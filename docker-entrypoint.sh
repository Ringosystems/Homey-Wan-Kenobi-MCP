#!/bin/sh
set -e

# Transport selection:
#   default            -> stdio MCP server (for `docker run -i` MCP clients and the MCP Registry)
#   MCP_TRANSPORT=http  -> long-lived streamable-HTTP service via supergateway (self-hosted)
case "${MCP_TRANSPORT:-stdio}" in
  streamable-http|http)
    exec supergateway \
      --stdio "node dist/index.js" \
      --outputTransport streamableHttp \
      --port "${MCP_PORT:-8000}" \
      --streamableHttpPath /mcp \
      --healthEndpoint /healthz
    ;;
  stdio)
    exec node dist/index.js
    ;;
  *)
    echo "Unknown MCP_TRANSPORT '${MCP_TRANSPORT}' (use 'stdio' or 'streamable-http')" >&2
    exit 1
    ;;
esac
