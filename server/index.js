const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const cors = require('cors');
const path = require('path');
const { createUser, findUser, verifyPassword } = require('./database');

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
        users[socket.id] = { id: socket.id, username };
        socket.emit('login_success', username);
        io.emit('users', Object.values(users));
        console.log(`User logged in: ${username}`);
      } else {
        socket.emit('login_error', 'Invalid credentials');
      }
    } catch (err) {
      socket.emit('login_error', 'Server error');
    }
  });

  // Private Message
  socket.on('private message', ({ content, to }) => {
    const fromUser = users[socket.id];
    if (fromUser) {
      socket.to(to).emit('private message', {
        content,
        from: socket.id,
        username: fromUser.username
      });
    }
  });

  // WebRTC Signaling
  socket.on("callUser", (data) => {
    io.to(data.userToCall).emit("callUser", { 
      signal: data.signalData, 
      from: data.from, 
      name: data.name 
    });
  });

  socket.on("answerCall", (data) => {
    io.to(data.to).emit("callAccepted", data.signal);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    delete users[socket.id];
    io.emit('users', Object.values(users));
    socket.broadcast.emit("callEnded");
  });
});

server.listen(3003, () => {
  console.log('Server listening on *:3003');
});
