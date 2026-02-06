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
  updateUserAvatar,
  verifyPassword, 
  searchUsers, 
  saveMessage, 
  editMessage,
  deleteMessage,
  markMessagesAsRead,
  getHistory, 
  getRecentChats 
} = require('./database');

app.use(cors());
// Increase limit for base64 file uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const io = new Server(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e8 // 100 MB
});

// Store connected users: { socketId: { socketId, userId, username } }
// Also map userId -> socketId for offline messaging
let connectedUsers = {}; // socketId -> info
let userSockets = {};    // userId -> socketId (only one socket per user for simplicity, or last active)

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

        // Pass avatar_url
        socket.emit('login_success', { id: user.id, username, avatar_url: user.avatar_url });
        console.log(`User logged in: ${username} (ID: ${user.id})`);
        
        // Broadcast online status
        io.emit('user_status', { userId: user.id, status: 'online' });

        // Send recent chats
        const chats = await getRecentChats(user.id);
        socket.emit('recent_chats', chats);

        // Send list of currently online users IDs
        const onlineIds = Object.values(connectedUsers).map(u => u.userId);
        socket.emit('online_users', onlineIds);

      } else {
        socket.emit('login_error', 'Invalid credentials');
      }
    } catch (err) {
      console.error(err);
      socket.emit('login_error', 'Server error');
    }
  });

  // UPDATE AVATAR
  socket.on('update_avatar', async ({ avatarUrl }) => {
      const user = connectedUsers[socket.id];
      if (!user) return;
      try {
          const result = await updateUserAvatar(user.userId, avatarUrl);
          socket.emit('avatar_updated', { avatarUrl: result.avatar_url });
      } catch (e) {
          console.error(e);
      }
  });

  // TYPING STATUS
  socket.on('typing', ({ toUserId }) => {
      const targetSocketId = userSockets[toUserId];
      if (targetSocketId) {
          io.to(targetSocketId).emit('typing', { fromUserId: connectedUsers[socket.id]?.userId });
      }
  });

  socket.on('stop_typing', ({ toUserId }) => {
      const targetSocketId = userSockets[toUserId];
      if (targetSocketId) {
          io.to(targetSocketId).emit('stop_typing', { fromUserId: connectedUsers[socket.id]?.userId });
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

  // MARK READ
  socket.on('mark_read', async ({ fromUserId }) => {
      const me = connectedUsers[socket.id];
      if (!me) return;
      try {
          await markMessagesAsRead(fromUserId, me.userId);
          
          // Notify the sender that their messages were read
          const senderSocketId = userSockets[fromUserId];
          if (senderSocketId) {
              io.to(senderSocketId).emit('messages_read', { byUserId: me.userId });
          }
      } catch (e) { console.error(e); }
  });

  // PRIVATE MESSAGE
  socket.on('private message', async ({ content, toUserId, type = 'text', file = null, fileName = null }) => {
    const fromUser = connectedUsers[socket.id];
    if (!fromUser) return;

    try {
      // Save to DB
      // If file is provided (base64), we save it as file_url (data URI for now)
      let fileUrl = null;
      if (type === 'file' || type === 'image') {
          fileUrl = file; // Base64 string
      }

      const msg = await saveMessage(fromUser.userId, toUserId, content, type, fileUrl, fileName);
      
      const payload = {
          id: msg.id,
          content: msg.content,
          fromUserId: fromUser.userId,
          toUserId: toUserId,
          username: fromUser.username,
          timestamp: msg.created_at,
          type: msg.type,
          file_url: msg.file_url,
          file_name: msg.file_name,
          is_edited: msg.is_edited,
          is_deleted: msg.is_deleted,
          is_read: msg.is_read
      };

      // Send to recipient if online
      const recipientSocketId = userSockets[toUserId];
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('private message', payload);
      }
      
      // Send confirmation to sender
      socket.emit('message_sent', payload);

    } catch (err) {
      console.error("Message error:", err);
    }
  });

  // EDIT MESSAGE
  socket.on('edit_message', async ({ messageId, newContent, toUserId }) => {
      const user = connectedUsers[socket.id];
      if (!user) return;
      try {
          await editMessage(messageId, user.userId, newContent);
          const payload = { messageId, newContent, fromUserId: user.userId };
          
          // Notify recipient
          const recipientSocketId = userSockets[toUserId];
          if (recipientSocketId) io.to(recipientSocketId).emit('message_edited', payload);
          
          // Notify sender (to update UI)
          socket.emit('message_edited', payload);
      } catch (e) { console.error(e); }
  });

  // DELETE MESSAGE
  socket.on('delete_message', async ({ messageId, toUserId }) => {
      const user = connectedUsers[socket.id];
      if (!user) return;
      try {
          await deleteMessage(messageId, user.userId);
          const payload = { messageId, fromUserId: user.userId };

          // Notify recipient
          const recipientSocketId = userSockets[toUserId];
          if (recipientSocketId) io.to(recipientSocketId).emit('message_deleted', payload);
          
          // Notify sender
          socket.emit('message_deleted', payload);
      } catch (e) { console.error(e); }
  });

  // WebRTC Signaling
  socket.on("callUser", (data) => {
    const targetSocketId = userSockets[data.userToCall];
    if (targetSocketId) {
        io.to(targetSocketId).emit("callUser", { 
            signal: data.signalData, 
            from: connectedUsers[socket.id]?.userId, 
            name: data.name 
        });
    }
  });

  socket.on("answerCall", (data) => {
    const targetSocketId = userSockets[data.to];
    if (targetSocketId) {
        io.to(targetSocketId).emit("callAccepted", data.signal);
    }
  });

  socket.on('disconnect', () => {
    const user = connectedUsers[socket.id];
    if (user) {
        console.log('User disconnected:', user.username);
        // Broadcast offline status
        io.emit('user_status', { userId: user.userId, status: 'offline' });
        
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
