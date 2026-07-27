const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const db = require('./db');
const config = require('./config');
const { requireAuth, attachUser } = require('./middleware/auth');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

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

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'storysite',
    resource_type: 'auto',
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'mov', 'avi', 'mkv', 'm4v']
  }
});

function fileFilter(req, file, cb) {
  const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.mov', '.avi', '.mkv', '.m4v'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) cb(null, true);
  else cb(new Error('Only image or video files are allowed'));
}

const upload = multer({ storage, fileFilter, limits: { fileSize: 50 * 1024 * 1024 } });

app.get('/', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT posts.*, users.username, users.avatar_filename,
        (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id) as like_count,
        (SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id) as comment_count,
        (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id AND likes.user_id = $1) as user_liked
      FROM posts
      JOIN users ON posts.user_id = users.id
      ORDER BY posts.created_at DESC LIMIT 50
    `, [req.session.userId || 0]);
    res.render('index', { posts: result.rows });
  } catch (e) {
    console.error('Home error:', e);
    res.status(500).send('加载首页失败');
  }
});

app.get('/signup', (req, res) => res.render('signup', { error: null }));
app.post('/signup', async (req, res) => {
  try {
    const { username, password, confirmPassword } = req.body;
    if (!username || !password) return res.render('signup', { error: 'Username and password are required.' });
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return res.render('signup', { error: 'Username must be 3-20 characters: letters, numbers, underscores only.' });
    if (password.length < 8) return res.render('signup', { error: 'Password must be at least 8 characters.' });
    if (password !== confirmPassword) return res.render('signup', { error: 'Passwords do not match.' });
    const existing = await db.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.rows[0]) return res.render('signup', { error: 'That username is already taken.' });
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await db.query('INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id', [username, passwordHash]);
    req.session.userId = result.rows[0].id;
    res.redirect('/');
  } catch (e) {
    console.error('Signup error:', e);
    res.render('signup', { error: 'Something went wrong. Please try again.' });
  }
});

app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await db.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0];
    if (!user) return res.render('login', { error: 'Invalid username or password.' });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.render('login', { error: 'Invalid username or password.' });
    req.session.userId = user.id;
    res.redirect('/');
  } catch (e) {
    console.error('Login error:', e);
    res.render('login', { error: 'Something went wrong. Please try again.' });
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.get('/new', requireAuth, (req, res) => res.render('new', { error: null }));
app.post('/new', requireAuth, (req, res) => {
  upload.single('photo')(req, res, async (err) => {
    if (err) return res.render('new', { error: err.message });
    try {
      const { title, story } = req.body;
      if (!title || !story) return res.render('new', { error: 'Title and story are required.' });
      const photoFilename = req.file ? req.file.path : null;
      await db.query(
        'INSERT INTO posts (user_id, title, story, photo_filename) VALUES ($1, $2, $3, $4)',
        [req.session.userId, title, story, photoFilename]
      );
      res.redirect('/');
    } catch (e) {
      console.error('New post error:', e);
      res.render('new', { error: 'Something went wrong. Please try again.' });
    }
  });
});

app.post('/post/:id/like', requireAuth, async (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    const userId = req.session.userId;
    const existing = await db.query('SELECT id FROM likes WHERE post_id = $1 AND user_id = $2', [postId, userId]);
    if (existing.rows[0]) {
      await db.query('DELETE FROM likes WHERE post_id = $1 AND user_id = $2', [postId, userId]);
    } else {
      await db.query('INSERT INTO likes (post_id, user_id) VALUES ($1, $2)', [postId, userId]);
      const post = await db.query('SELECT user_id FROM posts WHERE id = $1', [postId]);
      if (post.rows[0] && post.rows[0].user_id !== userId) {
        await db.query(
          'INSERT INTO notifications (user_id, from_user_id, type, post_id) VALUES ($1, $2, $3, $4)',
          [post.rows[0].user_id, userId, 'like', postId]
        );
      }
    }
    res.redirect('back');
  } catch (e) {
    console.error('Like error:', e);
    res.redirect('back');
  }
});

app.post('/post/:id/comment', requireAuth, async (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    const userId = req.session.userId;
    const { content } = req.body;
    if (!content || content.trim() === '') return res.redirect('back');
    await db.query('INSERT INTO comments (post_id, user_id, content) VALUES ($1, $2, $3)', [postId, userId, content.trim()]);
    const post = await db.query('SELECT user_id FROM posts WHERE id = $1', [postId]);
    if (post.rows[0] && post.rows[0].user_id !== userId) {
      await db.query(
        'INSERT INTO notifications (user_id, from_user_id, type, post_id) VALUES ($1, $2, $3, $4)',
        [post.rows[0].user_id, userId, 'comment', postId]
      );
    }
    res.redirect('back');
  } catch (e) {
    console.error('Comment error:', e);
    res.redirect('back');
  }
});

app.get('/api/comments/:postId', async (req, res) => {
  try {
    const postId = parseInt(req.params.postId);
    const result = await db.query(`
      SELECT comments.*, users.username, users.avatar_filename
      FROM comments
      JOIN users ON comments.user_id = users.id
      WHERE comments.post_id = $1
      ORDER BY comments.created_at DESC LIMIT 20
    `, [postId]);
    res.json(result.rows);
  } catch (e) {
    console.error('Comments API error:', e);
    res.status(500).json([]);
  }
});

app.get('/user/:username', async (req, res) => {
  try {
    const userResult = await db.query(
      'SELECT id, username, bio, avatar_filename, cover_filename, blog_title, blog_description, created_at FROM users WHERE username = $1',
      [req.params.username]
    );
    const user = userResult.rows[0];
    if (!user) return res.status(404).render('404');
    const postsResult = await db.query('SELECT * FROM posts WHERE user_id = $1 ORDER BY created_at DESC', [user.id]);
    let currentUser = null;
    let friendStatus = null;
    let isOwnProfile = false;
    if (req.session.userId) {
      const currentUserResult = await db.query('SELECT * FROM users WHERE id = $1', [req.session.userId]);
      currentUser = currentUserResult.rows[0];
      isOwnProfile = req.session.userId === user.id;
      if (!isOwnProfile) {
        const sent = await db.query('SELECT status FROM friends WHERE user_id = $1 AND friend_id = $2', [req.session.userId, user.id]);
        if (sent.rows[0]) friendStatus = sent.rows[0].status;
        else {
          const received = await db.query('SELECT status FROM friends WHERE user_id = $1 AND friend_id = $2', [user.id, req.session.userId]);
          if (received.rows[0]) friendStatus = received.rows[0].status;
        }
      }
    }
    res.render('profile', { profileUser: user, posts: postsResult.rows, currentUser, friendStatus, isOwnProfile });
  } catch (e) {
    console.error('Profile error:', e);
    res.status(500).send('加载主页失败');
  }
});

app.post('/friend/:id/request', requireAuth, async (req, res) => {
  try {
    const friendId = parseInt(req.params.id);
    const userId = req.session.userId;
    if (userId === friendId) return res.redirect('back');
    const existing = await db.query('SELECT id FROM friends WHERE user_id = $1 AND friend_id = $2', [userId, friendId]);
    if (!existing.rows[0]) {
      await db.query('INSERT INTO friends (user_id, friend_id, status) VALUES ($1, $2, $3)', [userId, friendId, 'pending']);
      await db.query('INSERT INTO notifications (user_id, from_user_id, type) VALUES ($1, $2, $3)', [friendId, userId, 'friend_request']);
    }
    res.redirect('back');
  } catch (e) {
    console.error('Friend request error:', e);
    res.redirect('back');
  }
});

app.post('/friend/:id/accept', requireAuth, async (req, res) => {
  try {
    const friendId = parseInt(req.params.id);
    const userId = req.session.userId;
    await db.query('UPDATE friends SET status = $1 WHERE user_id = $2 AND friend_id = $3', ['accepted', friendId, userId]);
    res.redirect('back');
  } catch (e) {
    console.error('Friend accept error:', e);
    res.redirect('back');
  }
});

app.post('/friend/:id/reject', requireAuth, async (req, res) => {
  try {
    const friendId = parseInt(req.params.id);
    const userId = req.session.userId;
    await db.query('DELETE FROM friends WHERE user_id = $1 AND friend_id = $2', [friendId, userId]);
    res.redirect('back');
  } catch (e) {
    console.error('Friend reject error:', e);
    res.redirect('back');
  }
});

app.get('/messages', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const result = await db.query(`
      SELECT u.id, u.username, u.avatar_filename,
        (SELECT content FROM messages WHERE (sender_id = $1 AND receiver_id = u.id) OR (sender_id = u.id AND receiver_id = $2) ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM messages WHERE (sender_id = $3 AND receiver_id = u.id) OR (sender_id = u.id AND receiver_id = $4) ORDER BY created_at DESC LIMIT 1) as last_time
      FROM users u
      WHERE u.id IN (
        SELECT friend_id FROM friends WHERE user_id = $5 AND status = 'accepted'
        UNION
        SELECT user_id FROM friends WHERE friend_id = $6 AND status = 'accepted'
      )
      ORDER BY last_time DESC
    `, [userId, userId, userId, userId, userId, userId]);
    res.render('messages', { friends: result.rows });
  } catch (e) {
    console.error('Messages list error:', e);
    res.status(500).send('加载消息失败');
  }
});

app.get('/messages/:userId', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const otherUserId = parseInt(req.params.userId);
    const isFriend = await db.query(`
      SELECT id FROM friends WHERE 
      (user_id = $1 AND friend_id = $2 AND status = 'accepted') OR
      (user_id = $3 AND friend_id = $4 AND status = 'accepted')
    `, [userId, otherUserId, otherUserId, userId]);
    if (!isFriend.rows[0]) return res.redirect('/messages');
    const messagesResult = await db.query(`
      SELECT * FROM messages WHERE 
      (sender_id = $1 AND receiver_id = $2) OR (sender_id = $3 AND receiver_id = $4)
      ORDER BY created_at ASC
    `, [userId, otherUserId, otherUserId, userId]);
    await db.query('UPDATE messages SET is_read = 1 WHERE sender_id = $1 AND receiver_id = $2', [otherUserId, userId]);
    const otherUserResult = await db.query('SELECT id, username, avatar_filename FROM users WHERE id = $1', [otherUserId]);
    const currentUserResult = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
    res.render('message-chat', { otherUser: otherUserResult.rows[0], messages: messagesResult.rows, currentUser: currentUserResult.rows[0] });
  } catch (e) {
    console.error('Message chat error:', e);
    res.status(500).send('加载聊天记录失败');
  }
});

app.post('/messages/:userId', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const otherUserId = parseInt(req.params.userId);
    const { content } = req.body;
    if (!content || content.trim() === '') return res.redirect('back');
    await db.query('INSERT INTO messages (sender_id, receiver_id, content) VALUES ($1, $2, $3)', [userId, otherUserId, content.trim()]);
    await db.query('INSERT INTO notifications (user_id, from_user_id, type) VALUES ($1, $2, $3)', [otherUserId, userId, 'message']);
    res.redirect('back');
  } catch (e) {
    console.error('Send message error:', e);
    res.redirect('back');
  }
});

app.get('/notifications', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const result = await db.query(`
      SELECT n.*, u.username, u.avatar_filename,
        p.title as post_title, p.id as post_id
      FROM notifications n
      JOIN users u ON n.from_user_id = u.id
      LEFT JOIN posts p ON n.post_id = p.id
      WHERE n.user_id = $1
      ORDER BY n.created_at DESC LIMIT 50
    `, [userId]);
    await db.query('UPDATE notifications SET is_read = 1 WHERE user_id = $1', [userId]);
    res.render('notifications', { notifications: result.rows });
  } catch (e) {
    console.error('Notifications error:', e);
    res.status(500).send('加载通知失败');
  }
});

const profileUpload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }
}).fields([
  { name: 'avatar', maxCount: 1 },
  { name: 'cover', maxCount: 1 }
]);

app.get('/profile/edit', requireAuth, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM users WHERE id = $1', [req.session.userId]);
    res.render('profile-edit', { profileUser: result.rows[0], error: null });
  } catch (e) {
    console.error('Profile edit page error:', e);
    res.status(500).send('加载失败');
  }
});

app.post('/profile/edit', requireAuth, (req, res) => {
  profileUpload(req, res, async (err) => {
    try {
      const userResult = await db.query('SELECT * FROM users WHERE id = $1', [req.session.userId]);
      const user = userResult.rows[0];
      if (err) return res.render('profile-edit', { profileUser: user, error: err.message });
      const { bio, removeAvatar, removeCover, blogTitle, blogDescription } = req.body;
      let avatarFilename = user.avatar_filename;
      let coverFilename = user.cover_filename;
      if (req.files && req.files['avatar']) {
        if (user.avatar_filename) fs.unlink(path.join(UPLOAD_DIR, user.avatar_filename), () => {});
        avatarFilename = req.files['avatar'][0].path;
      } else if (removeAvatar === 'on' && user.avatar_filename) {
        fs.unlink(path.join(UPLOAD_DIR, user.avatar_filename), () => {});
        avatarFilename = null;
      }
      if (req.files && req.files['cover']) {
        if (user.cover_filename) fs.unlink(path.join(UPLOAD_DIR, user.cover_filename), () => {});
        coverFilename = req.files['cover'][0].path;
      } else if (removeCover === 'on' && user.cover_filename) {
        fs.unlink(path.join(UPLOAD_DIR, user.cover_filename), () => {});
        coverFilename = null;
      }
      await db.query(`
        UPDATE users SET bio = $1, avatar_filename = $2, cover_filename = $3, blog_title = $4, blog_description = $5 WHERE id = $6
      `, [bio || '', avatarFilename, coverFilename, blogTitle || user.username, blogDescription || '', user.id]);
      res.redirect('/user/' + user.username);
    } catch (e) {
      console.error('Profile edit error:', e);
      res.status(500).send('保存失败');
    }
  });
});

app.get('/gallery', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT posts.*, users.username FROM posts JOIN users ON posts.user_id = users.id WHERE posts.photo_filename IS NOT NULL ORDER BY posts.created_at DESC
    `);
    res.render('gallery', { posts: result.rows });
  } catch (e) {
    console.error('Gallery error:', e);
    res.status(500).send('加载失败');
  }
});

