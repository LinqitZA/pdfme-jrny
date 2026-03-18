#!/bin/bash
set -e

echo "==========================================="
echo "  pdfme ERP Edition - Environment Setup"
echo "==========================================="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is required but not installed."
    echo "  Install Node.js LTS (20+) from https://nodejs.org"
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo "WARNING: Node.js 20+ recommended. Current: $(node -v)"
fi

echo "Node.js: $(node -v)"
echo "npm: $(npm -v)"
echo ""

# Check PostgreSQL
if command -v psql &> /dev/null; then
    echo "PostgreSQL: $(psql --version)"
else
    echo "WARNING: PostgreSQL CLI (psql) not found."
    echo "  Ensure PostgreSQL 15+ is running and accessible."
fi

# Check Redis
if command -v redis-cli &> /dev/null; then
    echo "Redis: $(redis-cli --version)"
else
    echo "WARNING: Redis CLI not found."
    echo "  Ensure Redis 7+ is running for Bull queue support."
fi

# Check Ghostscript
if command -v gs &> /dev/null; then
    echo "Ghostscript: $(gs --version)"
else
    echo "WARNING: Ghostscript not found."
    echo "  Required for PDF/A-3b conversion."
    echo "  Install: apt-get install ghostscript (Linux) or brew install ghostscript (macOS)"
fi

echo ""
echo "--- Installing dependencies ---"
npm install

echo ""
echo "--- Building upstream packages ---"
echo "Building @pdfme/pdf-lib..."
npm run build:pdf-lib 2>/dev/null || echo "  (skipped - may need setup)"

echo "Building @pdfme/common..."
npm run build:common 2>/dev/null || echo "  (skipped - may need setup)"

echo "Building @pdfme/converter..."
npm run build:converter 2>/dev/null || echo "  (skipped - may need setup)"

echo "Building @pdfme/schemas..."
npm run build:schemas 2>/dev/null || echo "  (skipped - may need setup)"

echo "Building @pdfme/generator..."
npm run build:generator 2>/dev/null || echo "  (skipped - may need setup)"

echo ""
echo "--- Starting Docker services (PostgreSQL + Redis) ---"
if command -v docker &> /dev/null; then
    # Start PostgreSQL if not running
    if ! docker ps --format '{{.Names}}' | grep -q pdfme-postgres; then
        echo "Starting PostgreSQL container..."
        docker run -d --name pdfme-postgres \
            -e POSTGRES_PASSWORD=postgres \
            -e POSTGRES_DB=pdfme_erp \
            -p 5432:5432 \
            postgres:15-alpine 2>/dev/null || echo "  (container may already exist)"
        sleep 3
    else
        echo "PostgreSQL container already running"
    fi
    # Start Redis if not running
    if ! docker ps --format '{{.Names}}' | grep -q pdfme-redis; then
        echo "Starting Redis container..."
        docker run -d --name pdfme-redis \
            -p 6379:6379 \
            redis:7-alpine 2>/dev/null || echo "  (container may already exist)"
        sleep 2
    else
        echo "Redis container already running"
    fi
else
    echo "WARNING: Docker not found. Ensure PostgreSQL and Redis are running manually."
fi

echo ""
echo "--- Starting NestJS API server ---"
# Kill any existing server on port 3000
if lsof -ti :3000 > /dev/null 2>&1; then
    echo "Stopping existing server on port 3000..."
    kill $(lsof -ti :3000) 2>/dev/null || true
    sleep 2
fi

# Start the NestJS server in background
npx ts-node --project nest-module/tsconfig.json nest-module/src/main.ts > /tmp/pdfme-server.log 2>&1 &
SERVER_PID=$!
echo "Server starting (PID: $SERVER_PID)..."
sleep 10

# Verify server is running
if curl -s http://localhost:3000/api/pdfme/health > /dev/null 2>&1; then
    echo "Server is running on http://localhost:3000"
    echo "Health: $(curl -s http://localhost:3000/api/pdfme/health)"
else
    echo "WARNING: Server may not have started. Check /tmp/pdfme-server.log"
fi

echo ""
echo "==========================================="
echo "  Setup Complete!"
echo "==========================================="
echo ""
echo "Project structure:"
echo "  packages/erp-schemas/   - ERP schema plugins (@pdfme-erp/schemas)"
echo "  nest-module/            - NestJS integration (@pdfme-erp/nest)"
echo "  apps/designer-sandbox/  - Next.js designer dev harness"
echo "  packages/ui/            - Forked pdfme designer UI"
echo ""
echo "Key commands:"
echo "  npm run build          - Build all packages"
echo "  npm test               - Run all tests"
echo ""
echo "API endpoints:"
echo "  GET  http://localhost:3000/api/pdfme/health     - Health check"
echo "  GET  http://localhost:3000/api/pdfme/templates   - List templates"
echo "  POST http://localhost:3000/api/pdfme/templates   - Create template"
echo ""
echo "Required services (running via Docker):"
echo "  PostgreSQL 15+ on localhost:5432"
echo "  Redis 7+ on localhost:6379"
echo ""
