const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// Config SSL based on environment
const connectionConfig = {
  connectionString: process.env.DATABASE_URL,
};

if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes("ssl")) {
    connectionConfig.ssl = {
        rejectUnauthorized: false
    };
}

const pool = new Pool(connectionConfig);

// Initialize DB
const initDB = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        from_user_id INTEGER NOT NULL,
        to_user_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Migrations for new features
    try { await pool.query(`ALTER TABLE messages ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE`); } catch (e) {}
    try { await pool.query(`ALTER TABLE messages ADD COLUMN is_edited BOOLEAN DEFAULT FALSE`); } catch (e) {}
    try { await pool.query(`ALTER TABLE messages ADD COLUMN type TEXT DEFAULT 'text'`); } catch (e) {}
    try { await pool.query(`ALTER TABLE messages ADD COLUMN file_url TEXT`); } catch (e) {}
    try { await pool.query(`ALTER TABLE messages ADD COLUMN file_name TEXT`); } catch (e) {}

    console.log("Database tables initialized and migrated");
  } catch (err) {
    console.error('Error creating tables:', err);
  }
};

initDB();

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

// --- New Features ---

// Search users by username (partial match)
function searchUsers(query, currentUserId) {
  return new Promise(async (resolve, reject) => {
    try {
      // Find users matching query, exclude current user
      const res = await pool.query(
        'SELECT id, username FROM users WHERE username ILIKE $1 AND id != $2 LIMIT 20',
        [`%${query}%`, currentUserId]
      );
      resolve(res.rows);
    } catch (err) {
      reject(err);
    }
  });
}

// Save a private message
function saveMessage(fromId, toId, content, type = 'text', fileUrl = null, fileName = null) {
  return new Promise(async (resolve, reject) => {
    try {
      const res = await pool.query(
        'INSERT INTO messages (from_user_id, to_user_id, content, type, file_url, file_name) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [fromId, toId, content, type, fileUrl, fileName]
      );
      resolve(res.rows[0]);
    } catch (err) {
      reject(err);
    }
  });
}

function editMessage(messageId, userId, newContent) {
    return new Promise(async (resolve, reject) => {
        try {
            // Check ownership
            const check = await pool.query('SELECT from_user_id FROM messages WHERE id = $1', [messageId]);
            if (check.rows.length === 0 || check.rows[0].from_user_id !== userId) {
                return reject("Unauthorized or not found");
            }
            const res = await pool.query(
                'UPDATE messages SET content = $1, is_edited = TRUE WHERE id = $2 RETURNING *',
                [newContent, messageId]
            );
            resolve(res.rows[0]);
        } catch (err) { reject(err); }
    });
}

function deleteMessage(messageId, userId) {
    return new Promise(async (resolve, reject) => {
        try {
             // Check ownership
            const check = await pool.query('SELECT from_user_id FROM messages WHERE id = $1', [messageId]);
            if (check.rows.length === 0 || check.rows[0].from_user_id !== userId) {
                return reject("Unauthorized or not found");
            }
            const res = await pool.query(
                'UPDATE messages SET is_deleted = TRUE, content = \'Message deleted\' WHERE id = $1 RETURNING *',
                [messageId]
            );
            resolve(res.rows[0]);
        } catch (err) { reject(err); }
    });
}

// Get chat history between two users
function getHistory(user1Id, user2Id) {
  return new Promise(async (resolve, reject) => {
    try {
      const res = await pool.query(
        `SELECT * FROM messages 
         WHERE (from_user_id = $1 AND to_user_id = $2) 
            OR (from_user_id = $2 AND to_user_id = $1)
         ORDER BY created_at ASC LIMIT 100`,
        [user1Id, user2Id]
      );
      resolve(res.rows);
    } catch (err) {
      reject(err);
    }
  });
}

// Get list of users with whom current user has chats
function getRecentChats(currentUserId) {
    return new Promise(async (resolve, reject) => {
      try {
        const res = await pool.query(
          `SELECT DISTINCT u.id, u.username 
           FROM users u
           JOIN messages m ON (m.from_user_id = u.id OR m.to_user_id = u.id)
           WHERE (m.from_user_id = $1 OR m.to_user_id = $1) AND u.id != $1
           ORDER BY u.username`, 
           [currentUserId]
        );
        resolve(res.rows);
      } catch (err) {
        reject(err);
      }
    });
}

module.exports = { 
    createUser, 
    findUser, 
    verifyPassword,
    searchUsers,
    saveMessage,
    editMessage,
    deleteMessage,
    getHistory,
    getRecentChats
};
