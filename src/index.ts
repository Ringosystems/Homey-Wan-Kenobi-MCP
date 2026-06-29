#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getHomeyApi } from "./homey.js";

const server = new McpServer({
  name: "homey-mcp",
  version: "2.1.1",
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
  const text = JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text: text ?? "null" }] };
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

// ── Flow Authoring (advanced + standard) ─────────────────────────────

server.registerTool("get_advanced_flow", {
  title: "Get Advanced Flow",
  description: "Get the full definition of an Advanced Flow by ID, including all cards (triggers/logic/actions) with their args, coordinates and outputSuccess/outputError connections. Use before update_advanced_flow to see the current structure.",
  inputSchema: { id: z.string().describe("Advanced Flow ID") },
  annotations: READ,
}, async ({ id }) => {
  const api = await getHomeyApi();
  try { return json(await api.flow.getAdvancedFlow({ id })); } catch (e: any) { return err(e.message); }
});

server.registerTool("create_advanced_flow", {
  title: "Create Advanced Flow",
  description: "Create a new Advanced Flow. Provide a name and a 'cards' object keyed by UUID; each card has type (trigger/condition/action/note/start/delay/all/any), id (flow card id), optional args, x/y coordinates, and outputSuccess/outputError arrays linking to other card UUIDs. Returns the new flow id and broken status (broken=false means all cards resolved).",
  inputSchema: {
    name: z.string().describe("Flow name"),
    cards: z.record(z.any()).describe("Advanced-flow cards map keyed by UUID"),
    enabled: z.boolean().optional().describe("Enable on creation (default true)"),
    folder: z.string().nullable().optional().describe("Folder ID (optional)"),
  },
  annotations: WRITE,
}, async ({ name, cards, enabled, folder }) => {
  const api = await getHomeyApi();
  try {
    const f = await api.flow.createAdvancedFlow({ advancedflow: { name, cards, enabled: enabled ?? true, ...(folder !== undefined ? { folder } : {}) } });
    return json({ success: true, id: f.id, name: f.name, enabled: f.enabled, broken: f.broken });
  } catch (e: any) { return err(e.message); }
});

server.registerTool("update_advanced_flow", {
  title: "Update Advanced Flow",
  description: "Update an existing Advanced Flow. Pass only the fields to change (name, enabled, and/or the full cards map). Replacing cards replaces the entire flow graph, so fetch with get_advanced_flow first and send the complete cards object. Returns broken status.",
  inputSchema: {
    id: z.string().describe("Advanced Flow ID"),
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    cards: z.record(z.any()).optional().describe("Full cards map (replaces existing)"),
  },
  annotations: WRITE,
}, async ({ id, name, enabled, cards }) => {
  const api = await getHomeyApi();
  const advancedflow: any = {};
  if (name !== undefined) advancedflow.name = name;
  if (enabled !== undefined) advancedflow.enabled = enabled;
  if (cards !== undefined) advancedflow.cards = cards;
  try {
    const f = await api.flow.updateAdvancedFlow({ id, advancedflow });
    return json({ success: true, id, name: f?.name, enabled: f?.enabled, broken: f?.broken });
  } catch (e: any) { return err(e.message); }
});

server.registerTool("delete_advanced_flow", {
  title: "Delete Advanced Flow",
  description: "Permanently delete an Advanced Flow by ID. Cannot be undone.",
  inputSchema: { id: z.string().describe("Advanced Flow ID") },
  annotations: DESTRUCTIVE,
}, async ({ id }) => {
  const api = await getHomeyApi();
  try { await api.flow.deleteAdvancedFlow({ id }); return json({ success: true, id }); } catch (e: any) { return err(e.message); }
});

server.registerTool("get_flow", {
  title: "Get Standard Flow",
  description: "Get the full definition of a standard (WHEN/AND/THEN) Flow by ID, including its trigger, conditions and actions cards.",
  inputSchema: { id: z.string().describe("Flow ID") },
  annotations: READ,
}, async ({ id }) => {
  const api = await getHomeyApi();
  try { return json(await api.flow.getFlow({ id })); } catch (e: any) { return err(e.message); }
});

