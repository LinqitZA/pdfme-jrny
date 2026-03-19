# Stage 1: Install dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/common/package.json packages/common/
COPY packages/generator/package.json packages/generator/
COPY packages/schemas/package.json packages/schemas/
COPY packages/converter/package.json packages/converter/
COPY packages/pdf-lib/package.json packages/pdf-lib/
COPY packages/manipulator/package.json packages/manipulator/
COPY packages/ui/package.json packages/ui/
COPY packages/erp-schemas/package.json packages/erp-schemas/
COPY apps/designer-sandbox/package.json apps/designer-sandbox/
COPY nest-module/package.json nest-module/
RUN npm ci --ignore-scripts

# Stage 2: Build upstream packages + nest-module
FROM node:20-alpine AS builder
WORKDIR /app
#COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app ./
COPY . .
# Build upstream packages in order
RUN npm run build:pdf-lib
RUN npm run build:common
RUN npm run build:converter
RUN npm run build:schemas
RUN npm run build:generator
# Build erp-schemas
RUN cd packages/erp-schemas && npx tsc
# Build nest-module
RUN cd nest-module && npx tsc

# Stage 3: Production image
FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache curl

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/nest-module/dist ./nest-module/dist
COPY --from=builder /app/nest-module/package.json ./nest-module/package.json
COPY --from=builder /app/nest-module/node_modules ./nest-module/node_modules
COPY --from=builder /app/package.json ./package.json

ENV PORT=3001
EXPOSE 3001

CMD ["node", "nest-module/dist/main.js"]
