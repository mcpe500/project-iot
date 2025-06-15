#!/usr/bin/env python3
"""
GPU-Accelerated Face Recognition Service
High-performance face detection and recognition using GPU acceleration
"""

import cv2
import torch
import numpy as np
import face_recognition
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
import uvicorn
import logging
from typing import Dict, List, Optional
import os
import json
from pathlib import Path
import time

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="GPU Face Recognition Service", version="1.0.0")

class GPUFaceRecognizer:
    def __init__(self, permitted_faces_dir: str = "../iot-backend-express/permitted_faces"):
        self.permitted_faces_dir = Path(permitted_faces_dir)
        self.known_face_encodings = []
        self.known_face_names = []
        
        # Check for GPU availability
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        logger.info(f"Using device: {self.device}")
        
        if torch.cuda.is_available():
            logger.info(f"GPU: {torch.cuda.get_device_name(0)}")
            logger.info(f"CUDA Version: {torch.version.cuda}")
        
        # Load permitted faces
        self.load_permitted_faces()
    
    def load_permitted_faces(self):
        """Load and encode permitted faces from the directory"""
        if not self.permitted_faces_dir.exists():
            logger.warning(f"Permitted faces directory not found: {self.permitted_faces_dir}")
            return
        
        self.known_face_encodings = []
        self.known_face_names = []
        
        for image_file in self.permitted_faces_dir.glob("*.jpg"):
            try:
                # Load image
                image = face_recognition.load_image_file(str(image_file))
                
                # Get face encodings
                encodings = face_recognition.face_encodings(image)
                
                if encodings:
                    # Use the first face found
                    self.known_face_encodings.append(encodings[0])
                    # Use filename (without extension) as name
                    name = image_file.stem
                    self.known_face_names.append(name)
                    logger.info(f"Loaded face: {name}")
                else:
                    logger.warning(f"No face found in {image_file}")
                    
            except Exception as e:
                logger.error(f"Error loading {image_file}: {e}")
        
        logger.info(f"Loaded {len(self.known_face_encodings)} permitted faces")
    
    def recognize_face(self, image_data: bytes) -> Dict:
        """Recognize faces in the given image data"""
        start_time = time.time()
        
        try:
            # Convert bytes to numpy array
            nparr = np.frombuffer(image_data, np.uint8)
            image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if image is None:
                return {
                    "status": "error",
                    "message": "Could not decode image",
                    "processing_time": time.time() - start_time
                }
            
            # Convert BGR to RGB (face_recognition uses RGB)
            rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            
            # Find face locations and encodings
            face_locations = face_recognition.face_locations(rgb_image)
            face_encodings = face_recognition.face_encodings(rgb_image, face_locations)
            
            results = []
            
            for i, face_encoding in enumerate(face_encodings):
                # Compare with known faces
                matches = face_recognition.compare_faces(self.known_face_encodings, face_encoding, tolerance=0.6)
                distances = face_recognition.face_distance(self.known_face_encodings, face_encoding)
                
                name = "Unknown"
                confidence = 0.0
                
                if matches and len(distances) > 0:
                    # Find the best match
                    best_match_index = np.argmin(distances)
                    if matches[best_match_index]:
                        name = self.known_face_names[best_match_index]
                        # Convert distance to confidence (lower distance = higher confidence)
                        confidence = max(0.0, 1.0 - distances[best_match_index])
                
                # Get face location
                top, right, bottom, left = face_locations[i]
                
                results.append({
                    "name": name,
                    "confidence": float(confidence),
                    "location": {
                        "top": int(top),
                        "right": int(right), 
                        "bottom": int(bottom),
                        "left": int(left)
                    }
                })
            
            processing_time = time.time() - start_time
            
            return {
                "status": "success" if results else "no_faces_detected",
                "faces_detected": len(results),
                "faces": results,
                "processing_time": processing_time,
                "recognized_faces": [f for f in results if f["name"] != "Unknown"]
            }
            
        except Exception as e:
            logger.error(f"Error in face recognition: {e}")
            return {
                "status": "error",
                "message": str(e),
                "processing_time": time.time() - start_time
            }

# Initialize the face recognizer
face_recognizer = GPUFaceRecognizer()

@app.get("/")
async def root():
    return {
        "service": "GPU Face Recognition Service",
        "status": "running",
        "device": str(face_recognizer.device),
        "known_faces": len(face_recognizer.known_face_names)
    }

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "device": str(face_recognizer.device),
        "gpu_available": torch.cuda.is_available(),
        "known_faces": len(face_recognizer.known_face_names)
    }

@app.post("/recognize")
async def recognize_face(file: UploadFile = File(...)):
    """Recognize faces in the uploaded image"""
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")
    
    try:
        image_data = await file.read()
        result = face_recognizer.recognize_face(image_data)
        return JSONResponse(content=result)
    
    except Exception as e:
        logger.error(f"Error processing image: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/reload_faces")
async def reload_permitted_faces():
    """Reload permitted faces from the directory"""
    try:
        face_recognizer.load_permitted_faces()
        return {
            "status": "success",
            "message": f"Reloaded {len(face_recognizer.known_face_names)} faces",
            "known_faces": face_recognizer.known_face_names
        }
    except Exception as e:
        logger.error(f"Error reloading faces: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/known_faces")
async def get_known_faces():
    """Get list of known face names"""
    return {
        "known_faces": face_recognizer.known_face_names,
        "count": len(face_recognizer.known_face_names)
    }

if __name__ == "__main__":
    # Run the service
    uvicorn.run(
        "gpu_face_service:app",
        host="0.0.0.0",
        port=8001,
        reload=True,
        workers=1  # Single worker for GPU memory management
    )
