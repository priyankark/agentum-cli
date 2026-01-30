#!/bin/bash
# Quick test script for PTY sessions
# Run this after starting the server with: npm run dev

echo "Testing PTY/CLI session functionality..."
echo ""

# Check if server is running
if ! nc -z localhost 11042 2>/dev/null; then
    echo "ERROR: Server not running on port 11042"
    echo "Start the server first with: cd cli && npm run dev"
    exit 1
fi

echo "Server is running. Running automated test..."
echo ""

# Run the automated test
node auto-test.js localhost 11042 2>&1

echo ""
echo "Test complete!"
