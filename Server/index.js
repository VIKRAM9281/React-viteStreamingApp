const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

const STATIC_ROOMS = ['room1', 'room2', 'room3', 'room4'];
const MAX_USERS = 4;

const roomUsers = {};
const rooms = {};

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('🔗 WebRTC Signaling Server is live!');
});

io.on('connection', (socket) => {
  console.log(`🔌 New user connected: ${socket.id}`);

  socket.on('getRooms', () => {
    const roomsStatus = STATIC_ROOMS.map((room) => ({
      name: room,
      count: roomUsers[room]?.length || 0,
      full: (roomUsers[room]?.length || 0) >= MAX_USERS,
    }));
    socket.emit('roomsList', roomsStatus);
  });

  socket.on('joinRoom', (roomName) => {
    if (!STATIC_ROOMS.includes(roomName)) return;

    roomUsers[roomName] = roomUsers[roomName] || [];
    rooms[roomName] = rooms[roomName] || { hostId: null, streamers: [] };

    if (roomUsers[roomName].length >= MAX_USERS) {
      socket.emit('roomFull');
      return;
    }

    if (!rooms[roomName].hostId) {
      rooms[roomName].hostId = socket.id;
      io.to(socket.id).emit('role', 'host');
    } else {
      io.to(socket.id).emit('role', 'viewer');
    }

    socket.join(roomName);
    roomUsers[roomName].push(socket.id);

    const others = roomUsers[roomName].filter(id => id !== socket.id);
    socket.emit('joined', { room: roomName, users: others });

    others.forEach(id => {
      io.to(id).emit('newUser', socket.id);
    });
  });

  socket.on('signal', ({ to, data }) => {
    io.to(to).emit('signal', { from: socket.id, data });
  });

  socket.on('streamRequest', () => {
    const room = findUserRoom(socket.id);
    if (room && rooms[room].hostId) {
      io.to(rooms[room].hostId).emit('streamRequest', socket.id);
    }
  });

  socket.on('streamApproved', (viewerId) => {
    const room = findUserRoom(viewerId);
    if (room && !rooms[room].streamers.includes(viewerId)) {
      rooms[room].streamers.push(viewerId);
      io.to(viewerId).emit('startStream');

      roomUsers[room].forEach(id => {
        if (id !== viewerId) {
          io.to(id).emit('newUser', viewerId);
          io.to(viewerId).emit('newUser', id);
        }
      });
    }
  });

  socket.on('disconnect', () => {
    console.log(`❌ Disconnected: ${socket.id}`);
    STATIC_ROOMS.forEach(room => {
      roomUsers[room] = roomUsers[room]?.filter(id => id !== socket.id) || [];

      if (rooms[room]?.hostId === socket.id) {
        rooms[room].hostId = null;
      }

      if(rooms[room]){
        rooms[room].streamers = rooms[room]?.streamers?.filter(id => id !== socket.id) || [];
      }

      socket.to(room).emit('userLeft', socket.id);
    });
  });
});

function findUserRoom(socketId) {
  return STATIC_ROOMS.find(room => roomUsers[room]?.includes(socketId));
}

server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
