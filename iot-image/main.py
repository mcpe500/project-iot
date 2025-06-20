import logging
import sys
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

# Import from our new modules
import config
from api_routes import router as api_router
from data_store import data_store
from ssh_tunnel import (create_ssh_tunnel, get_tunnel_instance,
                        stop_ssh_tunnel)
from middleware import RequestLoggingMiddleware

logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # --- Startup Logic ---
    logger.info("Application starting up...")
    
    # Load permitted faces into memory
    data_store.load_permitted_faces()

    # Start SSH reverse tunnel if configured
    if config.SSH_HOST and config.SSH_USER:
        logger.info("Attempting to start SSH reverse tunnel...")
        create_ssh_tunnel(
            public_vps_ip=config.SSH_HOST,
            ssh_server_port=config.SSH_CONNECTION_PORT,
            ssh_user=config.SSH_USER,
            ssh_password=config.SSH_PASSWORD,
            public_port=config.SSH_PUBLIC_PORT,
            private_server_port=config.SSH_PRIVATE_PORT
        )
    else:
        logger.warning("SSH tunnel environment variables not set. Skipping tunnel.")
    
    app.state.start_time = time.time()
    yield
    # --- Shutdown Logic ---
    logger.info("Application shutting down...")
    stop_ssh_tunnel()
    logger.info("Shutdown complete.")

# --- FastAPI App Initialization ---
app = FastAPI(
    title="IoT Backend GPU Server",
    version="1.0.0",
    lifespan=lifespan,
    # Optimize for high throughput
    docs_url="/docs" if config.RELOAD_DEBUG else None,
    redoc_url="/redoc" if config.RELOAD_DEBUG else None
)

# --- Add Middleware ---
# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add request logging middleware
app.add_middleware(RequestLoggingMiddleware)

# --- Global Exception Handler ---
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception for request {request.url.path}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"status": "error", "message": "An internal server error occurred."}
    )

# --- Include Routers and Static Files ---
app.include_router(api_router)
app.mount("/data", StaticFiles(directory=config.DATA_DIR), name="data")

# --- Root and Health Check Endpoints ---
@app.get("/")
async def root():
    return {"message": "Server is running."}

@app.get("/health")
async def health_check():
    tunnel = get_tunnel_instance()
    return {
        "status": "healthy",
        "uptime_seconds": round(time.time() - app.state.start_time),
        "face_recognition_ready": config.face_recognition_available,
        "ssh_tunnel_active": tunnel.is_active if tunnel else False
    }

# --- WebSocket Support ---
from fastapi import WebSocket, WebSocketDisconnect
import json

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"WebSocket connected. Total connections: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        logger.info(f"WebSocket disconnected. Total connections: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        if self.active_connections:
            message_str = json.dumps(message)
            for connection in self.active_connections.copy():
                try:
                    await connection.send_text(message_str)
                except:
                    self.active_connections.remove(connection)

manager = ConnectionManager()

@app.websocket("/")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# --- Main Execution ---
if __name__ == "__main__":
    if not config.uvicorn_available:
        logger.critical("Uvicorn is not installed. Please run: pip install uvicorn[standard]")
        sys.exit(1)
        
    logger.info(f"Starting high-performance server on {config.HOST}:{config.PORT}")
    config.uvicorn.run(
        "main:app",
        host=config.HOST,
        port=config.PORT,
        reload=config.RELOAD_DEBUG,
        log_level=config.UVICORN_LOG_LEVEL.lower(),
        workers=1,  # Single worker for GPU tasks
        access_log=False,  # Disable access logs for performance
        use_colors=False if not config.RELOAD_DEBUG else True
    )