server.registerTool("create_flow", {
  title: "Create Standard Flow",
  description: "Create a standard WHEN/AND/THEN Flow. Provide a name and a 'flow' object containing trigger (card object) and optional conditions[]/actions[] arrays. Use get_flow on a similar flow to learn the exact card shape.",
  inputSchema: {
    name: z.string().describe("Flow name"),
    flow: z.record(z.any()).describe("Flow definition (trigger, conditions, actions, ...)"),
  },
  annotations: WRITE,
}, async ({ name, flow }) => {
  const api = await getHomeyApi();
  try { const f = await api.flow.createFlow({ flow: { name, ...flow } }); return json({ success: true, id: f.id, name: f.name, broken: f.broken }); } catch (e: any) { return err(e.message); }
});

server.registerTool("update_flow", {
  title: "Update Standard Flow",
  description: "Update a standard Flow. Pass the flow id and a 'flow' object with only the fields to change (name, trigger, conditions, actions, enabled).",
  inputSchema: { id: z.string(), flow: z.record(z.any()).describe("Fields to update") },
  annotations: WRITE,
}, async ({ id, flow }) => {
  const api = await getHomeyApi();
  try { const f = await api.flow.updateFlow({ id, flow }); return json({ success: true, id, broken: f?.broken }); } catch (e: any) { return err(e.message); }
});

server.registerTool("delete_flow", {
  title: "Delete Standard Flow",
  description: "Permanently delete a standard Flow by ID. Cannot be undone.",
  inputSchema: { id: z.string() },
  annotations: DESTRUCTIVE,
}, async ({ id }) => {
  const api = await getHomeyApi();
  try { await api.flow.deleteFlow({ id }); return json({ success: true, id }); } catch (e: any) { return err(e.message); }
});

// ── Flow Card Discovery (for building flows) ─────────────────────────

const cardGetter = (api: any, type: string) =>
  type === "trigger" ? api.flow.getFlowCardTriggers()
    : type === "condition" ? api.flow.getFlowCardConditions()
      : api.flow.getFlowCardActions();

server.registerTool("list_flow_cards", {
  title: "List Flow Cards",
  description: "List available flow cards of a given type (trigger/condition/action). There are hundreds, so filter by a substring matched against the card id/title/uri (e.g. a device UUID to find that device's cards, or 'windowcoverings', 'dim', 'button'). Returns id + title. Use get_flow_card for full args.",
  inputSchema: {
    type: z.enum(["trigger", "condition", "action"]).describe("Card type"),
    filter: z.string().optional().describe("Substring matched against card id, title and uri"),
    limit: z.number().optional().describe("Max results (default 60)"),
  },
  annotations: READ,
}, async ({ type, filter, limit }) => {
  const api = await getHomeyApi();
  const cards = Object.values(await cardGetter(api, type)) as any[];
  const f = filter?.toLowerCase();
  let out = f ? cards.filter((c) => (`${c.id} ${c.title ?? ""} ${c.uri ?? ""}`).toLowerCase().includes(f)) : cards;
  const total = out.length;
  out = out.slice(0, limit ?? 60);
  return json({ type, filter: filter ?? null, total, showing: out.length, cards: out.map((c) => ({ id: c.id, title: c.title, uri: c.uri })) });
});

server.registerTool("get_flow_card", {
  title: "Get Flow Card",
  description: "Get the full definition of one flow card (by type + id), including its arguments (names, types, dropdown values, ranges). Use this to learn exactly what args a card needs when building a flow.",
  inputSchema: {
    type: z.enum(["trigger", "condition", "action"]),
    id: z.string().describe("Flow card id (e.g. homey:device:<uuid>:windowcoverings_set)"),
  },
  annotations: READ,
}, async ({ type, id }) => {
  const api = await getHomeyApi();
  try {
    const card = type === "trigger" ? await api.flow.getFlowCardTrigger({ id })
      : type === "condition" ? await api.flow.getFlowCardCondition({ id })
        : await api.flow.getFlowCardAction({ id });
    return json(card);
  } catch (e: any) { return err(e.message); }
});

// ── Device & Zone Management ─────────────────────────────────────────

server.registerTool("rename_device", {
  title: "Rename Device",
  description: "Rename a device. Use list_devices to find the device ID.",
  inputSchema: { id: z.string().describe("Device ID"), name: z.string().describe("New name") },
  annotations: WRITE,
}, async ({ id, name }) => {
  const api = await getHomeyApi();
  try { await api.devices.updateDevice({ id, device: { name } }); return json({ success: true, id, name }); } catch (e: any) { return err(e.message); }
});

