import logging
import os
import signal
import sys # Moved up
import time
from contextlib import asynccontextmanager # Added for lifespan
from pathlib import Path
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Request
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from dotenv import load_dotenv

# Setup logging (moved up)
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
log_level_name = LOG_LEVEL
if LOG_LEVEL not in ["CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG", "NOTSET"]:
    LOG_LEVEL = "INFO"
    log_level_name = "INFO (defaulted from invalid)"

logging.basicConfig(
    level=LOG_LEVEL,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout)  # Log to stdout
    ]
)
logger = logging.getLogger(__name__) # Define logger here

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

# Attempt to import ssh_tunnel_utils and set a flag
try:
    from ssh_tunnel import create_ssh_tunnel, stop_ssh_tunnel, get_tunnel_instance # Changed from ssh_tunnel_utils
    ssh_tunnel_available = True
    logger.info("SSH Tunnel utilities loaded successfully.") # Now logger is defined
except ImportError as e:
    create_ssh_tunnel = None
    stop_ssh_tunnel = None
    get_tunnel_instance = None
    ssh_tunnel_available = False
    logger.warning(f"SSH Tunnel utilities not available: {e}", exc_info=True) # Now logger is defined

# Load environment variables
load_dotenv()

logger.info(f"Logging initialized with level: {log_level_name}")
logger.info(f"Python version: {sys.version}")
logger.info(f"Current working directory: {os.getcwd()}")
logger.info(f"OpenCV (cv2) available: {cv2_available}")
logger.info(f"NumPy (np) available: {numpy_available}")
logger.info(f"face_recognition available: {face_recognition_available}")
logger.info(f"MediaPipe (mp) available: {mediapipe_available}")
logger.info(f"PyTorch (torch) available: {torch_available}")
logger.info(f"Uvicorn available: {uvicorn_available}")
logger.info(f"SSH Tunnel utilities available: {ssh_tunnel_available}")


