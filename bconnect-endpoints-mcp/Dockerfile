FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2
WORKDIR /app

# Create non-root user for security
RUN addgroup -S bconnect && adduser -S bconnect -G bconnect

COPY --from=builder /app/build ./build
COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

USER bconnect

ENV NODE_ENV=production
ENV BCONNECT_BASE_URL=https://bms-server/bconnect
ENV BCONNECT_AUDIT_LEVEL=none
ENV MCP_TRANSPORT=http
ENV MCP_PORT=3000

EXPOSE 3000

CMD ["node", "build/index.js"]
