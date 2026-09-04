require('dotenv').config();
const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { Server } = require('socket.io');
const { connectDB } = require('./config/db');

// Import Routes
const kioskRoutes = require('./routes/kioskRoutes');
const clinicalRoutes = require('./routes/clinicalRoutes');
const hprRoutes = require('./routes/hprRoutes');

const app = express();
const PORT = process.env.PORT || 4000;

// Initialize Database Connection
connectDB();

// CORS Configuration - Permissive for Frontend & Socket.IO Clients
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-hpr-token', 'x-requested-with']
}));

// Body Parsers & Morgan Logging
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('dev'));

// Serve Frontend Command Center Static UI under /dashboard
const dashboardPath = path.join(__dirname, 'triage-engine', 'dashboard');
app.use('/dashboard', express.static(dashboardPath));

// API Routes Mounting
app.use('/api/v1/kiosk', kioskRoutes);
app.use('/api/v1/clinical', clinicalRoutes);
app.use('/api/v1/hpr', hprRoutes);

// Compatibility Routes for Frontend Event APIs (/api/events/...)
app.use('/api/events', kioskRoutes);
app.use('/api/events', clinicalRoutes);

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'UP',
    service: 'MediKiosk Unified Backend & Triage Engine',
    port: PORT,
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    standards: ['HL7 FHIR R4', 'ABDM M1/M2/M3', 'HPR Biometric Write-Lock', 'Socket.IO Real-Time Stream'],
    dashboardUrl: `http://localhost:${PORT}/dashboard/index.html`
  });
});

// Root Welcome Endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    message: 'Welcome to MediKiosk Pure Backend & Real-Time Triage API Service',
    dashboard: `/dashboard/index.html`,
    health: `/health`,
    docs: {
      kioskIntake: 'POST /api/v1/kiosk/intake',
      doctorSummary: 'GET /api/v1/clinical/patient/:id/summary',
      clinicalCommit: 'POST /api/v1/clinical/commit (HPR Token Required)',
      fhirExport: 'GET /api/v1/clinical/fhir/bundle/:intakeId',
      demoSeed: 'POST /api/events/demo/seed',
      hprLogin: 'POST /api/v1/hpr/login'
    }
  });
});

// Global 404 Handler
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    error: 'ENDPOINT_NOT_FOUND',
    message: `Cannot ${req.method} ${req.originalUrl}`
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Unhandled Server Error]:', err);
  res.status(500).json({
    success: false,
    error: 'INTERNAL_SERVER_ERROR',
    message: err.message || 'An unexpected error occurred on the MediKiosk server.'
  });
});

// Create HTTP Server & Attach Socket.IO
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Socket.IO Gateway Event Listeners
io.on('connection', (socket) => {
  console.log(`[Socket.IO] Client connected: ${socket.id}`);

  socket.on('JOIN_DASHBOARD', (data, callback) => {
    socket.join('dashboard');
    console.log(`[Socket.IO] Client ${socket.id} joined 'dashboard' room.`);
    if (typeof callback === 'function') callback({ status: 'OK', room: 'dashboard' });
  });

  socket.on('JOIN_SESSION', (data, callback) => {
    const sessionId = typeof data === 'string' ? data : data?.sessionId;
    if (sessionId) {
      socket.join(`session:${sessionId}`);
      console.log(`[Socket.IO] Client ${socket.id} joined room 'session:${sessionId}'.`);
      if (typeof callback === 'function') callback({ status: 'OK', room: `session:${sessionId}` });
    }
  });

  socket.on('disconnect', () => {
    console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
  });
});

// Attach socket instance to app for routes if needed
app.set('io', io);

// Start HTTP & Socket Server
if (require.main === module) {
  httpServer.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(` MediKiosk Unified Backend Server running on port ${PORT}`);
    console.log(` Doctor Command Center Dashboard: http://localhost:${PORT}/dashboard/index.html`);
    console.log(` Socket.IO Gateway Initialized`);
    console.log(` Health Check: http://localhost:${PORT}/health`);
    console.log(`=======================================================`);
  });
}

module.exports = app;
module.exports.httpServer = httpServer;
module.exports.io = io;