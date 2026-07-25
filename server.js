const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('./db');
const config = require('./config');
const { requireAuth, attachUser } = require('./middleware/auth');
const crypto = require('crypto');                                                       const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-secret-in-production';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

app.use(attachUser(db));

app.use((req, res, next) => {
  res.locals.siteName = config.siteName;
  res.locals.tagline = config.tagline;
  next();
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = crypto.randomBytes(8).toString('hex');
    cb(null, `${Date.now()}-${unique}${path.extname(file.originalname).toLowerCase()}`);
  }
});

function fileFilter(req, file, cb) {
  const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.mov', '.avi', '.mkv', '.m4v'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) cb(null, true);
  else cb(new Error('Only image or video files are allowed'));
}

const upload = multer({ storage, fileFilter, limits: { fileSize: 50 * 1024 * 1024 } });

app.get('/', (req, res) => {
  const posts = db.prepare(`
    SELECT posts.*, users.username, users.avatar_filename,
      (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id) as like_count,
      (SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id) as comment_count,
      (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id AND likes.user_id = ?) as user_liked
    FROM posts
    JOIN users ON posts.user_id = users.id
    ORDER BY posts.created_at DESC LIMIT 50
  `).all(req.session.userId || 0);
  res.render('index', { posts });
});

app.get('/signup', (req, res) => res.render('signup', { error: null }));
app.post('/signup', async (req, res) => {
  const { username, password, confirmPassword } = req.body;
  if (!username || !password) return res.render('signup', { error: 'Username and password are required.' });
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return res.render('signup', { error: 'Username must be 3-20 characters: letters, numbers, underscores only.' });
  if (password.length < 8) return res.render('signup', { error: 'Password must be at least 8 characters.' });
  if (password !== confirmPassword) return res.render('signup', { error: 'Passwords do not match.' });
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.render('signup', { error: 'That username is already taken.' });
  const passwordHash = await bcrypt.hash(password, 10);
  const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, passwordHash);
  req.session.userId = result.lastInsertRowid;
  res.redirect('/');
});

app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.render('login', { error: 'Invalid username or password.' });
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.render('login', { error: 'Invalid username or password.' });
  req.session.userId = user.id;
  res.redirect('/');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.get('/new', requireAuth, (req, res) => res.render('new', { error: null }));
app.post('/new', requireAuth, (req, res) => {
  upload.single('photo')(req, res, (err) => {
    if (err) return res.render('new', { error: err.message });
    const { title, story } = req.body;
    if (!title || !story) return res.render('new', { error: 'Title and story are required.' });
    const photoFilename = req.file ? req.file.filename : null;
    db.prepare('INSERT INTO posts (user_id, title, story, photo_filename) VALUES (?, ?, ?, ?)')
      .run(req.session.userId, title, story, photoFilename);
    res.redirect('/');
  });
});

app.post('/post/:id/like', requireAuth, (req, res) => {
  const postId = parseInt(req.params.id);
  const userId = req.session.userId;
  const existing = db.prepare('SELECT id FROM likes WHERE post_id = ? AND user_id = ?').get(postId, userId);
  if (existing) {
    db.prepare('DELETE FROM likes WHERE post_id = ? AND user_id = ?').run(postId, userId);
  } else {
    db.prepare('INSERT INTO likes (post_id, user_id) VALUES (?, ?)').run(postId, userId);
    const post = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(postId);
    if (post && post.user_id !== userId) {
      db.prepare('INSERT INTO notifications (user_id, from_user_id, type, post_id) VALUES (?, ?, ?, ?)')
        .run(post.user_id, userId, 'like', postId);
    }
  }
  res.redirect('back');
});

app.post('/post/:id/comment', requireAuth, (req, res) => {
  const postId = parseInt(req.params.id);
  const userId = req.session.userId;
  const { content } = req.body;
  if (!content || content.trim() === '') return res.redirect('back');
  db.prepare('INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)')
    .run(postId, userId, content.trim());
  const post = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(postId);
  if (post && post.user_id !== userId) {
    db.prepare('INSERT INTO notifications (user_id, from_user_id, type, post_id) VALUES (?, ?, ?, ?)')
      .run(post.user_id, userId, 'comment', postId);
  }
  res.redirect('back');
});

