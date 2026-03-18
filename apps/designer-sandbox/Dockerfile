# Stage 1: Install dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/common/package.json packages/common/
COPY packages/generator/package.json packages/generator/
COPY packages/schemas/package.json packages/schemas/
COPY packages/converter/package.json packages/converter/
COPY packages/pdf-lib/package.json packages/pdf-lib/
COPY packages/erp-schemas/package.json packages/erp-schemas/
COPY packages/ui/package.json packages/ui/
COPY apps/designer-sandbox/package.json apps/designer-sandbox/
RUN npm ci --ignore-scripts

# Stage 2: Build upstream packages + designer
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build upstream packages in order
RUN npm run build:pdf-lib 2>/dev/null || true
RUN npm run build:common 2>/dev/null || true
RUN npm run build:converter 2>/dev/null || true
RUN npm run build:schemas 2>/dev/null || true
RUN npm run build:generator 2>/dev/null || true
# Build erp-schemas
RUN cd packages/erp-schemas && npx tsc 2>/dev/null || true

# Set build-time env for Next.js static optimization
ENV NEXT_PUBLIC_API_BASE=http://localhost:3001/api/pdfme
ENV NEXT_TELEMETRY_DISABLED=1

# Build the Next.js app
RUN cd apps/designer-sandbox && npx next build

# Stage 3: Production image
FROM node:20-alpine AS runner
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/designer-sandbox/.next ./apps/designer-sandbox/.next
COPY --from=builder /app/apps/designer-sandbox/package.json ./apps/designer-sandbox/package.json
COPY --from=builder /app/apps/designer-sandbox/next.config.js ./apps/designer-sandbox/next.config.js
COPY --from=builder /app/apps/designer-sandbox/public ./apps/designer-sandbox/public 2>/dev/null || true
COPY --from=builder /app/package.json ./package.json

ENV PORT=3000
ENV NEXT_PUBLIC_API_BASE=http://localhost:3001/api/pdfme
EXPOSE 3000

WORKDIR /app/apps/designer-sandbox
CMD ["npx", "next", "start", "-p", "3000"]
