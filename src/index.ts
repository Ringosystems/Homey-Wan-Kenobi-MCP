#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getHomeyApi } from "./homey.js";

const server = new McpServer({
  name: "homey-mcp",
  version: "2.0.0",
});

// ── Helpers ──────────────────────────────────────────────────────────

function fmtDevice(d: any, zones?: Record<string, any>) {
  const caps = d.capabilitiesObj ?? {};
  const values: Record<string, any> = {};
  for (const [k, v] of Object.entries(caps) as any[]) {
    if (v.value !== null && v.value !== undefined) {
      values[k] = v.units ? `${v.value} ${v.units}` : v.value;
    }
  }
  return {
    id: d.id,
    name: d.name,
    class: d.class,
    zone: zones?.[d.zone]?.name ?? d.zone,
    available: d.available,
    capabilities: d.capabilities,
    values,
  };
}

function json(data: any): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function err(msg: string): { content: [{ type: "text"; text: string }]; isError: true } {
  return { content: [{ type: "text", text: msg }], isError: true };
}

const READ = { readOnlyHint: true, destructiveHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true } as const;

// ── Devices ──────────────────────────────────────────────────────────

server.registerTool("list_devices", {
  title: "List Devices",
  description: "List all Homey devices with current capability values. Returns device ID, name, class, zone, availability, capabilities, and live sensor/state values. Use 'zone' to filter by room name (partial match) or 'class' to filter by device type (light, sensor, thermostat, speaker, lock, socket, etc).",
  inputSchema: {
    zone: z.string().optional().describe("Filter by zone name (partial match, e.g. 'kitchen')"),
    class: z.string().optional().describe("Filter by device class (e.g. light, sensor, thermostat, speaker, lock, socket)"),
  },
  annotations: READ,
}, async ({ zone, class: cls }) => {
  const api = await getHomeyApi();
  const zones = await api.zones.getZones();
  let devices = Object.values(await api.devices.getDevices()) as any[];
  if (zone) {
    const zl = zone.toLowerCase();
    devices = devices.filter((d) => zones[d.zone]?.name?.toLowerCase().includes(zl));
  }
  if (cls) {
    const cl = cls.toLowerCase();
    devices = devices.filter((d) => d.class?.toLowerCase().includes(cl));
  }
  return json({ total: devices.length, devices: devices.map((d) => fmtDevice(d, zones)) });
});

server.registerTool("get_device", {
  title: "Get Device Details",
  description: "Get detailed information about a specific device by ID, including all capability values, settings, and availability status. Use list_devices or search_devices first to find the device ID.",
  inputSchema: { id: z.string().describe("Device ID (UUID format)") },
  annotations: READ,
}, async ({ id }) => {
  const api = await getHomeyApi();
  const devices = await api.devices.getDevices();
  const d = devices[id];
  if (!d) return err(`Device ${id} not found`);
  const zones = await api.zones.getZones();
  return json(fmtDevice(d, zones));
});

server.registerTool("search_devices", {
  title: "Search Devices",
  description: "Search devices by name, device class, or capability name. Returns matching devices with their current values. Useful for finding devices when you don't know the exact ID — e.g. search 'temperature' to find all temperature sensors, or 'kitchen' to find devices with kitchen in the name.",
  inputSchema: { query: z.string().describe("Search text (matches against device name, class, and capability names)") },
  annotations: READ,
}, async ({ query }) => {
  const api = await getHomeyApi();
  const zones = await api.zones.getZones();
  const devices = Object.values(await api.devices.getDevices()) as any[];
  const q = query.toLowerCase();
  const matches = devices.filter((d) =>
    d.name?.toLowerCase().includes(q) ||
    d.class?.toLowerCase().includes(q) ||
    d.capabilities?.some((c: string) => c.toLowerCase().includes(q))
  );
  return json({ query, total: matches.length, devices: matches.map((d) => fmtDevice(d, zones)) });
});

