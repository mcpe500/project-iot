# middleware.py
import time
import logging
import json
import uuid
from datetime import datetime
from typing import Dict, Any, Optional
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

class RequestLoggingMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp):
        super().__init__(app)
        self.request_id_header = "X-Request-ID"
        
    async def extract_request_body(self, request: Request) -> Optional[Dict[str, Any]]:
        """Extract request body for logging if it's a JSON payload"""
        if request.headers.get("content-type") == "application/json":
            try:
                body = await request.json()
                # Sanitize sensitive data if needed
                return body
            except:
                return None
        return None
        
    async def dispatch(self, request: Request, call_next):
        # Generate unique request ID
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id
        
        # Get timestamp at start of request
        start_time = time.time()
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        
        # Extract request info
        method = request.method
        path = request.url.path
        full_url = str(request.url)
        client_ip = request.client.host if request.client else "unknown"
        user_agent = request.headers.get("user-agent", "unknown")
        content_length = request.headers.get("content-length", "0")
        content_type = request.headers.get("content-type", "unknown")
        query_params = dict(request.query_params)
        
        # Prepare log data
        log_data = {
            "timestamp": timestamp,
            "request_id": request_id,
            "client_ip": client_ip,
            "method": method,
            "path": path,
            "query_params": query_params,
            "content_type": content_type,
            "content_length": content_length,
            "user_agent": user_agent[:100] if len(user_agent) > 100 else user_agent
        }
        
        # Log request start with beautiful formatting
        logger.info(f"┌{'─' * 60}")
        logger.info(f"│ 🚀 REQUEST {request_id} - {timestamp}")
        logger.info(f"│ {method} {path}")
        logger.info(f"│ Client: {client_ip} | Size: {content_length}B")
        if query_params:
            logger.info(f"│ Query: {json.dumps(query_params)}")
        logger.info(f"└{'─' * 60}")
        
        try:
            # Process request
            response: Response = await call_next(request)
            
            # Calculate processing time
            process_time = time.time() - start_time
            end_timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
            
            # Get response info
            status_code = response.status_code
            response_size = response.headers.get("content-length", "unknown")
            
            # Determine status emoji and color based on status code
            if 200 <= status_code < 300:
                status_emoji = "✅"
                status_text = "SUCCESS"
            elif 300 <= status_code < 400:
                status_emoji = "⚠️"
                status_text = "REDIRECT"
            elif 400 <= status_code < 500:
                status_emoji = "❌"
                status_text = "CLIENT ERROR"
            else:
                status_emoji = "🔥"
                status_text = "SERVER ERROR"
            
            # Add response data to log
            log_data.update({
                "status_code": status_code,
                "response_size": response_size,
                "process_time_ms": round(process_time * 1000, 2),
                "end_timestamp": end_timestamp
            })
            
            # Log response with beautiful formatting
            logger.info(f"┌{'─' * 60}")
            logger.info(f"│ {status_emoji} RESPONSE {request_id} - {end_timestamp}")
            logger.info(f"│ {status_code} {status_text} | {method} {path}")
            logger.info(f"│ Processed in: {process_time:.3f}s | Size: {response_size}B")
            logger.info(f"└{'─' * 60}")
            
            # Add headers to response
            response.headers[self.request_id_header] = request_id
            response.headers["X-Process-Time"] = f"{process_time:.6f}"
            
            return response
            
        except Exception as e:
            # Log exception
            logger.error(f"┌{'─' * 60}")
            logger.error(f"│ 🔥 EXCEPTION {request_id}")
            logger.error(f"│ {method} {path}")
            logger.error(f"│ Error: {str(e)}")
            logger.error(f"└{'─' * 60}", exc_info=True)
            
            # Return error response
            return JSONResponse(
                status_code=500,
                content={"detail": "Internal server error", "request_id": request_id}
            )