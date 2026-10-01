const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Disable static caching so client browsers immediately receive updated Persona code
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// Store room states
// rooms: { [roomId]: { [socketId]: { username, muted, deafened, isSpeaking } } }
const rooms = {};

io.on('connection', (socket) => {
  console.log(`[Socket Connected] ID: ${socket.id}`);

  let currentRoom = null;
  let currentUsername = 'Gamer';

  socket.on('join-room', ({ roomId, username }) => {
    // Leave previous room if any
    if (currentRoom && rooms[currentRoom]) {
      socket.leave(currentRoom);
      delete rooms[currentRoom][socket.id];
      socket.to(currentRoom).emit('user-disconnected', { socketId: socket.id, username: currentUsername });
      if (Object.keys(rooms[currentRoom]).length === 0) {
        delete rooms[currentRoom];
      }
    }

    currentRoom = roomId || 'lobby';
    currentUsername = username || `Gamer_${socket.id.substring(0, 4)}`;

    socket.join(currentRoom);

    if (!rooms[currentRoom]) {
      rooms[currentRoom] = {};
    }

    // Existing users in the room
    const existingUsers = Object.entries(rooms[currentRoom]).map(([id, info]) => ({
      socketId: id,
      username: info.username,
      muted: info.muted || false,
      deafened: info.deafened || false
    }));

    // Register user in room storage
    rooms[currentRoom][socket.id] = {
      username: currentUsername,
      muted: false,
      deafened: false,
      isSpeaking: false
    };

    // Send existing users to the newly joined peer
    socket.emit('room-joined', {
      roomId: currentRoom,
      yourSocketId: socket.id,
      existingUsers
    });

    // Notify other peers in the room about new user
    socket.to(currentRoom).emit('user-connected', {
      socketId: socket.id,
      username: currentUsername
    });

    console.log(`[User Joined] ${currentUsername} (${socket.id}) -> Room: ${currentRoom}`);
  });

  // WebRTC Signaling Relay (Offers, Answers, ICE Candidates)
  socket.on('signal', ({ targetSocketId, signal }) => {
    io.to(targetSocketId).emit('signal', {
      senderSocketId: socket.id,
      signal
    });
  });

  // Status updates (Mute, Deafen, Speaking)
  socket.on('update-status', (statusData) => {
    if (currentRoom && rooms[currentRoom] && rooms[currentRoom][socket.id]) {
      rooms[currentRoom][socket.id] = {
        ...rooms[currentRoom][socket.id],
        ...statusData
      };

      socket.to(currentRoom).emit('user-status-changed', {
        socketId: socket.id,
        ...statusData
      });
    }
  });

  // Text Chat relay
  socket.on('send-message', ({ message }) => {
    if (!currentRoom || !message.trim()) return;

    const chatPayload = {
      senderId: socket.id,
      username: currentUsername,
      message: message.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    io.to(currentRoom).emit('new-message', chatPayload);
  });

  // Disconnection handling
  socket.on('disconnect', () => {
    console.log(`[Socket Disconnected] ID: ${socket.id}`);
    if (currentRoom && rooms[currentRoom]) {
      delete rooms[currentRoom][socket.id];
      socket.to(currentRoom).emit('user-disconnected', {
        socketId: socket.id,
        username: currentUsername
      });

      if (Object.keys(rooms[currentRoom]).length === 0) {
        delete rooms[currentRoom];
      }
    }
  });
});

const os = require('os');

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const networkInterfaces = os.networkInterfaces();
  let localIp = 'localhost';

  for (const interfaceName in networkInterfaces) {
    for (const iface of networkInterfaces[interfaceName]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIp = iface.address;
        break;
      }
    }
  }

  console.log(`====================================================`);
  console.log(`🚀 VOLC Voice Chat Server พร้อมใช้งาน!`);
  console.log(`----------------------------------------------------`);
  console.log(`👉 เปิดในเครื่องนี้:  http://localhost:${PORT}`);
  console.log(`👉 เพื่อนในวง LAN เดียวกัน: http://${localIp}:${PORT}`);
  console.log(`====================================================`);
});
