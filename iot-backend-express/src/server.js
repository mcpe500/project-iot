const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const WebSocket = require('ws');
const dotenv = require('dotenv');
const { createSshTunnel } = require('../job/tunnel');

// Import our separated modules
const { DataStore } = require('./dataStore');
const setupRoutes = require('./routes');

// Load environment variables
dotenv.config();

// Create Express app
const app = express();
const port = process.env.PORT || 3000;

app.use(cors('*')); // Allow all origins for simplicity, adjust as needed
app.use(helmet());
app.use(express.json());
app.use(morgan('dev'));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: process.env.RATE_LIMIT_WINDOW_MS || 60000,
  max: process.env.RATE_LIMIT_MAX || 100,
  message: 'Too many requests, please try again later'
});
app.use('/api/', apiLimiter);

// Initialize data store
const dataStore = new DataStore();

// WebSocket server
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    console.log('Received WebSocket message:', message.toString());
  });

  ws.send(JSON.stringify({
    type: 'connection',
    status: 'connected',
    timestamp: Date.now()
  }));
});

// Setup routes with dependencies
setupRoutes(app, dataStore, wss);

// Start server
const server = app.listen(port, () => {
  console.log(`IoT Backend running on port ${port}`);
});

// Handle WebSocket upgrades
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// SSH tunnel setup if configured
if (process.env.PUBLIC_VPS_IP) {
  const sshClient = createSshTunnel();
  if (sshClient) {
    console.log('SSH tunnel established');
  }
}

module.exports = server;