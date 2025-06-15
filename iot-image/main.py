import os
import logging
import time
import signal
import sys
from pathlib import Path
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Request
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from dotenv import load_dotenv

# Attempt to import optional libraries and set flags
try:
    import cv2
    cv2_available = True
except ImportError:
    cv2_available = False
    # logging.warning("OpenCV (cv2) not available. Image processing features will be limited.") # Logger not yet configured

try:
    import numpy as np
    numpy_available = True
except ImportError:
    numpy_available = False
    # logging.warning("NumPy not available. Numerical operations will be limited.")

try:
    import face_recognition
    face_recognition_available = True
except ImportError:
    face_recognition_available = False
    # logging.warning("face_recognition library not available. Face recognition features will be disabled.")

try:
    import mediapipe as mp
    mp_face_detection = mp.solutions.face_detection
    mp_drawing = mp.solutions.drawing_utils
    mediapipe_available = True
except ImportError:
    mediapipe_available = False
    mp_face_detection = None
    mp_drawing = None
    # logging.warning("MediaPipe not available. MediaPipe specific features will be disabled.")

try:
    import torch
    torch_available = True
except ImportError:
    torch_available = False
    # logging.warning("PyTorch not available. GPU acceleration checks will be skipped.")

try:
    import uvicorn
    uvicorn_available = True
except ImportError:
    uvicorn_available = False
    # logging.warning("Uvicorn not available. The server cannot be started directly with this script.")


from ssh_tunnel import create_ssh_tunnel, stop_ssh_tunnel, get_tunnel_instance

# Load environment variables
load_dotenv()

# Setup logging
log_level = os.getenv('LOG_LEVEL', 'INFO').upper()
# Ensure basicConfig is called only once
if not logging.getLogger().hasHandlers():
    logging.basicConfig(level=getattr(logging, log_level, logging.INFO),
                        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Log availability of optional dependencies
logger.info(f"OpenCV (cv2) available: {cv2_available}")
logger.info(f"NumPy available: {numpy_available}")
logger.info(f"face_recognition available: {face_recognition_available}")
logger.info(f"MediaPipe available: {mediapipe_available}")
logger.info(f"PyTorch available: {torch_available}")
logger.info(f"Uvicorn available: {uvicorn_available}")


app = FastAPI(title="IoT Backend GPU Server", version="1.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global Exception Handler to catch any unhandled errors
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception for request {request.url.path}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"status": "error", "message": "Internal server error", "detail": str(exc)},
    )

# Setup directories
BASE_DIR = Path(__file__).resolve().parent.parent.joinpath("iot-backend-express") # Corrected with resolve()
DATA_DIR = BASE_DIR / "data"
RECORDINGS_DIR = BASE_DIR / "recordings"
PERMITTED_FACES_DIR = BASE_DIR / "permitted_faces"

# Create directories if they don't exist
for directory in [DATA_DIR, RECORDINGS_DIR, PERMITTED_FACES_DIR]:
    try:
        directory.mkdir(parents=True, exist_ok=True) # Added parents=True
        logger.info(f"Ensured directory exists: {directory}")
    except Exception as e:
        logger.error(f"Could not create directory {directory}: {e}", exc_info=True)


# Mount static files
try:
    app.mount("/data", StaticFiles(directory=str(DATA_DIR)), name="data")
    app.mount("/recordings", StaticFiles(directory=str(RECORDINGS_DIR)), name="recordings")
    logger.info("Static file mounts successful.")
except Exception as e:
    logger.error(f"Error mounting static files: {e}", exc_info=True)


# Global variables for devices - consider moving fully into DataStore if appropriate
devices = {} # This global 'devices' might conflict with DataStore's self.devices.
             # For now, keeping as is from original code, but review if DataStore should be sole owner.

# SSH Tunnel instance
ssh_tunnel_instance = None # Renamed from ssh_tunnel to avoid conflict with module

