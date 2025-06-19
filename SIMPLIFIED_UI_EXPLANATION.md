# IoT Live Stream App - Simplified UI

## What was removed and why:

### ❌ Removed: "Start Cam" Button
**What it did:** Activated the mobile device's camera to send frames to the backend
**Why removed:** 
- Conflicted with the main purpose (receiving ESP32-CAM stream)
- Users should be **viewers**, not **senders** (except for face registration)
- Created confusion about what stream was being displayed

### ❌ Removed: "Flip" Button  
**What it did:** Switched between front/back camera of mobile device
**Why removed:**
- Only worked when mobile camera was active
- Irrelevant since stream comes from ESP32-CAM (which has no flip function)
- ESP32-CAM orientation is fixed

### ❌ Removed: Mobile Camera Streaming
**What it did:** Captured and sent mobile camera frames at 10 FPS
**Why removed:**
- The app's purpose is to **receive** ESP32-CAM images, not send mobile images
- Reduces battery usage and network traffic
- Cleaner, focused user experience

## ✅ What remains:

### 📺 **Live Stream Viewer**
- Displays real-time images from ESP32-CAM
- Shows FPS counter and connection status
- Face recognition results overlay

### 🎥 **Record Last 30s**
- Creates video from recent ESP32-CAM frames
- Only works when connected to backend
- Shows loading state during processing

### 👤 **Add Permitted Face** 
- **Only time mobile camera is used**
- Captures photo for face recognition training
- Modal interface with name input
- Separate from main streaming functionality

## 🎯 Clear Purpose Now:

The app is now a **pure ESP32-CAM viewer** with these functions:
1. **View** - ESP32-CAM live stream 
2. **Record** - Save ESP32-CAM footage
3. **Train** - Add faces using mobile camera (one-time action)

No more confusion about what camera is active or what stream is being shown!
