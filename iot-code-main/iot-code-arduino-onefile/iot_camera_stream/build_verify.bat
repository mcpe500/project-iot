@echo off
REM ESP32-S3 Camera Build Verification Script
REM This script helps verify the modular code structure

echo ESP32-S3 Camera Build Verification
echo =====================================
echo.

echo Checking file structure...
if exist "iot_camera_stream.ino" (
    echo ✓ iot_camera_stream.ino found
) else (
    echo ✗ iot_camera_stream.ino missing
    goto :error
)

if exist "config.h" (
    echo ✓ config.h found
) else (
    echo ✗ config.h missing
    goto :error
)

if exist "camera_network.h" (
    echo ✓ camera_network.h found
) else (
    echo ✗ camera_network.h missing
    goto :error
)

echo.
echo Checking include statements...
findstr /c:"#include \"config.h\"" iot_camera_stream.ino >nul
if %errorlevel%==0 (
    echo ✓ config.h included in main file
) else (
    echo ✗ config.h not included in main file
)

findstr /c:"#include \"camera_network.h\"" iot_camera_stream.ino >nul
if %errorlevel%==0 (
    echo ✓ camera_network.h included in main file
) else (
    echo ✗ camera_network.h not included in main file
)

echo.
echo Checking function declarations...
findstr /c:"bool sendFrameToServer" camera_network.h >nul
if %errorlevel%==0 (
    echo ✓ sendFrameToServer function declared
) else (
    echo ✗ sendFrameToServer function not declared
)

findstr /c:"void initWiFi" camera_network.h >nul
if %errorlevel%==0 (
    echo ✓ initWiFi function declared
) else (
    echo ✗ initWiFi function not declared
)

findstr /c:"void initCamera" camera_network.h >nul
if %errorlevel%==0 (
    echo ✓ initCamera function declared
) else (
    echo ✗ initCamera function not declared
)

echo.
echo Checking configuration constants...
findstr /c:"TARGET_FPS" config.h >nul
if %errorlevel%==0 (
    echo ✓ TARGET_FPS defined
) else (
    echo ✗ TARGET_FPS not defined
)

findstr /c:"WIFI_SSID" config.h >nul
if %errorlevel%==0 (
    echo ✓ WIFI_SSID defined
) else (
    echo ✗ WIFI_SSID not defined
)

echo.
echo =====================================
echo Build verification complete!
echo.
echo Ready for Arduino IDE compilation:
echo 1. Open iot_camera_stream.ino in Arduino IDE
echo 2. Select ESP32S3 Dev Module board
echo 3. Set CPU Frequency to 240MHz
echo 4. Enable PSRAM if available
echo 5. Compile and upload
echo.
pause
goto :end

:error
echo.
echo =====================================
echo ✗ Build verification FAILED!
echo Please check the file structure and try again.
echo.
pause

:end
