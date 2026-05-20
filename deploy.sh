#!/bin/bash
#
# Tribe Poker Tracker Deployment Script
# Builds frontend and restarts both services
#

set -e

echo "======================================"
echo "Tribe Poker Tracker Deployment"
echo "======================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Project paths
PROJECT_DIR="/root/.openclaw/workspace/poker-tracker"
FRONTEND_DIR="$PROJECT_DIR/app"
BACKEND_DIR="$PROJECT_DIR/backend"
WEB_ROOT="/var/www/poker-tracker"

echo -e "${YELLOW}Step 1: Building frontend...${NC}"
cd "$FRONTEND_DIR"
npm run build
echo -e "${GREEN}✓ Frontend build complete${NC}"
echo ""

echo -e "${YELLOW}Step 2: Copying frontend to web root...${NC}"
rm -rf "$WEB_ROOT"/*
cp -r "$FRONTEND_DIR/dist"/* "$WEB_ROOT/"
echo -e "${GREEN}✓ Frontend deployed to $WEB_ROOT${NC}"
echo ""

echo -e "${YELLOW}Step 3: Restarting backend service...${NC}"
systemctl restart tribe-poker-backend.service
echo -e "${GREEN}✓ Backend service restarted (port 5001)${NC}"
echo ""

echo -e "${YELLOW}Step 4: Checking service status...${NC}"
sleep 2

# Frontend is served by nginx from $WEB_ROOT (no dedicated systemd unit).
if systemctl is-active --quiet tribe-poker-backend.service; then
    echo -e "${GREEN}✓ Backend service is running (port 5001)${NC}"
else
    echo -e "${RED}✗ Backend service is NOT running${NC}"
    exit 1
fi

echo ""
echo "======================================"
echo -e "${GREEN}Deployment complete!${NC}"
echo "======================================"
echo ""
echo "Frontend: http://76.13.182.206:5000"
echo "Backend API: http://76.13.182.206:5001"
echo ""
