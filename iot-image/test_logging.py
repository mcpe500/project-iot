#!/usr/bin/env python3
# test_logging.py - Simple test to verify the logging implementation works

import asyncio
import logging
from log_utils import log_function_call

# Set up logging
logging.basicConfig(level=logging.DEBUG)

@log_function_call
async def test_async_function(param1, param2="default"):
    """Test async function"""
    await asyncio.sleep(0.1)
    return {"result": f"processed {param1} with {param2}"}

@log_function_call
def test_sync_function(param1, param2="default"):
    """Test sync function"""
    return {"result": f"processed {param1} with {param2}"}

async def main():
    print("Testing logging decorators...")
    
    # Test async function
    result1 = await test_async_function("test_data", param2="custom")
    print(f"Async result: {result1}")
    
    # Test sync function
    result2 = test_sync_function("test_data", param2="custom")
    print(f"Sync result: {result2}")
    
    print("All tests completed successfully!")

if __name__ == "__main__":
    asyncio.run(main())