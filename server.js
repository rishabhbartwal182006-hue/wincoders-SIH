require('dotenv').config();
const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { Server } = require('socket.io');
const { connectDB } = require('./config/db');

// Import Routes & Handlers
const kioskRoutes = require('./routes/kioskRoutes');
const clinicalRoutes = require('./routes/clinicalRoutes');
const hprRoutes = require('./routes/hprRoutes');
const sessionRoutes = require('./routes/sessionRoutes');
const vitalsRoutes  = require('./routes/vitalsRoutes');
const hprAuthMiddleware = require('./middleware/hprAuth');

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

// Serve Public Static Assets (Kiosk UI at /kiosk.html)
app.use(express.static(path.join(__dirname, 'public')));

// Serve Frontend Command Center Static UI under /dashboard and /triage/dashboard
const dashboardPath = path.join(__dirname, 'triage-engine', 'dashboard');
app.use('/dashboard', express.static(dashboardPath));
app.use('/triage/dashboard', express.static(dashboardPath));

// Direct Kiosk HTML Shortcut Routes
app.get('/kiosk', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'kiosk.html'));
});
app.get(['/patient-terminal', '/terminal'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'patientTerminal', 'dist', 'index.html'));
});

// API Base Routes Mounting
app.use('/api/v1/kiosk', kioskRoutes);
app.use('/api/v1/clinical', clinicalRoutes);
app.use('/api/v1/hpr', hprRoutes);

// openapi-spec-shaped session lifecycle API (/api/v1/sessions/*, /api/v1/auth/staff-login)
// Coexists with the routes above — see services/specAdapter.js for how the two
// data shapes bridge into the same discrepancy/FHIR logic.
app.use('/api/v1', sessionRoutes);

// Vital Scanner — ESP32-CAM + Groq AI glucometer reading
app.use('/api/v1/vitals', vitalsRoutes);

// Compatibility Base Routes for Frontend Event APIs (/api/events/...)
app.use('/api/events', kioskRoutes);
app.use('/api/events', clinicalRoutes);

// Specific Direct Endpoint Aliases (Module 5, 6, 7 & Intake Specs)
app.post('/api/v1/intake', kioskRoutes.handleKioskIngestion);
app.post('/api/v1/doctor/verify', hprAuthMiddleware, clinicalRoutes.handleClinicalCommit);
app.get('/api/v1/export/fhir/:intakeId', clinicalRoutes.handleFhirExport);

// In-Memory Patient Submissions Queue
let patientQueue = [];

// POST /api/patient/submit
app.post('/api/patient/submit', (req, res) => {
  const { patientId, name, age, symptoms, vitals, environment } = req.body || {};

  const generatedId = patientId || `PT-${Date.now().toString().slice(-4)}`;
  const newPatient = {
    patientId: generatedId,
    name: name || "Anonymous Patient",
    age: age || "—",
    symptoms: Array.isArray(symptoms) ? symptoms : symptoms ? [symptoms] : [],
    environment: environment || { altitudeMeters: 2438, altitudeSource: 'facility_config' },
    vitals: vitals || {},
    timestamp: new Date().toISOString(),
    status: "waiting"
  };

  patientQueue.push(newPatient);

  // Broadcast to Socket.IO clients if active
  const io = req.app.get('io');
  if (io) {
    io.emit('patient:new', newPatient);
    io.emit('kiosk:intake_submitted', {
      sessionId: newPatient.patientId,
      patientId: newPatient.patientId,
      patientName: newPatient.name,
      altitude: newPatient.environment?.altitudeMeters || 2438,
      triageLevel: 'ROUTINE',
      status: 'waiting',
      timestamp: newPatient.timestamp
    });
  }

  return res.status(201).json({
    success: true,
    message: "Patient queued successfully",
    data: newPatient
  });
});

// GET /api/doctor/queue
app.get('/api/doctor/queue', (req, res) => {
  return res.status(200).json(patientQueue);
});

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'UP',
    service: 'MediKiosk Unified Backend, Triage Engine & Doctor Command Center',
    port: PORT,
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    standards: ['HL7 FHIR R4', 'ABDM M1/M2/M3', 'HPR Biometric Write-Lock', 'Socket.IO Real-Time Stream'],
    kioskUrl: `http://localhost:${PORT}/kiosk.html`,
    dashboardUrl: `http://localhost:${PORT}/dashboard/index.html`
  });
});

// Root Route — Serve Landing Page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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

  // Prompt 1 Socket Event Relay: kiosk:intake_submitted
  socket.on('kiosk:intake_submitted', (data) => {
    console.log(`[Socket.IO] Relay 'kiosk:intake_submitted' event for session ${data?.sessionId} (Level: ${data?.triageLevel})`);
    io.emit('kiosk:intake_submitted', data);
  });

  // Prompt 3 Socket Event Relay: EHR_RECORD_COMMITTED
  socket.on('EHR_RECORD_COMMITTED', (data) => {
    console.log(`[Socket.IO] Relay 'EHR_RECORD_COMMITTED' event for session ${data?.sessionId}`);
    io.emit('EHR_RECORD_COMMITTED', data);
  });

  socket.on('PATIENT_EVENT_RECEIVED', (data) => {
    console.log(`[Socket.IO] Patient event received from kiosk for session: ${data?.sessionId}`);
    io.emit('PATIENT_EVENT_RECEIVED', data);
  });

  socket.on('disconnect', () => {
    console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
  });
});

// Attach socket instance to Express app
app.set('io', io);

// Start HTTP & Socket Server
if (require.main === module) {
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(` MediKiosk Unified Server running on port ${PORT}`);
    console.log(` Patient Intake Kiosk: http://localhost:${PORT}/kiosk.html`);
    console.log(` Doctor Command Center: http://localhost:${PORT}/dashboard/index.html`);
    console.log(` Socket.IO Gateway Active`);
    console.log(` Health Check: http://localhost:${PORT}/health`);
    console.log(`=======================================================`);
  });
}

module.exports = app;
module.exports.httpServer = httpServer;
module.exports.io = io;