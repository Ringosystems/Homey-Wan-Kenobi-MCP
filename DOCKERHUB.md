# Homey-Wan-Kenobi MCP

A **Model Context Protocol (MCP)** server for **Homey Pro** smart home systems. It talks directly to the Homey Web API so an MCP client (Claude Code, Claude Desktop, Cline, Kiro) can control devices, author and trigger flows, read energy and insights, run Z-Wave/Zigbee network diagnostics, and manage the system, all in natural language.

> Independent project. Not affiliated with, endorsed by, or supported by Athom or Homey. "Homey" is a trademark of its respective owner.

- **Source and full docs:** https://github.com/Ringosystems/Homey-Wan-Kenobi-MCP
- **Security model and audit:** https://github.com/Ringosystems/Homey-Wan-Kenobi-MCP/blob/main/SECURITY.md
- **MCP Registry:** `io.github.Ringosystems/homey-wan-kenobi-mcp`
- **License:** MIT

## Tags

- `latest` and the exact version (e.g. `2.1.0`), Alpine based with a minimal CVE surface.

Also published to the GitHub Container Registry at `ghcr.io/ringosystems/homey-wan-kenobi`.

## What it does

60 tools and 3 knowledge prompts spanning:

| Area | Examples |
|------|----------|
| Devices and zones | list/search/control devices, rename, move, create zones |
| Flows | list, trigger, enable, and full create/update/delete for standard and Advanced Flows, plus flow-card discovery |
| Energy and insights | live power by zone/device, day/week/month/year reports, historical sensor data |
| Diagnostics | Z-Wave and Zigbee network health with remediations, app RAM/usage analysis |
| System | weather, presence, alarms, moods, notifications, backups, updates, reboot |

The full tool list lives in the [README](https://github.com/Ringosystems/Homey-Wan-Kenobi-MCP/blob/main/README.md).

## Run it (stdio, for an MCP client)

The image defaults to the stdio transport, so an MCP client can launch it directly:

```bash
docker run -i --rm \
  -e HOMEY_ADDRESS=http://192.168.1.10 \
  -e HOMEY_TOKEN=your-local-api-key \
  ringosystems/homey-wan-kenobi:latest
```

## Run it (persistent HTTP service)

Set `MCP_TRANSPORT=streamable-http` to expose the server over streamable-HTTP at `/mcp` (health at `/healthz`), wrapped by supergateway:

```bash
docker run -d --name homey-wan-kenobi -p 8000:8000 \
  -e MCP_TRANSPORT=streamable-http \
  -e HOMEY_ADDRESS=http://192.168.1.10 \
  -e HOMEY_TOKEN=your-local-api-key \
  --restart unless-stopped \
  ringosystems/homey-wan-kenobi:latest
```

A hardened `docker-compose.yml` (read-only rootfs, dropped capabilities, `no-new-privileges`, resource limits) is in the repo.

## Configuration

Required:

| Variable | Description |
|----------|-------------|
| `HOMEY_ADDRESS` | Base URL of your Homey Pro local API, e.g. `http://192.168.1.10` |
| `HOMEY_TOKEN` | Homey local API key, created at [my.homey.app](https://my.homey.app/settings/system/api-keys) |

Optional:

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_TRANSPORT` | `stdio` | Set to `streamable-http` for the persistent HTTP service |
| `MCP_PORT` | `8000` | HTTP port when `MCP_TRANSPORT=streamable-http` |

## Security

- Runs as a non-root user on `node:22-alpine`; no credentials are baked into the image.
- Dependencies, base image, and the built image are scanned with Trivy on every release and gated on HIGH/CRITICAL findings.
- The HTTP transport is unauthenticated. Keep it on a trusted LAN or front it with a reverse proxy that adds TLS and auth. See [SECURITY.md](https://github.com/Ringosystems/Homey-Wan-Kenobi-MCP/blob/main/SECURITY.md).

## More

Full setup, the complete tool list, authentication options, and client configuration are documented in the [README](https://github.com/Ringosystems/Homey-Wan-Kenobi-MCP/blob/main/README.md).
