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
const { initializeDatabase } = require('./database');

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

// WebSocket server (moved before async block)
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    console.log('📨 Received WebSocket message:', message.toString());
  });

  ws.send(JSON.stringify({
    type: 'connection',
    status: 'connected',
    timestamp: Date.now()
  }));
});

// Initialize and start server
let server; // Declare server variable in module scope

(async () => {  try {
    let dbStatus = { success: true, version: 'N/A' };
    
    // Check if database should be used
    if (process.env.USEDB !== 'false') {
      console.log('⚙️  Initializing database...');
      const sequelize = await initializeDatabase();
      dbStatus = await sequelize.verifyConnection();
      
      if (!dbStatus.success) {
        console.error('❌ Fatal: Database connection failed. Exiting...');
        process.exit(1);
      }
      console.log('✅ Database verified');
    } else {
      console.log('ℹ️  Database initialization skipped (USEDB=false)');
    }
    
    console.log('🚀 Starting server...');
    // Setup routes with dependencies
    setupRoutes(app, dataStore, wss);
    
    // Start server
    server = app.listen(port, () => {
      console.log(`🌐 IoT Backend running on port ${port}`);
      console.log(`📊 Database: ${dbStatus.version}`);
    });
    
    // Handle WebSocket upgrades
    server.on('upgrade', (request, socket, head) => {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    });
      // SSH tunnel setup if configured
    if (process.env.PUBLIC_VPS_IP) {
      try {
        console.log(`🔗 Setting up SSH tunnel to ${process.env.PUBLIC_VPS_IP}:${process.env.PUBLIC_PORT}...`);
        const sshClient = createSshTunnel();
        if (sshClient) {
          console.log(`✅ SSH tunnel setup initiated. External access: http://${process.env.PUBLIC_VPS_IP}:${process.env.PUBLIC_PORT}`);
        } else {
          console.warn('⚠️  SSH tunnel setup failed, but server will continue running locally.');
        }
      } catch (tunnelErr) {
        console.error('⚠️  SSH tunnel error (server continues locally):', tunnelErr.message);
      }
    } else {
      console.log('ℹ️  SSH tunnel disabled - no PUBLIC_VPS_IP configured');
    }
    
  } catch (err) {
    console.error('❌ Fatal error during startup:', err);
    process.exit(1);
  }
})();

// Export app for testing and server getter
module.exports = { 
  app,
  getServer: () => server 
};