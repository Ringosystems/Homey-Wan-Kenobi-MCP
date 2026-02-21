# Homey MCP Server

[![CI](https://github.com/homey-mcp/homey-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/homey-mcp/homey-mcp/actions/workflows/ci.yml)

MCP server for controlling [Homey Pro](https://homey.app/) smart home systems through the [Model Context Protocol](https://modelcontextprotocol.io/).

43 tools and 3 knowledge prompts for device control, automation, monitoring, troubleshooting, and more.

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

**Homey CLI (recommended)** — Run `npx homey login` and `npx homey select`. The server reads the stored OAuth token from `~/.athom-cli/settings.json` automatically.

**Local API Key** — Create an API key at [my.homey.app](https://my.homey.app/settings/system/api-keys), then set environment variables:

```bash
export HOMEY_ADDRESS=http://192.168.1.x
export HOMEY_TOKEN=your-api-key
```

## Tools

### Devices

| Tool | Description |
|------|-------------|
| `list_devices` | List devices, filter by zone or class |
| `get_device` | Get device details with all capability values |
| `search_devices` | Search by name, class, or capability |
| `set_device_capability` | Control a device (on/off, dim, temperature, etc.) |

### Zones & Flows

| Tool | Description |
|------|-------------|
| `list_zones` | List all zones (rooms/areas) |
| `list_flows` | List simple and advanced flows |
| `trigger_flow` | Run a flow |
| `set_flow_enabled` | Enable or disable a flow |

### Logic & Apps

| Tool | Description |
|------|-------------|
| `list_variables` | List logic variables |
| `set_variable` | Set a variable value |
| `list_apps` | List installed apps |
| `restart_app` | Restart a Homey app |
| `enable_app` | Enable or disable an app |
| `uninstall_app` | Uninstall an app |

### Insights & Energy

| Tool | Description |
|------|-------------|
| `list_insights` | List available insight logs |
| `get_insight_entries` | Get historical sensor data |
| `get_energy_live` | Live power consumption by zone/device |
| `get_energy_report` | Energy report for day/week/month/year |

### Weather & Presence

| Tool | Description |
|------|-------------|
| `get_weather` | Current weather at Homey's location |
| `get_weather_hourly` | Hourly weather forecast |
| `get_presence` | Home/away status for all users |
| `set_presence` | Set your presence or sleep state |
| `get_location` | Homey's configured location |

### Alarms & Moods

| Tool | Description |
|------|-------------|
| `list_alarms` | List all alarms/timers |
| `set_alarm` | Create or update an alarm |
| `delete_alarm` | Delete an alarm |
| `list_moods` | List moods (scenes) per zone |
| `set_mood` | Activate a mood in a zone |

### Notifications & System

| Tool | Description |
|------|-------------|
| `list_notifications` | List recent notifications |
| `create_notification` | Send a notification |
| `get_system_info` | System info (version, wifi, hostname) |

### Infrastructure & Protocols

| Tool | Description |
|------|-------------|
| `list_drivers` | List all available device drivers |
| `get_zwave_log` | Z-Wave network log for troubleshooting |
| `get_backup_status` | Backup config and last backup time |
| `create_backup` | Schedule a new backup |
| `get_ledring` | LED ring screensaver options |
| `set_ledring` | Set LED ring screensaver |
| `get_updates` | Check for system updates |
| `get_session` | Current API session info |
| `reboot_homey` | Reboot the Homey Pro |
| `get_memory_info` | Memory usage by app/component |
| `get_storage_info` | Storage usage breakdown |
| `set_system_name` | Set the Homey system name |

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

- TypeScript + Node.js (≥20)
- [homey-api](https://www.npmjs.com/package/homey-api) v3 — Official Homey Web API client
- [@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk) v1.26 — MCP server (`registerTool` with `ToolAnnotations`)
- [zod](https://www.npmjs.com/package/zod) — Parameter validation

## License

[MIT](LICENSE)
