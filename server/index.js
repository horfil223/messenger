const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const cors = require('cors');
const path = require('path');

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const io = new Server(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

// Store connected users: { socketId: { id, username } }
let users = {};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.emit("me", socket.id);

  // Handle Login
  socket.on('login', (username) => {
    console.log(`User logged in: ${username} (${socket.id})`);
    users[socket.id] = { id: socket.id, username };
    // Broadcast updated user list to everyone
    io.emit('users', Object.values(users));
  });

  // Private Message
  socket.on('private message', ({ content, to }) => {
    const fromUser = users[socket.id];
    // Send to recipient
    socket.to(to).emit('private message', {
      content,
      from: socket.id,
      username: fromUser ? fromUser.username : 'Anonymous'
    });
    // (Optional) The sender already has the message in their state, 
    // but in a real app you might confirm receipt here.
  });

  // WebRTC Signaling (Updated for direct calls)
  socket.on("callUser", (data) => {
    // data: { userToCall, signalData, from, name }
    io.to(data.userToCall).emit("callUser", { 
      signal: data.signalData, 
      from: data.from, 
      name: data.name 
    });
  });

  socket.on("answerCall", (data) => {
    // data: { to, signal }
    io.to(data.to).emit("callAccepted", data.signal);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    delete users[socket.id];
    io.emit('users', Object.values(users)); // Update list for everyone
    socket.broadcast.emit("callEnded");
  });
});

server.listen(3002, () => {
  console.log('Server listening on *:3002');
});
