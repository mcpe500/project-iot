# api_routes.py
import logging
import time
from pathlib import Path
from typing import Optional

from fastapi import (APIRouter, File, Form, HTTPException, Request,
                     UploadFile)
from fastapi.responses import JSONResponse

from config import DATA_DIR, PERMITTED_FACES_DIR, face_recognition_available
from data_store import data_store
from log_utils import log_function_call, setup_logger

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1")


@router.post("/devices/register")
@log_function_call
async def register_device_endpoint(deviceId: str = Form(...), deviceName: str = Form(...)):
    try:
        device_data = {'id': deviceId, 'name': deviceName, 'status': 'online'}
        registered_device = data_store.register_device(device_data)
        return JSONResponse(content={"success": True, "device": registered_device})
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/stream/stream")
@log_function_call
async def stream_endpoint(image: UploadFile = File(...), deviceId: Optional[str] = Form("unknown")):
    """
    High-speed streaming endpoint for ESP32-CAM integration.
    """
    contents = await image.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Empty image file.")
    
    # Register/update device quickly
    device_data = {'id': deviceId, 'name': f'Device-{deviceId}', 'status': 'online'}
    data_store.register_device(device_data)
    
    # Perform recognition asynchronously
    result = await data_store.perform_face_recognition(contents)
    result["deviceId"] = deviceId
    return JSONResponse(content=result)


@router.post("/recognition/add-permitted-face")
@log_function_call
async def add_permitted_face(image: UploadFile = File(...), name: str = Form(...)):
    if not face_recognition_available:
        raise HTTPException(status_code=501, detail="Face recognition feature not available.")

    safe_name = "".join(c for c in name if c.isalnum() or c in (' ', '.', '_')).rstrip()
    if not safe_name:
        raise HTTPException(status_code=400, detail="Invalid name provided.")
        
    extension = Path(image.filename).suffix or ".jpg"
    file_path = PERMITTED_FACES_DIR / f"{safe_name}{extension}"
    
    contents = await image.read()
    with open(file_path, "wb") as f:
        f.write(contents)
    
    logger.info(f"Saved new permitted face '{name}' to {file_path}")
    data_store.load_permitted_faces() # Reload faces
    
    return JSONResponse(content={"success": True, "message": f"Permitted face '{name}' added."})

@router.post("/recognize")
@log_function_call
async def recognize_endpoint(image: UploadFile = File(...)):
    """
    Optimized endpoint for high-speed face recognition from the backend.
    """
    start_time = time.time()
    
    contents = await image.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    # Perform the recognition (now optimized for speed)
    result = await data_store.perform_face_recognition(contents)
    
    # Add processing time to the response
    processing_time = time.time() - start_time
    result["total_processing_time"] = round(processing_time, 4)
    
    return JSONResponse(content=result)

@router.get("/devices")
async def get_all_devices_endpoint():
    devices_list = data_store.get_all_devices()
    return JSONResponse(content={"success": True, "devices": devices_list})

# A simple root endpoint for the router
@router.get("/")
async def api_root():
    return {"message": "API v1 is active"}
