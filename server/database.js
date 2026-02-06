const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// Config SSL based on environment
// Timeweb/Render usually require SSL for external connections, but internal might differ.
// Best approach: allow unauthorized certs if SSL is enabled.
const connectionConfig = {
  connectionString: process.env.DATABASE_URL,
};

// If DATABASE_URL contains "sslmode", pg might handle it automatically.
// But usually for cloud providers we need explicit SSL config:
if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes("ssl")) {
    connectionConfig.ssl = {
        rejectUnauthorized: false
    };
}

const pool = new Pool(connectionConfig);

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
