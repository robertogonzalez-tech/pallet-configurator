#!/bin/bash
# Install BOL Drive watcher as a system service
# Checks for new BOL PDFs every 5 minutes and processes them

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
WATCH_SCRIPT="$SCRIPT_DIR/watch-drive-bols.js"
SERVICE_NAME="bol-watcher"

echo "Installing BOL watcher service..."

# Check if watch script exists
if [ ! -f "$WATCH_SCRIPT" ]; then
  echo "❌ Watch script not found: $WATCH_SCRIPT"
  exit 1
fi

# Check if .env.local exists
if [ ! -f "$PROJECT_DIR/.env.local" ]; then
  echo "❌ .env.local not found. Create it with DRIVE_BOL_FOLDER_ID and Supabase credentials."
  exit 1
fi

# Load environment variables
source "$PROJECT_DIR/.env.local"

if [ -z "$DRIVE_BOL_FOLDER_ID" ]; then
  echo "❌ DRIVE_BOL_FOLDER_ID not set in .env.local"
  exit 1
fi

# Use PM2 to manage the watcher
if ! command -v pm2 &> /dev/null; then
  echo "Installing PM2..."
  npm install -g pm2
fi

# Stop existing watcher if running
pm2 delete "$SERVICE_NAME" 2>/dev/null || true

# Start the watcher
echo "Starting watcher (checking every 5 minutes)..."
pm2 start "$WATCH_SCRIPT" \
  --name "$SERVICE_NAME" \
  --interpreter node \
  -- --folder-id "$DRIVE_BOL_FOLDER_ID" --watch

# Save PM2 process list
pm2 save

# Set up PM2 to start on boot (optional)
pm2 startup || true

echo "✅ BOL watcher installed and running"
echo ""
echo "Commands:"
echo "  pm2 status           - Check status"
echo "  pm2 logs $SERVICE_NAME  - View logs"
echo "  pm2 restart $SERVICE_NAME - Restart"
echo "  pm2 stop $SERVICE_NAME    - Stop"