server.registerTool("move_device_to_zone", {
  title: "Move Device to Zone",
  description: "Move a device to a different zone (room). Use list_zones for the zone ID and list_devices for the device ID.",
  inputSchema: { id: z.string().describe("Device ID"), zoneId: z.string().describe("Target zone ID") },
  annotations: WRITE,
}, async ({ id, zoneId }) => {
  const api = await getHomeyApi();
  try { await api.devices.updateDevice({ id, device: { zone: zoneId } }); return json({ success: true, id, zoneId }); } catch (e: any) { return err(e.message); }
});

server.registerTool("create_zone", {
  title: "Create Zone",
  description: "Create a new zone (room/area). Optionally nest it under a parent zone.",
  inputSchema: { name: z.string().describe("Zone name"), parent: z.string().optional().describe("Parent zone ID (optional)") },
  annotations: WRITE,
}, async ({ name, parent }) => {
  const api = await getHomeyApi();
  try { const z2 = await api.zones.createZone({ zone: { name, ...(parent ? { parent } : {}) } }); return json({ success: true, id: z2.id, name: z2.name }); } catch (e: any) { return err(e.message); }
});

// ── Radio Network Diagnostics ────────────────────────────────────────

server.registerTool("diagnose_zigbee_network", {
  title: "Diagnose Zigbee Network",
  description: "Read the Zigbee mesh state and report health: controller status, node count, per-node last-seen age, and detected issues with recommended remediations. Note: battery Zigbee devices sleep, so a stale last-seen on a battery node can be normal.",
  annotations: READ,
}, async () => {
  const api = await getHomeyApi();
  const st = await api.zigbee.getState();
  const raw = st.nodes ?? {};
  const nodes = (Array.isArray(raw) ? raw : Object.values(raw)) as any[];
  const now = Date.now();
  const an = nodes.map((n) => {
    const ls = typeof n.lastSeen === "number" ? n.lastSeen : (n.lastSeen ? new Date(n.lastSeen).getTime() : null);
    const ageH = ls ? Math.round(((now - ls) / 3600000) * 10) / 10 : null;
    return { networkAddress: n.networkAddress, ieeeAddress: n.ieeeAddress, model: n.modelId, manufacturer: n.manufacturerName, lastSeenHoursAgo: ageH };
  });
  const issues: any[] = [];
  if (st.zigbee_error) issues.push({ severity: "high", issue: `Zigbee controller error: ${st.zigbee_error}`, remediation: "Reboot Homey to restart the Zigbee stack and confirm the controller recovers." });
  if (st.zigbee_ready === false) issues.push({ severity: "high", issue: "Zigbee not ready", remediation: "Reboot Homey and confirm Zigbee initialises." });
  for (const n of an) {
    if (n.lastSeenHoursAgo === null) continue;
    if (n.lastSeenHoursAgo >= 720)
      issues.push({ severity: "high", node: n.ieeeAddress, model: n.model, issue: `Not seen in ~${Math.round(n.lastSeenHoursAgo / 24)} days`, remediation: "Almost certainly a dead or orphaned node. Remove it from the Zigbee network so it stops bloating routing tables, then re-pair only if you still use it." });
    else if (n.lastSeenHoursAgo >= 24)
      issues.push({ severity: "medium", node: n.ieeeAddress, model: n.model, issue: `Not seen in ${n.lastSeenHoursAgo}h`, remediation: "If mains-powered, power-cycle it and improve placement/repeaters. If battery powered this may be normal sleep, verify it still responds." });
  }
  const recommendations = [
    "Keep Zigbee on a channel clear of Wi-Fi overlap (11, 15, 20, or 25).",
    "Add mains-powered Zigbee devices as repeaters to extend and stabilise the mesh, and keep the first hop within 5-10 m of Homey.",
    "Avoid placing Homey near USB 3.0 ports, metal enclosures, or large appliances (2.4 GHz interference).",
  ];
  return json({ network: "zigbee", ready: st.zigbee_ready, state: st.zigbee_state, error: st.zigbee_error ?? null, nodeCount: an.length, nodes: an, issues, recommendations });
});

