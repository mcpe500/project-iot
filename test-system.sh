#!/bin/bash

# IoT Multi-ESP System Integration Test Script
# This script validates the complete system deployment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
BACKEND_URL="http://localhost:3000"
API_KEY="your-api-key-here"
TIMEOUT=30

echo -e "${BLUE}IoT Multi-ESP System Integration Test${NC}"
echo "=========================================="

# Function to check if a service is running
check_service() {
    local url=$1
    local service_name=$2
    
    echo -n "Checking $service_name... "
    if curl -s --max-time $TIMEOUT "$url" > /dev/null; then
        echo -e "${GREEN}✓${NC}"
        return 0
    else
        echo -e "${RED}✗${NC}"
        return 1
    fi
}

# Function to test API endpoint
test_api() {
    local endpoint=$1
    local method=${2:-GET}
    local description=$3
    
    echo -n "Testing $description... "
    
    local response
    if [ "$method" = "GET" ]; then
        response=$(curl -s -w "%{http_code}" -H "X-API-Key: $API_KEY" "$BACKEND_URL$endpoint")
    else
        response=$(curl -s -w "%{http_code}" -X "$method" -H "Content-Type: application/json" -H "X-API-Key: $API_KEY" "$BACKEND_URL$endpoint")
    fi
    
    local http_code="${response: -3}"
    
    if [ "$http_code" = "200" ]; then
        echo -e "${GREEN}✓${NC}"
        return 0
    else
        echo -e "${RED}✗ (HTTP $http_code)${NC}"
        return 1
    fi
}

