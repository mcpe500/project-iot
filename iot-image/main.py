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
    cv2 = None # type: ignore
    cv2_available = False

try:
    import numpy as np
    numpy_available = True
except ImportError:
    np = None # type: ignore
    numpy_available = False

try:
    import face_recognition
    face_recognition_available = True
except ImportError:
    face_recognition = None # type: ignore
    face_recognition_available = False

try:
    import mediapipe as mp
    if mp: # mypy check
        mp_face_detection = mp.solutions.face_detection
        mp_drawing = mp.solutions.drawing_utils
    else:
        mp_face_detection = None
        mp_drawing = None
    mediapipe_available = True if mp else False
except ImportError:
    mp = None # type: ignore
    mp_face_detection = None
    mp_drawing = None
    mediapipe_available = False

try:
    import torch
    torch_available = True
except ImportError:
    torch = None # type: ignore
    torch_available = False

try:
    import uvicorn
    uvicorn_available = True
except ImportError:
    uvicorn = None # type: ignore
    uvicorn_available = False

# Ensure ssh_tunnel is importable, handle if not
try:
    from ssh_tunnel import create_ssh_tunnel, stop_ssh_tunnel, get_tunnel_instance
    ssh_tunnel_available = True
except ImportError:
    create_ssh_tunnel, stop_ssh_tunnel, get_tunnel_instance = None, None, None # type: ignore
    ssh_tunnel_available = False

# Load environment variables
load_dotenv()

# Setup logging
log_level_name = os.getenv('LOG_LEVEL', 'INFO').upper()
# Ensure basicConfig is called only once
if not logging.getLogger().hasHandlers():
    logging.basicConfig(
        level=getattr(logging, log_level_name, logging.INFO),
        format='%(asctime)s - %(name)s - %(levelname)s - %(module)s:%(lineno)d - %(message)s'
    )
logger = logging.getLogger(__name__)

logger.info(f"Logging initialized with level: {log_level_name}")
logger.info(f"OpenCV (cv2) available: {cv2_available}")
logger.info(f"NumPy (np) available: {numpy_available}")
logger.info(f"face_recognition available: {face_recognition_available}")
logger.info(f"MediaPipe (mp) available: {mediapipe_available}")
logger.info(f"PyTorch (torch) available: {torch_available}")
logger.info(f"Uvicorn available: {uvicorn_available}")
logger.info(f"SSH Tunnel utilities available: {ssh_tunnel_available}")


app = FastAPI(title="IoT Backend GPU Server", version="1.0.0")
app.state.start_time = time.time() # Record start time for uptime calculation

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
    logger.error(f"Unhandled exception for request {request.url.path}: {type(exc).__name__} - {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"status": "error", "message": "Internal server error", "detail": f"{type(exc).__name__}: {str(exc)}"},
    )

# Setup directories
BASE_DIR = Path(__file__).resolve().parent.parent.joinpath("iot-backend-express") # Corrected with resolve()
DATA_DIR = BASE_DIR / "data"
RECORDINGS_DIR = BASE_DIR / "recordings"
PERMITTED_FACES_DIR = BASE_DIR / "permitted_faces"

# Create directories if they don't exist
for directory in [DATA_DIR, RECORDINGS_DIR, PERMITTED_FACES_DIR]:
    try:
        Path(directory).mkdir(parents=True, exist_ok=True) # Ensure Path object is used
        logger.info(f"Ensured directory exists: {directory}")
    except Exception as e:
        logger.error(f"Could not create or verify directory {directory}: {e}", exc_info=True)
        # Depending on severity, you might want to exit or raise a more specific error


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
ssh_tunnel_instance = None

