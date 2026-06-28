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