app.get('/post/:id', async (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    const postResult = await db.query(`
      SELECT posts.*, users.username, users.avatar_filename
      FROM posts
      JOIN users ON posts.user_id = users.id
      WHERE posts.id = $1
    `, [postId]);
    const post = postResult.rows[0];
    if (!post) return res.status(404).render('404');
    const likeCountResult = await db.query('SELECT COUNT(*) as count FROM likes WHERE post_id = $1', [postId]);
    const commentCountResult = await db.query('SELECT COUNT(*) as count FROM comments WHERE post_id = $1', [postId]);
    const commentsResult = await db.query(`
      SELECT comments.*, users.username, users.avatar_filename
      FROM comments
      JOIN users ON comments.user_id = users.id
      WHERE comments.post_id = $1 AND comments.parent_comment_id IS NULL
      ORDER BY comments.created_at ASC
    `, [postId]);
    const comments = commentsResult.rows;
    for (const comment of comments) {
      const repliesResult = await db.query(`
        SELECT replies.*, ru.username, ru.avatar_filename,
          pu.username as parent_username
        FROM comments replies
        JOIN users ru ON replies.user_id = ru.id
        JOIN comments pc ON replies.parent_comment_id = pc.id
        JOIN users pu ON pc.user_id = pu.id
        WHERE replies.parent_comment_id = $1
        ORDER BY replies.created_at ASC
      `, [comment.id]);
      comment.replies = repliesResult.rows;
    }
    let userLiked = false;
    if (req.session.userId) {
      const liked = await db.query('SELECT id FROM likes WHERE post_id = $1 AND user_id = $2', [postId, req.session.userId]);
      userLiked = !!liked.rows[0];
    }
    let currentUser = null;
    if (req.session.userId) {
      const currentUserResult = await db.query('SELECT * FROM users WHERE id = $1', [req.session.userId]);
      currentUser = currentUserResult.rows[0];
    }
    res.render('post-detail', {
      post,
      likeCount: likeCountResult.rows[0].count,
      commentCount: commentCountResult.rows[0].count,
      comments,
      userLiked,
      currentUser
    });
  } catch (e) {
    console.error('Post detail error:', e);
    res.status(500).send('加载失败');
  }
});