server.registerTool("set_device_capability", {
  title: "Control Device",
  description: "Control a device by setting a capability value. Common capabilities: 'onoff' (boolean — turn on/off), 'dim' (number 0-1 — brightness), 'target_temperature' (number — thermostat setpoint), 'volume_set' (number 0-1). Use get_device first to see available capabilities and their current values.",
  inputSchema: {
    deviceId: z.string().describe("Device ID"),
    capability: z.string().describe("Capability ID (e.g. onoff, dim, target_temperature, volume_set)"),
    value: z.union([z.boolean(), z.number(), z.string()]).describe("Value to set (type depends on capability)"),
  },
  annotations: WRITE,
}, async ({ deviceId, capability, value }) => {
  const api = await getHomeyApi();
  const devices = await api.devices.getDevices();
  const device = devices[deviceId];
  if (!device) return err(`Device ${deviceId} not found`);
  await device.setCapabilityValue({ capabilityId: capability, value });
  return json({ success: true, device: device.name, capability, value });
});

// ── Zones ────────────────────────────────────────────────────────────

server.registerTool("list_zones", {
  title: "List Zones",
  description: "List all zones (rooms/areas) in the home with their hierarchy. Returns zone ID, name, parent zone, and icon. Zones are organized in a tree: Home → Floors → Rooms.",
  annotations: READ,
}, async () => {
  const api = await getHomeyApi();
  const zones = Object.values(await api.zones.getZones()) as any[];
  return json({ total: zones.length, zones: zones.map((z) => ({ id: z.id, name: z.name, parent: z.parent, icon: z.icon, active: z.active })) });
});

// ── Flows ────────────────────────────────────────────────────────────

server.registerTool("list_flows", {
  title: "List Flows",
  description: "List all automation flows (simple and advanced). Returns flow ID, name, enabled/broken status, and type. Flows are Homey's automations with WHEN/AND/THEN logic.",
  annotations: READ,
}, async () => {
  const api = await getHomeyApi();
  const flows = Object.values(await api.flow.getFlows()) as any[];
  let advancedFlows: any[] = [];
  try { advancedFlows = Object.values(await api.flow.getAdvancedFlows()) as any[]; } catch { /* may not be available */ }
  return json({
    flows: flows.map((f) => ({ id: f.id, name: f.name, enabled: f.enabled, broken: f.broken, type: "simple" })),
    advancedFlows: advancedFlows.map((f) => ({ id: f.id, name: f.name, enabled: f.enabled, broken: f.broken, type: "advanced" })),
  });
});

server.registerTool("trigger_flow", {
  title: "Trigger Flow",
  description: "Trigger (run) a flow immediately by its ID. Tries simple flow first, then advanced flow. Use list_flows to find the flow ID.",
  inputSchema: { id: z.string().describe("Flow ID") },
  annotations: WRITE,
}, async ({ id }) => {
  const api = await getHomeyApi();
  try { await api.flow.triggerFlow({ id }); return json({ success: true, id, type: "simple" }); } catch {
    try { await api.flow.triggerAdvancedFlow({ id }); return json({ success: true, id, type: "advanced" }); } catch (e: any) { return err(e.message); }
  }
});

server.registerTool("set_flow_enabled", {
  title: "Enable/Disable Flow",
  description: "Enable or disable a flow automation. Disabled flows won't trigger. Use list_flows to find the flow ID.",
  inputSchema: {
    id: z.string().describe("Flow ID"),
    enabled: z.boolean().describe("true to enable, false to disable"),
  },
  annotations: WRITE,
}, async ({ id, enabled }) => {
  const api = await getHomeyApi();
  try { await api.flow.updateFlow({ id, flow: { enabled } }); return json({ success: true, id, enabled, type: "simple" }); } catch {
    try { await api.flow.updateAdvancedFlow({ id, advancedflow: { enabled } }); return json({ success: true, id, enabled, type: "advanced" }); } catch (e: any) { return err(e.message); }
  }
});

// ── Logic Variables ──────────────────────────────────────────────────

server.registerTool("list_variables", {
  title: "List Logic Variables",
  description: "List all logic variables with their current values. Logic variables store state (boolean, number, string) that can be used in flow conditions and actions.",
  annotations: READ,
}, async () => {
  const api = await getHomeyApi();
  const vars = Object.values(await api.logic.getVariables()) as any[];
  return json({ total: vars.length, variables: vars.map((v) => ({ id: v.id, name: v.name, type: v.type, value: v.value })) });
});

server.registerTool("set_variable", {
  title: "Set Logic Variable",
  description: "Set the value of a logic variable. The value type must match the variable type (boolean, number, or string).",
  inputSchema: {
    id: z.string().describe("Variable ID"),
    value: z.union([z.boolean(), z.number(), z.string()]).describe("New value (must match variable type)"),
  },
  annotations: WRITE,
}, async ({ id, value }) => {
  const api = await getHomeyApi();
  await api.logic.updateVariable({ id, variable: { value } });
  return json({ success: true, id, value });
});

