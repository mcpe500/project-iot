# Frontend API Authentication Fix

## Problem
The frontend was experiencing 401 (Unauthorized) errors when connecting to the backend because it wasn't sending the required API key that matches the Arduino device configuration.

## Root Cause
The Arduino code (`iot_camera_stream.ino`) uses the API key `dev-api-key-change-in-production` with the header `X-API-Key`, but the frontend wasn't configured to send this authentication.

## Changes Made

### 1. Updated Configuration (`app/config.ts`)
- Added `API_KEY: 'dev-api-key-change-in-production'` to match Arduino configuration

### 2. Created API Service (`services/api.ts`)
- Created axios instance with default API key headers
- Added request interceptor to ensure API key is always included
- Added response interceptor for proper error handling
- All HTTP requests now automatically include `X-API-Key` header

### 3. Updated Frontend Components
- **`index.tsx`**: 
  - Replaced raw axios calls with api service
  - Updated WebSocket connection to include API key as query parameter
  - Added authentication message after WebSocket connection
- **`devices.tsx`**:
  - Replaced raw axios calls with api service
  - Fixed IconSymbol names for valid SF Symbols
  - All device management API calls now use proper authentication

### 4. Added Testing Utilities (`services/testConnection.ts`)
- Functions to test API and WebSocket connections
- Helps diagnose authentication issues

### 5. Environment Configuration (`services/config.ts`)
- Centralized configuration management
- Support for environment variables
- Helper functions for consistent URL and header generation

## API Key Authentication Flow

### HTTP Requests
1. All HTTP requests automatically include `X-API-Key: dev-api-key-change-in-production` header
2. Backend validates this header against the expected API key
3. 401 errors should no longer occur for valid requests

### WebSocket Connections
1. API key included as query parameter: `?apiKey=dev-api-key-change-in-production`
2. Additional authentication message sent after connection opens
3. Backend can validate WebSocket connections using the API key

## Testing
To verify the fix works:
1. Import `testAPIConnection` from `services/testConnection.ts`
2. Call it to test HTTP API authentication
3. Import `testWebSocketConnection` to test WebSocket authentication

## Environment Variables (Optional)
You can override the default configuration by setting:
- `EXPO_PUBLIC_BACKEND_URL` - Backend server URL
- `EXPO_PUBLIC_WS_URL` - WebSocket server URL  
- `EXPO_PUBLIC_API_KEY` - API key for authentication

## Expected Result
- No more 401 authentication errors
- Successful API calls to load devices and system status
- Working WebSocket connection for live streaming
- Frontend can properly communicate with backend using same API key as Arduino device