class DataStore:
    def __init__(self):
        self.devices: Dict[str, Dict[str, Any]] = {}
        self.permitted_face_encodings: List[Any] = []
        self.permitted_face_names: List[str] = []
        logger.info("DataStore initializing...")
        try:
            self.load_permitted_faces()
        except Exception as e:
            logger.error(f"Failed to load permitted faces during DataStore initialization: {e}", exc_info=True)
        logger.info("DataStore initialized.")
    
    def register_device(self, device_data: Dict[str, Any]) -> Dict[str, Any]:
        device_id = device_data.get('id') or device_data.get('deviceId')
        if not device_id:
            logger.error("Device registration attempt with no ID.")
            # This will be caught by the global handler if raised from an endpoint
            raise ValueError("Device ID is required for registration.")
        
        logger.info(f"Registering or updating device: {device_id}")
        try:
            existing_device = self.devices.get(device_id)
            current_time_ms = time.time() * 1000
            if existing_device:
                existing_device.update(device_data)
                existing_device['lastSeen'] = current_time_ms
                logger.info(f"Updated existing device: {device_id}")
            else:
                device_data['lastSeen'] = current_time_ms
                device_data['status'] = device_data.get('status', 'online')
                device_data['errors'] = device_data.get('errors', 0)
                self.devices[device_id] = device_data
                logger.info(f"Registered new device: {device_id}")
            return self.devices[device_id]
        except Exception as e:
            logger.error(f"Error during device registration/update for {device_id}: {e}", exc_info=True)
            # Re-raise to be handled by endpoint or global handler
            raise
    
    def get_device(self, device_id: str) -> Optional[Dict[str, Any]]:
        logger.debug(f"Fetching device: {device_id}")
        return self.devices.get(device_id)
    
    def get_all_devices(self) -> List[Dict[str, Any]]:
        logger.debug("Fetching all devices.")
        return list(self.devices.values())
    
    def load_permitted_faces(self):
        """Load permitted faces from the permitted_faces directory"""
        logger.info("Attempting to load permitted faces...")
        self.permitted_face_encodings = []
        self.permitted_face_names = []
        
        if not face_recognition_available:
            logger.warning("face_recognition library not available. Cannot load permitted faces.")
            return
        if not cv2_available:
            logger.warning("OpenCV (cv2) not available. Cannot load permitted faces.")
            return
        if not numpy_available:
            logger.warning("NumPy (np) not available. Cannot load permitted faces.")
            return

        if not PERMITTED_FACES_DIR.exists():
            logger.warning(f"Permitted faces directory {PERMITTED_FACES_DIR} does not exist. Cannot load faces.")
            return
        
        loaded_count = 0
        logger.info(f"Scanning {PERMITTED_FACES_DIR} for permitted faces (jpg, jpeg, png)...")
        for image_file_path in PERMITTED_FACES_DIR.glob("*.[jp][pn]g"):
            try:
                logger.debug(f"Processing permitted face image: {image_file_path.name}")
                
                # Load image using face_recognition's loader (which uses Pillow)
                logger.debug(f"Loading image file: {image_file_path}")
                image_array = face_recognition.load_image_file(str(image_file_path))
                logger.debug(f"Image {image_file_path.name} loaded successfully, shape: {image_array.shape if hasattr(image_array, 'shape') else 'N/A'}")

                # Get face encodings for all faces in the image
                # We'll take the first one found, assuming one person per image for permitted faces.
                logger.debug(f"Encoding face(s) in {image_file_path.name}...")
                encodings = face_recognition.face_encodings(image_array)
                
                if encodings:
                    self.permitted_face_encodings.append(encodings[0])
                    self.permitted_face_names.append(image_file_path.stem) # Use filename (without ext) as name
                    loaded_count += 1
                    logger.info(f"Successfully loaded and encoded face: {image_file_path.stem}")
                else:
                    logger.warning(f"No face found in permitted image: {image_file_path.name}")
            except Exception as e:
                logger.error(f"Error loading or encoding permitted face {image_file_path.name}: {e}", exc_info=True)
        logger.info(f"Finished loading permitted faces. Total loaded: {loaded_count}. Total in memory: {len(self.permitted_face_encodings)}")
    
    async def perform_face_recognition(self, image_bytes: bytes) -> Dict[str, Any]:
        """Perform face recognition on image bytes"""
        logger.info("Initiating face recognition process...")
        
        if not face_recognition_available:
            logger.warning("face_recognition library not available. Recognition cannot proceed.")
            return {"status": "recognition_disabled", "recognizedAs": None, "error": "Face recognition library not available."}
        if not cv2_available:
            logger.warning("OpenCV (cv2) not available. Recognition cannot proceed.")
            return {"status": "recognition_disabled", "recognizedAs": None, "error": "OpenCV (cv2) not available."}
        if not numpy_available:
            logger.warning("NumPy (np) not available. Recognition cannot proceed.")
            return {"status": "recognition_disabled", "recognizedAs": None, "error": "NumPy (np) not available."}

        try:
            logger.debug("Converting image bytes to NumPy array...")
            nparr = np.frombuffer(image_bytes, np.uint8)
            logger.debug(f"NumPy array created from buffer, shape: {nparr.shape}")

            logger.debug("Decoding NumPy array to OpenCV image...")
            image_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if image_bgr is None:
                logger.error("Failed to decode image from bytes (cv2.imdecode returned None).")
                return {"status": "image_decode_error", "recognizedAs": None, "error": "Failed to decode image. Image might be corrupt or in an unsupported format."}
            logger.debug(f"Image decoded successfully (BGR), shape: {image_bgr.shape}")

            logger.debug("Converting BGR image to RGB...")
            image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
            logger.debug(f"Image converted to RGB, shape: {image_rgb.shape}")
            
            logger.info("Detecting face locations in RGB image...")
            # model=\"hog\" is faster, \"cnn\" is more accurate but requires dlib with CUDA compiled for GPU.
            # Using default (hog) for broader compatibility unless CNN is explicitly needed and configured.
            face_locations = face_recognition.face_locations(image_rgb) 
            logger.info(f"Found {len(face_locations)} face(s) at locations: {face_locations}")
            
            if not face_locations:
                logger.info("No faces detected in the image.")
                return {"status": "no_face_detected", "recognizedAs": None, "faces_detected": 0}
            
            logger.info("Encoding detected faces...")
            unknown_face_encodings = face_recognition.face_encodings(image_rgb, known_face_locations=face_locations)
            logger.debug(f"Generated {len(unknown_face_encodings)} encodings for detected faces.")
            
            if not self.permitted_face_encodings:
                logger.warning("No permitted faces loaded for comparison. All detected faces will be 'unknown'.")
                return {"status": "unknown_face", "recognizedAs": None, "faces_detected": len(face_locations), "detail": "No permitted faces loaded for comparison."}
            logger.debug(f"Comparing against {len(self.permitted_face_encodings)} permitted face(s).")

            for i, unknown_face_encoding in enumerate(unknown_face_encodings):
                logger.debug(f"Comparing detected face #{i+1} against permitted faces.")
                
                # Perform comparison
                matches = face_recognition.compare_faces(self.permitted_face_encodings, unknown_face_encoding, tolerance=0.6)
                logger.debug(f"Matches for face #{i+1}: {matches}")

                # Get distances for confidence scoring
                face_distances = face_recognition.face_distance(self.permitted_face_encodings, unknown_face_encoding)
                logger.debug(f"Distances for face #{i+1}: {face_distances}")
                
                name = "Unknown"
                confidence = None # type: Optional[float]

                if len(face_distances) > 0: # Should always be true if permitted_face_encodings is not empty
                    best_match_index = np.argmin(face_distances)
                    logger.debug(f"Best match index for face #{i+1}: {best_match_index}, distance: {face_distances[best_match_index]}")
                    if matches[best_match_index]:
                        name = self.permitted_face_names[best_match_index]
                        # Convert distance to a pseudo-confidence score (0-100, higher is better)
                        confidence = round((1.0 - float(face_distances[best_match_index])) * 100, 2)
                        logger.info(f"Permitted face matched: {name} with distance: {face_distances[best_match_index]:.4f} (Confidence: {confidence}%) for detected face #{i+1}.")
                        # Return first permitted match found
                        return {"status": "permitted_face", "recognizedAs": name, "confidence": confidence, "faces_detected": len(face_locations)}
            
            logger.info("No permitted face matched among detected faces after checking all. All are unknown.")
            return {"status": "unknown_face", "recognizedAs": None, "faces_detected": len(face_locations)}
            
        except cv2.error as cv2_err: # Specific OpenCV errors
             logger.error(f"OpenCV error during face recognition: {cv2_err}", exc_info=True)
             return {"status": "recognition_error", "recognizedAs": None, "error": f"OpenCV error: {str(cv2_err)}"}
        except Exception as e:
            logger.error(f"Critical error in face recognition process: {type(e).__name__} - {e}", exc_info=True)
            return {"status": "recognition_error", "recognizedAs": None, "error": f"Internal server error during recognition: {type(e).__name__} - {str(e)}"}