// ── Apps ─────────────────────────────────────────────────────────────

server.registerTool("list_apps", {
  title: "List Installed Apps",
  description: "List all installed Homey apps with version, enabled status, and origin (appstore or devkit). Apps provide device drivers, flow cards, and integrations.",
  annotations: READ,
}, async () => {
  const api = await getHomeyApi();
  const apps = Object.values(await api.apps.getApps()) as any[];
  return json({ total: apps.length, apps: apps.map((a) => ({ id: a.id, name: a.name, version: a.version, enabled: a.enabled, origin: a.origin })) });
});

server.registerTool("restart_app", {
  title: "Restart App",
  description: "Restart a Homey app. Useful when devices from that app are unresponsive. Use list_apps to find the app ID (e.g. 'com.fibaro').",
  inputSchema: { id: z.string().describe("App ID (e.g. com.fibaro, nl.philips.hue)") },
  annotations: WRITE,
}, async ({ id }) => {
  const api = await getHomeyApi();
  await api.apps.restartApp({ id });
  return json({ success: true, id });
});

server.registerTool("enable_app", {
  title: "Enable/Disable App",
  description: "Enable or disable a Homey app. Disabled apps won't run and their devices become unavailable.",
  inputSchema: {
    id: z.string().describe("App ID"),
    enabled: z.boolean().describe("true to enable, false to disable"),
  },
  annotations: WRITE,
}, async ({ id, enabled }) => {
  const api = await getHomeyApi();
  if (enabled) await api.apps.enableApp({ id }); else await api.apps.disableApp({ id });
  return json({ success: true, id, enabled });
});

server.registerTool("uninstall_app", {
  title: "Uninstall App",
  description: "Permanently uninstall a Homey app and remove all its devices. This cannot be undone.",
  inputSchema: { id: z.string().describe("App ID") },
  annotations: DESTRUCTIVE,
}, async ({ id }) => {
  const api = await getHomeyApi();
  await api.apps.uninstallApp({ id });
  return json({ success: true, id });
});


// ── Insights ─────────────────────────────────────────────────────────

server.registerTool("list_insights", {
  title: "List Insight Logs",
  description: "List all available insight logs (sensor history, energy meters, etc). Returns log ID, title, data type, and units. Use the log ID with get_insight_entries to retrieve historical data.",
  annotations: READ,
}, async () => {
  const api = await getHomeyApi();
  const logs = Object.values(await api.insights.getLogs()) as any[];
  return json({ total: logs.length, logs: logs.map((l) => ({ id: l.id, title: l.title, type: l.type, units: l.units })) });
});

server.registerTool("get_insight_entries", {
  title: "Get Insight History",
  description: "Get historical data points for an insight log. Returns timestamped values (e.g. temperature readings over time). Use list_insights first to find the log ID.",
  inputSchema: {
    id: z.string().describe("Insight log ID (from list_insights)"),
    resolution: z.enum(["last6Hours", "last24Hours", "last7Days", "last14Days", "last31Days", "last3Months", "lastYear"]).optional().describe("Time range (default: last24Hours)"),
  },
  annotations: READ,
}, async ({ id, resolution }) => {
  const api = await getHomeyApi();
  const entries = await api.insights.getLogEntries({ id, resolution: resolution ?? "last24Hours" });
  return json({ id, resolution: resolution ?? "last24Hours", entries: entries.values?.length ?? 0, values: entries.values });
});

// ── Energy ───────────────────────────────────────────────────────────

server.registerTool("get_energy_live", {
  title: "Live Energy Report",
  description: "Get real-time power consumption broken down by zone and device. Returns watts (W) currently being consumed. Useful for answering 'what is using power right now?'",
  annotations: READ,
}, async () => {
  const api = await getHomeyApi();
  return json(await api.energy.getLiveReport());
});

server.registerTool("get_energy_report", {
  title: "Energy Report",
  description: "Get energy consumption report for a specific period. Returns kWh consumed per device. Useful for 'how much energy did I use today/this week/this month?'",
  inputSchema: {
    period: z.enum(["day", "week", "month", "year"]).describe("Report period"),
    date: z.string().optional().describe("Date in YYYY-MM-DD format (default: today)"),
  },
  annotations: READ,
}, async ({ period, date }) => {
  const api = await getHomeyApi();
  const d = date ?? new Date().toISOString().split("T")[0];
  const fn = { day: "getReportDay", week: "getReportWeek", month: "getReportMonth", year: "getReportYear" }[period];
  return json(await api.energy[fn]({ date: d }));
});