app.get('/api/comments/:postId', (req, res) => {
  const postId = parseInt(req.params.postId);
  const comments = db.prepare(`
    SELECT comments.*, users.username, users.avatar_filename
    FROM comments
    JOIN users ON comments.user_id = users.id
    WHERE comments.post_id = ?
    ORDER BY comments.created_at DESC LIMIT 20
  `).all(postId);
  res.json(comments);
});

app.get('/user/:username', (req, res) => {
  const user = db.prepare('SELECT id, username, bio, avatar_filename, cover_filename, blog_title, blog_description, created_at FROM users WHERE username = ?').get(req.params.username);
  if (!user) return res.status(404).render('404');
  const posts = db.prepare('SELECT * FROM posts WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
  let currentUser = null;
  let friendStatus = null;
  let isOwnProfile = false;
  if (req.session.userId) {
    currentUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    isOwnProfile = req.session.userId === user.id;
    if (!isOwnProfile) {
      const sent = db.prepare('SELECT status FROM friends WHERE user_id = ? AND friend_id = ?').get(req.session.userId, user.id);
      if (sent) friendStatus = sent.status;
      else {
        const received = db.prepare('SELECT status FROM friends WHERE user_id = ? AND friend_id = ?').get(user.id, req.session.userId);
        if (received) friendStatus = received.status;
      }
    }
  }
  res.render('profile', { profileUser: user, posts, currentUser, friendStatus, isOwnProfile });
});

app.post('/friend/:id/request', requireAuth, (req, res) => {
  const friendId = parseInt(req.params.id);
  const userId = req.session.userId;
  if (userId === friendId) return res.redirect('back');
  const existing = db.prepare('SELECT id FROM friends WHERE user_id = ? AND friend_id = ?').get(userId, friendId);
  if (!existing) {
    db.prepare('INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, ?)').run(userId, friendId, 'pending');
    db.prepare('INSERT INTO notifications (user_id, from_user_id, type) VALUES (?, ?, ?)').run(friendId, userId, 'friend_request');
  }
  res.redirect('back');
});

app.post('/friend/:id/accept', requireAuth, (req, res) => {
  const friendId = parseInt(req.params.id);
  const userId = req.session.userId;
  db.prepare('UPDATE friends SET status = ? WHERE user_id = ? AND friend_id = ?').run('accepted', friendId, userId);
  res.redirect('back');
});

app.post('/friend/:id/reject', requireAuth, (req, res) => {
  const friendId = parseInt(req.params.id);
  const userId = req.session.userId;
  db.prepare('DELETE FROM friends WHERE user_id = ? AND friend_id = ?').run(friendId, userId);
  res.redirect('back');
});

app.get('/messages', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const friends = db.prepare(`
    SELECT u.id, u.username, u.avatar_filename,
      (SELECT content FROM messages WHERE (sender_id = ? AND receiver_id = u.id) OR (sender_id = u.id AND receiver_id = ?) ORDER BY created_at DESC LIMIT 1) as last_message,
      (SELECT created_at FROM messages WHERE (sender_id = ? AND receiver_id = u.id) OR (sender_id = u.id AND receiver_id = ?) ORDER BY created_at DESC LIMIT 1) as last_time
    FROM users u
    WHERE u.id IN (
      SELECT friend_id FROM friends WHERE user_id = ? AND status = 'accepted'
      UNION
      SELECT user_id FROM friends WHERE friend_id = ? AND status = 'accepted'
    )
    ORDER BY last_time DESC
  `).all(userId, userId, userId, userId, userId, userId);
  res.render('messages', { friends });
});

app.get('/messages/:userId', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const otherUserId = parseInt(req.params.userId);
  const isFriend = db.prepare(`
    SELECT id FROM friends WHERE 
    (user_id = ? AND friend_id = ? AND status = 'accepted') OR
    (user_id = ? AND friend_id = ? AND status = 'accepted')
  `).get(userId, otherUserId, otherUserId, userId);
  if (!isFriend) return res.redirect('/messages');
  const messages = db.prepare(`
    SELECT * FROM messages WHERE 
    (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
    ORDER BY created_at ASC
  `).all(userId, otherUserId, otherUserId, userId);
  db.prepare('UPDATE messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ?').run(otherUserId, userId);
  const otherUser = db.prepare('SELECT id, username, avatar_filename FROM users WHERE id = ?').get(otherUserId);
  const currentUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  res.render('message-chat', { otherUser, messages, currentUser });
});

