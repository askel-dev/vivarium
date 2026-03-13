#!/bin/bash

echo "Starting Vivarium Backend..."
source venv/bin/activate
cd agent_world
python main_server.py &
BACKEND_PID=$!

cd ../frontend
echo "Starting Vivarium Frontend..."
npm run dev &
FRONTEND_PID=$!

echo ""
echo "==================================================="
echo "Vivarium servers are running in the background."
echo "Press Ctrl+C to stop both servers."
echo "==================================================="
echo ""

# Wait for any process to exit, then kill both
trap "kill $BACKEND_PID $FRONTEND_PID; exit" INT TERM
wait