// ── Weather ──────────────────────────────────────────────────────────

server.registerTool("get_weather", {
  title: "Current Weather",
  description: "Get current weather conditions at Homey's location. Returns temperature, humidity, pressure, wind, and weather state (e.g. 'clear sky', 'overcast clouds').",
  annotations: { ...READ, openWorldHint: true },
}, async () => {
  const api = await getHomeyApi();
  const w = await api.weather.getWeather();
  const { screensaver: _screensaver, ...weather } = w;
  return json(weather);
});

server.registerTool("get_weather_hourly", {
  title: "Hourly Weather Forecast",
  description: "Get hourly weather forecast at Homey's location. Returns temperature and weather conditions for upcoming hours.",
  annotations: { ...READ, openWorldHint: true },
}, async () => {
  const api = await getHomeyApi();
  return json(await api.weather.getWeatherHourly());
});

// ── Presence ─────────────────────────────────────────────────────────

server.registerTool("get_presence", {
  title: "Get Presence Status",
  description: "Get home/away and awake/asleep status for all household members. Useful for 'is anyone home?' or 'who is home?'",
  annotations: READ,
}, async () => {
  const api = await getHomeyApi();
  const users = Object.values(await api.users.getUsers()) as any[];
  return json({ users: users.map((u) => ({ id: u.id, name: u.name, present: u.present, asleep: u.asleep, role: u.role })) });
});

server.registerTool("set_presence", {
  title: "Set Presence",
  description: "Set your own presence (home/away) or sleep state (awake/asleep). This affects presence-based automations.",
  inputSchema: {
    present: z.boolean().optional().describe("true = home, false = away"),
    asleep: z.boolean().optional().describe("true = asleep, false = awake"),
  },
  annotations: WRITE,
}, async ({ present, asleep }) => {
  const api = await getHomeyApi();
  if (present !== undefined) await api.presence.setPresentMe({ present });
  if (asleep !== undefined) await api.presence.setAsleepMe({ asleep });
  return json({ success: true, present, asleep });
});

// ── Notifications ────────────────────────────────────────────────────

server.registerTool("list_notifications", {
  title: "List Notifications",
  description: "List the 50 most recent Homey notifications (app updates, alerts, system messages). Sorted newest first.",
  annotations: READ,
}, async () => {
  const api = await getHomeyApi();
  const notifs = Object.values(await api.notifications.getNotifications()) as any[];
  const sorted = notifs.sort((a, b) => new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime()).slice(0, 50);
  return json({ total: notifs.length, showing: sorted.length, notifications: sorted.map((n) => ({ id: n.id, excerpt: n.excerpt, dateCreated: n.dateCreated })) });
});

server.registerTool("create_notification", {
  title: "Send Notification",
  description: "Send a notification to the Homey timeline. Visible in the Homey app for all household members.",
  inputSchema: { excerpt: z.string().describe("Notification message text") },
  annotations: WRITE,
}, async ({ excerpt }) => {
  const api = await getHomeyApi();
  await api.notifications.createNotification({ excerpt });
  return json({ success: true, excerpt });
});

// ── Alarms ───────────────────────────────────────────────────────────

server.registerTool("list_alarms", {
  title: "List Alarms",
  description: "List all alarms and timers with their schedule and repetition days.",
  annotations: READ,
}, async () => {
  const api = await getHomeyApi();
  const alarms = Object.values(await api.alarms.getAlarms()) as any[];
  return json({ total: alarms.length, alarms: alarms.map((a) => ({ id: a.id, name: a.name, time: a.time, enabled: a.enabled, repetition: a.repetition })) });
});

