const { loadEnvConfig } = require('@next/env');
const { Pool } = require('pg');
loadEnvConfig(process.cwd());
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function ensureBuckets() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY || '';
  if (!url || !key) {
    console.log('[Storage] SUPABASE_URL / SUPABASE_SECRET_KEY missing, skipping bucket setup.');
    return;
  }

  const headers = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };

  let existing = [];
  try {
    const res = await fetch(`${url}/storage/v1/bucket`, { headers });
    if (res.ok) existing = await res.json();
  } catch (e) {
    console.warn('[Storage] Cannot list buckets:', e.message);
    return;
  }

  const wanted = [
    { id: 'files', name: 'files', public: false },
    { id: 'screenshots', name: 'screenshots', public: true },
  ];

  for (const bucket of wanted) {
    const found = Array.isArray(existing)
      ? existing.find((b) => b.id === bucket.id || b.name === bucket.name)
      : null;

    if (!found) {
      try {
        const res = await fetch(`${url}/storage/v1/bucket`, {
          method: 'POST',
          headers,
          body: JSON.stringify(bucket),
        });
        if (res.ok) console.log(`[Storage] Created bucket: ${bucket.name}`);
        else console.warn(`[Storage] Could not create ${bucket.name}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      } catch (e) {
        console.warn(`[Storage] Could not create ${bucket.name}:`, e.message);
      }
      continue;
    }

    if (bucket.public && found.public !== true) {
      try {
        const res = await fetch(`${url}/storage/v1/bucket/${encodeURIComponent(found.id || bucket.id)}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ public: true }),
        });
        if (res.ok) console.log(`[Storage] Bucket ${bucket.name} is now public.`);
        else console.warn(`[Storage] Could not update ${bucket.name}: HTTP ${res.status}`);
      } catch (e) {
        console.warn(`[Storage] Could not update ${bucket.name}:`, e.message);
      }
    }
  }
}

async function init() {
  try {
    console.log('[DB] Running schema migration...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS nodes (
        node_id TEXT PRIMARY KEY, device_label TEXT, account_label TEXT,
        platform TEXT, last_ip TEXT, consent_at BIGINT, expires_at BIGINT, last_seen BIGINT
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id BIGSERIAL PRIMARY KEY, node_id TEXT, task TEXT,
        status TEXT DEFAULT 'pending', report TEXT, created_at BIGINT, executed_at BIGINT
      );
      CREATE TABLE IF NOT EXISTS messages (
        id BIGSERIAL PRIMARY KEY, node_id TEXT, channel TEXT, body TEXT, created_at BIGINT
      );
      CREATE TABLE IF NOT EXISTS file_logs (
        id BIGSERIAL PRIMARY KEY,
        node_id TEXT,
        action TEXT,
        file_path TEXT,
        storage_path TEXT,
        file_size BIGINT,
        created_at BIGINT
      );
    `);
    console.log('[DB] Schema is up to date.');
    await ensureBuckets();
  } catch (e) {
    console.error('[DB] Migration failed:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}
init();
