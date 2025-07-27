FROM node:20-alpine AS base

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
COPY turbo.json ./

# Copy service package files
COPY services/orchestrator/package.json ./services/orchestrator/
COPY packages/*/package.json ./packages/*/

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application (this now includes frontend build)
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Copy built application
COPY --from=base /app/services/orchestrator/dist ./dist
COPY --from=base /app/services/orchestrator/dist-frontend ./frontend/dist
COPY --from=base /app/services/orchestrator/package.json ./

# Install production dependencies only
RUN npm ci --production

EXPOSE 3000

CMD ["node", "dist/index.js"]