# Lifespan manager
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup logic
    global ssh_tunnel_instance # Ensure ssh_tunnel_instance is accessible globally if needed by other parts
    app.state.start_time = time.time()
    logger.info(f"Executing startup logic within lifespan. App start time set to: {app.state.start_time}")
    logger.info("IoT Backend GPU Server starting up...")

    try:
        logger.info("Initializing DataStore and loading permitted faces as part of DataStore init or explicitly here if needed.")
        # data_store.load_permitted_faces() # This is called in DataStore.__init__
        logger.info("Permitted faces loading process initiated by DataStore.")
    except Exception as e:
        logger.error(f"Error during DataStore initialization or explicit face loading in lifespan startup: {e}", exc_info=True)

    if ssh_tunnel_available and create_ssh_tunnel and stop_ssh_tunnel and get_tunnel_instance:
        ssh_host = os.getenv("PUBLIC_VPS_IP") # Changed from SSH_HOST
        ssh_connection_port_str = os.getenv("SSH_SERVER_PORT", "22") # New: Port for SSH connection itself
        ssh_user = os.getenv("SSH_USER")
        ssh_password = os.getenv("SSH_PASSWORD")
        ssh_remote_bind_port_str = os.getenv('PUBLIC_PORT') # Changed from SSH_TUNNEL_REMOTE_PORT
        # PRIVATE_SERVER_PORT is the port the FastAPI app runs on, which is also the local end of the tunnel.
        ssh_local_bind_port_str = os.getenv('PRIVATE_SERVER_PORT', os.getenv('PORT', '9001')) # Default to app's port

        logger.info(f"SSH Config: Host={ssh_host}, SSH_Connection_Port={ssh_connection_port_str}, User={ssh_user}, RemoteBindPort(PublicPort)={ssh_remote_bind_port_str}, LocalBindPort(PrivateServerPort)={ssh_local_bind_port_str}")
        if ssh_password:
            logger.info("SSH_PASSWORD is set.")
        else:
            logger.warning("SSH_PASSWORD is NOT set (key-based auth may still work if SSH_PRIVATE_KEY_PATH is set).")

        if ssh_host and ssh_user and ssh_remote_bind_port_str and ssh_local_bind_port_str:
            logger.info(f"Attempting to start SSH reverse tunnel to {ssh_host}...")
            try:
                remote_bind_port_int = int(ssh_remote_bind_port_str)
                local_bind_port_int = int(ssh_local_bind_port_str)
                ssh_connection_port_int = int(ssh_connection_port_str)
                
                logger.info(f"SSH Tunnel Params: public_vps_ip={ssh_host}, ssh_server_port={ssh_connection_port_int}, ssh_user={ssh_user}, public_port={remote_bind_port_int}, private_server_port={local_bind_port_int}")

                ssh_tunnel_instance = create_ssh_tunnel(
                    public_vps_ip=ssh_host,
                    ssh_server_port=ssh_connection_port_int, 
                    ssh_user=ssh_user,
                    ssh_password=ssh_password, # Will be None if not set, ssh_tunnel.py handles key fallback
                    public_port=remote_bind_port_int,
                    private_server_port=local_bind_port_int,
                    # private_key_path and passphrase will be picked up from env by SSHTunnel class if not passed here
                )
                if ssh_tunnel_instance:
                    logger.info(f"SSH tunnel object created. Tunnel: {ssh_host}:{remote_bind_port_int} -> localhost:{local_bind_port_int}")
                    # Adding a small delay to allow the tunnel thread to attempt connection,
                    # as sshtunnel usually starts the connection in a background thread.
                    time.sleep(3) # Increased sleep to 3 seconds
                    retrieved_tunnel = get_tunnel_instance()
                    if retrieved_tunnel:
                        logger.info("get_tunnel_instance() returned an object. Further status should be in sshtunnel logs.")
                        # Avoid checking for 'is_active' as it caused AttributeErrors.
                        # The library itself should handle and log connection success/failure.
                    else:
                        logger.warning("get_tunnel_instance() returned None after tunnel creation attempt.")
                else:
                    logger.error("Failed to create SSH tunnel instance (create_ssh_tunnel returned None).")
            except ValueError as ve:
                logger.error(f"ValueError during SSH tunnel setup (likely port conversion): {ve}", exc_info=True)
            except Exception as e:
                logger.error(f"Failed to start or verify SSH tunnel: {type(e).__name__} - {e}", exc_info=True)
        else:
            logger.warning("SSH tunnel environment variables not fully configured. Tunnel not started.")
            if not ssh_host: logger.warning("PUBLIC_VPS_IP is not set.")
            if not ssh_user: logger.warning("SSH_USER is not set.")
            # Password not being set isn't necessarily an error if key auth is used.
            # if not ssh_password: logger.warning("SSH_PASSWORD is not set.") 
            if not ssh_remote_bind_port_str: logger.warning("PUBLIC_PORT (for remote tunnel bind) is not set.")
            if not ssh_local_bind_port_str: logger.warning("PRIVATE_SERVER_PORT (for local tunnel bind, or PORT) is not set.")

    else:
        logger.info("SSH tunnel utilities (create_ssh_tunnel, stop_ssh_tunnel, get_tunnel_instance) not available or not imported. Skipping tunnel setup.")
    
    logger.info("Startup logic completed.")
    
    yield # Application runs here
    
    # Shutdown logic
    logger.info("Executing shutdown logic within lifespan. IoT Backend GPU Server shutting down...")
    if ssh_tunnel_available and stop_ssh_tunnel and get_tunnel_instance:
        tunnel = get_tunnel_instance()
        if tunnel:
            logger.info("Attempting to stop SSH tunnel...")
            try:
                stop_ssh_tunnel()
                logger.info("SSH tunnel stop command issued.")
            except Exception as e:
                logger.error(f"Error stopping SSH tunnel: {e}", exc_info=True)
        else:
            logger.info("No active SSH tunnel instance to stop.")
    else:
        logger.info("SSH tunnel utilities not available. Skipping tunnel shutdown.")
    logger.info("Shutdown logic completed.")