server.registerTool("set_alarm", {
  title: "Create/Update Alarm",
  description: "Create a new alarm or update an existing one. Specify time in HH:MM format and optionally which days to repeat.",
  inputSchema: {
    id: z.string().optional().describe("Alarm ID (omit to create new)"),
    name: z.string().describe("Alarm name"),
    time: z.string().describe("Time in HH:MM format (24h)"),
    enabled: z.boolean().optional().describe("Enable/disable (default: true)"),
    repetition: z.object({ mon: z.boolean().optional(), tue: z.boolean().optional(), wed: z.boolean().optional(), thu: z.boolean().optional(), fri: z.boolean().optional(), sat: z.boolean().optional(), sun: z.boolean().optional() }).optional().describe("Days to repeat"),
  },
  annotations: WRITE,
}, async ({ id, name, time, enabled, repetition }) => {
  const api = await getHomeyApi();
  const alarm = { name, time, enabled: enabled ?? true, repetition: repetition ?? {} };
  if (id) { await api.alarms.updateAlarm({ id, alarm }); return json({ success: true, action: "updated", id }); }
  const created = await api.alarms.createAlarm({ alarm });
  return json({ success: true, action: "created", id: created.id });
});

server.registerTool("delete_alarm", {
  title: "Delete Alarm",
  description: "Permanently delete an alarm. Use list_alarms to find the alarm ID.",
  inputSchema: { id: z.string().describe("Alarm ID") },
  annotations: DESTRUCTIVE,
}, async ({ id }) => {
  const api = await getHomeyApi();
  await api.alarms.deleteAlarm({ id });
  return json({ success: true, id });
});

// ── Moods ────────────────────────────────────────────────────────────

server.registerTool("list_moods", {
  title: "List Moods",
  description: "List all moods (scenes/presets) per zone. Moods save device states that can be activated together (e.g. 'Movie Mode' dims lights and closes blinds).",
  annotations: READ,
}, async () => {
  const api = await getHomeyApi();
  const moods = Object.values(await api.moods.getMoods()) as any[];
  const zones = await api.zones.getZones();
  return json({ total: moods.length, moods: moods.map((m) => ({ id: m.id, name: m.name, zone: zones[m.zone]?.name ?? m.zone, zoneId: m.zone, devices: Object.keys(m.devices ?? {}).length })) });
});

server.registerTool("set_mood", {
  title: "Activate Mood",
  description: "Activate a mood (scene) in a zone. This sets all devices in the mood to their saved states.",
  inputSchema: {
    zoneId: z.string().describe("Zone ID"),
    moodId: z.string().describe("Mood ID"),
  },
  annotations: WRITE,
}, async ({ zoneId, moodId }) => {
  const api = await getHomeyApi();
  await api.moods.setMood({ zone: zoneId, mood: moodId });
  return json({ success: true, zoneId, moodId });
});

// ── System & Infrastructure ──────────────────────────────────────────

server.registerTool("get_system_info", {
  title: "System Information",
  description: "Get Homey system information including software version, hostname, Wi-Fi network, and hardware details.",
  annotations: READ,
}, async () => {
  const api = await getHomeyApi();
  return json(await api.system.getInfo());
});

server.registerTool("get_location", {
  title: "Get Location",
  description: "Get Homey's configured geographic location (address and GPS coordinates). Used for sunrise/sunset calculations and weather.",
  annotations: READ,
}, async () => {
  const api = await getHomeyApi();
  const [address, location] = await Promise.all([
    api.geolocation.getOptionAddress().catch(() => null),
    api.geolocation.getOptionLocation().catch(() => null),
  ]);
  return json({ address, location });
});

server.registerTool("list_drivers", {
  title: "List Drivers",
  description: "List all available device drivers (protocol integrations). Useful for troubleshooting — shows which drivers are ready.",
  annotations: READ,
}, async () => {
  const api = await getHomeyApi();
  const drivers = Object.values(await api.drivers.getDrivers()) as any[];
  return json({ total: drivers.length, drivers: drivers.map((d) => ({ id: d.id, name: d.name, ready: d.ready })) });
});

server.registerTool("get_zwave_log", {
  title: "Z-Wave Log",
  description: "Get recent Z-Wave network log entries. Shows transmit failures, routing issues, and network events. Essential for diagnosing Z-Wave device connectivity problems.",
  annotations: READ,
}, async () => {
  const api = await getHomeyApi();
  return json(await api.zwave.getLog());
});

server.registerTool("get_backup_status", {
  title: "Backup Status",
  description: "Get backup configuration and last successful backup timestamp.",
  annotations: READ,
}, async () => {
  const api = await getHomeyApi();
  const [autoEnabled, lastBackup] = await Promise.all([
    api.backup.getOptionAutomaticBackupsEnabled().catch(() => null),
    api.backup.getOptionLastSuccessfulBackup().catch(() => null),
  ]);
  return json({ automaticBackupsEnabled: autoEnabled?.value, lastSuccessfulBackup: lastBackup?.value });
});