app.post('/comment/:id/reply', requireAuth, async (req, res) => {
  try {
    const parentCommentId = parseInt(req.params.id);
    const userId = req.session.userId;
    const { content } = req.body;
    if (!content || content.trim() === '') return res.redirect('back');
    const parentResult = await db.query('SELECT post_id FROM comments WHERE id = $1', [parentCommentId]);
    const parent = parentResult.rows[0];
    if (!parent) return res.redirect('back');
    await db.query(
      'INSERT INTO comments (post_id, user_id, content, parent_comment_id) VALUES ($1, $2, $3, $4)',
      [parent.post_id, userId, content.trim(), parentCommentId]
    );
    const parentUserResult = await db.query('SELECT user_id FROM comments WHERE id = $1', [parentCommentId]);
    const parentUser = parentUserResult.rows[0];
    if (parentUser && parentUser.user_id !== userId) {
      await db.query(
        'INSERT INTO notifications (user_id, from_user_id, type, post_id) VALUES ($1, $2, $3, $4)',
        [parentUser.user_id, userId, 'comment', parent.post_id]
      );
    }
    res.redirect('back');
  } catch (e) {
    console.error('Reply error:', e);
    res.redirect('back');
  }
});

app.get('/post/:id/edit', requireAuth, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM posts WHERE id = $1', [req.params.id]);
    const post = result.rows[0];
    if (!post || post.user_id !== req.session.userId) return res.status(403).send('Not allowed');
    res.render('edit', { post, error: null });
  } catch (e) {
    console.error('Edit page error:', e);
    res.status(500).send('加载失败');
  }
});