app = FastAPI(title="IoT Backend GPU Server", version="1.0.0", lifespan=lifespan) # Use lifespan
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
            # self.load_permitted_faces() # Moved to startup lifespan event
            logger.info("Initial call to load_permitted_faces in DataStore __init__ deferred to lifespan startup.")
        except Exception as e:
            logger.error(f"Error during initial DataStore setup (load_permitted_faces): {e}", exc_info=True)
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
            logger.warning("OpenCV (cv2) library not available. Cannot load permitted faces.")
            return
        if not numpy_available:
            logger.warning("NumPy (np) library not available. Cannot load permitted faces.")
            return

        if not PERMITTED_FACES_DIR.exists():
            logger.warning(f"Permitted faces directory {PERMITTED_FACES_DIR} does not exist. No faces will be loaded.")
            return
        
        loaded_count = 0
        logger.info(f"Scanning {PERMITTED_FACES_DIR} for permitted faces (jpg, jpeg, png)...")
        try:
            for image_file_path in PERMITTED_FACES_DIR.glob("*.[jp][pn]g"): # Handles jpg, jpeg, png
                try:
                    logger.debug(f"Processing permitted face file: {image_file_path}")
                    # Ensure face_recognition, np, cv2 are not None before using
                    if face_recognition and np and cv2:
                        image_np = face_recognition.load_image_file(str(image_file_path))
                        # Attempt to get face encodings
                        face_encs = face_recognition.face_encodings(image_np)
                        if face_encs:
                            self.permitted_face_encodings.append(face_encs[0])
                            self.permitted_face_names.append(image_file_path.stem) # Use filename (without ext) as name
                            loaded_count += 1
                            logger.info(f"Loaded permitted face: {image_file_path.stem} from {image_file_path}")
                        else:
                            logger.warning(f"No faces found in permitted image: {image_file_path}")
                    else:
                        logger.error("A required library (face_recognition, numpy, or cv2) is None during permitted face loading.")
                        break # Stop processing if essential libraries are missing
                except Exception as e_file:
                    logger.error(f"Error processing permitted face file {image_file_path}: {e_file}", exc_info=True)
        except Exception as e_glob:
            logger.error(f"Error scanning permitted faces directory {PERMITTED_FACES_DIR}: {e_glob}", exc_info=True)
        
        logger.info(f"Finished loading permitted faces. Total loaded: {loaded_count}. Total in memory: {len(self.permitted_face_encodings)}")

    async def perform_face_recognition(self, image_bytes: bytes) -> Dict[str, Any]:
        """Perform face recognition on image bytes"""
        logger.info("Initiating face recognition process...")
        
        if not face_recognition_available:
            logger.error("Face recognition library not available. Cannot perform recognition.")
            return {"status": "error", "message": "Face recognition library not available.", "recognizedAs": None, "confidence": 0.0, "faces_detected": 0}
        if not cv2_available:
            logger.error("OpenCV (cv2) library not available. Cannot perform recognition.")
            return {"status": "error", "message": "OpenCV (cv2) library not available.", "recognizedAs": None, "confidence": 0.0, "faces_detected": 0}
        if not numpy_available:
            logger.error("NumPy (np) library not available. Cannot perform recognition.")
            return {"status": "error", "message": "NumPy (np) library not available.", "recognizedAs": None, "confidence": 0.0, "faces_detected": 0}

        try:
            logger.debug("Attempting to decode image from bytes for face recognition.")
            image_array = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
            if image_array is None:
                logger.error("Failed to decode image. cv2.imdecode returned None.")
                return {"status": "error", "message": "Failed to decode image", "recognizedAs": None, "confidence": 0.0, "faces_detected": 0}
            logger.info("Image decoded successfully.")

            # Convert BGR (OpenCV default) to RGB (face_recognition requirement)
            rgb_image_np = cv2.cvtColor(image_array, cv2.COLOR_BGR2RGB)
            logger.debug("Image converted from BGR to RGB.")

            logger.debug("Detecting face locations...")
            face_locations = face_recognition.face_locations(rgb_image_np)
            logger.info(f"Detected {len(face_locations)} face(s) in the image.")
            
            if not face_locations:
                logger.info("No faces detected in the image.")
                return {"status": "no_face_detected", "message": "No faces found in the image", "recognizedAs": None, "confidence": 0.0, "faces_detected": 0}

            logger.debug("Encoding detected faces...")
            face_encodings = face_recognition.face_encodings(image_array, face_locations)
            logger.info(f"Successfully encoded {len(face_encodings)} detected face(s).")
        except cv2.error as cv2_err:
            logger.error(f"OpenCV error decoding image: {cv2_err}", exc_info=True)
            return {"status": "error", "message": f"OpenCV error: {cv2_err}", "recognizedAs": None, "confidence": 0.0, "faces_detected": 0}
        except Exception as e:
            logger.error(f"Error decoding image: {type(e).__name__} - {e}", exc_info=True)
            return {"status": "error", "message": f"Error decoding image: {e}", "recognizedAs": None, "confidence": 0.0, "faces_detected": 0}

        try:
            logger.debug("Detecting face locations...")
            face_locations = face_recognition.face_locations(image_array)
            logger.info(f"Detected {len(face_locations)} face(s) in the image.")
        except Exception as e:
            logger.error(f"Error during face_locations: {type(e).__name__} - {e}", exc_info=True)
            return {"status": "error", "message": f"Error detecting faces: {e}", "recognizedAs": None, "confidence": 0.0, "faces_detected": 0}

        if not face_locations:
            logger.info("No faces detected in the image.")
            return {"status": "no_face_detected", "message": "No faces found in the image", "recognizedAs": None, "confidence": 0.0, "faces_detected": 0}

        try:
            logger.debug("Encoding detected faces...")
            face_encodings = face_recognition.face_encodings(image_array, face_locations)
            logger.info(f"Successfully encoded {len(face_encodings)} detected face(s).")
        except Exception as e:
            logger.error(f"Error during face_encodings: {type(e).__name__} - {e}", exc_info=True)
            return {"status": "error", "message": f"Error encoding faces: {e}", "recognizedAs": None, "confidence": 0.0, "faces_detected": len(face_locations) if 'face_locations' in locals() else 0}

        recognized_faces_details = []
        if not self.permitted_face_encodings:
            logger.warning("No permitted faces loaded. Cannot match against any known faces.")
        
        for face_encoding in face_encodings:
            try:
                logger.debug("Comparing current face encoding with permitted faces...")
                if not self.permitted_face_encodings: # Double check in loop just in case
                    logger.debug("No permitted faces loaded, skipping match for this face encoding.")
                    recognized_faces_details.append({
                        "name": "Unknown",
                        "confidence": 0.0,
                        "match_status": "no_permitted_faces_loaded"
                    })
                    continue

                matches = face_recognition.compare_faces(self.permitted_face_encodings, face_encoding)
                face_distances = face_recognition.face_distance(self.permitted_face_encodings, face_encoding)
                
                logger.debug(f"Matches array: {matches}")
                logger.debug(f"Face distances array: {face_distances}")

                best_match_index = np.argmin(face_distances) if len(face_distances) > 0 else -1
                
                if best_match_index != -1 and matches[best_match_index]:
                    name = self.permitted_face_names[best_match_index]
                    confidence = 1 - face_distances[best_match_index] # Simple confidence score
                    logger.info(f"Face matched: {name} with confidence: {confidence:.2f} (distance: {face_distances[best_match_index]:.2f})")
                    recognized_faces_details.append({
                        "name": name,
                        "confidence": float(confidence),
                        "match_status": "matched"
                    })
                else:
                    logger.info("Face did not match any permitted faces.")
                    recognized_faces_details.append({
                        "name": "Unknown",
                        "confidence": 0.0,
                        "match_status": "no_match"
                    })
            except Exception as e:
                logger.error(f"Error during face comparison for one face: {type(e).__name__} - {e}", exc_info=True)
                recognized_faces_details.append({
                    "name": "ErrorInComparison",
                    "confidence": 0.0,
                    "match_status": "error_during_comparison"
                })
        
        if not recognized_faces_details and face_locations: # Faces detected but none processed (should not happen if loop runs)
             logger.warning("Faces were located, but no recognition details were generated.")
             return {"status": "unknown_face", "message": "Faces detected but recognition processing incomplete.", "recognizedAs": None, "confidence": 0.0, "faces_detected": len(face_locations)}


        if recognized_faces_details:
            # For simplicity, taking the first recognized face if multiple. Could be more sophisticated.
            primary_recognition = recognized_faces_details[0]
            if primary_recognition["name"] != "Unknown" and primary_recognition["name"] != "ErrorInComparison":
                logger.info(f"Primary recognition: Permitted face '{primary_recognition['name']}' detected with confidence {primary_recognition['confidence']:.2f}.")
                return {
                    "status": "permitted_face", 
                    "message": "Permitted face detected.",
                    "recognizedAs": primary_recognition["name"], 
                    "confidence": primary_recognition["confidence"],
                    "faces_detected": len(face_locations),
                    "all_detections": recognized_faces_details
                }
            else:
                logger.info("Primary recognition: Unknown face or error in comparison.")
                return {
                    "status": "unknown_face", 
                    "message": "Unknown face detected or error in comparison.",
                    "recognizedAs": None, 
                    "confidence": 0.0,
                    "faces_detected": len(face_locations),
                    "all_detections": recognized_faces_details
                }
        
        # This case should be covered by "No faces detected" earlier
        logger.info("Face recognition process completed, no specific matches or unknown faces to report based on details list.")
        return {"status": "no_action", "message": "Face recognition complete, no specific outcome.", "recognizedAs": None, "confidence": 0.0, "faces_detected": len(face_locations) if 'face_locations' in locals() else 0}


