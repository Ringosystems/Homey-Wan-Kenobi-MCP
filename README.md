# Homey MCP Server

[![CI](https://github.com/homey-mcp/homey-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/homey-mcp/homey-mcp/actions/workflows/ci.yml)

MCP server for controlling [Homey Pro](https://homey.app/) smart home systems through the [Model Context Protocol](https://modelcontextprotocol.io/).

60 tools and 3 knowledge prompts for device control, flow authoring, automation, monitoring, troubleshooting, network diagnostics, and self-hosted deployment.

## Quick Start

```bash
git clone https://github.com/homey-mcp/homey-mcp.git
cd homey-mcp
npm install
npm run build
```

Authenticate with your Homey:

```bash
npx homey login
npx homey select
```

Add to your MCP client config (Kiro, Claude Desktop, Cline, etc.):

```json
{
  "mcpServers": {
    "homey": {
      "command": "node",
      "args": ["/path/to/homey-mcp/dist/index.js"]
    }
  }
}
```

## Authentication

The server supports two authentication methods:

**Homey CLI (recommended)** runs `npx homey login` and `npx homey select`. The server reads the stored OAuth token from `~/.athom-cli/settings.json` automatically.

**Local API Key** is created at [my.homey.app](https://my.homey.app/settings/system/api-keys). Set environment variables:

```bash
export HOMEY_ADDRESS=http://192.168.1.x
export HOMEY_TOKEN=your-api-key
```

The local API key method is the recommended choice when running self-hosted in a container, since it does not depend on a mounted CLI settings file.

## Self-Hosted (Docker / HTTP)

Run the server as a long-lived HTTP service instead of a per-client stdio process. The container wraps the stdio server with [supergateway](https://github.com/supercorp-ai/supergateway) and exposes it as streamable-HTTP at `/mcp`, with a health endpoint at `/healthz`. The image is published at [`ringosystems/homey-wan-kenobi`](https://hub.docker.com/r/ringosystems/homey-wan-kenobi), built on `node:22-alpine`, runs as a non-root user, and ships no baked-in secrets. See [SECURITY.md](SECURITY.md) for the audit details.

### Pull from Docker Hub

```bash
docker run -d -p 8000:8000 \
  -e HOMEY_ADDRESS=http://192.168.1.x \
  -e HOMEY_TOKEN=your-local-api-key \
  --restart unless-stopped \
  ringosystems/homey-wan-kenobi:latest
```

### Docker Compose

Supply your Homey credentials via a `.env` file next to `docker-compose.yml`:

```bash
cat > .env <<'EOF'
HOMEY_ADDRESS=http://192.168.1.x
HOMEY_TOKEN=your-local-api-key
EOF

# Pull the published image, or add --build to build locally instead
docker compose up -d
```

The provided `docker-compose.yml` references the published image (with `build: .` as a local-build fallback) and applies container hardening (read-only root filesystem, dropped Linux capabilities, `no-new-privileges`, and memory/PID limits):

```yaml
services:
  homey-mcp:
    image: ringosystems/homey-wan-kenobi:latest
    build: .
    container_name: homey-mcp
    ports:
      - "8000:8000"
    environment:
      HOMEY_ADDRESS: "${HOMEY_ADDRESS:-http://192.168.1.x}"
      HOMEY_TOKEN: "${HOMEY_TOKEN:-}"
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /tmp
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    mem_limit: 256m
    pids_limit: 128
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:8000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
```

### Build locally

```bash
docker build -t ringosystems/homey-wan-kenobi .
docker run -d -p 8000:8000 \
  -e HOMEY_ADDRESS=http://192.168.1.x \
  -e HOMEY_TOKEN=your-local-api-key \
  --restart unless-stopped \
  ringosystems/homey-wan-kenobi
```

### Connecting a client

Point an MCP client at the streamable-HTTP endpoint:

```json
{
  "mcpServers": {
    "homey": {
      "type": "streamable-http",
      "url": "http://your-host:8000/mcp"
    }
  }
}
```

Check health with `curl http://your-host:8000/healthz`.

## Tools

### Devices

| Tool | Description |
|------|-------------|
| `list_devices` | List devices with live capability values, filter by zone or class |
| `get_device` | Get full device details and all capability values by ID |
| `search_devices` | Search devices by name, class, or capability |
| `set_device_capability` | Control a device (onoff, dim, target_temperature, volume_set, etc.) |

### Device & Zone Management

| Tool | Description |
|------|-------------|
| `rename_device` | Rename a device |
| `move_device_to_zone` | Move a device to a different zone (room) |
| `create_zone` | Create a new zone, optionally nested under a parent |

### Zones

| Tool | Description |
|------|-------------|
| `list_zones` | List all zones (rooms/areas) with their hierarchy |

### Flows

| Tool | Description |
|------|-------------|
| `list_flows` | List simple and advanced flows with enabled/broken status |
| `trigger_flow` | Run a flow immediately |
| `set_flow_enabled` | Enable or disable a flow |

### Flow Authoring

| Tool | Description |
|------|-------------|
| `get_flow` | Get a standard WHEN/AND/THEN flow definition by ID |
| `create_flow` | Create a standard flow from trigger/conditions/actions |
| `update_flow` | Update fields of a standard flow |
| `delete_flow` | Permanently delete a standard flow |
| `get_advanced_flow` | Get an Advanced Flow definition (cards, args, connections) |
| `create_advanced_flow` | Create an Advanced Flow from a cards graph |
| `update_advanced_flow` | Update an Advanced Flow (replaces the cards graph) |
| `delete_advanced_flow` | Permanently delete an Advanced Flow |

### Flow Card Discovery

| Tool | Description |
|------|-------------|
| `list_flow_cards` | List trigger/condition/action cards, filtered by substring |
| `get_flow_card` | Get one flow card's full definition and argument schema |

### Logic & Apps

| Tool | Description |
|------|-------------|
| `list_variables` | List logic variables with current values |
| `set_variable` | Set a logic variable value |
| `list_apps` | List installed apps with version, status, and origin |
| `restart_app` | Restart a Homey app |
| `enable_app` | Enable or disable an app |
| `uninstall_app` | Uninstall an app and remove its devices |

### Insights & Energy

| Tool | Description |
|------|-------------|
| `list_insights` | List available insight logs |
| `get_insight_entries` | Get historical sensor/meter data over a time range |
| `get_energy_live` | Live power consumption by zone and device |
| `get_energy_report` | Energy report for day/week/month/year |

### Weather, Presence & Location

| Tool | Description |
|------|-------------|
| `get_weather` | Current weather at Homey's location |
| `get_weather_hourly` | Hourly weather forecast |
| `get_presence` | Home/away and awake/asleep status for all users |
| `set_presence` | Set your own presence or sleep state |
| `get_location` | Homey's configured geographic location |

### Alarms & Moods

| Tool | Description |
|------|-------------|
| `list_alarms` | List all alarms and timers |
| `set_alarm` | Create or update an alarm |
| `delete_alarm` | Delete an alarm |
| `list_moods` | List moods (scenes) per zone |
| `set_mood` | Activate a mood in a zone |

### Notifications

| Tool | Description |
|------|-------------|
| `list_notifications` | List the 50 most recent notifications |
| `create_notification` | Send a notification to the Homey timeline |

### Network Diagnostics

| Tool | Description |
|------|-------------|
| `diagnose_zigbee_network` | Zigbee mesh health, per-node last-seen, issues and remediations |
| `diagnose_zwave_network` | Z-Wave health, transmit failures, unavailable nodes, remediations |
| `get_zwave_log` | Raw recent Z-Wave network log for troubleshooting |

### App Usage Analysis

| Tool | Description |
|------|-------------|
| `analyze_app_usage` | Cross-reference apps against RAM, devices, and flow references to flag removal candidates (advisory, read-only) |

### System & Infrastructure

| Tool | Description |
|------|-------------|
| `get_system_info` | System info (version, wifi, hostname, hardware) |
| `list_drivers` | List all available device drivers |
| `get_backup_status` | Backup config and last backup time |
| `create_backup` | Schedule a new backup |
| `get_ledring` | LED ring screensaver options and current setting |
| `set_ledring` | Set the LED ring screensaver |
| `get_updates` | Check for system updates and update settings |
| `get_session` | Current API session info (user, role, scopes) |
| `reboot_homey` | Reboot the Homey Pro |
| `get_memory_info` | Memory usage by app and component |
| `get_storage_info` | Storage usage breakdown |
| `set_system_name` | Set the Homey system name |

### Advanced

| Tool | Description |
|------|-------------|
| `homey_api_call` | Raw escape hatch to call any Homey Web API endpoint directly |

## Prompts

Built-in knowledge prompts accessible via the MCP prompts API:

| Prompt | Description |
|--------|-------------|
| `homey_best_practices` | Zone architecture, device naming, protocol tips, energy management, security |
| `homey_troubleshooting` | Diagnosing offline devices, Z-Wave/Zigbee issues, flow debugging, performance |
| `homey_flow_patterns` | Automation patterns, naming conventions, anti-patterns to avoid |

## Development

```bash
npm run dev        # Run with tsx (no build step)
npm run build      # Compile TypeScript
npm run lint       # ESLint
npm run typecheck  # TypeScript strict check
npm start          # Run compiled version
```

## Tech Stack

- TypeScript + Node.js (>=20)
- [homey-api](https://www.npmjs.com/package/homey-api) v3, the official Homey Web API client
- [@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk) v1.29, MCP server (`registerTool` with `ToolAnnotations`)
- [zod](https://www.npmjs.com/package/zod) for parameter validation
- [supergateway](https://github.com/supercorp-ai/supergateway) for the self-hosted streamable-HTTP transport

## Security

The dependency tree, base image, and container configuration are audited with [Trivy](https://trivy.dev/) and `npm audit`. The published image runs as a non-root user on `node:22-alpine` with no baked-in secrets, and the production dependencies ship with 0 high or critical advisories. See [SECURITY.md](SECURITY.md) for the full audit, accepted residual risks, and how to reproduce the scans.

## License

[MIT](LICENSE)
