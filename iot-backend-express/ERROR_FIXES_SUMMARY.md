# Content-Length Header Fix Plan

## Issue
The `/api/v1/sensor-data` endpoint responses are missing the Content-Length header, causing warnings in the frontend logs.

## Analysis
- The endpoint already sets Content-Length (lines 689-724 in routes.js)
- The header might be getting stripped by middleware
- Need more robust header handling

## Proposed Fix
1. Modify the sensor-data endpoint to:
```javascript
app.get('/api/v1/sensor-data', async (req, res) => {
  const startTime = Date.now();
  const { deviceId, limit } = req.query;
  
  if (!deviceId) {
    return res.status(400).json({ 
      error: 'Missing required query parameter: deviceId',
      responseTime: Date.now() - startTime
    });
  }
  
  try {
    const limitNum = limit ? Math.min(parseInt(limit, 10), 1000) : 100;
    const data = await dataStore.getSensorData(deviceId, limitNum);
    
    // Prepare response and set headers
    const responseObj = {
      success: true, 
      data,
      count: data.length,
      deviceId,
      responseTime: Date.now() - startTime
    };
    
    const responseStr = JSON.stringify(responseObj);
    const contentLength = Buffer.byteLength(responseStr, 'utf8');
    
    res.set({
      'Content-Length': contentLength,
      'Content-Type': 'application/json'
    });
    
    // Debug logging
    console.log('Response headers:', {
      'Content-Length': contentLength,
      'Content-Type': 'application/json'
    });
    
    res.end(responseStr);
  } catch (error) {
    console.error('[API Error] /sensor-data:', error);
    res.status(500).json({ 
      error: 'Failed to retrieve sensor data', 
      details: error.message,
      responseTime: Date.now() - startTime
    });
  }
});
```

2. Add middleware to ensure headers are preserved
3. Add test cases to verify header presence

## Verification Steps
1. Make GET request to endpoint
2. Verify Content-Length header in response
3. Check frontend logs for warnings

## Next Steps
- Switch to Code mode to implement changes
- Test changes locally
- Deploy to staging environment
- Verify fix in production
