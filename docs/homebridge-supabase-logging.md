# Homebridge → Supabase Logging: Implementation Guide

## Overview

This guide covers forking the Aranet4 and Airmega Homebridge plugins to write sensor
readings directly to a Supabase Postgres database. Both forks use the same pattern:
a shared `supabaseLogger.ts` helper that POSTs to the Supabase REST API on every
reading, with credentials passed through the plugin config.

**Architecture:**
```
Aranet4 BLE advertisements
  → forked aranet4 plugin (updateReading)
      → Supabase REST API → aranet4_readings table

Coway cloud API (polled every 60s)
  → forked airmega plugin (pushUpdates)
      → Supabase REST API → airmega_readings table
```

---

## Part 1 — Supabase Setup

### 1.1 Create the project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Wait for the project to finish provisioning
3. Go to **Project Settings → API** and note:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **service_role key** — the secret key, not the anon key

### 1.2 Create the tables

Run both statements in **SQL Editor → New query**:

```sql
create table aranet4_readings (
  id          bigint generated always as identity primary key,
  recorded_at timestamptz not null default now(),
  device_id   text        not null,  -- normalized MAC, e.g. "aabbccddeeff"
  co2         integer     not null,  -- ppm
  temperature real        not null,  -- °C
  pressure    real        not null,  -- hPa
  humidity    integer     not null,  -- %
  battery     integer     not null,  -- %
  status      integer,
  interval    integer,
  age         integer
);

create table airmega_readings (
  id                      bigint generated always as identity primary key,
  recorded_at             timestamptz not null default now(),
  device_id               text        not null,  -- Coway deviceId string
  power                   boolean     not null,
  mode                    text        not null,  -- 'auto'|'manual'|'night'|'eco'|'rapid'
  fan_speed               integer     not null,  -- 1–6
  light_on                boolean     not null,
  air_quality             integer     not null,  -- 0–4 (HomeKit AirQuality enum)
  pm25                    real,                  -- µg/m³, null if API did not return it
  pm10                    real,                  -- µg/m³, null if API did not return it
  pre_filter_pct          integer,               -- 0–100
  max2_filter_pct         integer,               -- 0–100
  timer_minutes_remaining integer
);
```

### 1.3 Enable Row Level Security

Run in SQL Editor (no policies needed yet — just locks the tables down):

```sql
alter table aranet4_readings enable row level security;
alter table airmega_readings enable row level security;
```

The service_role key bypasses RLS by design, so writes from the plugins still work.

---

## Part 2 — Fork the Aranet4 Plugin

### 2.1 Fork and clone

