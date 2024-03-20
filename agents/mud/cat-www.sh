#!/bin/bash

# Start the context with all the contents of all the files in the directory
# Currently have a problem with the app overwriting it's own files an not undrstanding the context
# For a mud most of the data is in the db so hopefully the rest of the site is 'light'

# The path to the directory to search, provided as the first script argument
DIRECTORY_PATH="$1"

# The name of the directory to exclude from the search
EXCLUDE_DIR="logs"

# Check if the provided directory path is not empty
if [[ -z "$DIRECTORY_PATH" ]]; then
    echo "Usage: $0 <directory-path>"
    exit 1
fi

# Execute find command, excluding the specified directory and matching files with the specified extensions
# For each matched file, print its full path and then display its contents
find "$DIRECTORY_PATH" -type d -name "$EXCLUDE_DIR" -prune -o \
     \( -name "*.php" -o -name "*.html" -o -name "*.js" -o -name "*.css" -o -name "*.sh" -o -name "*.txt" \) -type f -exec sh -c 'echo "\ncat {}"; cat "{}"' \;