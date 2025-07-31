#!/bin/bash
# test-docker-terminal.sh
# Test script to manually verify Docker terminal setup

# Usage: ./test-docker-terminal.sh <container_id> <session_name> <working_dir>

CONTAINER_ID=$1
SESSION_NAME=${2:-"test-session"}
WORKING_DIR=${3:-"/app"}

if [ -z "$CONTAINER_ID" ]; then
    echo "Usage: $0 <container_id> [session_name] [working_dir]"
    echo "Example: $0 abc123def456 my-session /app"
    exit 1
fi

echo "==============================================="
echo "Docker Terminal Test Script"
echo "==============================================="
echo "Container ID: $CONTAINER_ID"
echo "Session name: $SESSION_NAME"
echo "Working directory: $WORKING_DIR"
echo "==============================================="

# Test 1: Check if container exists
echo -e "\n[TEST 1] Checking if container exists..."
if docker inspect $CONTAINER_ID >/dev/null 2>&1; then
    echo "✓ Container exists"
else
    echo "✗ Container not found!"
    exit 1
fi

# Test 2: Check if container is running
echo -e "\n[TEST 2] Checking container status..."
RUNNING=$(docker inspect $CONTAINER_ID --format='{{.State.Running}}')
STATUS=$(docker inspect $CONTAINER_ID --format='{{.State.Status}}')
echo "Running: $RUNNING"
echo "Status: $STATUS"

if [ "$RUNNING" != "true" ]; then
    echo "✗ Container is not running!"
    exit 1
fi
echo "✓ Container is running"

# Test 3: Test basic exec
echo -e "\n[TEST 3] Testing basic exec..."
if docker exec $CONTAINER_ID echo "Basic exec works"; then
    echo "✓ Basic exec successful"
else
    echo "✗ Basic exec failed!"
    exit 1
fi

# Test 4: Test tmux installation
echo -e "\n[TEST 4] Checking tmux availability..."
if docker exec $CONTAINER_ID which tmux >/dev/null 2>&1; then
    TMUX_PATH=$(docker exec $CONTAINER_ID which tmux)
    echo "✓ tmux found at: $TMUX_PATH"
else
    echo "✗ tmux not found in container!"
    echo "Installing tmux might be required in the container image"
fi

# Test 5: List existing tmux sessions
echo -e "\n[TEST 5] Listing existing tmux sessions..."
docker exec $CONTAINER_ID tmux list-sessions 2>/dev/null || echo "No tmux sessions found (this is normal if none exist)"

# Test 6: Test working directory
echo -e "\n[TEST 6] Checking working directory..."
if docker exec $CONTAINER_ID test -d "$WORKING_DIR"; then
    echo "✓ Working directory exists: $WORKING_DIR"
    CONTENTS=$(docker exec $CONTAINER_ID ls -la "$WORKING_DIR" | head -5)
    echo "First 5 entries:"
    echo "$CONTENTS"
else
    echo "✗ Working directory does not exist: $WORKING_DIR"
    echo "Available directories:"
    docker exec $CONTAINER_ID ls -la / | grep "^d"
fi

# Test 7: Run the exact tmux command we use (non-interactive test)
echo -e "\n[TEST 7] Testing tmux session creation..."
TMUX_TEST_CMD='
if [ -d "'$WORKING_DIR'" ]; then
  cd "'$WORKING_DIR'" || exit 1
  if tmux has-session -t '$SESSION_NAME' 2>/dev/null; then
    echo "[Terminal] Session already exists: '$SESSION_NAME'"
    tmux list-sessions | grep '$SESSION_NAME'
  else
    echo "[Terminal] Creating new tmux session: '$SESSION_NAME'"
    tmux new-session -d -s '$SESSION_NAME' -c "'$WORKING_DIR'"
    if [ $? -eq 0 ]; then
      echo "✓ Session created successfully"
      tmux list-sessions | grep '$SESSION_NAME'
    else
      echo "✗ Failed to create session"
      exit 1
    fi
  fi
else
  echo "[Terminal] ERROR: Working directory does not exist: '$WORKING_DIR'"
  exit 1
fi
'

if docker exec \
  -e TERM=xterm-256color \
  -e LANG=en_US.UTF-8 \
  -e LC_ALL=en_US.UTF-8 \
  -e COLORTERM=truecolor \
  $CONTAINER_ID /bin/bash -c "$TMUX_TEST_CMD"; then
    echo "✓ Tmux command execution successful"
else
    echo "✗ Tmux command execution failed!"
fi

# Test 8: Interactive terminal test (optional)
echo -e "\n[TEST 8] Interactive terminal test"
echo "==============================================="
echo "To test the interactive terminal, run:"
echo ""
echo "docker exec -it \\"
echo "  -e TERM=xterm-256color \\"
echo "  -e LANG=en_US.UTF-8 \\"
echo "  -e LC_ALL=en_US.UTF-8 \\"
echo "  -e COLORTERM=truecolor \\"
echo "  $CONTAINER_ID tmux attach-session -t $SESSION_NAME"
echo ""
echo "Or to create and attach in one command:"
echo ""
echo "docker exec -it \\"
echo "  -e TERM=xterm-256color \\"
echo "  -e LANG=en_US.UTF-8 \\"
echo "  -e LC_ALL=en_US.UTF-8 \\"
echo "  -e COLORTERM=truecolor \\"
echo "  $CONTAINER_ID /bin/bash -c 'cd $WORKING_DIR && tmux new-session -A -s $SESSION_NAME'"
echo "==============================================="

# Cleanup test session (optional)
echo -e "\n[CLEANUP] To remove the test session, run:"
echo "docker exec $CONTAINER_ID tmux kill-session -t $SESSION_NAME"