class DataStore:
    def __init__(self):
        self.devices = {} # Device storage specific to DataStore instance
        self.permitted_face_encodings: List[Any] = []
        self.permitted_face_names: List[str] = []
        self.load_permitted_faces()
    
    def register_device(self, device_data: Dict[str, Any]) -> Dict[str, Any]:
        device_id = device_data.get('id') or device_data.get('deviceId')
        if not device_id:
            logger.error("Device registration attempt with no ID.")
            raise ValueError("Device ID is required for registration.") # This will be caught by global handler
        
        logger.info(f"Registering or updating device: {device_id}")
        existing_device = self.devices.get(device_id)
        if existing_device:
            existing_device.update(device_data)
            existing_device['lastSeen'] = time.time() * 1000
            logger.info(f"Updated existing device: {device_id}")
        else:
            device_data['lastSeen'] = time.time() * 1000
            device_data['status'] = device_data.get('status', 'online')
            device_data['errors'] = device_data.get('errors', 0)
            self.devices[device_id] = device_data
            logger.info(f"Registered new device: {device_id}")
        
        return self.devices[device_id]
    
    def get_device(self, device_id: str) -> Optional[Dict[str, Any]]:
        logger.debug(f"Fetching device: {device_id}")
        return self.devices.get(device_id)
    
    def get_all_devices(self) -> List[Dict[str, Any]]:
        logger.debug("Fetching all devices.")
        return list(self.devices.values())
    
    def load_permitted_faces(self):
        """Load permitted faces from the permitted_faces directory"""
        logger.info("Loading permitted faces...")
        self.permitted_face_encodings = []
        self.permitted_face_names = []
        
        if not face_recognition_available:
            logger.warning("face_recognition library not available. Cannot load permitted faces.")
            return
        if not cv2_available or not numpy_available:
            logger.warning("cv2 or numpy not available. Cannot load permitted faces.")
            return

        if not PERMITTED_FACES_DIR.exists():
            logger.warning(f"Permitted faces directory {PERMITTED_FACES_DIR} does not exist.")
            return
        
        loaded_count = 0
        for image_file in PERMITTED_FACES_DIR.glob("*.[jp][pn]g"): # jpg, jpeg, png
            try:
                logger.debug(f"Attempting to load permitted face from {image_file.name}")
                # Load image using face_recognition's loader
                image = face_recognition.load_image_file(str(image_file))
                
                # Get face encodings for all faces in the image
                # We'll take the first one found, assuming one person per image for permitted faces.
                encodings = face_recognition.face_encodings(image)
                
                if encodings:
                    self.permitted_face_encodings.append(encodings[0])
                    self.permitted_face_names.append(image_file.stem) # Use filename (without ext) as name
                    loaded_count += 1
                    logger.info(f"Successfully loaded face: {image_file.stem}")
                else:
                    logger.warning(f"No face found in permitted image: {image_file.name}")
            except Exception as e:
                logger.error(f"Error loading permitted face {image_file.name}: {e}", exc_info=True)
        logger.info(f"Finished loading permitted faces. Total loaded: {loaded_count}")
    
    async def perform_face_recognition(self, image_bytes: bytes) -> Dict[str, Any]:
        """Perform face recognition on image bytes"""
        logger.info("Attempting face recognition...")
        
        if not face_recognition_available:
            logger.warning("face_recognition library not available. Skipping recognition.")
            return {"status": "recognition_disabled", "recognizedAs": None, "error": "Face recognition library not available."}
        if not cv2_available or not numpy_available:
            logger.warning("cv2 or numpy not available. Skipping recognition.")
            return {"status": "recognition_disabled", "recognizedAs": None, "error": "cv2 or numpy not available."}

        try:
            nparr = np.frombuffer(image_bytes, np.uint8)
            image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if image is None:
                logger.error("Failed to decode image from bytes.")
                return {"status": "image_decode_error", "recognizedAs": None, "error": "Failed to decode image"}

            # Convert BGR to RGB (face_recognition expects RGB)
            rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            
            logger.info("Detecting face locations...")
            face_locations = face_recognition.face_locations(rgb_image) # model="hog" is faster, "cnn" is more accurate
            logger.info(f"Found {len(face_locations)} face(s).")
            
            if not face_locations:
                logger.info("No faces detected in the image.")
                return {"status": "no_face_detected", "recognizedAs": None, "faces_detected": 0}
            
            logger.info("Encoding detected faces...")
            unknown_face_encodings = face_recognition.face_encodings(rgb_image, known_face_locations=face_locations)
            
            if not self.permitted_face_encodings:
                logger.warning("No permitted faces loaded for comparison. All detected faces will be 'unknown'.")
                return {"status": "unknown_face", "recognizedAs": None, "faces_detected": len(face_locations), "detail": "No permitted faces loaded for comparison."}

            for i, unknown_face_encoding in enumerate(unknown_face_encodings):
                logger.debug(f"Comparing detected face #{i+1} against permitted faces.")
                matches = face_recognition.compare_faces(self.permitted_face_encodings, unknown_face_encoding, tolerance=0.6)
                name = "Unknown"
                confidence = None

                face_distances = face_recognition.face_distance(self.permitted_face_encodings, unknown_face_encoding)
                
                if len(face_distances) > 0:
                    best_match_index = np.argmin(face_distances)
                    if matches[best_match_index]:
                        name = self.permitted_face_names[best_match_index]
                        # Convert distance to a pseudo-confidence score (0-100, higher is better)
                        # Lower distance means more similar. (1 - distance) makes it higher for better matches.
                        confidence = round((1 - float(face_distances[best_match_index])) * 100, 2)
                        logger.info(f"Permitted face matched: {name} with distance: {face_distances[best_match_index]:.2f} (Confidence: {confidence}%)")
                        # Return first permitted match found
                        return {"status": "permitted_face", "recognizedAs": name, "confidence": confidence, "faces_detected": len(face_locations)}
            
            logger.info("No permitted face matched among detected faces. All are unknown.")
            return {"status": "unknown_face", "recognizedAs": None, "faces_detected": len(face_locations)}
            
        except Exception as e:
            logger.error(f"Critical error in face recognition process: {e}", exc_info=True)
            return {"status": "recognition_error", "recognizedAs": None, "error": f"Internal server error during recognition: {str(e)}"}

