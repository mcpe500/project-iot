#!/usr/bin/env python3
# quick_test.py - Quick test to verify the service starts without errors

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    print("Testing imports...")
    from middleware import RequestLoggingMiddleware
    from log_utils import log_function_call
    from api_routes import router
    from main import app
    print("✅ All imports successful!")
    
    print("Testing logging decorator...")
    @log_function_call
    async def test_function():
        return {"status": "ok"}
    
    print("✅ Logging decorator works!")
    print("🎉 Service should start without errors now!")
    
except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)