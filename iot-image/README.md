# IoT Python GPU Face Recognition Service

This service provides GPU-accelerated face recognition capabilities for the IoT backend system, including SSH reverse tunnel support for remote access.

## Features

- **Face Recognition**: GPU-accelerated face detection and recognition using OpenCV and face_recognition
- **SSH Reverse Tunnel**: Automatic SSH tunnel setup for remote access through a public VPS
- **REST API**: FastAPI-based REST endpoints compatible with the Node.js backend
- **Permitted Faces Management**: Add and manage authorized faces
- **Real-time Processing**: Fast image processing for live camera streams

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
# Service Configuration
PORT=9001
HOST=0.0.0.0
DEBUG=True

# SSH Reverse Tunnel (Optional)
PUBLIC_VPS_IP=your.vps.ip.address
PUBLIC_PORT=9003
PRIVATE_SERVER_PORT=9001
SSH_USER=your-ssh-username
SSH_PASSWORD=your-ssh-password
SSH_PRIVATE_KEY_PATH=~/.ssh/id_rsa
SSH_PASSPHRASE=your-key-passphrase

# Face Recognition
FACE_RECOGNITION_ENABLED=True
FACE_DETECTION_MODEL=hog
FACE_RECOGNITION_TOLERANCE=0.5

# Integration
EXPRESS_BACKEND_URL=http://localhost:3000
EXPRESS_BACKEND_API_KEY=dev-api-key-change-in-production
```

## Installation

### Windows
```cmd
start_service.bat
```

### Linux/Mac
```bash
chmod +x start_service.sh
./start_service.sh
```

### Manual Installation
```bash
# Create virtual environment
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# Linux/Mac:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start service
python main.py
```

## API Endpoints

### Health Check
```
GET /health
```

### Device Registration
```
POST /api/v1/devices/register
```

### Device Heartbeat
```
POST /api/v1/devices/heartbeat
```

### Camera Stream Processing
```
POST /api/v1/stream/stream
```

### Face Recognition (Compatible with Node.js backend)
```
POST /recognize
```

### Add Permitted Face
```
POST /api/v1/recognition/add-permitted-face
```

### Get System Status
```
GET /api/v1/system/status
```

### Get All Devices
```
GET /api/v1/devices
```

### Get Frames
```
GET /api/v1/stream/frames
```

## SSH Reverse Tunnel

The service automatically establishes an SSH reverse tunnel when configured, allowing remote access through a public VPS:

1. **Configure SSH settings** in `.env` file
2. **Public VPS** listens on specified port (default: 9003)
3. **Traffic forwarded** to local service (default: 9001)
4. **Auto-reconnect** handles connection failures

### SSH Authentication

Supports both password and key-based authentication:

- **Password**: Set `SSH_PASSWORD` in `.env`
- **Private Key**: Set `SSH_PRIVATE_KEY_PATH` and optionally `SSH_PASSPHRASE`

## Integration with Express Backend

The service is designed to work seamlessly with the Node.js Express backend:

1. **Update Express .env** with `PYTHON_GPU_SERVICE_URL=http://localhost:9001`
2. **Enable service** with `PYTHON_GPU_SERVICE_ENABLED=true`
3. **Compatible endpoints** for face recognition and device management

## GPU Acceleration

Automatically detects and uses GPU acceleration when available:

- **CUDA**: For NVIDIA GPUs with PyTorch
- **CPU Fallback**: Automatic fallback for systems without GPU

## Directory Structure

```
iot-image/
├── main.py              # Main FastAPI application
├── ssh_tunnel.py        # SSH tunnel implementation
├── requirements.txt     # Python dependencies
├── .env                 # Configuration file
├── start_service.sh     # Linux/Mac startup script
├── start_service.bat    # Windows startup script
└── README.md           # This file
```

## Troubleshooting

### SSH Tunnel Issues
- Verify VPS IP and credentials
- Check firewall settings on VPS
- Ensure SSH service is running on VPS

### Face Recognition Issues
- Install face_recognition dependencies: `pip install cmake dlib`
- For GPU acceleration, install CUDA and PyTorch GPU version

### Service Connection Issues
- Check if port 9001 is available
- Verify Express backend configuration
- Check network connectivity between services

## Development

For development with auto-reload:
```bash
uvicorn main:app --reload --host 0.0.0.0 --port 9001
```

## Logs

Service logs include:
- SSH tunnel status and connections
- Face recognition results
- Device registrations and heartbeats
- Performance metrics
