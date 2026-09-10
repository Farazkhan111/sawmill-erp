#!/bin/bash
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "Installing required files - this only happens once, please wait..."
  npm install
  if [ $? -ne 0 ]; then
    echo ""
    echo "Something went wrong installing dependencies."
    echo "Make sure Node.js is installed: https://nodejs.org"
    read -p "Press Enter to close..."
    exit 1
  fi
fi

( sleep 1 && (open http://localhost:4173 2>/dev/null || xdg-open http://localhost:4173 2>/dev/null) ) &
node server.js
