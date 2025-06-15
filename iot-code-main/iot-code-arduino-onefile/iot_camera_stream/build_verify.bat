@echo off
REM ESP32-S3 Camera Build Verification Script - 5-File Architecture
REM This script verifies the new modular code structure

echo ESP32-S3 Camera Build Verification (5-File Architecture)
echo ================================================
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

if exist "globals.h" (
    echo ✓ globals.h found
) else (
    echo ✗ globals.h missing
    goto :error
)

if exist "wifi_manager.h" (
    echo ✓ wifi_manager.h found
) else (
    echo ✗ wifi_manager.h missing
    goto :error
)

if exist "wifi_manager.cpp" (
    echo ✓ wifi_manager.cpp found
) else (
    echo ✗ wifi_manager.cpp missing
    goto :error
)

if exist "camera_manager.h" (
    echo ✓ camera_manager.h found
) else (
    echo ✗ camera_manager.h missing
    goto :error
)

if exist "camera_manager.cpp" (
    echo ✓ camera_manager.cpp found
) else (
    echo ✗ camera_manager.cpp missing
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

findstr /c:"#include \"globals.h\"" iot_camera_stream.ino >nul
if %errorlevel%==0 (
    echo ✓ globals.h included in main file
) else (
    echo ✗ globals.h not included in main file
)

findstr /c:"#include \"wifi_manager.h\"" iot_camera_stream.ino >nul
if %errorlevel%==0 (
    echo ✓ wifi_manager.h included in main file
) else (
    echo ✗ wifi_manager.h not included in main file
)

findstr /c:"#include \"camera_manager.h\"" iot_camera_stream.ino >nul
if %errorlevel%==0 (
    echo ✓ camera_manager.h included in main file
) else (
    echo ✗ camera_manager.h not included in main file
)

echo.
echo Checking function declarations...
findstr /c:"void initWiFi" wifi_manager.h >nul
if %errorlevel%==0 (
    echo ✓ initWiFi function declared in wifi_manager.h
) else (
    echo ✗ initWiFi function not declared
)

findstr /c:"void initCamera" camera_manager.h >nul
if %errorlevel%==0 (
    echo ✓ initCamera function declared in camera_manager.h
) else (
    echo ✗ initCamera function not declared
)

findstr /c:"bool sendFrameWithRetry" camera_manager.h >nul
if %errorlevel%==0 (
    echo ✓ sendFrameWithRetry function declared in camera_manager.h
) else (
    echo ✗ sendFrameWithRetry function not declared
)

echo.
echo Checking configuration constants...
findstr /c:"TARGET_FPS" config.h >nul
if %errorlevel%==0 (
    echo ✓ TARGET_FPS defined in config.h
) else (
    echo ✗ TARGET_FPS not defined
)

findstr /c:"WIFI_SSID" config.h >nul
if %errorlevel%==0 (
    echo ✓ WIFI_SSID defined in config.h
) else (
    echo ✗ WIFI_SSID not defined
)

echo.
echo Checking for old files...
if exist "camera_network.h" (
    echo ⚠️ Old camera_network.h still exists - should be removed
) else (
    echo ✓ Old camera_network.h properly removed
)

echo.
echo ================================================
echo Build verification complete!
echo.
echo New 5-File Architecture:
echo - iot_camera_stream.ino (Main program)
echo - config.h (Configuration)
echo - globals.h (Global variables)
echo - wifi_manager.h/.cpp (WiFi management)
echo - camera_manager.h/.cpp (Camera operations)
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
echo ================================================
echo ✗ Build verification FAILED!
echo Please check the file structure and try again.
echo.
pause

:end
