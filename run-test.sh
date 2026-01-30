#!/bin/bash
cd /Users/priyankar/Desktop/AirCodum-Agentum/cli

# Run test client with commands
{
  echo "/create test"
  sleep 2
  echo "echo hello"
  sleep 2
  echo "exit"
  sleep 1
} | node test-client.js localhost 11042 2>&1 &
PID=$!

# Wait and kill
sleep 8
kill $PID 2>/dev/null