# Function to test WebSocket connection
test_websocket() {
    echo -n "Testing WebSocket connection... "
    
    # Use a simple Node.js script to test WebSocket
    local test_result=$(node -e "
        const WebSocket = require('ws');
        const ws = new WebSocket('ws://localhost:3000/ws');
        
        ws.on('open', () => {
            console.log('SUCCESS');
            ws.close();
        });
        
        ws.on('error', () => {
            console.log('FAILED');
        });
        
        setTimeout(() => {
            console.log('TIMEOUT');
            ws.close();
        }, 5000);
    " 2>/dev/null)
    
    if [ "$test_result" = "SUCCESS" ]; then
        echo -e "${GREEN}✓${NC}"
        return 0
    else
        echo -e "${RED}✗${NC}"
        return 1
    fi
}

# Function to simulate device registration
test_device_registration() {
    echo -n "Testing device registration... "
    
    local payload='{
        "deviceId": "TEST_CAM_001",
        "deviceName": "Test Camera",
        "deviceType": "camera",
        "ipAddress": "192.168.1.100",
        "capabilities": ["stream", "photo"]
    }'
    
    local response=$(curl -s -w "%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -H "X-API-Key: $API_KEY" \
        -d "$payload" \
        "$BACKEND_URL/api/v1/devices/register")
    
    local http_code="${response: -3}"
    
    if [ "$http_code" = "200" ]; then
        echo -e "${GREEN}✓${NC}"
        return 0
    else
        echo -e "${RED}✗ (HTTP $http_code)${NC}"
        return 1
    fi
}

# Function to test command sending
test_command_system() {
    echo -n "Testing command system... "
    
    local payload='{
        "deviceId": "TEST_CAM_001",
        "type": "ping",
        "payload": {}
    }'
    
    local response=$(curl -s -w "%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -H "X-API-Key: $API_KEY" \
        -d "$payload" \
        "$BACKEND_URL/api/v1/control/command")
    
    local http_code="${response: -3}"
    
    if [ "$http_code" = "200" ]; then
        echo -e "${GREEN}✓${NC}"
        return 0
    else
        echo -e "${RED}✗ (HTTP $http_code)${NC}"
        return 1
    fi
}

# Function to cleanup test data
cleanup_test_data() {
    echo -n "Cleaning up test data... "
    # Add cleanup logic here if needed
    echo -e "${GREEN}✓${NC}"
}

# Main test execution
main() {
    local failed_tests=0
    local total_tests=0
    
    echo -e "\n${YELLOW}1. Basic Service Health Checks${NC}"
    echo "================================"
    
    check_service "$BACKEND_URL/health" "Backend Health" || ((failed_tests++))
    ((total_tests++))
    
    echo -e "\n${YELLOW}2. API Endpoint Tests${NC}"
    echo "====================="
    
    test_api "/api/v1/dashboard/data" "GET" "Dashboard Data" || ((failed_tests++))
    ((total_tests++))
    
    test_api "/api/v1/dashboard/devices" "GET" "Device List" || ((failed_tests++))
    ((total_tests++))
    
    test_api "/api/v1/config/system" "GET" "System Config" || ((failed_tests++))
    ((total_tests++))
    
    test_api "/api/v1/stream/status" "GET" "Stream Status" || ((failed_tests++))
    ((total_tests++))
    
    echo -e "\n${YELLOW}3. WebSocket Tests${NC}"
    echo "=================="
    
    if command -v node &> /dev/null; then
        test_websocket || ((failed_tests++))
        ((total_tests++))
    else
        echo "Node.js not found, skipping WebSocket test"
    fi
    
    echo -e "\n${YELLOW}4. Device Management Tests${NC}"
    echo "=========================="
    
    test_device_registration || ((failed_tests++))
    ((total_tests++))
    
    test_command_system || ((failed_tests++))
    ((total_tests++))
    
    echo -e "\n${YELLOW}5. Cleanup${NC}"
    echo "=========="
    
    cleanup_test_data
    
    # Test Results Summary
    echo -e "\n${BLUE}Test Results Summary${NC}"
    echo "===================="
    echo "Total tests: $total_tests"
    echo "Passed: $((total_tests - failed_tests))"
    echo "Failed: $failed_tests"
    
    if [ $failed_tests -eq 0 ]; then
        echo -e "\n${GREEN}All tests passed! ✓${NC}"
        echo "System is ready for deployment."
        exit 0
    else
        echo -e "\n${RED}Some tests failed! ✗${NC}"
        echo "Please check the failed components before deployment."
        exit 1
    fi
}

# Help function
show_help() {
    echo "IoT Multi-ESP System Integration Test Script"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -h, --help      Show this help message"
    echo "  -u, --url URL   Backend URL (default: http://localhost:3000)"
    echo "  -k, --key KEY   API Key for authentication"
    echo "  -t, --timeout   Request timeout in seconds (default: 30)"
    echo ""
    echo "Environment Variables:"
    echo "  IOT_BACKEND_URL   Backend URL"
    echo "  IOT_API_KEY       API Key"
    echo ""
    echo "Examples:"
    echo "  $0                                    # Test with defaults"
    echo "  $0 -u http://192.168.1.100:3000     # Test remote server"
    echo "  $0 -k myapikey                       # Use specific API key"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        -u|--url)
            BACKEND_URL="$2"
            shift 2
            ;;
        -k|--key)
            API_KEY="$2"
            shift 2
            ;;
        -t|--timeout)
            TIMEOUT="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Use environment variables if available
if [ -n "$IOT_BACKEND_URL" ]; then
    BACKEND_URL="$IOT_BACKEND_URL"
fi

if [ -n "$IOT_API_KEY" ]; then
    API_KEY="$IOT_API_KEY"
fi

# Validate required parameters
if [ "$API_KEY" = "your-api-key-here" ]; then
    echo -e "${RED}Error: Please set a valid API key${NC}"
    echo "Use -k option or set IOT_API_KEY environment variable"
    exit 1
fi

# Check if curl is available
if ! command -v curl &> /dev/null; then
    echo -e "${RED}Error: curl is required but not installed${NC}"
    exit 1
fi

echo "Configuration:"
echo "Backend URL: $BACKEND_URL"
echo "API Key: ${API_KEY:0:8}..."
echo "Timeout: ${TIMEOUT}s"
echo ""

# Run the main test suite
main
