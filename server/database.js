const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// Connect to DB using connection string from environment variable
// If running locally without env var, you might need a local postgres or fallback
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for Render
  }
});

// Initialize DB
pool.query(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  )
`).catch(err => console.error('Error creating table:', err));

// Helper functions
function createUser(username, password) {
  return new Promise(async (resolve, reject) => {
    try {
      const hash = bcrypt.hashSync(password, 10);
      const res = await pool.query(
        'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id',
        [username, hash]
      );
      resolve(res.rows[0].id);
    } catch (err) {
      reject(err);
    }
  });
}

function findUser(username) {
  return new Promise(async (resolve, reject) => {
    try {
      const res = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
      resolve(res.rows[0]);
    } catch (err) {
      reject(err);
    }
  });
}

function verifyPassword(user, password) {
  return bcrypt.compareSync(password, user.password);
}

module.exports = { createUser, findUser, verifyPassword };
