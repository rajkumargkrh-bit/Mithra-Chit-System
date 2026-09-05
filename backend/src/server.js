require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const authRoutes = require('./routes/auth');
const memberRoutes = require('./routes/members');
const chitRoutes = require('./routes/chits');
const buildAuctionRoutes = require('./routes/auctions');
const paymentRoutes = require('./routes/payments');
const dueRoutes = require('./routes/dues');
const payoutRoutes = require('./routes/payouts');
const reportRoutes = require('./routes/reports');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: process.env.CORS_ORIGIN || '*' },
});

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

// -------- REST API --------
app.use('/api/auth', authRoutes);
app.use('/api/members', memberRoutes);
app.use('/api/chits', chitRoutes);
app.use('/api/auctions', buildAuctionRoutes(io));
app.use('/api/payments', paymentRoutes);
app.use('/api/dues', dueRoutes);
app.use('/api/payouts', payoutRoutes);
app.use('/api/reports', reportRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our end' });
});

// -------- Socket.IO: live auction rooms --------
// Clients authenticate with the same JWT used for the REST API, then join
// the room for the auction round they are viewing/bidding in.
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(); // allow anonymous viewers (read-only dashboards), routes still enforce auth for writes
  try {
    socket.user = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    // invalid token: still allow connection as anonymous viewer
  }
  next();
});

io.on('connection', (socket) => {
  socket.on('auction:join', (auctionRoundId) => {
    socket.join(`auction:${auctionRoundId}`);
  });

  socket.on('auction:leave', (auctionRoundId) => {
    socket.leave(`auction:${auctionRoundId}`);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`ChitPro backend running on http://localhost:${PORT}`);
});
