#!/bin/bash

# High-Performance IoT System Startup Script
echo "Starting High-Performance IoT Streaming System..."

# Function to check if a port is in use
check_port() {
    if lsof -Pi :$1 -sTCP:LISTEN -t >/dev/null ; then
        echo "Port $1 is already in use"
        return 1
    else
        return 0
    fi
}

# Start Python Image Service (Port 9001)
echo "Starting Python Image Recognition Service on port 9001..."
cd iot-image
if check_port 9001; then
    python main.py &
    PYTHON_PID=$!
    echo "Python service started with PID: $PYTHON_PID"
else
    echo "Port 9001 is busy, skipping Python service"
fi

# Wait for Python service to start
sleep 3

# Start Node.js Backend Express (Port 9003)
echo "Starting Node.js Backend Express on port 9003..."
cd ../iot-backend-express
if check_port 9003; then
    npm start &
    NODE_PID=$!
    echo "Node.js service started with PID: $NODE_PID"
else
    echo "Port 9003 is busy, skipping Node.js service"
fi

echo ""
echo "=== High-Performance IoT System Status ==="
echo "Python Image Service: http://localhost:9001"
echo "Node.js Backend: http://localhost:9003"
echo "Frontend should connect to: ws://localhost:9003 for WebSocket"
echo ""
echo "Press Ctrl+C to stop all services"

# Trap Ctrl+C to clean up processes
trap 'echo "Stopping services..."; kill $PYTHON_PID $NODE_PID 2>/dev/null; exit' INT

# Wait for user to stop
wait
