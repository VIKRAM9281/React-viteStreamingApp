const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*', // or set to 'http://localhost:5173' for Vite
    methods: ['GET', 'POST'],
    credentials: true,
  },
});
app.use(cors({
  origin: '*', // Or match your frontend
  credentials: true,
}));


const PORT = process.env.PORT || 3001;

const MAX_USERS = 4;
const STATIC_ROOMS = ['room1', 'room2', 'room3', 'room4'];
let roomUsers = {}; // e.g., { room1: [socketId1, socketId2] }

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('🔗 WebRTC Signaling Server is live!');
});

io.on('connection', (socket) => {
  console.log(`🔌 New user connected: ${socket.id}`);
  socket.on('connect_error', (err) => {
    console.error('❌ Connection failed:', err.message);
  });
  
  socket.on('getRooms', () => {
    console.log("Hello");
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

    if (roomUsers[roomName].length >= MAX_USERS) {
      socket.emit('roomFull');
      return;
    }

    socket.join(roomName);
    roomUsers[roomName].push(socket.id);

    const otherUsers = roomUsers[roomName].filter((id) => id !== socket.id);
    socket.emit('joined', { room: roomName, users: otherUsers });

    otherUsers.forEach((userId) => {
      io.to(userId).emit('newUser', socket.id);
    });

    socket.on('signal', ({ to, data }) => {
      io.to(to).emit('signal', { from: socket.id, data });
    });

    socket.on('disconnect', () => {
      console.log(`❌ User disconnected: ${socket.id}`);
      roomUsers[roomName] = (roomUsers[roomName] || []).filter((id) => id !== socket.id);
      socket.to(roomName).emit('userLeft', socket.id);
    });
  });
});

server.listen(PORT, () => {
  console.log(`✅ Signaling server running on port ${PORT}`);
});