# Initialize data store
data_store = DataStore()

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
async def recognize_face_endpoint(    file: UploadFile = File(...)
):
    logger.info(f"Received request for /recognize endpoint. File: {file.filename}, Content-Type: {file.content_type}")
    start_time = time.time()
    try:
        contents = await file.read()
        logger.info(f"Successfully read {len(contents)} bytes from uploaded file.")
        
        if not contents:
            logger.warning("Uploaded file is empty.")
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")

        logger.info("Calling perform_face_recognition...")
        recognition_result = await data_store.perform_face_recognition(contents)
        processing_time = time.time() - start_time
        logger.info(f"Face recognition process completed in {processing_time:.4f} seconds.")
        
        # Ensure the result has a 'status' field for consistent client handling
        if not isinstance(recognition_result, dict) or 'status' not in recognition_result:
            logger.error(f"Recognition result is not a dict or missing 'status': {recognition_result}")
            # Fallback to a generic error structure
            return JSONResponse(
                status_code=500,
                content={
                    "status": "error", 
                    "message": "Invalid response format from recognition logic.",
                    "recognizedAs": None, 
                    "confidence": 0.0,
                    "faces_detected": 0,
                    "processing_time": processing_time,
                    "raw_result": str(recognition_result) # include raw for debugging
                }
            )

        # Add processing time to the response
        recognition_result["processing_time"] = round(processing_time, 4)
        
        logger.info(f"Returning recognition result: {recognition_result}")
        return JSONResponse(content=recognition_result)

    except HTTPException as http_exc:
        logger.warning(f"HTTPException in /recognize: {http_exc.status_code} - {http_exc.detail}", exc_info=True)
        raise # Re-raise HTTPException to be handled by FastAPI
    except Exception as e:
        processing_time = time.time() - start_time
        logger.error(f"Unexpected error in /recognize endpoint after {processing_time:.4f}s: {type(e).__name__} - {e}", exc_info=True)
        return JSONResponse(
            status_code=500,
            content={
                "status": "error", 
                "message": f"Internal server error during recognition: {type(e).__name__}",
                "detail": str(e),
                "recognizedAs": None, 
                "confidence": 0.0,
                "faces_detected": 0,
                "processing_time": processing_time
            }
        )

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
