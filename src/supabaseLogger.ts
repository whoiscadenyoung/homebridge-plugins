export interface SupabaseConfig {
  url: string;
  key: string;
}

export async function insertRow(
  config: SupabaseConfig,
  table: string,
  row: Record<string, unknown>,
  log: { warn(msg: string): void },
): Promise<void> {
  try {
    const res = await fetch(`${config.url}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': config.key,
        'Authorization': `Bearer ${config.key}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      const body = await res.text();
      log.warn(`Supabase insert failed (${res.status}): ${body}`);
    }
  } catch (err) {
    log.warn(`Supabase insert error: ${err instanceof Error ? err.message : String(err)}`);
  }
}