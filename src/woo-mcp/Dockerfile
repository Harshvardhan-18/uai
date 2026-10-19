# Multi-stage Dockerfile for woo-mcp
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json tsconfig.json ./
RUN npm install

COPY src/ ./src/
RUN npm run build

# Runner stage
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

# Non-root user (node user has UID/GID 1000)
USER node

EXPOSE 8000

CMD ["node", "dist/index.js"]
