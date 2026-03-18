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
echo "Required services:"
echo "  PostgreSQL 15+ on localhost:5432"
echo "  Redis 7+ on localhost:6379"
echo ""