# Initialize data store
data_store = DataStore()

@app.on_event("startup")
async def startup_event():
    """Initialize services on startup"""
    global ssh_tunnel_instance
    
    app.state.start_time = time.time() # Ensure start_time is set
    logger.info(f"Executing startup_event. App start time set to: {app.state.start_time}")
    
    logger.info("IoT Backend GPU Server starting up...")
    try:
        data_store.load_permitted_faces() # Reload faces on startup, in case new files were added manually
    except Exception as e:
        logger.error(f"Error during startup face loading: {e}", exc_info=True)

    if ssh_tunnel_available and create_ssh_tunnel and stop_ssh_tunnel and get_tunnel_instance : # Check if functions are not None
        public_vps_ip = os.getenv('PUBLIC_VPS_IP')
        if public_vps_ip:
            logger.info(f"Attempting to start SSH reverse tunnel to {public_vps_ip}...")
            try:
                ssh_tunnel_instance = create_ssh_tunnel()
                if ssh_tunnel_instance and get_tunnel_instance() and get_tunnel_instance().is_active:
                    logger.info("SSH reverse tunnel started successfully and is active.")
                elif ssh_tunnel_instance:
                    logger.warning("SSH tunnel object created, but it might not be active. Check tunnel logs/status.")
                else:
                    logger.warning("create_ssh_tunnel() did not return an active tunnel instance.")
            except Exception as e:
                logger.error(f"Failed to start or verify SSH tunnel: {e}", exc_info=True)
        else:
            logger.info("No PUBLIC_VPS_IP configured in .env, running without SSH tunnel.")
    else:
        logger.warning("SSH tunnel utilities are not available. Cannot start tunnel.")
    logger.info("Startup event completed.")

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    global ssh_tunnel_instance
    
    logger.info("Executing shutdown_event. IoT Backend GPU Server shutting down...")
    
    if ssh_tunnel_available and stop_ssh_tunnel and ssh_tunnel_instance:
        logger.info("Stopping SSH tunnel...")
        try:
            stop_ssh_tunnel()
            ssh_tunnel_instance = None # Clear the instance
            logger.info("SSH tunnel stopped successfully.")
        except Exception as e:
            logger.error(f"Error stopping SSH tunnel: {e}", exc_info=True)
    elif ssh_tunnel_instance:
        logger.warning("SSH tunnel instance exists, but stop_ssh_tunnel utility is not available.")
    else:
        logger.info("No active SSH tunnel instance to stop or utilities not available.")
    logger.info("Shutdown event completed.")