server.registerTool("create_backup", {
  title: "Create Backup",
  description: "Schedule a new backup of the Homey configuration. Backup runs in the background.",
  annotations: WRITE,
}, async () => {
  const api = await getHomeyApi();
  await api.backup.scheduleBackup();
  return json({ success: true, message: "Backup scheduled" });
});

server.registerTool("get_ledring", {
  title: "LED Ring Status",
  description: "Get LED ring screensaver options and current setting.",
  annotations: READ,
}, async () => {
  const api = await getHomeyApi();
  const [screensavers, current] = await Promise.all([api.ledring.getScreensavers(), api.ledring.getOptionScreensaver().catch(() => null)]);
  return json({ current: current?.value, screensavers: Object.values(screensavers).map((s: any) => ({ id: s.id, name: s.name })) });
});

server.registerTool("set_ledring", {
  title: "Set LED Ring",
  description: "Set the LED ring screensaver animation. Use get_ledring to see available options (e.g. 'spectrum', 'off').",
  inputSchema: { screensaverId: z.string().describe("Screensaver ID (e.g. 'spectrum', 'off')") },
  annotations: WRITE,
}, async ({ screensaverId }) => {
  const api = await getHomeyApi();
  await api.ledring.setOptionScreensaver({ value: { uri: "homey:manager:ledring", id: screensaverId } });
  return json({ success: true, screensaverId });
});

server.registerTool("get_updates", {
  title: "Check Updates",
  description: "Check for available Homey system updates and current update settings (channel, auto-update).",
  annotations: READ,
}, async () => {
  const api = await getHomeyApi();
  const [channel, autoupdate, updates] = await Promise.all([
    api.updates.getOptionChannel().catch(() => null),
    api.updates.getOptionAutoupdate().catch(() => null),
    api.updates.getUpdates().catch(() => []),
  ]);
  return json({ channel: channel?.value, autoupdate: autoupdate?.value, pendingUpdates: updates });
});

server.registerTool("get_session", {
  title: "Session Info",
  description: "Get current API session details including authenticated user, role, and permission scopes.",
  annotations: READ,
}, async () => {
  const api = await getHomeyApi();
  const session = await api.sessions.getSessionMe();
  return json({ id: session.id, type: session.type, userId: session.userId, userName: session.userName, scopes: session.scopes });
});

server.registerTool("reboot_homey", {
  title: "Reboot Homey",
  description: "Reboot the Homey Pro. Takes 2-3 minutes to come back online. Use this to resolve stale devices or Z-Wave/Zigbee mesh issues after firmware updates.",
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
}, async () => {
  const api = await getHomeyApi();
  await api.system.reboot();
  return json({ success: true, message: "Reboot initiated. Homey will be back in ~2-3 minutes." });
});

server.registerTool("get_memory_info", {
  title: "Memory Usage",
  description: "Get Homey memory usage breakdown by app and system component. Useful for identifying memory-hungry apps.",
  annotations: READ,
}, async () => {
  const api = await getHomeyApi();
  return json(await api.system.getMemoryInfo());
});

server.registerTool("get_storage_info", {
  title: "Storage Usage",
  description: "Get Homey storage usage breakdown. Shows how much disk space is used by apps, insights, and system.",
  annotations: READ,
}, async () => {
  const api = await getHomeyApi();
  return json(await api.system.getStorageInfo());
});

server.registerTool("set_system_name", {
  title: "Set System Name",
  description: "Set the Homey system name (visible in network discovery and the Homey app).",
  inputSchema: { name: z.string().describe("New system name") },
  annotations: WRITE,
}, async ({ name }) => {
  const api = await getHomeyApi();
  await api.system.setSystemName({ name });
  return json({ success: true, name });
});


// ── Prompts ──────────────────────────────────────────────────────────

