const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
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

// Create Express app with optimizations
const app = express();
const port = process.env.PORT || 3000;

// High-performance middleware stack
app.use(compression()); // Enable gzip compression
app.use(cors('*')); // Allow all origins for simplicity, adjust as needed
app.use(helmet({
  contentSecurityPolicy: false, // Disable for API server
  crossOriginEmbedderPolicy: false
}));

// Optimized JSON parsing with size limits
app.use(express.json({ 
  limit: '50mb', // Allow large image uploads
  strict: false
}));

// Conditional logging based on environment
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// High-performance rate limiting with memory store
const apiLimiter = rateLimit({
  windowMs: process.env.RATE_LIMIT_WINDOW_MS || 60000,
  max: process.env.RATE_LIMIT_MAX || 1000, // Increased for high-traffic IoT
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for high-frequency endpoints
    return req.path.includes('/stream/fast') || req.path.includes('/heartbeat');
  }
});
// app.use('/api/', apiLimiter);

// Initialize high-performance data store
console.log('🚀 Initializing high-performance DataStore...');
const dataStore = new DataStore();

// High-performance WebSocket server with connection pooling
const wss = new WebSocket.Server({ 
  noServer: true,
  maxPayload: 10 * 1024 * 1024, // 10MB max payload
  perMessageDeflate: true // Enable compression
});

// WebSocket connection management
let wsConnectionCount = 0;
const MAX_WS_CONNECTIONS = 1000;

wss.on('connection', (ws, request) => {
  wsConnectionCount++;
  
  if (wsConnectionCount > MAX_WS_CONNECTIONS) {
    ws.close(1008, 'Server at capacity');
    wsConnectionCount--;
    return;
  }

  console.log(`📡 WebSocket connected (${wsConnectionCount} active connections)`);
  
  // Send welcome message with server capabilities
  ws.send(JSON.stringify({
    type: 'connection',
    status: 'connected',
    timestamp: Date.now(),
    serverCapabilities: {
      compression: true,
      batchProcessing: true,
      caching: true,
      realTimeNotifications: true
    }
  }));

  // Handle incoming messages
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      console.log('📨 WebSocket message:', data.type || 'unknown');
      
      // Handle specific message types if needed
      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      }
      
      // Echo back any message for testing
      if (data.type === 'test') {
        ws.send(JSON.stringify({ 
          type: 'test_response', 
          originalMessage: data,
          timestamp: Date.now(),
          serverInfo: {
            port: port,
            connections: wsConnectionCount
          }
        }));
      }
    } catch (error) {
      console.error('WebSocket message parse error:', error.message);
      // Send error response
      try {
        ws.send(JSON.stringify({ 
          type: 'error', 
          message: 'Invalid JSON message',
          timestamp: Date.now() 
        }));
      } catch (sendError) {
        console.error('Failed to send error response:', sendError.message);
      }
    }
  });

  // Connection cleanup
  ws.on('close', () => {
    wsConnectionCount--;
    console.log(`📡 WebSocket disconnected (${wsConnectionCount} active connections)`);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error.message);
    wsConnectionCount--;
  });
});

// Broadcast helper function for high-performance messaging
wss.broadcastToAll = (message) => {
  const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
  const clients = Array.from(wss.clients);
  
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(messageStr);
      } catch (error) {
        console.error('WebSocket broadcast error:', error.message);
      }
    }
  });
};

// Performance monitoring for WebSocket
setInterval(() => {
  if (wsConnectionCount > 0) {
    console.log(`📊 WebSocket Status: ${wsConnectionCount} active connections`);
  }
}, 60000); // Log every minute

// Initialize and start high-performance server
let server; // Declare server variable in module scope

(async () => {
  try {
    let dbStatus = { success: true, version: 'N/A' };
    
    // Check if database should be used
    if (process.env.USEDB !== 'false') {
      console.log('⚙️  Initializing high-performance database connection...');
      const sequelize = await initializeDatabase();
      dbStatus = await sequelize.verifyConnection();
      
      if (!dbStatus.success) {
        console.error('❌ Fatal: Database connection failed. Exiting...');
        process.exit(1);
      }
      console.log('✅ Database verified with optimization features');
    } else {
      console.log('ℹ️  Database initialization skipped (USEDB=false)');
    }
    
    console.log('🚀 Starting optimized server...');
    
    // Setup routes with high-performance dependencies
    setupRoutes(app, dataStore, wss);
    
    // Add global error handler
    app.use((err, req, res, next) => {
      console.error('Server error:', err);
      res.status(500).json({ 
        error: 'Internal server error',
        timestamp: Date.now()
      });
    });
    
    // Start server with performance optimizations
    server = app.listen(port, '0.0.0.0', () => {
      console.log(`🌐 High-Performance IoT Backend running on port ${port}`);
      console.log(`📊 Database: ${dbStatus.version}`);
      console.log(`🚀 Optimizations: Caching, Batching, Compression enabled`);
      console.log(`💾 Memory usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
      console.log(`📡 WebSocket server ready on ws://0.0.0.0:${port}/`);
    });
    
    // Configure server for high traffic
    server.keepAliveTimeout = 65000; // Slightly higher than load balancer timeout
    server.headersTimeout = 66000; // Higher than keepAliveTimeout
    
    // Handle WebSocket upgrades with error handling
    server.on('upgrade', (request, socket, head) => {
      try {
        // Log WebSocket upgrade attempts
        console.log(`📡 WebSocket upgrade request from ${request.socket.remoteAddress}:${request.socket.remotePort}`);
        console.log(`📡 WebSocket URL: ${request.url}`);
        console.log(`📡 WebSocket headers:`, request.headers);
        
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      } catch (error) {
        console.error('WebSocket upgrade error:', error);
        socket.destroy();
      }
    });
    
    // Add error handling for server
    server.on('error', (error) => {
      console.error('Server error:', error);
    });
    
    // Log server listening
    server.on('listening', () => {
      console.log(`🌐 Server listening on all interfaces (0.0.0.0:${port})`);
      console.log(`📡 WebSocket server ready for connections`);
      if (process.env.PUBLIC_VPS_IP) {
        console.log(`🔗 External WebSocket access: ws://${process.env.PUBLIC_VPS_IP}:${process.env.PUBLIC_PORT}/`);
      }
    });

    // Performance monitoring
    setInterval(() => {
      const memUsage = process.memoryUsage();
      console.log(`📈 Performance: Memory ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB, ` +
                  `Uptime ${Math.round(process.uptime())}s, ` +
                  `WebSocket connections: ${wsConnectionCount}`);
    }, 300000); // Every 5 minutes
    
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

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('📤 SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('📤 SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

// Export app for testing and server getter
module.exports = { 
  app,
  getServer: () => server 
};