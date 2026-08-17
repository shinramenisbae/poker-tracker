#!/bin/bash
#
# Tribe Poker Tracker Deployment Script
# Builds the frontend and restarts the backend (and optionally the bot).
#
# Defaults deploy the primary instance, so existing callers (CI, manual runs)
# need no changes. Override the env vars below to deploy a second, isolated
# instance from the same checkout — see docs/second-instance.md:
#
#   WEB_ROOT=/var/www/poker-tracker-b \
#   BACKEND_SERVICE=tribe-poker-backend-b.service \
#   BOT_SERVICE=tribe-poker-bot-b.service \
#   SKIP_BUILD=1 \
#     bash deploy.sh
#
# SKIP_BUILD reuses the existing app/dist — both instances run identical
# frontend code, so there's no reason to rebuild it for the second one.

set -e

# Project paths
PROJECT_DIR="${PROJECT_DIR:-/root/.openclaw/workspace/poker-tracker}"
FRONTEND_DIR="$PROJECT_DIR/app"
BACKEND_DIR="$PROJECT_DIR/backend"
WEB_ROOT="${WEB_ROOT:-/var/www/poker-tracker}"
BACKEND_SERVICE="${BACKEND_SERVICE:-tribe-poker-backend.service}"
BOT_SERVICE="${BOT_SERVICE:-}"   # empty = leave the bot alone (CI restarts it)
SKIP_BUILD="${SKIP_BUILD:-}"

echo "======================================"
echo "Tribe Poker Tracker Deployment"
echo "  web root : $WEB_ROOT"
echo "  backend  : $BACKEND_SERVICE"
[ -n "$BOT_SERVICE" ] && echo "  bot      : $BOT_SERVICE"
echo "======================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

if [ -n "$SKIP_BUILD" ]; then
    echo -e "${YELLOW}Step 1: Skipping build (SKIP_BUILD set), reusing app/dist${NC}"
    if [ ! -d "$FRONTEND_DIR/dist" ]; then
        echo -e "${RED}✗ No existing build at $FRONTEND_DIR/dist — run without SKIP_BUILD first${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}Step 1: Building frontend...${NC}"
    cd "$FRONTEND_DIR"
    npm run build
    echo -e "${GREEN}✓ Frontend build complete${NC}"
fi
echo ""

echo -e "${YELLOW}Step 2: Copying frontend to web root...${NC}"
mkdir -p "$WEB_ROOT"
rm -rf "${WEB_ROOT:?}"/*
cp -r "$FRONTEND_DIR/dist"/* "$WEB_ROOT/"
echo -e "${GREEN}✓ Frontend deployed to $WEB_ROOT${NC}"
echo ""

echo -e "${YELLOW}Step 3: Restarting services...${NC}"
systemctl restart "$BACKEND_SERVICE"
echo -e "${GREEN}✓ Restarted $BACKEND_SERVICE${NC}"
if [ -n "$BOT_SERVICE" ]; then
    systemctl restart "$BOT_SERVICE"
    echo -e "${GREEN}✓ Restarted $BOT_SERVICE${NC}"
fi
echo ""

echo -e "${YELLOW}Step 4: Checking service status...${NC}"
sleep 2

# Frontend is served by nginx from $WEB_ROOT (no dedicated systemd unit).
status=0
if systemctl is-active --quiet "$BACKEND_SERVICE"; then
    echo -e "${GREEN}✓ $BACKEND_SERVICE is running${NC}"
else
    echo -e "${RED}✗ $BACKEND_SERVICE is NOT running${NC}"
    status=1
fi
if [ -n "$BOT_SERVICE" ]; then
    if systemctl is-active --quiet "$BOT_SERVICE"; then
        echo -e "${GREEN}✓ $BOT_SERVICE is running${NC}"
    else
        echo -e "${RED}✗ $BOT_SERVICE is NOT running${NC}"
        status=1
    fi
fi
[ "$status" -eq 0 ] || exit 1

echo ""
echo "======================================"
echo -e "${GREEN}Deployment complete!${NC}"
echo "======================================"
echo ""