server.registerTool("diagnose_zwave_network", {
  title: "Diagnose Z-Wave Network",
  description: "Read the Z-Wave controller state plus recent network log and report health: controller readiness/version, transmit failures grouped by node, currently-unavailable devices, and detected issues with recommended remediations.",
  annotations: READ,
}, async () => {
  const api = await getHomeyApi();
  const [state, log, devicesObj] = await Promise.all([
    api.zwave.getState(),
    api.zwave.getLog().catch(() => []),
    api.devices.getDevices(),
  ]);
  const logArr = (Array.isArray(log) ? log : ((log as any)?.log ?? (log as any)?.entries ?? [])) as any[];
  const failByType: Record<string, number> = {};
  let firstDate: string | null = null, lastDate: string | null = null;
  for (const e of logArr) {
    const s = typeof e === "string" ? e : (e.log ?? e.message ?? e.text ?? "");
    const d = e && e.date ? String(e.date) : null;
    if (d) { if (!firstDate || d < firstDate) firstDate = d; if (!lastDate || d > lastDate) lastDate = d; }
    const m = s.match(/TRANSMIT_COMPLETE_[A-Z_]+|[A-Z]*TIMEOUT|UNREACHABLE/i);
    if (m) { const t = m[0].toUpperCase(); failByType[t] = (failByType[t] || 0) + 1; }
  }
  const totalFailures = Object.values(failByType).reduce((a, b) => a + b, 0);
  const devices = Object.values(devicesObj) as any[];
  const unavailable = devices.filter((d) => d.available === false).map((d) => ({ id: d.id, name: d.name, reason: d.unavailableMessage ?? null }));
  const issues: any[] = [];
  if (state.zw_error) issues.push({ severity: "high", issue: `Z-Wave controller error: ${state.zw_error}`, remediation: "Reboot Homey; if it persists, the Z-Wave chip may need attention." });
  if (state.zw_ready === false) issues.push({ severity: "high", issue: "Z-Wave not ready", remediation: "Reboot Homey and confirm Z-Wave initialises." });
  if (totalFailures > 0) {
    const span = firstDate && lastDate ? ` between ${firstDate} and ${lastDate}` : "";
    const breakdown = Object.entries(failByType).map(([t, c]) => `${t}: ${c}`).join(", ");
    issues.push({
      severity: totalFailures >= 25 ? "high" : "medium",
      issue: `${totalFailures} transmit failures across the last ${logArr.length} log entries${span} (${breakdown})`,
      note: "Homey's Z-Wave log does not record node IDs. Repeated NO_ACK failures almost always come from Homey re-polling an unreachable or dead node, so correlate with unavailableDevices below.",
      remediation: "Identify the offending node from unavailableDevices, then re-pair or remove it. Place a mains-powered repeater between Homey and distant nodes and run a Z-Wave network heal.",
    });
  }
  for (const d of unavailable) issues.push({ severity: "medium", device: d.name, issue: `Unavailable${d.reason ? `: ${d.reason}` : ""}`, remediation: "Check power/battery and range, restart the device's app, and re-pair if the node is dead." });
  const recommendations = [
    "Run a Z-Wave network heal after adding or relocating devices so routes recalculate.",
    "Distribute mains-powered Z-Wave devices between Homey and distant nodes, they act as repeaters.",
    "Remove dead/ghost nodes promptly, they cause routing delays and retries.",
    "Keep Homey away from metal and strong 2.4 GHz interference sources.",
  ];
  return json({
    network: "zwave",
    ready: state.zw_ready,
    error: state.zw_error ?? null,
    controller: { libraryType: state.zw_state?.libraryType, version: state.zw_state ? `${state.zw_state.versionMajor}.${state.zw_state.versionMinor}` : null },
    logEntriesScanned: logArr.length,
    transmitFailures: { total: totalFailures, byType: failByType, window: { from: firstDate, to: lastDate } },
    unavailableDevices: unavailable,
    issues,
    recommendations,
  });
});

// ── Raw API Passthrough (future-proof escape hatch) ──────────────────

server.registerTool("homey_api_call", {
  title: "Raw Homey API Call",
  description: "Advanced escape hatch: call any Homey Web API endpoint directly. method is GET/POST/PUT/DELETE; path is the API path (e.g. /manager/zwave/state); body is an optional JSON object. Use to reach endpoints not yet wrapped by a dedicated tool, including new firmware capabilities. Prefer the dedicated tools when one exists.",
  inputSchema: {
    method: z.enum(["GET", "POST", "PUT", "DELETE"]).describe("HTTP method"),
    path: z.string().describe("API path, e.g. /manager/zwave/state"),
    body: z.record(z.any()).optional().describe("Optional JSON body for POST/PUT"),
  },
  annotations: { readOnlyHint: false, destructiveHint: false },
}, async ({ method, path, body }) => {
  const api = await getHomeyApi();
  try { const r = await api.call({ method, path, ...(body !== undefined ? { body } : {}) }); return json(r === undefined ? { success: true } : r); } catch (e: any) { return err(e.message); }
});

