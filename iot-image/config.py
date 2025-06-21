# config.py
import logging
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# --- Core Configuration ---
HOST = os.getenv('HOST', '0.0.0.0')
PORT = int(os.getenv('PORT', '9001'))
RELOAD_DEBUG = os.getenv('RELOAD_DEBUG', 'False').lower() == 'true'
UVICORN_LOG_LEVEL = os.getenv('UVICORN_LOG_LEVEL', 'warning').lower()  # Reduced verbosity for performance

# Performance optimizations
MAX_WORKERS = int(os.getenv('MAX_WORKERS', '4'))
FACE_RECOGNITION_TIMEOUT = float(os.getenv('FACE_RECOGNITION_TIMEOUT', '3.0'))  # Fast timeout

# --- Logging Configuration ---
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
LOG_FORMAT = os.getenv("LOG_FORMAT", "standard").lower()
LOG_FILE = os.getenv("LOG_FILE", "").strip()

# Define log formats
if LOG_FORMAT == "json":
    log_format = "%(asctime)s %(levelname)s %(name)s %(message)s"
    date_format = "%Y-%m-%dT%H:%M:%S%z"
else:  # standard format
    log_format = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    date_format = "%Y-%m-%d %H:%M:%S"

# Configure handlers
log_handlers = [logging.StreamHandler(sys.stdout)]

# Add file handler if LOG_FILE is specified
if LOG_FILE:
    log_dir = os.path.dirname(LOG_FILE)
    if log_dir and not os.path.exists(log_dir):
        os.makedirs(log_dir, exist_ok=True)
    file_handler = logging.FileHandler(LOG_FILE)
    file_handler.setFormatter(logging.Formatter(log_format, date_format))
    log_handlers.append(file_handler)

# Configure logging
logging.basicConfig(
    level=LOG_LEVEL,
    format=log_format,
    datefmt=date_format,
    handlers=log_handlers
)

# Reduce verbosity of some loggers
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
logging.getLogger("uvicorn.error").setLevel(logging.WARNING)

logger = logging.getLogger(__name__)

# --- Directory Paths ---
# Assumes this config.py is in a subdirectory (e.g., 'src'), so we go up one level.
# Change if your file structure is different.
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
RECORDINGS_DIR = BASE_DIR / "recordings"
PERMITTED_FACES_DIR = BASE_DIR / "permitted_faces"

# Create directories on startup
for directory in [DATA_DIR, RECORDINGS_DIR, PERMITTED_FACES_DIR]:
    directory.mkdir(parents=True, exist_ok=True)
    logger.info(f"Ensured directory exists: {directory}")

# --- SSH Tunnel Configuration ---
SSH_HOST = os.getenv("PUBLIC_VPS_IP")
SSH_CONNECTION_PORT = int(os.getenv("SSH_SERVER_PORT", "22"))
SSH_USER = os.getenv("SSH_USER")
SSH_PASSWORD = os.getenv("SSH_PASSWORD")
SSH_PUBLIC_PORT = int(os.getenv('PUBLIC_PORT', '9009'))
SSH_PRIVATE_PORT = int(os.getenv('PRIVATE_SERVER_PORT') or PORT)

# --- Optional Library Availability ---
try:
    import cv2
    cv2_available = True
except ImportError:
    cv2 = None
    cv2_available = False

try:
    import numpy as np
    numpy_available = True
except ImportError:
    np = None
    numpy_available = False

try:
    import face_recognition
    face_recognition_available = True
except ImportError:
    face_recognition = None
    face_recognition_available = False
    
try:
    import uvicorn
    uvicorn_available = True
except ImportError:
    uvicorn = None
    uvicorn_available = False

logger.info(f"Logging initialized with level: {LOG_LEVEL}")
logger.info(f"OpenCV (cv2) available: {cv2_available}")
logger.info(f"NumPy (np) available: {numpy_available}")
logger.info(f"face_recognition available: {face_recognition_available}")