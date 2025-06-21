# log_utils.py
import asyncio
import logging
import functools
import time
import inspect
from typing import Callable, Any, Dict, Optional
from fastapi import Request

logger = logging.getLogger(__name__)

def log_function_call(func: Callable) -> Callable:
    """
    Decorator to log function calls with parameters and execution time
    Handles both sync and async functions
    """
    if inspect.iscoroutinefunction(func):
        @functools.wraps(func)
        async def async_wrapper(*args, **kwargs):
            func_name = func.__name__
            module_name = func.__module__
            
            # Simple function call logging without detailed arguments to avoid serialization issues
            logger.debug(f"CALL: {module_name}.{func_name}() - {len(args)} args, {len(kwargs)} kwargs")
            
            start_time = time.time()
            try:
                result = await func(*args, **kwargs)
                elapsed = time.time() - start_time
                logger.debug(f"RETURN: {module_name}.{func_name} completed in {elapsed:.6f}s")
                return result
            except Exception as e:
                elapsed = time.time() - start_time
                logger.error(f"ERROR: {module_name}.{func_name} failed after {elapsed:.6f}s: {str(e)}")
                raise
        
        return async_wrapper
    else:
        @functools.wraps(func)
        def sync_wrapper(*args, **kwargs):
            func_name = func.__name__
            module_name = func.__module__
            
            # Simple function call logging without detailed arguments to avoid serialization issues
            logger.debug(f"CALL: {module_name}.{func_name}() - {len(args)} args, {len(kwargs)} kwargs")
            
            start_time = time.time()
            try:
                result = func(*args, **kwargs)
                elapsed = time.time() - start_time
                logger.debug(f"RETURN: {module_name}.{func_name} completed in {elapsed:.6f}s")
                return result
            except Exception as e:
                elapsed = time.time() - start_time
                logger.error(f"ERROR: {module_name}.{func_name} failed after {elapsed:.6f}s: {str(e)}")
                raise
        
        return sync_wrapper

def get_request_id(request: Optional[Request] = None) -> str:
    """
    Get the request ID from the request state or generate a new one
    """
    if request and hasattr(request.state, 'request_id'):
        return request.state.request_id
    return 'no-request-id'

class RequestContextFilter(logging.Filter):
    """
    Logging filter that adds request ID to log records
    """
    def __init__(self, request: Optional[Request] = None):
        super().__init__()
        self.request = request
        
    def filter(self, record):
        record.request_id = get_request_id(self.request)
        return True

def setup_logger(name: str, request: Optional[Request] = None) -> logging.Logger:
    """
    Set up a logger with request context
    """
    logger = logging.getLogger(name)
    request_filter = RequestContextFilter(request)
    for handler in logger.handlers:
        handler.addFilter(request_filter)
    return logger