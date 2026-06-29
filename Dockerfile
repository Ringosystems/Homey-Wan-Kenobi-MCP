FROM node:20-slim

WORKDIR /app

# Install deps (incl. dev deps for the TypeScript build)
COPY package*.json ./
RUN npm ci

# Build the stdio MCP server
COPY . .
RUN npm run build \
 && npm prune --omit=dev \
 && npm install -g supergateway

# supergateway wraps the stdio server and exposes it as streamable-HTTP at /mcp
EXPOSE 8000
ENV HOMEY_ADDRESS="" \
    HOMEY_TOKEN="" \
    NODE_ENV=production

CMD ["supergateway", \
     "--stdio", "node dist/index.js", \
     "--outputTransport", "streamableHttp", \
     "--port", "8000", \
     "--streamableHttpPath", "/mcp", \
     "--healthEndpoint", "/healthz"]