app.post('/post/:id/edit', requireAuth, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM posts WHERE id = $1', [req.params.id]);
    const post = result.rows[0];
    if (!post || post.user_id !== req.session.userId) return res.status(403).send('Not allowed');
    upload.single('photo')(req, res, async (err) => {
      try {
        if (err) return res.render('edit', { post, error: err.message });
        const { title, story, removePhoto } = req.body;
        if (!title || !story) return res.render('edit', { post, error: 'Title and story are required.' });
        let photoFilename = post.photo_filename;
        if (req.file) {
          if (post.photo_filename) fs.unlink(path.join(UPLOAD_DIR, post.photo_filename), () => {});
          photoFilename = req.file.path;
        } else if (removePhoto === 'on' && post.photo_filename) {
          fs.unlink(path.join(UPLOAD_DIR, post.photo_filename), () => {});
          photoFilename = null;
        }
        await db.query('UPDATE posts SET title = $1, story = $2, photo_filename = $3 WHERE id = $4', [title, story, photoFilename, post.id]);
        const userResult = await db.query('SELECT username FROM users WHERE id = $1', [req.session.userId]);
        res.redirect('/user/' + userResult.rows[0].username);
      } catch (e2) {
        console.error('Edit save error:', e2);
        res.status(500).send('保存失败');
      }
    });
  } catch (e) {
    console.error('Edit post error:', e);
    res.status(500).send('加载失败');
  }
});

