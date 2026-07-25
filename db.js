const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'storysite.db'));

db.pragma('journal_mode = WAL');

// 创建所有表
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    bio TEXT DEFAULT '',
    avatar_filename TEXT,
    cover_filename TEXT,
    blog_title TEXT,
    blog_description TEXT,
    theme_color TEXT DEFAULT '#b5573a',
    music_filename TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    story TEXT NOT NULL,
    excerpt TEXT,
    photo_filename TEXT,
    read_time INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(post_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    parent_comment_id INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS friends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    friend_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, friend_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    from_user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    post_id INTEGER,
    is_read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// 检查并添加缺失的字段（兼容旧数据库）
const userColumns = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
const columnsToAdd = ['cover_filename', 'blog_title', 'blog_description', 'theme_color', 'music_filename'];
columnsToAdd.forEach(col => {
  if (!userColumns.includes(col)) {
    db.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT`);
  }
});

const postsColumns = db.prepare("PRAGMA table_info(posts)").all().map((c) => c.name);
if (!postsColumns.includes('excerpt')) {
  db.exec('ALTER TABLE posts ADD COLUMN excerpt TEXT');
}
if (!postsColumns.includes('read_time')) {
  db.exec('ALTER TABLE posts ADD COLUMN read_time INTEGER DEFAULT 1');
}

const commentsColumns = db.prepare("PRAGMA table_info(comments)").all().map((c) => c.name);
if (!commentsColumns.includes('parent_comment_id')) {
  db.exec('ALTER TABLE comments ADD COLUMN parent_comment_id INTEGER');
}

module.exports = db;
