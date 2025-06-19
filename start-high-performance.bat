@echo off
echo Starting High-Performance IoT Streaming System...

echo Starting Python Image Recognition Service on port 9001...
cd iot-image
start "Python Image Service" cmd /k "python main.py"

echo Waiting for Python service to start...
timeout /t 3 /nobreak > nul

echo Starting Node.js Backend Express on port 9003...
cd ..\iot-backend-express
start "Node.js Backend" cmd /k "npm start"

echo.
echo === High-Performance IoT System Status ===
echo Python Image Service: http://localhost:9001
echo Node.js Backend: http://localhost:9003
echo Frontend should connect to: ws://localhost:9003 for WebSocket
echo.
echo Both services are running in separate windows.
echo Close those windows to stop the services.

pause