app.post('/messages/:userId', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const otherUserId = parseInt(req.params.userId);
  const { content } = req.body;
  if (!content || content.trim() === '') return res.redirect('back');
  db.prepare('INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)').run(userId, otherUserId, content.trim());
  db.prepare('INSERT INTO notifications (user_id, from_user_id, type) VALUES (?, ?, ?)').run(otherUserId, userId, 'message');
  res.redirect('back');
});

app.get('/notifications', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const notifications = db.prepare(`
    SELECT n.*, u.username, u.avatar_filename,
      p.title as post_title, p.id as post_id
    FROM notifications n
    JOIN users u ON n.from_user_id = u.id
    LEFT JOIN posts p ON n.post_id = p.id
    WHERE n.user_id = ?
    ORDER BY n.created_at DESC LIMIT 50
  `).all(userId);
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(userId);
  res.render('notifications', { notifications });
});

const profileUpload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }
}).fields([
  { name: 'avatar', maxCount: 1 },
  { name: 'cover', maxCount: 1 }
]);

app.get('/profile/edit', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  res.render('profile-edit', { profileUser: user, error: null });
});

app.post('/profile/edit', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  profileUpload(req, res, async (err) => {
    if (err) return res.render('profile-edit', { profileUser: user, error: err.message });
    const { bio, removeAvatar, removeCover, blogTitle, blogDescription } = req.body;
    let avatarFilename = user.avatar_filename;
    let coverFilename = user.cover_filename;
    if (req.files && req.files['avatar']) {
      if (user.avatar_filename) fs.unlink(path.join(UPLOAD_DIR, user.avatar_filename), () => {});
      avatarFilename = req.files['avatar'][0].filename;
    } else if (removeAvatar === 'on' && user.avatar_filename) {
      fs.unlink(path.join(UPLOAD_DIR, user.avatar_filename), () => {});
      avatarFilename = null;
    }
    if (req.files && req.files['cover']) {
      if (user.cover_filename) fs.unlink(path.join(UPLOAD_DIR, user.cover_filename), () => {});
      coverFilename = req.files['cover'][0].filename;
    } else if (removeCover === 'on' && user.cover_filename) {
      fs.unlink(path.join(UPLOAD_DIR, user.cover_filename), () => {});
      coverFilename = null;
    }
    db.prepare(`
      UPDATE users SET bio = ?, avatar_filename = ?, cover_filename = ?, blog_title = ?, blog_description = ? WHERE id = ?
    `).run(bio || '', avatarFilename, coverFilename, blogTitle || user.username, blogDescription || '', user.id);
    res.redirect('/user/' + user.username);
  });
});

app.get('/gallery', (req, res) => {
  const posts = db.prepare(`
    SELECT posts.*, users.username FROM posts JOIN users ON posts.user_id = users.id WHERE posts.photo_filename IS NOT NULL ORDER BY posts.created_at DESC
  `).all();
  res.render('gallery', { posts });
});

app.get('/post/:id', (req, res) => {
  const postId = parseInt(req.params.id);
  const post = db.prepare(`
    SELECT posts.*, users.username, users.avatar_filename
    FROM posts
    JOIN users ON posts.user_id = users.id
    WHERE posts.id = ?
  `).get(postId);
  if (!post) return res.status(404).render('404');
  const likeCount = db.prepare('SELECT COUNT(*) as count FROM likes WHERE post_id = ?').get(postId).count;
  const commentCount = db.prepare('SELECT COUNT(*) as count FROM comments WHERE post_id = ?').get(postId).count;
  const comments = db.prepare(`
    SELECT comments.*, users.username, users.avatar_filename
    FROM comments
    JOIN users ON comments.user_id = users.id
    WHERE comments.post_id = ? AND comments.parent_comment_id IS NULL
    ORDER BY comments.created_at ASC
  `).all(postId);
  comments.forEach(comment => {
    const replies = db.prepare(`
      SELECT replies.*, users.username, users.avatar_filename,
        parent.username as parent_username
      FROM comments replies
      JOIN users ON replies.user_id = users.id
      JOIN comments parent ON replies.parent_comment_id = parent.id
      JOIN users parent ON parent.user_id = parent.id
      WHERE replies.parent_comment_id = ?
      ORDER BY replies.created_at ASC
    `).all(comment.id);
    comment.replies = replies;
  });
  let userLiked = false;
  if (req.session.userId) {
    const liked = db.prepare('SELECT id FROM likes WHERE post_id = ? AND user_id = ?').get(postId, req.session.userId);
    userLiked = !!liked;
  }
  let currentUser = null;
  if (req.session.userId) {
    currentUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  }
  res.render('post-detail', { post, likeCount, commentCount, comments, userLiked, currentUser });
});

