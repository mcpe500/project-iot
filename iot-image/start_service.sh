#!/bin/bash

# IoT Python GPU Service Startup Script

echo "Starting IoT Python GPU Face Recognition Service..."

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    python -m venv venv
fi

# Activate virtual environment
echo "Activating virtual environment..."
if [ -f "venv/Scripts/activate" ]; then
    # Windows
    source venv/Scripts/activate
else
    # Linux/Mac
    source venv/bin/activate
fi

# Install/upgrade dependencies
echo "Installing dependencies..."
pip install -r requirements.txt

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "Warning: .env file not found. Using default configuration."
fi

# Start the service
echo "Starting Python GPU service..."
echo "Service will be available at: http://localhost:9001"
echo "Press Ctrl+C to stop the service"

python main.py