# Initialize data store
data_store = DataStore()

@app.on_event("startup")
async def startup_event():
    """Initialize services on startup"""
    global ssh_tunnel_instance # Use the renamed global variable
    
    logger.info("Starting IoT Backend GPU Server...")
    data_store.load_permitted_faces() # Load faces on startup
    
    public_vps_ip = os.getenv('PUBLIC_VPS_IP')
    if public_vps_ip:
        logger.info(f"Attempting to start SSH reverse tunnel to {public_vps_ip}...")
        try:
            ssh_tunnel_instance = create_ssh_tunnel() # Assuming create_ssh_tunnel handles its config from env
            if ssh_tunnel_instance and get_tunnel_instance() and get_tunnel_instance().is_active: # Check if tunnel is active
                 logger.info("SSH reverse tunnel started successfully.")
            else:
                 logger.warning("SSH tunnel object created, but it might not be active. Check tunnel logs/status.")
        except Exception as e:
            logger.error(f"Failed to start SSH tunnel: {e}", exc_info=True)
    else:
        logger.info("No PUBLIC_VPS_IP configured in .env, running without SSH tunnel.")

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    global ssh_tunnel_instance
    
    logger.info("Shutting down IoT Backend GPU Server...")
    
    if ssh_tunnel_instance:
        logger.info("Stopping SSH tunnel...")
        try:
            stop_ssh_tunnel() # Assuming this stops the tunnel started by create_ssh_tunnel
            ssh_tunnel_instance = None
            logger.info("SSH tunnel stopped.")
        except Exception as e:
            logger.error(f"Error stopping SSH tunnel: {e}", exc_info=True)


@app.get("/health")
async def health_check():
    logger.info("Health check requested.")
    current_uptime = -1
    if hasattr(app.state, 'start_time') and app.state.start_time:
        current_uptime = int(time.time() - app.state.start_time)
    return {"status": "healthy", "uptime_seconds": current_uptime , "timestamp_ms": int(time.time() * 1000)}


