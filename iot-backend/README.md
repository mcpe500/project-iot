# IoT Backend Service

A production-grade, high-performance IoT backend service built with **Fastify**, **Bun**, and **TypeScript**. This service acts as the central communication hub for ESP32 devices and provides real-time data streaming to frontend dashboards.

## 🚀 Features

- **High Performance**: Built with Fastify and Bun for maximum throughput
- **Real-time Communication**: WebSocket support for instant data updates
- **Production Ready**: Comprehensive logging, error handling, and security
- **Type Safe**: Full TypeScript implementation with strict type checking
- **Modular Architecture**: Plugin-based system for easy extensibility
- **API Documentation**: JSON Schema validation with automatic OpenAPI generation
- **Security First**: Rate limiting, CORS, Helmet, and API key authentication
- **Database Agnostic**: Clean abstraction layer for easy database integration

## 🏗️ Architecture

```
src/
├── types/          # TypeScript type definitions
├── schemas/        # JSON Schema for request validation
├── models/         # Data models and storage abstraction
├── services/       # Business logic layer
├── routes/         # API route handlers
├── plugins/        # Fastify plugins (auth, websocket, etc.)
├── utils/          # Helper functions and utilities
└── server.ts       # Main application entry point
```

## 📋 Prerequisites

- **Bun** >= 1.0.0
- **Node.js** >= 18.0.0 (for compatibility)
- **TypeScript** >= 5.0.0

## 🔧 Installation

1. **Clone and setup**:
   ```bash
   cd iot-backend
   bun install
   ```

2. **Environment Configuration**:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Start Development Server**:
   ```bash
   bun run dev
   ```

## 🌐 API Endpoints

### Core Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check (public) |
| `WS` | `/ws` | WebSocket connection for real-time updates |

### Data Ingestion
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/ingest/sensor-data` | Submit sensor data from ESP32 |
| `GET` | `/api/v1/ingest/sensor-data/history/:deviceId` | Get sensor history |

### Dashboard API
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/dashboard/data` | Complete dashboard data |
| `GET` | `/api/v1/dashboard/devices` | List all devices |
| `GET` | `/api/v1/dashboard/system-status` | System statistics |

### Device Control
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/control/command` | Send command to device |
| `GET` | `/api/v1/control/commands/pending` | Get pending commands |
| `PUT` | `/api/v1/control/commands/:id/status` | Update command status |

### Notes Management
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/dashboard/notes` | Get all notes |
| `POST` | `/api/v1/dashboard/notes` | Create new note |
| `PUT` | `/api/v1/dashboard/notes/:id` | Update note |
| `DELETE` | `/api/v1/dashboard/notes/:id` | Delete note |

### Configuration
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/config/media` | Media configuration (public) |
| `GET` | `/api/v1/config/system` | System capabilities |

## 🔐 Authentication

Most endpoints require an API key in the request headers:

```bash
curl -H "X-API-Key: your-api-key-here" \
     -X GET http://localhost:3000/api/v1/dashboard/data
```

Public endpoints (no authentication required):
- `/health`
- `/api/v1/config/media`
- WebSocket endpoint `/ws`

## 📊 Data Models

### Sensor Data
```typescript
{
  deviceId: string;
  timestamp: number;
  temperature?: number;
  humidity?: number;
  pressure?: number;
  lightLevel?: number;
  motionDetected?: boolean;
  airQuality?: number;
}
```

### Command
```typescript
{
  deviceId: string;
  type: 'led_control' | 'sensor_config' | 'reboot' | 'ping' | 'relay_control';
  payload: Record<string, any>;
}
```

## 🔄 Real-time Updates

The WebSocket endpoint (`/ws`) provides real-time updates for:

- **New sensor data**: Broadcast immediately when received
- **Device status changes**: Online/offline status updates
- **Command results**: Command execution status updates
- **System alerts**: Critical system notifications

### WebSocket Message Format
```typescript
{
  type: 'sensor-data' | 'device-status' | 'command-result' | 'system-alert';
  payload: any;
  timestamp: number;
}
```

## 🚀 Deployment

### Development
```bash
bun run dev        # Development with hot reload
bun run watch      # Watch mode
```

### Production
```bash
bun run build      # Type check and compile
bun run start      # Start production server
```

### Environment Variables

Required:
- `PORT` - Server port (default: 3000)
- `HOST` - Server host (default: 0.0.0.0)
- `JWT_SECRET` - JWT signing secret
- `API_KEY` - API authentication key

Optional:
- `CORS_ORIGIN` - Allowed CORS origins
- `RATE_LIMIT_MAX` - Rate limit per window
- `RATE_LIMIT_WINDOW_MS` - Rate limit window
- `LOG_LEVEL` - Logging level (info, debug, error)
- `DATABASE_URL` - Database connection string

## 🔌 ESP32 Integration

### Sending Sensor Data
```cpp
// ESP32 Arduino code example
void sendSensorData() {
  HTTPClient http;
  http.begin("http://your-server:3000/api/v1/ingest/sensor-data");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", "your-api-key");
  
  String payload = "{";
  payload += "\"deviceId\":\"" + deviceId + "\",";
  payload += "\"timestamp\":" + String(millis()) + ",";
  payload += "\"temperature\":" + String(temperature) + ",";
  payload += "\"humidity\":" + String(humidity);
  payload += "}";
  
  int httpResponseCode = http.POST(payload);
  http.end();
}
```

### Receiving Commands
```cpp
// Check for pending commands
void checkCommands() {
  HTTPClient http;
  http.begin("http://your-server:3000/api/v1/control/commands/pending?deviceId=" + deviceId);
  http.addHeader("X-API-Key", "your-api-key");
  
  int httpResponseCode = http.GET();
  if (httpResponseCode == 200) {
    String response = http.getString();
    // Parse and execute commands
  }
  http.end();
}
```

## 🗄️ Database Integration

The current implementation uses an in-memory data store for development. To integrate with a production database:

1. **Create a new data adapter** in `src/models/`
2. **Implement the same interface** as `DataStore`
3. **Replace the singleton** in `src/models/dataStore.ts`

Recommended databases:
- **PostgreSQL** - General-purpose with JSON support
- **InfluxDB** - Time-series optimized for sensor data
- **MongoDB** - Document-based for flexible schemas

## 🧪 Testing

```bash
bun test              # Run tests
bun run check-types   # Type checking only
bun run lint          # Linting and type checks
```

## 📝 Contributing

1. Follow TypeScript strict mode
2. Use Fastify plugins for new features
3. Add JSON schemas for API validation
4. Include comprehensive error handling
5. Update documentation for new endpoints

## 📄 License

MIT License - see LICENSE file for details.
