#!/bin/bash

SESSION_NAME="naisys-agent"
MARKER_FILE="/tmp/naisys-marker.txt"

# Function to start the tmux session with NAISYS agent
start_session() {
    echo "Starting NAISYS agent in tmux session..."
    
    # Kill existing session if it exists
    tmux kill-session -t "$SESSION_NAME" 2>/dev/null
    
    # Start new session with agent
    tmux new-session -d -s "$SESSION_NAME" -c "$(pwd)" 'npm run agent:assistant'
    
    echo "Session started. Waiting for agent to initialize..."
    sleep 3
    
    # Initialize marker
    echo "0" > "$MARKER_FILE"
    
    echo "Agent ready!"
}

# Function to send a command to the agent
send_command() {
    local command="$1"
    
    if [ -z "$command" ]; then
        echo "Usage: send_command '<command>'"
        return 1
    fi
    
    echo "Sending command: $command"
    
    # Clear screen to make output tracking easier
    tmux send-keys -t "$SESSION_NAME" 'clear' Enter
    
    # Send the command
    tmux send-keys -t "$SESSION_NAME" "$command" Enter
}

# Function to send just a carriage return (to trigger agent execution)
trigger_agent() {
    echo "Triggering agent execution..."
    tmux send-keys -t "$SESSION_NAME" Enter
}

# Function to wait for the agent prompt to return and capture output
wait_for_completion() {
    local timeout=${1:-60}  # Default 60 second timeout
    local check_interval=1
    local elapsed=0
    
    echo "Waiting for command completion..."
    
    while [ $elapsed -lt $timeout ]; do
        # Capture current output
        local current_output=$(tmux capture-pane -t "$SESSION_NAME" -p)
        
        # Check if we see the user prompt pattern (indicating completion)
        # Looking for patterns like "chuck@naisys:/path [Tokens: X/Y]$ "
        if echo "$current_output" | grep -q "chuck@naisys:.*\[Tokens:.*\]\$ *$"; then
            echo "Command completed!"
            echo "$current_output"
            return 0
        fi
        
        sleep $check_interval
        elapsed=$((elapsed + check_interval))
        echo -n "."
    done
    
    echo ""
    echo "Timeout waiting for completion. Current output:"
    tmux capture-pane -t "$SESSION_NAME" -p
    return 1
}

# Function to send a talk command specifically
talk() {
    local message="$1"
    
    if [ -z "$message" ]; then
        echo "Usage: talk '<message>'"
        return 1
    fi
    
    send_command "talk \"$message\""
    trigger_agent
    wait_for_completion
}

# Function to get current session output
get_output() {
    tmux capture-pane -t "$SESSION_NAME" -p
}

# Function to check if session is running
is_running() {
    tmux has-session -t "$SESSION_NAME" 2>/dev/null
}

# Function to attach to the session for manual interaction
attach() {
    if is_running; then
        echo "Attaching to session. Press Ctrl+B then D to detach."
        tmux attach-session -t "$SESSION_NAME"
    else
        echo "Session is not running. Start it first with: $0 start"
    fi
}

# Function to stop the session
stop() {
    echo "Stopping NAISYS agent session..."
    tmux kill-session -t "$SESSION_NAME" 2>/dev/null
    rm -f "$MARKER_FILE"
    echo "Session stopped."
}

# Main command dispatcher
case "$1" in
    "start")
        start_session
        ;;
    "stop")
        stop
        ;;
    "send")
        if ! is_running; then
            echo "Session not running. Start it first with: $0 start"
            exit 1
        fi
        send_command "$2"
        ;;
    "trigger")
        if ! is_running; then
            echo "Session not running. Start it first with: $0 start"
            exit 1
        fi
        trigger_agent
        ;;
    "wait")
        if ! is_running; then
            echo "Session not running. Start it first with: $0 start"
            exit 1
        fi
        wait_for_completion "$2"
        ;;
    "talk")
        if ! is_running; then
            echo "Session not running. Start it first with: $0 start"
            exit 1
        fi
        talk "$2"
        ;;
    "output")
        if ! is_running; then
            echo "Session not running. Start it first with: $0 start"
            exit 1
        fi
        get_output
        ;;
    "attach")
        attach
        ;;
    "status")
        if is_running; then
            echo "Session is running"
        else
            echo "Session is not running"
        fi
        ;;
    *)
        echo "NAISYS tmux session manager"
        echo ""
        echo "Usage: $0 <command> [args]"
        echo ""
        echo "Commands:"
        echo "  start                 - Start the NAISYS agent in tmux"
        echo "  stop                  - Stop the tmux session"
        echo "  send '<command>'      - Send a command to the agent"
        echo "  trigger               - Send carriage return to trigger agent"
        echo "  wait [timeout]        - Wait for command completion"
        echo "  talk '<message>'      - Send a talk command and wait for completion"
        echo "  output                - Get current session output"
        echo "  attach                - Attach to the session for manual interaction"
        echo "  status                - Check if session is running"
        echo ""
        echo "Example workflow:"
        echo "  $0 start"
        echo "  $0 talk 'create a file called hello.txt with Hello World'"
        echo "  $0 output"
        ;;
esac