server.registerPrompt("homey_best_practices", {
  title: "Homey Best Practices",
  description: "Zone architecture, device naming, Z-Wave/Zigbee mesh tips, energy management, security, and performance guidelines.",
}, () => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text: `# Homey Pro Best Practices

## Zone Architecture
- Hierarchy: Home → Floors → Rooms → Sub-areas
- Every device in exactly one zone. Use sub-zones for independent control areas
- Consistent English naming (match Homey's language setting)

## Device Naming
- Pattern: \`<Type> [Location Detail]\` — e.g. "Ceiling Light", "Floor Thermostat", "Motion Sensor"
- Avoid hardware model names (not "Dimmer 2" or "ZW122")
- Avoid default names (not "Hue color lamp 1")

## Z-Wave Best Practices
- Mains-powered devices relay signals — place them between Homey and distant nodes
- Use S2 security for pairing. Run network heal after adding/moving devices
- Remove failed nodes promptly to prevent ghost routing issues
- Max 232 nodes per network

## Zigbee Best Practices
- Avoid Wi-Fi channel overlap (Zigbee channels 11, 15, 20, 25 are safest)
- Mains-powered devices act as routers. Battery devices are end-nodes only
- Keep first-hop routers within 5-10m of Homey

## Energy & Maintenance
- Enable energy reporting on all capable devices
- Keep automatic backups enabled. Manual backup before major changes
- Review weekly energy reports. Set up standby detection flows
- Periodic app audit — remove unused apps to free resources
- Consider weekly scheduled reboot for long-term stability

## Security
- Use scoped API keys with minimum permissions
- Role-based access: owner, manager, user, guest
- Enable notifications for security events (door sensors, motion, water alarms)` }}] }));

server.registerPrompt("homey_troubleshooting", {
  title: "Homey Troubleshooting",
  description: "Diagnosing offline devices, Z-Wave/Zigbee issues, flow debugging, and performance problems.",
}, () => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text: `# Homey Troubleshooting Guide

## Device Unavailable
1. Check power and physical status
2. Check distance — may be out of range
3. Z-Wave: check get_zwave_log for TRANSMIT_COMPLETE_NO_ACK errors
4. Zigbee: verify nearby router devices are online
5. Try: restart_app for the device's app
6. Try: reboot_homey to rebuild mesh
7. Last resort: remove and re-pair

## Z-Wave Issues
- Transmit failures → add mains-powered repeaters between Homey and device
- Ghost nodes → remove failed nodes via Developer Tools
- "Invalid Node Token" → battery dead or security handshake broken. Replace battery, remove, re-pair
- Slow response → move Homey away from metal/interference sources

## Zigbee Issues
- Devices dropping → Wi-Fi interference. Change Zigbee channel
- Pairing fails → factory reset device, bring within 0.5m of Homey
- Battery drain → check reporting intervals (too frequent = fast drain)

## Flow Issues
- Not triggering → check enabled status, trigger conditions, device availability
- Actions fail → check target device availability and capability values
- Use list_flows to audit, trigger_flow to test manually

## Performance
- Slow UI → check get_memory_info for memory-hungry apps
- Storage full → check get_storage_info
- After firmware update → reboot_homey to rebuild protocol meshes` }}] }));

server.registerPrompt("homey_flow_patterns", {
  title: "Homey Flow Patterns",
  description: "Automation patterns for presence, lighting, climate, notifications, and common anti-patterns to avoid.",
}, () => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text: `# Homey Flow Patterns

## Naming Convention
Pattern: \`<Zone> — <Action>\` (e.g. "Kitchen — Motion Light On", "Garden — Lights Off at Sunrise")

## Folder Organization
Group by function: Lighting, Climate, Security, Bathroom, Buttons

## Common Patterns

### Motion Lighting
- WHEN motion detected AND light is off AND time between sunset-sunrise
- THEN turn on light, start countdown timer
- Separate flow: WHEN countdown reaches zero THEN turn off light
- Add "manual override" variable to skip auto-off when manually turned on

### Presence Automation
- WHEN last person leaves → turn off lights, lower thermostats
- WHEN first person arrives → restore comfort settings
- Guard with "vacation mode" variable

### Climate Schedule
- Morning: raise target temperature
- Evening: lower target temperature
- Night: turn off or set to minimum
- Always check presence — don't heat empty rooms

### Sunrise/Sunset
- Use Homey's built-in sun events, not fixed times
- Add offsets: "30 min before sunset" for gradual transitions
- Combine with presence checks

## Anti-Patterns to Avoid
- Polling loops (check state every X seconds) → use event triggers instead
- Mega-flows with 20+ actions → split into focused sub-flows
- Hardcoded times → use sunrise/sunset + presence
- Missing conditions → always guard with time-of-day and presence
- Duplicate flow names → use Zone — Action pattern` }}] }));

// ── Start ────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