1. Go to [github.com/RobSim/Homebridge-Aranet4](https://github.com/RobSim/Homebridge-Aranet4)
   and click **Fork**
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/Homebridge-Aranet4.git
   cd Homebridge-Aranet4
   npm install
   ```

### 2.2 Create `src/supabaseLogger.ts`

Create this file from scratch:

```typescript
export interface SupabaseConfig {
  url: string;
  key: string;
}

function baseUrl(config: SupabaseConfig): string {
  return config.url.replace(/\/$/, '');
}

const REQUEST_TIMEOUT_MS = 10_000;

export async function insertRow(
  config: SupabaseConfig,
  table: string,
  row: Record<string, unknown>,
  log: { warn(msg: string): void; debug(msg: string): void },
): Promise<void> {
  try {
    const res = await fetch(`${baseUrl(config)}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': config.key,
        'Authorization': `Bearer ${config.key}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.ok) {
      log.debug(`[Supabase] Inserted row into ${table}`);
    } else {
      const body = await res.text();
      log.warn(`[Supabase] Insert into ${table} failed (HTTP ${res.status}): ${body}`);
    }
  } catch (err) {
    log.warn(`[Supabase] Insert into ${table} error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function checkConnection(
  config: SupabaseConfig,
  table: string,
  log: { info(msg: string): void; warn(msg: string): void },
): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl(config)}/rest/v1/${table}?select=id&limit=1`, {
      method: 'GET',
      headers: {
        'apikey': config.key,
        'Authorization': `Bearer ${config.key}`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.ok) {
      log.info(`[Supabase] Connection to "${table}" verified (HTTP ${res.status})`);
      return true;
    }
    const body = await res.text();
    log.warn(`[Supabase] Connection check for "${table}" failed (HTTP ${res.status}): ${body}`);
    return false;
  } catch (err) {
    log.warn(`[Supabase] Connection check error: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}
```

Notes on what this does beyond the minimal implementation:
- `baseUrl()` strips a trailing slash from the project URL before building the REST path — prevents double-slash errors if the URL is copied with a trailing `/`
- `AbortSignal.timeout(10_000)` on both fetch calls prevents a network hang from stalling Homebridge indefinitely (requires Node 17+, already satisfied by the Node 20 engine requirement)
- `checkConnection()` — runs a `GET` against the table at startup to verify credentials and table access before the first reading arrives; logs at `info` level so it's always visible
- `insertRow` now logs a `debug`-level success message so you can confirm rows are being written without spamming the default log level

### 2.3 Update `src/settings.ts`

Add the optional `supabase` field to both config interfaces (no import needed — use an inline type):

```typescript
/** Per-device configuration from config.json. */
export interface Aranet4DeviceConfig {
  name: string;
  address?: string;
  pollingInterval: number;
  co2AlertThreshold: number;
  lowBatteryThreshold: number;
  enableHistory: boolean;
  supabase?: { url: string; key: string };  // ADD THIS
}

/** Top-level platform configuration. */
export interface Aranet4PlatformConfig {
  platform: string;
  name: string;
  devices?: Aranet4DeviceConfig[];
  supabase?: { url: string; key: string };  // ADD THIS
}
```

### 2.4 Update `src/platform.ts`

Three changes are required here. All three are needed — missing any one of them causes silent failures.

**Import `checkConnection`** at the top:

```typescript
import { checkConnection } from './supabaseLogger';
```

**Add a class field** to hold the platform-level Supabase config:

```typescript
private readonly platformSupabase: { url: string; key: string } | undefined;
```

**In the constructor**, set `platformSupabase` and propagate it into each device config. The `supabase` line in the map is the critical one — without it the config is silently dropped and `insertRow` is never called:

```typescript
const platformConfig = config as unknown as Aranet4PlatformConfig;
this.platformSupabase = platformConfig.supabase;
this.deviceConfigs = (platformConfig.devices ?? []).map((d) => ({
  name: d.name || 'Aranet4',
  address: d.address ? normalizeAddress(d.address) : undefined,
  pollingInterval: clamp(d.pollingInterval ?? DEFAULT_POLLING_INTERVAL, 60, 3600),
  co2AlertThreshold: clamp(d.co2AlertThreshold ?? DEFAULT_CO2_ALERT_THRESHOLD, 400, 5000),
  lowBatteryThreshold: clamp(d.lowBatteryThreshold ?? DEFAULT_LOW_BATTERY_THRESHOLD, 5, 50),
  enableHistory: d.enableHistory !== false,
  supabase: d.supabase ?? platformConfig.supabase,  // ADD THIS — device-level overrides platform-level
}));
```

**In `ensureAccessory()`**, also include `supabase` in the fallback config used for auto-discovered devices that aren't listed in `devices`:

```typescript
const deviceConfig = this.findDeviceConfig(deviceId) ?? {
  name: 'Aranet4',
  pollingInterval: DEFAULT_POLLING_INTERVAL,
  co2AlertThreshold: DEFAULT_CO2_ALERT_THRESHOLD,
  lowBatteryThreshold: DEFAULT_LOW_BATTERY_THRESHOLD,
  enableHistory: true,
  supabase: this.platformSupabase,  // ADD THIS
};
```

**In `logStartupDiagnostics()`**, add a status line so you can see at a glance whether Supabase is configured:

```typescript
this.log.info(`Supabase logging: ${this.platformSupabase ? `enabled (${this.platformSupabase.url})` : 'not configured'}`);
```

**In `initializePlugin()`**, kick off the async health check before BLE scanning starts:

```typescript
if (this.platformSupabase) {
  void checkConnection(this.platformSupabase, 'aranet4_readings', this.log);
}
```

### 2.5 Update `src/platformAccessory.ts`

Add the import and the insert call inside `updateReading()`:

```typescript
// Add at the top with other imports:
import { insertRow } from './supabaseLogger';

// In updateReading(), after the FakeGato block:
if (this.config.supabase) {
  insertRow(this.config.supabase, 'aranet4_readings', {
    device_id:   (this.accessory.context.deviceId as string | undefined) ?? this.accessory.UUID,
    co2:         reading.co2,
    temperature: reading.temperature,
    pressure:    reading.pressure,
    humidity:    reading.humidity,
    battery:     reading.battery,
    status:      reading.status,
    interval:    reading.interval,
    age:         reading.age,
  }, this.log);
}
```

Note: `device_id` uses `this.accessory.context.deviceId` (the normalized MAC address stored by the platform, e.g. `aabbccddeeff`) rather than `this.accessory.UUID` (a HomeKit-generated UUID that is not human-readable and changes if the accessory is re-registered).

### 2.6 Update `config.schema.json`

Add the supabase block to the schema so the Homebridge UI exposes the fields.
Find the `"properties"` object at the top level of the schema and add:

```json
"supabase": {
  "title": "Supabase",
  "type": "object",
  "properties": {
    "url": {
      "title": "Project URL",
      "type": "string",
      "placeholder": "https://yourproject.supabase.co"
    },
    "key": {
      "title": "Secret API Key",
      "type": "string",
      "placeholder": "your-secret-api-key",
      "secret": true
    }
  }
}
```

`"secret": true` causes the Homebridge UI to mask the key field so the service role key isn't shown in plaintext in the config editor.

### 2.7 Update `package.json`

```json
{
  "name": "homebridge-aranet4-advanced-yourname",
  "version": "0.1.1-fork.1",
  ...
}
```

Replace `yourname` with something unique — your GitHub username works well.

### 2.8 Build and verify

```bash
npm run build
npm test
```

Fix any TypeScript errors before proceeding.

### 2.9 Publish to npm

```bash
npm login        # only needed once
npm publish --access public
```

---

## Part 3 — Fork the Airmega Plugin

### 3.1 Fork and clone

1. Go to [github.com/jakemgold/homebridge-airmega-iocare](https://github.com/jakemgold/homebridge-airmega-iocare)
   and click **Fork**
2. Clone and install:
   ```bash
   git clone https://github.com/YOUR_USERNAME/homebridge-airmega-iocare.git
   cd homebridge-airmega-iocare
   npm install
   ```

### 3.2 Create `src/supabaseLogger.ts`

Copy the exact same file from Part 2, step 2.2. It is identical.

### 3.3 Update `src/settings.ts`

```typescript
// Add this import at the top:
import { SupabaseConfig } from './supabaseLogger';

// Find the platform config interface (or create one if it doesn't exist)
// and add the supabase field. Based on the compiled output it will look
// something like this — add the supabase line:
export interface AirmegaPlatformConfig {
  platform: string;
  name: string;
  username: string;
  password: string;
  pollingInterval?: number;
  exposeLight?: boolean;
  skipPasswordChange?: boolean;
  supabase?: SupabaseConfig;  // ADD THIS
}
```

### 3.4 Update `src/platform.ts`

Make `supabaseConfig` available to accessories. Find where `AirPurifierAccessory`
is constructed and pass the config through:

```typescript
// Add import at top:
import { SupabaseConfig } from './supabaseLogger';

// In AirmegaPlatform, add a property:
readonly supabaseConfig?: SupabaseConfig;

// In the constructor, read it from config:
this.supabaseConfig = (this.config as AirmegaPlatformConfig).supabase;

// When constructing AirPurifierAccessory, pass it as an additional argument:
new AirPurifierAccessory(this, accessory, pollingInterval);
// becomes:
new AirPurifierAccessory(this, accessory, pollingInterval, this.supabaseConfig);
```

### 3.5 Update `src/accessories/airPurifier.ts`

```typescript
// Add import at top:
import { SupabaseConfig } from '../supabaseLogger';
import { insertRow } from '../supabaseLogger';

// In the AirPurifierAccessory class, add a property:
private readonly supabaseConfig?: SupabaseConfig;

// Update the constructor signature to accept it:
constructor(
  platform: AirmegaPlatform,
  accessory: PlatformAccessory,
  pollingInterval: number,
  supabaseConfig?: SupabaseConfig,   // ADD THIS
) {
  // ... existing constructor body ...
  this.supabaseConfig = supabaseConfig;  // ADD THIS
}

// At the END of pushUpdates(), after this.lightService?.updateCharacteristic(...):
if (this.supabaseConfig && this.state) {
  const s = this.state;
  insertRow(this.supabaseConfig, 'airmega_readings', {
    device_id:               this.device.deviceId,
    power:                   s.power,
    mode:                    s.mode,
    fan_speed:               s.fanSpeed,
    light_on:                s.lightOn,
    air_quality:             s.airQuality,
    pm25:                    s.pm25    ?? null,
    pm10:                    s.pm10    ?? null,
    pre_filter_pct:          s.preFilterPct          ?? null,
    max2_filter_pct:         s.max2FilterPct         ?? null,
    timer_minutes_remaining: s.timerMinutesRemaining ?? null,
  }, this.platform.log);
}
```

### 3.6 Update `config.schema.json`

Add the same supabase block as in Part 2, step 2.6.

### 3.7 Update `package.json`

```json
{
  "name": "homebridge-airmega-iocare-yourname",
  "version": "1.0.0-fork.1",
  ...
}
```

### 3.8 Build and verify

```bash
npm run build
npm test
```

### 3.9 Publish to npm

```bash
npm publish --access public
```

---

## Part 4 — Swap the Plugins on your Raspberry Pi

### 4.1 Uninstall the originals

SSH into your Pi, then either use the Homebridge UI to uninstall both plugins,
or run:

```bash
sudo npm uninstall -g homebridge-aranet4-advanced
sudo npm uninstall -g homebridge-airmega-iocare
```

### 4.2 Install your forks

```bash
sudo npm install -g homebridge-aranet4-advanced-yourname
sudo npm install -g homebridge-airmega-iocare-yourname
```

### 4.3 Update Homebridge config

Open the Homebridge UI config editor and update the `"platform"` entries.
The plugin name references in config need to match your new package names.
Also add the `supabase` block to each platform:

```json
{
  "platforms": [
    {
      "platform": "Aranet4",
      "name": "Aranet4",
      "supabase": {
        "url": "https://yourproject.supabase.co",
        "key": "your-service-role-key"
      },
      "devices": [
        {
          "name": "Living Room CO2",
          "address": "AA:BB:CC:DD:EE:FF",
          "pollingInterval": 60,
          "enableHistory": true
        }
      ]
    },
    {
      "platform": "AirmegaPlatform",
      "name": "Airmega",
      "username": "your-iocare-email",
      "password": "your-iocare-password",
      "supabase": {
        "url": "https://yourproject.supabase.co",
        "key": "your-service-role-key"
      }
    }
  ]
}
```

### 4.4 Restart Homebridge

```bash
sudo systemctl restart homebridge
```

---

## Part 5 — Verify Everything is Working

### 5.1 Check Homebridge logs

```bash
sudo journalctl -u homebridge -f
```

Look for:
- Both plugins loading without errors
- `Supabase logging: enabled (https://...)` — confirms the config was read
- `[Supabase] Connection to "aranet4_readings" verified` — confirms auth + table access
- No `[Supabase] Insert` warnings
- `[Supabase] Inserted row into aranet4_readings` — at debug log level, once per reading
- Aranet4: `Discovered Aranet4` and reading updates
- Airmega: `Logged in to Coway IoCare+` and polling messages

If you see `[Supabase] Connection check for "aranet4_readings" failed (HTTP 401)`, the key is wrong (use the `service_role` key, not the `anon` key). If you see HTTP 404, the table name is wrong or the project URL is incorrect.

### 5.2 Check Supabase

Go to **Table Editor** in your Supabase dashboard and confirm:
- `aranet4_readings` has rows appearing (allow one full `pollingInterval`, default 60s)
- `airmega_readings` has rows appearing (allow one full poll cycle, default 60s)

### 5.3 Test a manual query

In Supabase SQL Editor:

```sql
-- Most recent Aranet4 readings
select recorded_at, co2, temperature, humidity, pressure, battery
from aranet4_readings
order by recorded_at desc
limit 10;

-- Most recent Airmega readings
select recorded_at, power, mode, fan_speed, air_quality, pm25, pre_filter_pct
from airmega_readings
order by recorded_at desc
limit 10;
```

---

## Part 6 — Ongoing Maintenance

### Keeping forks up to date

Add the upstream remotes once:

```bash
# In your Aranet4 fork directory:
git remote add upstream https://github.com/RobSim/Homebridge-Aranet4.git

# In your Airmega fork directory:
git remote add upstream https://github.com/jakemgold/homebridge-airmega-iocare.git
```

When upstream ships an update:

```bash
git fetch upstream
git merge upstream/main
# resolve any conflicts (your changes are only in supabaseLogger.ts
# and small additions to settings.ts, platformAccessory.ts/airPurifier.ts,
# and config.schema.json — conflicts should be minimal)
npm run build
npm test
# bump version in package.json
npm publish --access public
# then on the Pi:
sudo npm install -g homebridge-aranet4-advanced-yourname@latest
sudo systemctl restart homebridge
```

### Watch upstream repos for updates

Enable GitHub notifications on both upstream repos (**Watch → Custom → Releases**)
so you catch security fixes promptly.

---

## Notes and Caveats

**Data frequency:** Both plugins poll/throttle at 60s by default. Each `updateReading()`
/ `pushUpdates()` call produces exactly one DB row. The Aranet4 broadcasts every ~1s
over BLE but the plugin only calls `updateReading()` at the throttled rate — if you want
sub-minute resolution you would need to hook into `handleAranet4Advertisement` in
`bleManager.ts` instead, but 60s granularity is fine for air quality monitoring.

**Airmega writes on every poll, not just on change.** If the purifier is off and
unchanged, you'll still get a row every 60s. You can add a state-comparison check before
calling `insertRow` if you want to only write on changes.

**The service_role key has full database access.** It lives in your Homebridge
`config.json` on the Pi, which is a local file only accessible to the homebridge user.
Do not commit it to version control or log it. Homebridge's config UI masks it in the
display as long as you mark the field `"secret": true` in `config.schema.json`.

**`fetch()` and `AbortSignal.timeout()` require Node 17.5+ and 17.3+ respectively.**
Both plugins require Node 20, so this is already satisfied. The 10-second timeout on
all Supabase requests means a network issue will surface as a logged warning rather than
silently hanging Homebridge.

**The 250S reports PM2.5** (unlike the 400S). The `pm25` column will not be null
in your Airmega rows.