app.post('/post/:id/delete', requireAuth, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM posts WHERE id = $1', [req.params.id]);
    const post = result.rows[0];
    if (!post || post.user_id !== req.session.userId) return res.status(403).send('Not allowed');
    if (post.photo_filename) fs.unlink(path.join(UPLOAD_DIR, post.photo_filename), () => {});
    await db.query('DELETE FROM likes WHERE post_id = $1', [post.id]);
    await db.query('DELETE FROM comments WHERE post_id = $1', [post.id]);
    await db.query('DELETE FROM posts WHERE id = $1', [post.id]);
    res.redirect('back');
  } catch (e) {
    console.error('Delete post error:', e);
    res.status(500).send('删除失败');
  }
});

app.get('/explore', async (req, res) => {
  try {
    const usersResult = await db.query('SELECT id, username, avatar_filename, bio, created_at FROM users ORDER BY created_at DESC');
    const users = usersResult.rows;
    const totalPostsResult = await db.query('SELECT COUNT(*) as count FROM posts');
    const totalPosts = totalPostsResult.rows[0].count;
    const imagePostsResult = await db.query(`
      SELECT posts.*, users.username, users.avatar_filename
      FROM posts 
      JOIN users ON posts.user_id = users.id 
      WHERE posts.photo_filename IS NOT NULL 
      ORDER BY posts.created_at DESC
    `);
    const textPostsResult = await db.query(`
      SELECT posts.*, users.username, users.avatar_filename
      FROM posts 
      JOIN users ON posts.user_id = users.id 
      WHERE posts.photo_filename IS NULL 
      ORDER BY posts.created_at DESC
    `);
    const totalUsers = users.length;
    res.render('explore', {
      users,
      totalPosts,
      totalUsers,
      imagePosts: imagePostsResult.rows,
      textPosts: textPostsResult.rows
    });
  } catch (e) {
    console.log('Explore error:', e.message);
    res.status(500).send('探索页面加载失败');
  }
});

app.post('/api/theme', requireAuth, async (req, res) => {
  try {
    const { theme_color } = req.body;
    const userId = req.session.userId;
    await db.query('UPDATE users SET theme_color = $1 WHERE id = $2', [theme_color, userId]);
    res.json({ success: true });
  } catch (e) {
    console.error('Theme error:', e);
    res.status(500).json({ success: false });
  }
});

app.use((req, res) => res.status(404).render('404'));

app.listen(PORT, () => console.log(`Storysite running at http://localhost:${PORT}`));
