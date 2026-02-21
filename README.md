# Homey MCP Server

MCP server for controlling [Homey Pro](https://homey.app/) smart home systems. Provides 43 tools and 3 knowledge prompts for device control, automation, monitoring, troubleshooting, and more through the [Model Context Protocol](https://modelcontextprotocol.io/).

## Features

- **Devices** — List, search, get details, and control devices (on/off, dim, temperature, etc.)
- **Zones** — List all rooms and areas
- **Flows** — List, trigger, enable/disable automations (simple + advanced)
- **Variables** — Read and set logic variables
- **Apps** — List installed apps
- **Insights** — Browse sensor history and get historical data
- **Energy** — Live power consumption and daily/weekly/monthly/yearly reports
- **Weather** — Current conditions and hourly forecast
- **Presence** — Home/away and awake/asleep status per user
- **Alarms** — List, create, update, and delete alarms
- **Moods** — List and activate scenes/presets per zone
- **Notifications** — Read and create notifications
- **System** — System info, geolocation, updates, backups, LED ring, sessions
- **Protocols** — Z-Wave log, driver listing for troubleshooting
- **Knowledge** — Built-in prompts for best practices, troubleshooting, and flow patterns

## Setup

### 1. Install

```bash
npm install
npm run build
```

### 2. Authenticate with Homey

**Option A: Homey CLI (recommended)**

```bash
npx homey login
npx homey select
```

The server automatically reads the stored OAuth token from `~/.athom-cli/settings.json`.

**Option B: Local API Key**

Create an API key at [my.homey.app/settings/system/api-keys](https://my.homey.app/settings/system/api-keys), then set environment variables:

```bash
export HOMEY_ADDRESS=http://192.168.1.x  # Your Homey's local IP
export HOMEY_TOKEN=your-api-key
```

### 3. Configure your MCP client

**Kiro / Claude Desktop / Cline:**

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
| `restart_app` | Restart a Homey app |
| `enable_app` | Enable or disable an app |
| `uninstall_app` | Uninstall an app |

## Prompts

The server includes built-in knowledge prompts accessible via the MCP prompts API:

| Prompt | Description |
|--------|-------------|
| `homey_best_practices` | Zone architecture, device naming, protocol tips (Z-Wave/Zigbee), energy management, security, performance |
| `homey_troubleshooting` | Diagnosing offline devices, Z-Wave/Zigbee issues, flow debugging, performance problems |
| `homey_flow_patterns` | Automation patterns (presence, motion lighting, climate), naming conventions, anti-patterns to avoid |

## Development

```bash
npm run dev    # Run with tsx (no build step)
npm run build  # Compile TypeScript
npm start      # Run compiled version
```

## Tech Stack

- TypeScript + Node.js
- [homey-api](https://www.npmjs.com/package/homey-api) v3 — Official Homey Web API client
- [@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk) v1.26 — MCP server with `McpServer` class
- [zod](https://www.npmjs.com/package/zod) — Tool parameter validation

## License

MIT
