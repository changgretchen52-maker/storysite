const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:JUCnatOIHEpsXNaBAJysQjxeWjKsKxvW@sakura.proxy.rlwy.net:19230/railway',
  ssl: { rejectUnauthorized: false }
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect()
};
