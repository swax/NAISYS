#!/bin/bash

# Make sure to enable this script for execution with `chmod +x runteam.sh`

# Check if an argument is provided
if [ $# -eq 0 ]; then
  echo "Runs an entire team of agents in a tmux session"
  echo "  Usage: naisys <path_to_agent_directory>"
  echo "  Note: The folder the agents are in will be treated as the tmux session name"
  exit 1
fi

# TODO: In the future should implement a max agents per window in the session
# Will require an outer loop to create new windows
# How many agents per window
# AGENTS_PER_WINDOW=4

# Resolves the location of naisys from the bin directory
SCRIPT=$(readlink -f "$0" || echo "$0")
SCRIPT_DIR=$(dirname "$SCRIPT")

# Directory containing agent files
AGENT_DIR="$1"
TEAM_NAME=$(basename "$AGENT_DIR")

# Start a new tmux session detached
tmux new-session -d -s $TEAM_NAME

# Get a list of agent paths
AGENT_FILES=($(find $AGENT_DIR -type f)) # This will list all files in the directory

# Split the window into panes and start agents
for ((i = 0; i < ${#AGENT_FILES[@]}; i++)); do
  echo "Starting agent $((i + 1)) of ${#AGENT_FILES[@]}..."
  sleep $((i == 0 ? 3 : 1)) # Sleep longer for the first agent
  
  # For the first agent, no split is needed
  if [ $i -eq 0 ]; then
    tmux send-keys -t $TEAM_NAME:0.0 "node $SCRIPT_DIR/dist/naisys.js '${AGENT_FILES[i]}'" C-m # Quote the path
  else
    # Determine pane split direction based on odd/even pane index
    if [ $((i % 2)) -eq 0 ]; then
      tmux split-window -v -t $TEAM_NAME:0
    else
      tmux split-window -h -t $TEAM_NAME:0
    fi
    tmux send-keys "node $SCRIPT_DIR/dist/naisys.js '${AGENT_FILES[i]}'" C-m # Quote the path
    tmux last-pane # Move focus back to the last pane to ensure correct targeting in the next iteration
  fi
done

# Optionally, you can balance the panes if you want
tmux select-layout -t $TEAM_NAME tiled

# Attach to the session
tmux attach-session -t $TEAM_NAME
