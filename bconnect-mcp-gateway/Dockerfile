# bconnect-mcp-gateway — unified MCP HTTP gateway
#
# Build context: parent directory (bConnect-MCP/)
#   docker build -f bconnect-mcp-gateway/Dockerfile .
#
# The gateway imports all 13 MCP servers via file: deps, so the build
# context must include the sibling server directories.

FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS builder
WORKDIR /app

# Copy each server: package files, tsconfig, and source.
# Using separate COPY for src/ to preserve directory structure.
COPY bconnect-activedirectory-mcp/package*.json bconnect-activedirectory-mcp/tsconfig.json bconnect-activedirectory-mcp/
COPY bconnect-activedirectory-mcp/src/ bconnect-activedirectory-mcp/src/

COPY bconnect-assets-mcp/package*.json bconnect-assets-mcp/tsconfig.json bconnect-assets-mcp/
COPY bconnect-assets-mcp/src/ bconnect-assets-mcp/src/

COPY bconnect-compliance-mcp/package*.json bconnect-compliance-mcp/tsconfig.json bconnect-compliance-mcp/
COPY bconnect-compliance-mcp/src/ bconnect-compliance-mcp/src/

COPY bconnect-defensecontrol-mcp/package*.json bconnect-defensecontrol-mcp/tsconfig.json bconnect-defensecontrol-mcp/
COPY bconnect-defensecontrol-mcp/src/ bconnect-defensecontrol-mcp/src/

COPY bconnect-endpoints-mcp/package*.json bconnect-endpoints-mcp/tsconfig.json bconnect-endpoints-mcp/
COPY bconnect-endpoints-mcp/src/ bconnect-endpoints-mcp/src/

COPY bconnect-groups-mcp/package*.json bconnect-groups-mcp/tsconfig.json bconnect-groups-mcp/
COPY bconnect-groups-mcp/src/ bconnect-groups-mcp/src/

COPY bconnect-jobs-mcp/package*.json bconnect-jobs-mcp/tsconfig.json bconnect-jobs-mcp/
COPY bconnect-jobs-mcp/src/ bconnect-jobs-mcp/src/

COPY bconnect-operatingsystems-mcp/package*.json bconnect-operatingsystems-mcp/tsconfig.json bconnect-operatingsystems-mcp/
COPY bconnect-operatingsystems-mcp/src/ bconnect-operatingsystems-mcp/src/

COPY bconnect-servermanagement-mcp/package*.json bconnect-servermanagement-mcp/tsconfig.json bconnect-servermanagement-mcp/
COPY bconnect-servermanagement-mcp/src/ bconnect-servermanagement-mcp/src/

COPY bconnect-software-mcp/package*.json bconnect-software-mcp/tsconfig.json bconnect-software-mcp/
COPY bconnect-software-mcp/src/ bconnect-software-mcp/src/

COPY bconnect-universaldynamicgroups-mcp/package*.json bconnect-universaldynamicgroups-mcp/tsconfig.json bconnect-universaldynamicgroups-mcp/
COPY bconnect-universaldynamicgroups-mcp/src/ bconnect-universaldynamicgroups-mcp/src/

COPY bconnect-updatemanagement-mcp/package*.json bconnect-updatemanagement-mcp/tsconfig.json bconnect-updatemanagement-mcp/
COPY bconnect-updatemanagement-mcp/src/ bconnect-updatemanagement-mcp/src/

COPY bconnect-variables-mcp/package*.json bconnect-variables-mcp/tsconfig.json bconnect-variables-mcp/
COPY bconnect-variables-mcp/src/ bconnect-variables-mcp/src/

# Install + build each server (gateway's file: deps reference these)
# --force: some servers have platform-specific optional deps (e.g.
# @rollup/rollup-linux-arm64-gnu) that fail on x64. These are devDeps
# not needed at runtime.
RUN set -e; for dir in bconnect-*-mcp; do \
      echo "=== Building $dir ===" && \
      cd /app/$dir && npm ci --force && npm run build && \
      cd /app; \
    done

# Gateway
COPY bconnect-mcp-gateway/package*.json bconnect-mcp-gateway/tsconfig.json bconnect-mcp-gateway/
COPY bconnect-mcp-gateway/src/ bconnect-mcp-gateway/src/

# npm uses .gitignore when no .npmignore exists. The root .gitignore
# excludes build/, which prevents file: deps from including the compiled
# output. Create empty .npmignore in each server so build/ is included.
RUN for dir in /app/bconnect-*-mcp; do touch "$dir/.npmignore"; done

WORKDIR /app/bconnect-mcp-gateway
RUN npm install && npm run build

# ── Runtime stage ────────────────────────────────────────────────
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293
WORKDIR /app

RUN addgroup -S bconnect && adduser -S bconnect -G bconnect

# Copy all built servers (gateway's file: deps resolve to these)
COPY --from=builder /app/bconnect-activedirectory-mcp /app/bconnect-activedirectory-mcp
COPY --from=builder /app/bconnect-assets-mcp /app/bconnect-assets-mcp
COPY --from=builder /app/bconnect-compliance-mcp /app/bconnect-compliance-mcp
COPY --from=builder /app/bconnect-defensecontrol-mcp /app/bconnect-defensecontrol-mcp
COPY --from=builder /app/bconnect-endpoints-mcp /app/bconnect-endpoints-mcp
COPY --from=builder /app/bconnect-groups-mcp /app/bconnect-groups-mcp
COPY --from=builder /app/bconnect-jobs-mcp /app/bconnect-jobs-mcp
COPY --from=builder /app/bconnect-operatingsystems-mcp /app/bconnect-operatingsystems-mcp
COPY --from=builder /app/bconnect-servermanagement-mcp /app/bconnect-servermanagement-mcp
COPY --from=builder /app/bconnect-software-mcp /app/bconnect-software-mcp
COPY --from=builder /app/bconnect-universaldynamicgroups-mcp /app/bconnect-universaldynamicgroups-mcp
COPY --from=builder /app/bconnect-updatemanagement-mcp /app/bconnect-updatemanagement-mcp
COPY --from=builder /app/bconnect-variables-mcp /app/bconnect-variables-mcp

# Copy gateway
COPY --from=builder /app/bconnect-mcp-gateway /app/bconnect-mcp-gateway

WORKDIR /app/bconnect-mcp-gateway
USER bconnect

ENV NODE_ENV=production
ENV MCP_GATEWAY_PORT=3001
ENV MCP_GATEWAY_BIND=0.0.0.0

EXPOSE 3001

CMD ["node", "--import", "./build/preload.js", "build/gateway.js"]