@app.post("/api/v1/devices/register")
async def register_device_endpoint( # Renamed to avoid conflict with built-in 'register_device'
    deviceId: str = Form(...),
    deviceName: str = Form(...),
    deviceType: str = Form(...),
    ipAddress: Optional[str] = Form(None),
    capabilities: Optional[str] = Form(None) # e.g. "stream,record,ptz"
):
    logger.info(f"Received registration request for deviceId: {deviceId}")
    try:
        capabilities_list = capabilities.split(',') if capabilities else []
        
        device_data = {
            'id': deviceId,
            'name': deviceName,
            'type': deviceType,
            'ipAddress': ipAddress,
            'capabilities': capabilities_list,
            'status': 'online' # Default status
        }
        registered_device = data_store.register_device(device_data)
        logger.info(f"Device {deviceId} registered/updated successfully.")
        return JSONResponse(content={"success": True, "device": registered_device})
        
    except ValueError as ve:
        logger.warning(f"Validation error during device registration for {deviceId}: {ve}")
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error registering device {deviceId}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.post("/api/v1/devices/heartbeat")
async def device_heartbeat(
    deviceId: str = Form(...),
    uptime: Optional[int] = Form(None),
    freeHeap: Optional[int] = Form(None),
    wifiRssi: Optional[int] = Form(None),
    status: Optional[str] = Form("online")
):
    logger.debug(f"Received heartbeat from deviceId: {deviceId}")
    try:
        device = data_store.get_device(deviceId)
        if not device:
            logger.warning(f"Heartbeat from unknown device: {deviceId}. Registering as new.")
            # Optionally, register it or reject heartbeat
            new_device_data = {'id': deviceId, 'name': f"Unknown Device {deviceId}", 'type': 'unknown', 'status': status}
            data_store.register_device(new_device_data)
            # Fallthrough to update below is fine, or handle differently
        
        updated_data = {
            'lastSeen': time.time() * 1000,
            'uptime': uptime,
            'freeHeap': freeHeap,
            'wifiRssi': wifiRssi,
            'status': status
        }
        # Filter out None values before updating
        update_payload = {k: v for k, v in updated_data.items() if v is not None}
        
        # Update device in DataStore (assuming registerDevice handles updates)
        data_store.register_device({'id': deviceId, **update_payload}) # Spreading existing and new data
        logger.debug(f"Heartbeat processed for device {deviceId}.")
        return JSONResponse(content={"success": True, "message": "Heartbeat received"})
        
    except Exception as e:
        logger.error(f"Error processing heartbeat for device {deviceId}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.get("/api/v1/devices")
async def get_all_devices_endpoint(): # Renamed
    logger.debug("Request to get all devices.")
    try:
        devices_list = data_store.get_all_devices()
        # Format if needed, or return as is
        return JSONResponse(content={"success": True, "devices": devices_list})
    except Exception as e:
        logger.error(f"Error retrieving all devices: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@app.post("/api/v1/stream/stream")
async def stream_endpoint(
    image: UploadFile = File(...),
    deviceId: Optional[str] = Form("unknown_device")
):
    logger.info(f"Received stream frame from device: {deviceId}, filename: {image.filename}")
    try:
        image_bytes = await image.read()
        if not image_bytes:
            logger.warning(f"Empty image file received from {deviceId}.")
            raise HTTPException(status_code=400, detail="Empty image file received.")

        # Save image (optional, if needed beyond recognition)
        # timestamp = int(time.time() * 1000)
        # save_filename = f"{deviceId}_{timestamp}.jpg"
        # save_path = DATA_DIR / save_filename
        # with open(save_path, "wb") as f:
        #     f.write(image_bytes)
        # logger.info(f"Frame from {deviceId} saved to {save_path}")

        recognition_result = await data_store.perform_face_recognition(image_bytes)
        logger.info(f"Face recognition result for {deviceId} frame: {recognition_result}")
        
        # Add deviceId to the response for clarity, though perform_face_recognition doesn't know it
        response_payload = {
            "deviceId": deviceId,
            **recognition_result # Spread the result from recognition
        }
        return JSONResponse(content=response_payload)
        
    except HTTPException as http_exc:
        logger.warning(f"HTTPException in stream endpoint for {deviceId}: {http_exc.detail}")
        raise http_exc # Re-raise already formed HTTPException
    except Exception as e:
        logger.error(f"Error processing stream from {deviceId}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error processing stream: {str(e)}")

@app.get("/api/v1/stream/frames")
async def get_frames():
    logger.debug("Request to get frames (not implemented in detail, placeholder).")
    try:
        # This endpoint seems to list saved frames.
        # For now, return a placeholder or list files from DATA_DIR if that's the intent.
        # Example: list image files
        image_files = [f.name for f in DATA_DIR.glob("*.[jp][pn]g") if f.is_file()]
        return JSONResponse(content={"success": True, "frames": image_files, "message": "Basic frame list."})
    except Exception as e:
        logger.error(f"Error in get_frames: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.post("/api/v1/recognition/add-permitted-face")
async def add_permitted_face(
    image: UploadFile = File(...),
    name: str = Form(...)
):
    logger.info(f"Request to add permitted face: {name}, filename: {image.filename}")
    if not face_recognition_available:
        logger.warning("Cannot add permitted face: face_recognition library not available.")
        raise HTTPException(status_code=501, detail="Face recognition feature not available.")
    if not cv2_available or not numpy_available:
        logger.warning("Cannot add permitted face: cv2 or numpy not available.")
        raise HTTPException(status_code=501, detail="Required image processing libraries not available.")

    try:
        image_bytes = await image.read()
        if not image_bytes:
            logger.warning(f"Empty image file received for permitted face: {name}")
            raise HTTPException(status_code=400, detail="Empty image file received.")

        # Validate image (optional, e.g., using PIL)
        try:
            img_pil = Image.open(image.file)
            img_pil.verify() # Verify it's a valid image
            # Reset file pointer for saving or further processing if needed
            await image.seek(0) 
        except Exception as img_exc:
            logger.warning(f"Invalid image file received for permitted face {name}: {img_exc}")
            raise HTTPException(status_code=400, detail=f"Invalid image file: {img_exc}")

        # Save the image to permitted_faces directory
        # Ensure name is filesystem-safe
        safe_name = "".join(c if c.isalnum() or c in (' ', '.', '_') else '_' for c in name).rstrip()
        # Get extension from original filename
        original_filename = image.filename if image.filename else "uploaded_face"
        extension = Path(original_filename).suffix or ".jpg" # Default to .jpg if no suffix
        
        # Prevent path traversal or overly long names
        if len(safe_name) == 0 or len(safe_name) > 100:
            logger.warning(f"Invalid or too long name for permitted face: {name}")
            raise HTTPException(status_code=400, detail="Invalid or too long name for permitted face.")

        permitted_image_path = PERMITTED_FACES_DIR / f"{safe_name}{extension}"
        
        with open(permitted_image_path, "wb") as f:
            f.write(image_bytes)
        logger.info(f"Saved new permitted face image for '{name}' to {permitted_image_path}")

        # Reload permitted faces in DataStore
        data_store.load_permitted_faces()
        
        return JSONResponse(content={"success": True, "message": f"Permitted face '{name}' added and loaded."})
        
    except HTTPException as http_exc:
        raise http_exc
    except Exception as e:
        logger.error(f"Error adding permitted face '{name}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error adding face: {str(e)}")

@app.get("/api/v1/system/status")
async def get_system_status_endpoint(): # Renamed
    logger.info("Request for system status.")
    try:
        devices_list = data_store.get_all_devices()
        online_devices_count = len([d for d in devices_list if d.get('status', 'offline').lower() in ['online', 'warning']])
        
        # Calculate uptime
        current_uptime = -1
        if hasattr(app.state, 'start_time') and app.state.start_time:
            current_uptime = int(time.time() - app.state.start_time)

        status_data = {
            "devicesOnline": online_devices_count,
            "devicesTotal": len(devices_list),
            "systemUptimeSeconds": current_uptime,
            # "totalCommandsSent": 0, # These would need actual tracking
            # "totalCommandsFailed": 0,
            "backendConnected": True, # Assuming this service is the backend
            "lastBackendSyncMs": int(time.time() * 1000), # Or a more meaningful sync time
            # "systemLoad": psutil.cpu_percent() if 'psutil' in sys.modules else -1 # Example, requires psutil
        }
        return JSONResponse(content={"success": True, "status": status_data})
    except Exception as e:
        logger.error(f"Error getting system status: {e}", exc_info=True)
        raise # Re-raise to be caught by global handler


@app.post("/recognize")
async def recognize_face_endpoint( # Renamed
    file: UploadFile = File(...)
):
    logger.info(f"Received request for /recognize for file: {file.filename}")
    try:
        image_bytes = await file.read()
        if not image_bytes:
            logger.error(f"Empty file received for /recognize: {file.filename}")
            raise HTTPException(status_code=400, detail="Empty image file received.")
        
        recognition_result = await data_store.perform_face_recognition(image_bytes)
        logger.info(f"Recognition result for {file.filename}: {recognition_result}")

        # If recognition itself had an error, it's already in the result's 'status' and 'error' fields.
        # The HTTP status code for /recognize itself will be 200 OK if this endpoint executes successfully,
        # and the JSON payload will contain the outcome of the recognition attempt.
        # If perform_face_recognition raises an exception not caught internally, global handler takes over.

        return JSONResponse(content=recognition_result)

    except HTTPException as http_exc:
        # This will catch HTTPExceptions raised explicitly, like the empty file check.
        logger.warning(f"HTTPException in /recognize for {file.filename}: {http_exc.detail}", exc_info=False) # No need for full stack trace for expected HTTP exceptions
        raise http_exc # Re-raise
    except Exception as e:
        # This catches unexpected errors within this endpoint's direct logic (e.g., await file.read()).
        # Errors from perform_face_recognition should be handled within that method or by the global handler if they escape.
        logger.error(f"Unexpected error in /recognize endpoint for file {file.filename}: {e}", exc_info=True)
        # Let the global exception handler manage this for consistency
        raise # Or return JSONResponse({"status": "error", "message": "Internal server error in /recognize endpoint", "detail": str(e)}, status_code=500)

if __name__ == "__main__":
    if not uvicorn_available:
        logger.critical("Uvicorn is not installed. Please install uvicorn to run the server: pip install uvicorn[standard]")
        sys.exit(1)
        
    # Setup signal handlers for graceful shutdown
    def signal_handler(signum, frame):
        logger.info(f"Received signal {signum}, initiating graceful shutdown...")
        # Perform any app-specific cleanup before stopping the tunnel
        # (e.g., wait for ongoing requests, close database connections)
        
        # Stop SSH tunnel if it's running
        global ssh_tunnel_instance
        if ssh_tunnel_instance: # Check if the tunnel object exists
            logger.info("Attempting to stop SSH tunnel...")
            try:
                stop_ssh_tunnel() # Call the function from ssh_tunnel.py
                logger.info("SSH tunnel stop command issued.")
            except Exception as e:
                logger.error(f"Error during SSH tunnel stop: {e}", exc_info=True)
        
        logger.info("Exiting application.")
        sys.exit(0) # Exit gracefully
    
    signal.signal(signal.SIGINT, signal_handler) # Handle Ctrl+C
    signal.signal(signal.SIGTERM, signal_handler) # Handle kill/system shutdown
    
    # Check for GPU availability (PyTorch example)
    if torch_available:
        try:
            if torch.cuda.is_available():
                logger.info(f"PyTorch: CUDA is available. GPU: {torch.cuda.get_device_name(0)}")
            else:
                logger.info("PyTorch: CUDA not available, running on CPU.")
        except Exception as e:
            logger.warning(f"Error checking PyTorch CUDA availability: {e}")
    else:
        logger.info("PyTorch not available, cannot check for GPU.")
    
    # Get configuration from environment
    host = os.getenv('HOST', '0.0.0.0')
    port = int(os.getenv('PORT', '9001')) # Default to 9001 for the Python service
    reload_debug = os.getenv('DEBUG', 'False').lower() == 'true' # For uvicorn's reload
    log_level_uvicorn = os.getenv('LOG_LEVEL', 'info').lower() # For uvicorn's own logging

    logger.info(f"Starting Uvicorn server on {host}:{port}. Reload: {reload_debug}. Log Level: {log_level_uvicorn}")
    
    uvicorn.run(
        "main:app", # app is instance of FastAPI in main.py
        host=host,
        port=port,
        reload=reload_debug,
        log_level=log_level_uvicorn
        # workers=int(os.getenv('WEB_CONCURRENCY', 1)) # For production, consider multiple workers
    )
