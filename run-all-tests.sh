#!/bin/bash
#
# Run all CLI/PTY tests
# This script starts the server, runs tests, and reports results
#

set -e

cd "$(dirname "$0")"

echo "=================================================="
echo "    AGENTUM CLI/PTY TEST RUNNER"
echo "=================================================="
echo ""

# Build first
echo "Building..."
npm run build

# Check if server is already running
if nc -z localhost 11042 2>/dev/null; then
    echo "Server already running on port 11042"
    SERVER_PID=""
else
    echo "Starting server..."
    node dist/index.js server --port 11042 &
    SERVER_PID=$!

    # Wait for server to be ready
    for i in {1..10}; do
        if nc -z localhost 11042 2>/dev/null; then
            echo "Server is ready"
            break
        fi
        sleep 1
    done

    if ! nc -z localhost 11042 2>/dev/null; then
        echo "ERROR: Server failed to start"
        exit 1
    fi
fi

echo ""
echo "Running tests..."
echo ""

# Run all test suites
FAILED=0

echo "=== Running Comprehensive Tests ==="
if ! node test-all.js localhost 11042; then
    FAILED=1
fi

echo ""
echo "=== Running Quote Tests ==="
if ! node test-quotes.js localhost 11042; then
    FAILED=1
fi

echo ""
echo "=== Running Session Command Tests ==="
if ! node test-session-command.js localhost 11042; then
    FAILED=1
fi

echo ""
echo "=== Running Mobile Client Simulator Tests ==="
if ! node test-mobile-client.js localhost 11042; then
    FAILED=1
fi

# Cleanup
if [ -n "$SERVER_PID" ]; then
    echo ""
    echo "Stopping server..."
    kill $SERVER_PID 2>/dev/null || true
fi

echo ""
if [ $FAILED -eq 0 ]; then
    echo "=================================================="
    echo "    ALL TESTS PASSED!"
    echo "=================================================="
else
    echo "=================================================="
    echo "    SOME TESTS FAILED"
    echo "=================================================="
    exit 1
fi
