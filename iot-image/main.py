from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import os
import json
import time
import asyncio
import signal
import sys
from pathlib import Path
from typing import Optional, List, Dict, Any
import cv2
import numpy as np
from PIL import Image
import io
import face_recognition
import mediapipe as mp
import logging
from dotenv import load_dotenv
from ssh_tunnel import create_ssh_tunnel, stop_ssh_tunnel, get_tunnel_instance

# Load environment variables
load_dotenv()

# Setup logging
log_level = os.getenv('LOG_LEVEL', 'INFO').upper()
logging.basicConfig(level=getattr(logging, log_level))
logger = logging.getLogger(__name__)

app = FastAPI(title="IoT Backend GPU Server", version="1.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Setup directories
# BASE_DIR = Path(__file__).parent
BASE_DIR = Path(__file__).parent.parent.joinpath("iot-backend-express")
DATA_DIR = BASE_DIR / "data"
RECORDINGS_DIR = BASE_DIR / "recordings" 
PERMITTED_FACES_DIR = BASE_DIR / "permitted_faces"

# Create directories if they don't exist
for directory in [DATA_DIR, RECORDINGS_DIR, PERMITTED_FACES_DIR]:
    directory.mkdir(exist_ok=True)

# Mount static files
app.mount("/data", StaticFiles(directory=str(DATA_DIR)), name="data")
app.mount("/recordings", StaticFiles(directory=str(RECORDINGS_DIR)), name="recordings")

# Global variables for devices and face recognition
devices = {}
permitted_face_encodings = []
permitted_face_names = []

# MediaPipe face detection (optional, fallback if face_recognition not available)
try:
    import mediapipe as mp
    mp_face_detection = mp.solutions.face_detection
    mp_drawing = mp.solutions.drawing_utils
    mediapipe_available = True
except ImportError:
    logger.warning("MediaPipe not available")
    mediapipe_available = False

# SSH Tunnel instance
ssh_tunnel = None

class DataStore:
    def __init__(self):
        self.devices = {}
        self.load_permitted_faces()
    
    def register_device(self, device_data: Dict[str, Any]) -> Dict[str, Any]:
        device_id = device_data.get('id') or device_data.get('deviceId')
        if not device_id:
            raise ValueError("Device ID is required")
        
        existing_device = self.devices.get(device_id)
        if existing_device:
            # Update existing device
            existing_device.update(device_data)
            existing_device['lastSeen'] = time.time() * 1000
        else:
            # Create new device
            device_data['lastSeen'] = time.time() * 1000
            device_data['status'] = device_data.get('status', 'online')
            device_data['errors'] = device_data.get('errors', 0)
            self.devices[device_id] = device_data
        
        return self.devices[device_id]
    
    def get_device(self, device_id: str) -> Optional[Dict[str, Any]]:
        return self.devices.get(device_id)
    
    def get_all_devices(self) -> List[Dict[str, Any]]:
        return list(self.devices.values())
    
    def load_permitted_faces(self):
        """Load permitted faces from the permitted_faces directory"""
        global permitted_face_encodings, permitted_face_names
        permitted_face_encodings = []
        permitted_face_names = []
        
        if not PERMITTED_FACES_DIR.exists():
            return
        
        try:
            import face_recognition
            face_recognition_available = True
        except ImportError:
            logger.warning("face_recognition library not available")
            face_recognition_available = False
            return
        
        for image_file in PERMITTED_FACES_DIR.glob("*.jpg"):
            try:
                # Load image
                image = face_recognition.load_image_file(str(image_file))
                # Get face encoding
                encodings = face_recognition.face_encodings(image)
                
                if encodings:
                    permitted_face_encodings.append(encodings[0])
                    permitted_face_names.append(image_file.stem)
                    logger.info(f"Loaded permitted face: {image_file.stem}")
                else:
                    logger.warning(f"No face found in {image_file}")
            except Exception as e:
                logger.error(f"Error loading face from {image_file}: {e}")
    
    async def perform_face_recognition(self, image_bytes: bytes) -> Dict[str, Any]:
        """Perform face recognition on image bytes"""
        logger.info("Attempting face recognition...")
        try:
            # Check if face_recognition library is available
            try:
                import face_recognition
                face_recognition_available = True
            except ImportError:
                logger.warning("face_recognition library not available")
                return {"status": "library_unavailable", "recognizedAs": None, "error": "face_recognition library not found"}
            
            # Convert bytes to numpy array
            nparr = np.frombuffer(image_bytes, np.uint8)
            image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if image is None:
                logger.error("Could not decode image from bytes.")
                return {"status": "image_decode_error", "recognizedAs": None, "error": "Could not decode image"}

            # Convert BGR to RGB
            rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            
            # Find faces in the image
            logger.info("Detecting face locations...")
            face_locations = face_recognition.face_locations(rgb_image)
            logger.info(f"Found {len(face_locations)} face(s).")
            
            if not face_locations:
                return {"status": "no_face_detected", "recognizedAs": None, "faces_detected": 0}
            
            # Get face encodings
            logger.info("Encoding faces...")
            face_encodings = face_recognition.face_encodings(rgb_image, face_locations)
            
            # Check against permitted faces
            if not permitted_face_encodings:
                logger.warning("No permitted faces loaded. Cannot perform matching.")
                return {"status": "unknown_face", "recognizedAs": None, "faces_detected": len(face_locations), "error": "No permitted faces loaded for comparison"}

            for face_encoding in face_encodings:
                # Compare with known faces
                logger.info("Comparing face encoding with permitted faces...")
                matches = face_recognition.compare_faces(permitted_face_encodings, face_encoding, tolerance=0.5)
                face_distances = face_recognition.face_distance(permitted_face_encodings, face_encoding)
                
                if len(face_distances) == 0: # Should not happen if permitted_face_encodings is not empty
                    logger.warning("Face distances array is empty, though permitted faces exist.")
                    continue

                best_match_index = np.argmin(face_distances)
                
                logger.info(f"Best match index: {best_match_index}, Match: {matches[best_match_index]}, Distance: {face_distances[best_match_index]}")

                if matches[best_match_index] and face_distances[best_match_index] < 0.5:
                    recognized_name = permitted_face_names[best_match_index]
                    confidence = float(1 - face_distances[best_match_index])
                    logger.info(f"Permitted face recognized: {recognized_name} with confidence {confidence}")
                    return {
                        "status": "permitted_face",
                        "recognizedAs": recognized_name,
                        "confidence": confidence,
                        "faces_detected": len(face_locations)
                    }
            
            logger.info("No permitted face matched. Face is unknown.")
            return {"status": "unknown_face", "recognizedAs": None, "faces_detected": len(face_locations)}
            
        except Exception as e:
            logger.error(f"Error in face recognition: {e}", exc_info=True)
            return {"status": "recognition_error", "recognizedAs": None, "error": str(e)}

# Initialize data store
data_store = DataStore()

@app.on_event("startup")
async def startup_event():
    """Initialize services on startup"""
    global ssh_tunnel
    
    logger.info("Starting IoT Backend GPU Server...")
    
    # Start SSH tunnel if configured
    public_vps_ip = os.getenv('PUBLIC_VPS_IP')
    if public_vps_ip:
        logger.info("Starting SSH reverse tunnel...")
        try:
            ssh_tunnel = create_ssh_tunnel()
            if ssh_tunnel:
                logger.info("SSH tunnel started successfully")
            else:
                logger.warning("Failed to start SSH tunnel")
        except Exception as e:
            logger.error(f"Error starting SSH tunnel: {e}")
    else:
        logger.info("No PUBLIC_VPS_IP configured, running without tunnel")

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    global ssh_tunnel
    
    logger.info("Shutting down IoT Backend GPU Server...")
    
    # Stop SSH tunnel
    if ssh_tunnel:
        logger.info("Stopping SSH tunnel...")
        stop_ssh_tunnel()
        ssh_tunnel = None

@app.get("/health")
async def health_check():
    return {"status": "healthy", "uptime": time.time(), "timestamp": int(time.time() * 1000)}

@app.post("/api/v1/devices/register")
async def register_device(
    deviceId: str = Form(...),
    deviceName: str = Form(...),
    deviceType: str = Form(...),
    ipAddress: Optional[str] = Form(None),
    capabilities: Optional[str] = Form(None)
):
    try:
        capabilities_list = []
        if capabilities:
            try:
                capabilities_list = json.loads(capabilities)
            except:
                capabilities_list = capabilities.split(',') if isinstance(capabilities, str) else []
        
        device_data = {
            'id': deviceId,
            'name': deviceName,
            'type': deviceType,
            'ipAddress': ipAddress,
            'capabilities': capabilities_list,
            'status': 'online'
        }
        
        registered_device = data_store.register_device(device_data)
        logger.info(f"Device registered: {deviceId}")
        return registered_device
        
    except Exception as e:
        logger.error(f"Error registering device: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/v1/devices/heartbeat")
async def device_heartbeat(
    deviceId: str = Form(...),
    uptime: Optional[int] = Form(None),
    freeHeap: Optional[int] = Form(None),
    wifiRssi: Optional[int] = Form(None),
    status: Optional[str] = Form("online")
):
    try:
        device = data_store.get_device(deviceId)
        if device:
            device['lastSeen'] = time.time() * 1000
            device['uptime'] = uptime or device.get('uptime', 0)
            device['freeHeap'] = freeHeap or device.get('freeHeap', 0)
            device['wifiRssi'] = wifiRssi
            device['status'] = status
            data_store.register_device(device)
        
        return {"message": "Heartbeat received", "status": "success"}
        
    except Exception as e:
        logger.error(f"Error processing heartbeat: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/v1/devices")
async def get_all_devices():
    devices = data_store.get_all_devices()
    formatted_devices = []
    
    for device in devices:
        formatted_devices.append({
            "deviceId": device.get('id'),
            "deviceName": device.get('name'),
            "deviceType": device.get('type'),
            "status": device.get('status'),
            "ipAddress": device.get('ipAddress'),
            "lastHeartbeat": device.get('lastSeen'),
            "uptime": device.get('uptime'),
            "freeHeap": device.get('freeHeap'),
            "wifiRssi": device.get('wifiRssi'),
            "errorCount": device.get('errors', 0),
            "capabilities": device.get('capabilities', [])
        })
    
    return {"success": True, "devices": formatted_devices}

@app.post("/api/v1/stream/stream")
async def stream_endpoint(
    image: UploadFile = File(...),
    deviceId: Optional[str] = Form("unknown_device")
):
    try:
        if not image.content_type.startswith('image/'):
            raise HTTPException(status_code=400, detail="File must be an image")
        
        # Read image bytes
        image_bytes = await image.read()
        
        # Save image to data directory
        timestamp = int(time.time() * 1000)
        filename = f"{deviceId}_{timestamp}.jpg"
        file_path = DATA_DIR / filename
        
        with open(file_path, 'wb') as f:
            f.write(image_bytes)
        
        logger.info(f"Frame saved: {filename}")
        
        # Perform face recognition
        recognition_result = await data_store.perform_face_recognition(image_bytes)
        
        return {
            "message": "Frame received",
            "recognitionStatus": recognition_result["status"],
            "recognizedAs": recognition_result["recognizedAs"],
            "filename": filename,
            "url": f"/data/{filename}"
        }
        
    except Exception as e:
        logger.error(f"Error processing frame: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to process frame: {str(e)}")

@app.get("/api/v1/stream/frames")
async def get_frames():
    try:
        frames = []
        for image_file in DATA_DIR.glob("*.jpg"):
            stat = image_file.stat()
            frames.append({
                "id": image_file.name,
                "name": image_file.name,
                "url": f"/data/{image_file.name}",
                "createdAt": time.ctime(stat.st_ctime),
                "size": stat.st_size,
                "type": "image"
            })
        
        # Sort by creation time (newest first)
        frames.sort(key=lambda x: x["createdAt"], reverse=True)
        
        return {"success": True, "data": frames}
        
    except Exception as e:
        logger.error(f"Error getting frames: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve frames")

@app.post("/api/v1/recognition/add-permitted-face")
async def add_permitted_face(
    image: UploadFile = File(...),
    name: str = Form(...)
):
    try:
        if not image.content_type.startswith('image/'):
            raise HTTPException(status_code=400, detail="File must be an image")
        
        # Read image bytes
        image_bytes = await image.read()
        
        # Save to permitted faces directory
        safe_name = "".join(c for c in name if c.isalnum() or c in (' ', '-', '_')).strip()
        safe_name = safe_name.replace(' ', '_')
        filename = f"{safe_name}.jpg"
        file_path = PERMITTED_FACES_DIR / filename
        
        with open(file_path, 'wb') as f:
            f.write(image_bytes)
        
        # Reload permitted faces
        data_store.load_permitted_faces()
        
        logger.info(f"Permitted face added: {safe_name}")
        
        return {
            "success": True,
            "message": f"Permitted face '{safe_name}' added successfully",
            "filename": filename
        }
        
    except Exception as e:
        logger.error(f"Error adding permitted face: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to add permitted face: {str(e)}")

@app.get("/api/v1/system/status")
async def get_system_status():
    devices = data_store.get_all_devices()
    online_devices = [d for d in devices if d.get('status') in ['online', 'warning']]
    
    return {
        "success": True,
        "status": {
            "devicesOnline": len(online_devices),
            "devicesTotal": len(devices),
            "systemUptime": int(time.time()),
            "totalCommandsSent": 0,
            "totalCommandsFailed": 0,
            "backendConnected": True,
            "lastBackendSync": int(time.time() * 1000),
            "systemLoad": 0.1
        }
    }

@app.post("/recognize")
async def recognize_face(
    file: UploadFile = File(...)
):
    """
    Receives an image file, performs face recognition, and returns the result.
    """
    logger.info(f"Received request for /recognize for file: {file.filename}")
    try:
        image_bytes = await file.read()
        if not image_bytes:
            logger.error("Received empty file for recognition.")
            raise HTTPException(status_code=400, detail="Empty file uploaded")

        logger.info(f"File size: {len(image_bytes)} bytes. Performing recognition...")
        
        # Ensure permitted faces are loaded (or reloaded if necessary)
        # This might be better in startup or a separate refresh mechanism if faces change often
        if not permitted_face_encodings: # Check if it's empty
            logger.info("Permitted faces not loaded. Attempting to load now.")
            data_store.load_permitted_faces() 
            if not permitted_face_encodings:
                 logger.warning("Permitted faces are still not loaded after attempting reload. Recognition might fail or be limited.")


        start_time = time.time()
        recognition_result = await data_store.perform_face_recognition(image_bytes)
        end_time = time.time()
        
        processing_time = round((end_time - start_time) * 1000, 2) # in milliseconds
        logger.info(f"Recognition for {file.filename} completed in {processing_time}ms. Result: {recognition_result}")

        # Standardize response
        response_data = {
            "status": recognition_result.get("status", "error"), # Default to 'error' if status is missing
            "recognized_faces": [],
            "faces_detected": recognition_result.get("faces_detected", 0),
            "processing_time": processing_time,
            "error": recognition_result.get("error")
        }

        if recognition_result.get("status") == "permitted_face":
            response_data["recognized_faces"].append({
                "name": recognition_result.get("recognizedAs"),
                "confidence": recognition_result.get("confidence")
            })
        # If status is unknown_face, no_face_detected, or an error, recognized_faces remains empty or error is populated

        return JSONResponse(content=response_data)

    except HTTPException as http_exc: # Re-raise HTTPExceptions
        raise http_exc
    except Exception as e:
        logger.error(f"Unexpected error in /recognize endpoint: {e}", exc_info=True)
        return JSONResponse(
            status_code=500,
            content={
                "status": "server_error", 
                "recognized_faces": [], 
                "faces_detected": 0,
                "error": f"Internal server error: {str(e)}"
            }
        )

if __name__ == "__main__":
    # Setup signal handlers for graceful shutdown
    def signal_handler(signum, frame):
        logger.info(f"Received signal {signum}, shutting down...")
        stop_ssh_tunnel()
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    # Check for GPU availability
    try:
        import torch
        if torch.cuda.is_available():
            logger.info(f"GPU available: {torch.cuda.get_device_name(0)}")
        else:
            logger.info("GPU not available, using CPU")
    except ImportError:
        logger.info("PyTorch not available")
    
    # Get configuration from environment
    host = os.getenv('HOST', '0.0.0.0')
    port = int(os.getenv('PORT', '9001'))
    debug = os.getenv('DEBUG', 'False').lower() == 'true'
    
    # Start server
    logger.info(f"Starting server on {host}:{port}")
    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=debug,
        log_level=os.getenv('LOG_LEVEL', 'info').lower()
    )
