const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const cors = require('cors');
const path = require('path');
const { 
  createUser, 
  findUser, 
  verifyPassword, 
  searchUsers, 
  saveMessage, 
  getHistory, 
  getRecentChats 
} = require('./database');

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const io = new Server(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

// Store connected users: { socketId: { socketId, userId, username } }
// Also map userId -> socketId for offline messaging
let connectedUsers = {}; // socketId -> info
let userSockets = {};    // userId -> socketId

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  socket.emit("me", socket.id);

  // REGISTER
  socket.on('register', async ({ username, password }) => {
    try {
      await createUser(username, password);
      socket.emit('register_success');
    } catch (err) {
      socket.emit('register_error', 'Username already exists');
    }
  });

  // LOGIN
  socket.on('login', async ({ username, password }) => {
    try {
      const user = await findUser(username);
      if (user && verifyPassword(user, password)) {
        // Store user info
        connectedUsers[socket.id] = { socketId: socket.id, userId: user.id, username };
        userSockets[user.id] = socket.id;

        socket.emit('login_success', { id: user.id, username });
        console.log(`User logged in: ${username} (ID: ${user.id})`);
        
        // Send recent chats
        const chats = await getRecentChats(user.id);
        socket.emit('recent_chats', chats);

      } else {
        socket.emit('login_error', 'Invalid credentials');
      }
    } catch (err) {
      console.error(err);
      socket.emit('login_error', 'Server error');
    }
  });

  // SEARCH USERS
  socket.on('search_users', async (query) => {
    const user = connectedUsers[socket.id];
    if (!user) return;
    try {
      const results = await searchUsers(query, user.userId);
      socket.emit('search_results', results);
    } catch (err) {
      console.error(err);
    }
  });

  // GET HISTORY
  socket.on('get_history', async (otherUserId) => {
    const user = connectedUsers[socket.id];
    if (!user) return;
    try {
      const messages = await getHistory(user.userId, otherUserId);
      socket.emit('history', { userId: otherUserId, messages });
    } catch (err) {
      console.error(err);
    }
  });

  // PRIVATE MESSAGE
  socket.on('private message', async ({ content, toUserId }) => {
    const fromUser = connectedUsers[socket.id];
    if (!fromUser) return;

    try {
      // Save to DB
      const msg = await saveMessage(fromUser.userId, toUserId, content);
      
      // Send to recipient if online
      const recipientSocketId = userSockets[toUserId];
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('private message', {
          content,
          fromUserId: fromUser.userId,
          username: fromUser.username,
          timestamp: msg.created_at
        });
      }
      
      // Send confirmation to sender (optional, but good for UI consistency)
      socket.emit('message_sent', {
          content,
          toUserId,
          timestamp: msg.created_at
      });

    } catch (err) {
      console.error("Message error:", err);
    }
  });

  // WebRTC Signaling (Call)
  // We need to map socketId to userId for calls to work with new logic
  socket.on("callUser", (data) => {
    // data.userToCall is now userId (not socketId)
    const targetSocketId = userSockets[data.userToCall];
    if (targetSocketId) {
        io.to(targetSocketId).emit("callUser", { 
            signal: data.signalData, 
            from: connectedUsers[socket.id]?.userId, // Send userId
            name: data.name 
        });
    }
  });

  socket.on("answerCall", (data) => {
    // data.to is caller's userId
    const targetSocketId = userSockets[data.to];
    if (targetSocketId) {
        io.to(targetSocketId).emit("callAccepted", data.signal);
    }
  });

  socket.on('disconnect', () => {
    const user = connectedUsers[socket.id];
    if (user) {
        console.log('User disconnected:', user.username);
        delete userSockets[user.userId];
        delete connectedUsers[socket.id];
    }
    socket.broadcast.emit("callEnded");
  });
});

const PORT = process.env.PORT || 3003;
server.listen(PORT, () => {
  console.log(`Server listening on *:${PORT}`);
});