app.post('/comment/:id/reply', requireAuth, (req, res) => {
  const parentCommentId = parseInt(req.params.id);
  const userId = req.session.userId;
  const { content } = req.body;
  if (!content || content.trim() === '') return res.redirect('back');
  const parent = db.prepare('SELECT post_id FROM comments WHERE id = ?').get(parentCommentId);
  if (!parent) return res.redirect('back');
  db.prepare('INSERT INTO comments (post_id, user_id, content, parent_comment_id) VALUES (?, ?, ?, ?)')
    .run(parent.post_id, userId, content.trim(), parentCommentId);
  const parentUser = db.prepare('SELECT user_id FROM comments WHERE id = ?').get(parentCommentId);
  if (parentUser && parentUser.user_id !== userId) {
    db.prepare('INSERT INTO notifications (user_id, from_user_id, type, post_id) VALUES (?, ?, ?, ?)')
      .run(parentUser.user_id, userId, 'comment', parent.post_id);
  }
  res.redirect('back');
});

app.get('/post/:id/edit', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post || post.user_id !== req.session.userId) return res.status(403).send('Not allowed');
  res.render('edit', { post, error: null });
});

app.post('/post/:id/edit', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post || post.user_id !== req.session.userId) return res.status(403).send('Not allowed');
  upload.single('photo')(req, res, (err) => {
    if (err) return res.render('edit', { post, error: err.message });
    const { title, story, removePhoto } = req.body;
    if (!title || !story) return res.render('edit', { post, error: 'Title and story are required.' });
    let photoFilename = post.photo_filename;
    if (req.file) {
      if (post.photo_filename) fs.unlink(path.join(UPLOAD_DIR, post.photo_filename), () => {});
      photoFilename = req.file.filename;
    } else if (removePhoto === 'on' && post.photo_filename) {
      fs.unlink(path.join(UPLOAD_DIR, post.photo_filename), () => {});
      photoFilename = null;
    }
    db.prepare('UPDATE posts SET title = ?, story = ?, photo_filename = ? WHERE id = ?').run(title, story, photoFilename, post.id);
    const user = db.prepare('SELECT username FROM users WHERE id = ?').get(req.session.userId);
    res.redirect('/user/' + user.username);
  });
});

app.post('/post/:id/delete', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post || post.user_id !== req.session.userId) return res.status(403).send('Not allowed');
  if (post.photo_filename) fs.unlink(path.join(UPLOAD_DIR, post.photo_filename), () => {});
  db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
  res.redirect('back');
});

// ========== 探索 ==========
app.get('/explore', (req, res) => {
  try {
    const users = db.prepare('SELECT id, username, avatar_filename, bio, created_at FROM users ORDER BY created_at DESC').all();
    const totalPosts = db.prepare('SELECT COUNT(*) as count FROM posts').get().count;
    const imagePosts = db.prepare(`
      SELECT posts.*, users.username, users.avatar_filename
      FROM posts 
      JOIN users ON posts.user_id = users.id 
      WHERE posts.photo_filename IS NOT NULL 
      ORDER BY posts.created_at DESC
    `).all();
    const textPosts = db.prepare(`
      SELECT posts.*, users.username, users.avatar_filename
      FROM posts 
      JOIN users ON posts.user_id = users.id 
      WHERE posts.photo_filename IS NULL 
      ORDER BY posts.created_at DESC
    `).all();
    const totalUsers = users.length;
    res.render('explore', { users, totalPosts, totalUsers, imagePosts, textPosts });
  } catch(e) {
    console.log('Explore error:', e.message);
    res.status(500).send('探索页面加载失败');
  }
});

// ========== 保存主题色 ==========
app.post('/api/theme', requireAuth, (req, res) => {
  const { theme_color } = req.body;
  const userId = req.session.userId;
  db.prepare('UPDATE users SET theme_color = ? WHERE id = ?').run(theme_color, userId);
  res.json({ success: true });
});

app.use((req, res) => res.status(404).render('404'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Storysite running on port ${PORT}`);
});
