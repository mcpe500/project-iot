# Buzzer Control System Design

## Database Model
Create `BuzzerRequest` model with:
- id: INTEGER (auto-increment primary key)
- deviceId: STRING (foreign key to Device)
- requestedAt: BIGINT (timestamp)
- buzzedAt: BIGINT (nullable)
- status: ENUM('pending', 'completed')
- deletedAt: DATETIME (for soft deletion)

## API Endpoints
1. **POST /api/v1/buzzer/request**
   - Creates new buzzer request
   - Body: { deviceId }
   - Returns: Created request object

2. **GET /api/v1/buzzer/status/:deviceId**
   - Gets latest buzzer status for device
   - Returns: { status, lastRequestedAt, lastBuzzedAt }

3. **PATCH /api/v1/buzzer/complete/:id**
   - Marks request as completed
   - Updates buzzedAt timestamp
   - Returns: Updated request object

## Implementation Details
1. Create new model file: `src/models/BuzzerRequest.js`
2. Add model initialization in `database.js`
3. Add new routes in `routes.js`
4. Add data access methods in `DataStore` class
5. Implement proper error handling and validation
6. Add API documentation

## Buzzer Control Flow Diagram
```mermaid
sequenceDiagram
    participant ESP32
    participant API
    participant Database

    ESP32->>API: POST /buzzer/request {deviceId}
    API->>Database: Create BuzzerRequest
    Database-->>API: Created request
    API-->>ESP32: Response with requestId

    loop Every 150ms
        ESP32->>API: GET /buzzer/status/:deviceId
        API->>Database: Get latest request
        Database-->>API: Request status
        API-->>ESP32: Response with status
    end

    ESP32->>API: PATCH /buzzer/complete/:id
    API->>Database: Update request status
    Database-->>API: Updated request
    API-->>ESP32: Response with updated request