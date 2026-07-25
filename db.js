const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'storysite.db');

const db = new Database(dbPath);

const initPath = path.join(__dirname, 'init.sql');

if (fs.existsSync(initPath)) {
  const sql = fs.readFileSync(initPath, 'utf8');
  db.exec(sql);
}

module.exports = db;