@app.get("/health")
async def health_check():
    logger.debug("Health check endpoint requested.")
    current_uptime_seconds = -1.0
    if hasattr(app.state, 'start_time') and app.state.start_time is not None:
        current_uptime_seconds = round(time.time() - app.state.start_time, 2)
    
    health_status = {
        "status": "healthy", 
        "uptime_seconds": current_uptime_seconds, 
        "timestamp_ms": int(time.time() * 1000),
        "face_recognition_available": face_recognition_available,
        "cv2_available": cv2_available,
        "numpy_available": numpy_available,
        "ssh_tunnel_active": ssh_tunnel_instance.is_active if ssh_tunnel_instance and hasattr(ssh_tunnel_instance, 'is_active') else False
    }
    logger.debug(f"Health status: {health_status}")
    return JSONResponse(content=health_status)


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
async def get_system_status_endpoint(): # Renamed from get_system_status
    logger.debug("System status endpoint requested.")
    try:
        devices_list = data_store.get_all_devices()
        online_devices = [d for d in devices_list if d.get('status') in ['online', 'warning']]
        
        current_uptime_seconds = -1.0
        if hasattr(app.state, 'start_time') and app.state.start_time is not None:
            current_uptime_seconds = round(time.time() - app.state.start_time, 2)

        status_payload = {
            "success": True,
            "status": {
                "devicesOnline": len(online_devices),
                "devicesTotal": len(devices_list),
                "systemUptimeSeconds": current_uptime_seconds,
                "faceRecognitionService": {
                    "status": "operational" if face_recognition_available else "degraded",
                    "permitted_faces_loaded": len(data_store.permitted_face_encodings)
                },
                "lastBackendSync": int(time.time() * 1000), # Placeholder, consider actual sync time if applicable
                "systemLoad": "N/A", # Placeholder, consider using psutil if needed
                "ssh_tunnel_active": ssh_tunnel_instance.is_active if ssh_tunnel_instance and hasattr(ssh_tunnel_instance, 'is_active') else False
            }
        }
        logger.debug(f"System status: {status_payload}")
        return JSONResponse(content=status_payload)
    except Exception as e:
        logger.error(f"Error retrieving system status: {e}", exc_info=True)
        # Let global handler manage this
        raise

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
        # FastAPI/Uvicorn handles its own shutdown gracefully on SIGINT/SIGTERM.
        # Custom logic here might be for stopping other services before uvicorn exits.
        # The app.on_event(\"shutdown\") handler is preferred for FastAPI specific cleanup.
        
        # If there's a need to explicitly stop the tunnel here (e.g. if on_event isn't always triggered)
        # global ssh_tunnel_instance
        # if ssh_tunnel_available and stop_ssh_tunnel and ssh_tunnel_instance:
        #     logger.info(\"Signal handler: Attempting to stop SSH tunnel...\")
        #     try:
        #         stop_ssh_tunnel()
        #         logger.info(\"Signal handler: SSH tunnel stop command issued.\")
        #     except Exception as e:
        #         logger.error(f\"Signal handler: Error during SSH tunnel stop: {e}\", exc_info=True)
        
        logger.info("Signal handler: Exiting application process.")
        sys.exit(0) # This will trigger uvicorn's shutdown
    
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
    reload_debug = os.getenv('RELOAD_DEBUG', 'False').lower() == 'true' # Changed env var name for clarity
    log_level_uvicorn = os.getenv('UVICORN_LOG_LEVEL', 'info').lower() # Changed env var name

    logger.info(f"Starting Uvicorn server on {host}:{port}. Reload: {reload_debug}. Uvicorn Log Level: {log_level_uvicorn}")
    
    # Ensure uvicorn is not None before calling
    if uvicorn:
        uvicorn.run(
            "main:app",
            host=host,
            port=port,
            reload=reload_debug,
            log_level=log_level_uvicorn
            # workers=1 # Consider number of workers for production
        )
    else:
        logger.critical("Uvicorn is None, cannot start server.")
        sys.exit(1)
