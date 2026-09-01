# bconnect-mcp-gateway — unified MCP HTTP gateway
#
# Build context: the bConnect-MCP repo ROOT (npm workspaces monorepo).
#   docker build -f bconnect-mcp-gateway/Dockerfile .
#
# The gateway is NOT a workspace member; it depends on @bconnect/mcp-core and
# all 13 bconnect-*-mcp servers via file: deps. So the build installs the
# workspace at the root (single package-lock.json), builds the shared core and
# every server, then installs + builds the gateway with --install-links so its
# node_modules is self-contained and the runtime image needs only the gateway.

FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS builder
WORKDIR /app

# Source only — build/, node_modules and tests are excluded via .dockerignore.
COPY . .

# Install every workspace from the root lockfile (reproducible).
RUN npm ci

# Build the shared core first, then all 13 servers (+ template).
RUN npm run build -w @bconnect/mcp-core \
 && npm run build

# The root .gitignore excludes build/, which npm honours when packing file:
# deps. An empty .npmignore per package overrides that so the compiled build/
# output is included when the gateway installs them.
RUN for dir in packages/mcp-core bconnect-*-mcp; do touch "$dir/.npmignore"; done

# Build the gateway (compile only — do NOT `npm install` here). The gateway is
# not a workspace member, so a local install collides with the parent workspace
# and stubs shared deps. Every gateway dependency (express, the MCP SDK, core,
# and all 13 servers) is already in /app/node_modules from the root install, so
# tsc and the runtime resolve them by walking up from the gateway directory.
WORKDIR /app/bconnect-mcp-gateway
RUN npm run build \
 && rm -rf node_modules
# Removing the gateway's own (stub) node_modules lets Node resolve every import
# up at /app/node_modules — the real, hoisted express/SDK plus the workspace
# symlinks to core and the 13 servers.

# ── Runtime stage ────────────────────────────────────────────────
FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2

RUN addgroup -S bconnect && adduser -S bconnect -G bconnect

# Carry the whole built workspace so the gateway's file: links to the sibling
# server dirs (and hoisted deps) resolve. Owned by root, read-only to the
# non-root runtime user.
COPY --from=builder /app /app

WORKDIR /app/bconnect-mcp-gateway
USER bconnect

ENV NODE_ENV=production
ENV MCP_GATEWAY_PORT=3001

# SEC-7 — the bind defaults to LOOPBACK, not 0.0.0.0.
#
# This image used to set MCP_GATEWAY_BIND=0.0.0.0, and the shipped compose paired
# it with MCP_ALLOW_NO_AUTH=true. Together those two lines meant the gateway's
# own fail-closed guard was satisfied before the operator ever saw it: the
# artifact disarmed its own authentication.
#
# The image now ships the safe default and the compose file widens it explicitly,
# next to the MCP_GATEWAY_AUTH_TOKEN that makes widening legitimate. A published
# port cannot reach a loopback listener inside a container, so if you run this
# image directly you must set BOTH:
#
#   docker run -p 127.0.0.1:3001:3001 \
#     -e MCP_GATEWAY_BIND=0.0.0.0 \
#     -e MCP_GATEWAY_AUTH_TOKEN=<24+ random chars> \
#     ... bconnect-mcp-gateway
#
# Set MCP_GATEWAY_BIND=0.0.0.0 without a token and the gateway refuses to start
# and tells you how to generate one. That refusal is the feature.
ENV MCP_GATEWAY_IN_CONTAINER=true

EXPOSE 3001

CMD ["node", "--import", "./build/preload.js", "build/gateway.js"]
