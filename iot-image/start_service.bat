@echo off
REM IoT Python GPU Service Startup Script for Windows

echo Starting IoT Python GPU Face Recognition Service...

REM Check if virtual environment exists
if not exist "venv" (
    echo Creating Python virtual environment...
    python -m venv venv
)

REM Activate virtual environment
echo Activating virtual environment...
call venv\Scripts\activate.bat

REM Install/upgrade dependencies
echo Installing dependencies...
pip install -r requirements.txt

REM Check if .env file exists
if not exist ".env" (
    echo Warning: .env file not found. Using default configuration.
)

REM Start the service
echo Starting Python GPU service...
echo Service will be available at: http://localhost:9001
echo Press Ctrl+C to stop the service

python main.py

pause
