# data_store.py
import logging
import time
from typing import Any, Dict, List, Optional

# Import dependencies and config variables from the config module
from config import (PERMITTED_FACES_DIR, cv2, cv2_available,
                    face_recognition, face_recognition_available, np,
                    numpy_available)

logger = logging.getLogger(__name__)

class DataStore:
    def __init__(self):
        self.devices: Dict[str, Dict[str, Any]] = {}
        self.permitted_face_encodings: List[Any] = []
        self.permitted_face_names: List[str] = []
        logger.info("DataStore initialized.")

    def load_permitted_faces(self):
        logger.info("Loading permitted faces...")
        self.permitted_face_encodings.clear()
        self.permitted_face_names.clear()

        if not all([face_recognition_available, cv2_available, numpy_available]):
            logger.warning("A required library (face_recognition, cv2, or numpy) is not available. Skipping face loading.")
            return

        if not PERMITTED_FACES_DIR.exists():
            logger.warning(f"Permitted faces directory does not exist: {PERMITTED_FACES_DIR}")
            return
            
        loaded_count = 0
        for image_path in PERMITTED_FACES_DIR.glob("*.[jp][pn]g"):
            try:
                image = face_recognition.load_image_file(str(image_path))
                encodings = face_recognition.face_encodings(image)
                if encodings:
                    self.permitted_face_encodings.append(encodings[0])
                    self.permitted_face_names.append(image_path.stem)
                    loaded_count += 1
                    logger.info(f"Loaded permitted face: {image_path.stem}")
                else:
                    logger.warning(f"No face found in {image_path.name}")
            except Exception as e:
                logger.error(f"Failed to process {image_path.name}: {e}", exc_info=True)
        
        logger.info(f"Finished loading permitted faces. Total loaded: {loaded_count}")

    async def perform_face_recognition(self, image_bytes: bytes) -> Dict[str, Any]:
        if not all([face_recognition_available, cv2_available, numpy_available]):
            return {"status": "error", "message": "Face recognition feature not available."}
        
        try:
            image_array = np.frombuffer(image_bytes, np.uint8)
            image_bgr = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
            if image_bgr is None:
                raise ValueError("Failed to decode image.")
            
            # Convert the image from BGR color (which OpenCV uses) to RGB color (which face_recognition uses)
            image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)

            face_locations = face_recognition.face_locations(image_rgb)
            if not face_locations:
                return {"status": "no_face_detected", "faces_detected": 0}

            face_encodings = face_recognition.face_encodings(image_rgb, face_locations)
            
            best_match_name = "Unknown"
            best_confidence = 0.0

            if self.permitted_face_encodings:
                for face_encoding in face_encodings:
                    matches = face_recognition.compare_faces(self.permitted_face_encodings, face_encoding)
                    face_distances = face_recognition.face_distance(self.permitted_face_encodings, face_encoding)
                    
                    if len(face_distances) > 0:
                        best_match_index = np.argmin(face_distances)
                        if matches[best_match_index]:
                            confidence = 1 - face_distances[best_match_index]
                            if confidence > best_confidence:
                                best_confidence = confidence
                                best_match_name = self.permitted_face_names[best_match_index]

            if best_match_name != "Unknown":
                return {
                    "status": "permitted_face",
                    "recognizedAs": best_match_name,
                    "confidence": best_confidence,
                    "faces_detected": len(face_locations)
                }
            else:
                 return {
                    "status": "unknown_face",
                    "recognizedAs": None,
                    "confidence": 0.0,
                    "faces_detected": len(face_locations)
                }
        except Exception as e:
            logger.error(f"Error during face recognition: {e}", exc_info=True)
            return {"status": "error", "message": str(e)}

    def register_device(self, device_data: Dict[str, Any]) -> Dict[str, Any]:
        device_id = device_data.get('id')
        if not device_id:
            raise ValueError("Device ID is required.")
        
        current_time_ms = time.time() * 1000
        if device_id in self.devices:
            self.devices[device_id].update(device_data)
            self.devices[device_id]['lastSeen'] = current_time_ms
        else:
            device_data['lastSeen'] = current_time_ms
            self.devices[device_id] = device_data
        
        logger.info(f"Registered/updated device: {device_id}")
        return self.devices[device_id]

    def get_all_devices(self) -> List[Dict[str, Any]]:
        return list(self.devices.values())

# Create a single, shared instance of the DataStore
data_store = DataStore()
