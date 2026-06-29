# syntax=docker/dockerfile:1

# ---------- Build stage ----------
# Alpine base carries far fewer OS CVEs than the Debian slim image, and the
# whole dependency tree is pure JavaScript so musl libc is not a concern.
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- Runtime stage ----------
FROM node:22-alpine AS runtime

# Pick up the latest OS security patches available at build time.
RUN apk upgrade --no-cache

ENV NODE_ENV=production
WORKDIR /app

# Install only production dependencies plus the supergateway HTTP wrapper, then
# remove npm itself. It is not needed at runtime, and dropping it strips the
# vulnerabilities that ship inside the bundled npm CLI from the final image.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
 && npm install -g supergateway \
 && npm cache clean --force \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY --from=builder /app/dist ./dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

LABEL org.opencontainers.image.title="homey-mcp" \
      org.opencontainers.image.description="MCP server for Homey Pro smart home control (60 tools, 3 prompts)" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="https://github.com/Ringosystems/homey-mcp" \
      org.opencontainers.image.url="https://github.com/Ringosystems/homey-mcp" \
      org.opencontainers.image.vendor="Steeves and Associates" \
      io.modelcontextprotocol.server.name="io.github.Ringosystems/homey-mcp"

# Default transport is stdio (MCP clients via `docker run -i`, and the MCP Registry).
# Set MCP_TRANSPORT=streamable-http to expose a long-lived HTTP service on this port
# (path /mcp, health at /healthz).
EXPOSE 8000

# Credentials are supplied at runtime (compose env / docker run -e), never baked
# into the image. Run as the unprivileged 'node' user shipped by the base image.
USER node

# Health check applies to HTTP mode; stdio containers report healthy immediately.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "const t=process.env.MCP_TRANSPORT||'stdio'; if(t!=='streamable-http'&&t!=='http')process.exit(0); fetch('http://localhost:'+(process.env.MCP_PORT||8000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
