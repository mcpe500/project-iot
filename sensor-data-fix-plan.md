# Sensor Data Handling Fix Plan

## Problem Description
The frontend component handling sensor data currently has complex logic to handle API responses. The backend returns data in a nested structure `{ data: [...] }`, but the frontend code contains redundant checks and type casting that makes the code harder to maintain.

## Proposed Solution
1. **Update API Interface**  
   Create a proper TypeScript interface for the API response
2. **Simplify Data Handling**  
   Remove redundant checks and directly access `response.data.data`
3. **Enhance Type Safety**  
   Add proper typing throughout the component
4. **Maintain Sorting**  
   Keep the existing timestamp sorting functionality
5. **Preserve Error Handling**  
   Maintain existing error handling mechanisms

## Implementation Steps

### 1. Update API Interface
Add a new interface in `sensor-data.tsx`:
```typescript
interface SensorDataResponse {
  data: SensorDataItem[];
}
```

### 2. Simplify Data Handling
Replace the complex data extraction logic with:
```typescript
const response = await getSensorData(selectedDevice) as SensorDataResponse;
const sensorDataArray = response.data || [];
```

### 3. Remove Redundant Code
Delete:
- Multi-level array checks
- `console.log` showing data structure
- All `as any` type casting

### 4. Enhance Type Safety
Update the `getSensorData` call to use the new interface:
```typescript
const response = await getSensorData(selectedDevice) as SensorDataResponse;
```

### 5. Maintain Sorting
Keep the timestamp sorting logic:
```typescript
setSensorData(sensorDataArray.sort((a, b) => a.timestamp - b.timestamp));
```

## Expected Outcomes
- Simplified and more maintainable code
- Improved type safety
- Consistent data handling
- Preserved functionality