// ── App Usage & Memory Recommendations ───────────────────────────────

server.registerTool("analyze_app_usage", {
  title: "Analyze App Usage & Memory",
  description: "Cross-references installed apps against RAM usage (from the memory report), how many devices each provides, and whether each app is referenced by any flow (full flow definitions are scanned, not just metadata). Flags removal candidates (apps with 0 devices and no flow references, largest RAM first), reports potential RAM savings, and groups possible duplicate/overlapping app categories (e.g. multiple MQTT apps). Read-only and advisory; it does NOT uninstall anything. Caveat: a few apps run background logic (schedules, exports, tokens) without devices or flow cards, so verify before removing.",
  annotations: READ,
}, async () => {
  const api = await getHomeyApi();
  const [mem, appsObj, devicesObj, flowsObj] = await Promise.all([
    api.system.getMemoryInfo(), api.apps.getApps(), api.devices.getDevices(), api.flow.getFlows(),
  ]);
  let advList: any[] = [];
  try { advList = Object.values(await api.flow.getAdvancedFlows()) as any[]; } catch { /* advanced flows may be unavailable */ }
  const apps = Object.values(appsObj) as any[];
  const devices = Object.values(devicesObj) as any[];
  const mb = (b: number) => Math.round((b / 1048576) * 10) / 10;
  const ramOf = (id: string) => (mem.types?.[`homey:app:${id}`]?.size ?? 0);
  const devCount: Record<string, number> = {};
  for (const d of devices) { const m = String(d.driverId || "").match(/^homey:app:([^:]+)/); if (m) devCount[m[1]] = (devCount[m[1]] || 0) + 1; }
  let blob = "";
  for (const f of Object.values(flowsObj) as any[]) { try { blob += JSON.stringify(await api.flow.getFlow({ id: f.id })); } catch { /* skip flows we cannot read */ } }
  for (const f of advList) { try { blob += JSON.stringify(await api.flow.getAdvancedFlow({ id: f.id })); } catch { /* skip flows we cannot read */ } }
  const used = new Set<string>();
  for (const m of blob.matchAll(/homey:app:([a-zA-Z0-9_.-]+)/g)) used.add(m[1]);
  for (const m of blob.matchAll(/homey:device:([0-9a-f-]{36})/g)) { const d = (devicesObj as any)[m[1]]; const am = String(d?.driverId || "").match(/^homey:app:([^:]+)/); if (am) used.add(am[1]); }
  const rows = apps.map((a) => ({ id: a.id, name: a.name, enabled: a.enabled, ramMB: mb(ramOf(a.id)), devices: devCount[a.id] || 0, usedInFlows: used.has(a.id) })).sort((x, y) => y.ramMB - x.ramMB);
  const removalCandidates = rows.filter((r) => r.devices === 0 && !r.usedInFlows);
  const CATS: Record<string, RegExp> = { MQTT: /mqtt/i, "Weather/Sun": /weather|sunevent|^no\.yr$/i, Timers: /chronograph|countdown|timer/i, "Device groups": /devicegroup/i };
  const possibleDuplicates: any[] = [];
  for (const [cat, re] of Object.entries(CATS)) { const m = rows.filter((r) => re.test(r.name) || re.test(r.id)); if (m.length >= 2) possibleDuplicates.push({ category: cat, apps: m.map((x) => ({ name: x.name, ramMB: x.ramMB, devices: x.devices, usedInFlows: x.usedInFlows })) }); }
  return json({
    memory: { totalMB: mb(mem.total), freeMB: mb(mem.free), usedMB: mb(mem.total - mem.free), swapMB: mb(mem.swap || 0) },
    potentialSavingMB: Math.round(removalCandidates.reduce((s, r) => s + r.ramMB, 0) * 10) / 10,
    apps: rows,
    removalCandidates,
    possibleDuplicates,
    note: "removalCandidate = 0 devices AND not referenced by any flow. Verify before uninstalling: some apps run background logic (schedules, exports, tokens) without devices or flow cards.",
  });
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
