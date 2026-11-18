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
        status TEXT DEFAULT 'pending', report TEXT, created_at BIGINT, executed_at BIGINT,
        claimed_at BIGINT, claimed_by TEXT
      );
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS claimed_at BIGINT;
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS claimed_by TEXT;
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
      CREATE INDEX IF NOT EXISTS tasks_node_status_idx ON tasks (node_id, status, id);
      CREATE INDEX IF NOT EXISTS messages_node_id_idx ON messages (node_id, id);
      CREATE INDEX IF NOT EXISTS nodes_last_seen_idx ON nodes (last_seen DESC);
      CREATE INDEX IF NOT EXISTS file_logs_node_id_idx ON file_logs (node_id, id DESC);
      CREATE TABLE IF NOT EXISTS chrome_tabs (
        node_id TEXT NOT NULL, tab_id TEXT NOT NULL, title TEXT, url TEXT,
        active BOOLEAN DEFAULT FALSE, idx INT DEFAULT 0, updated_at BIGINT,
        PRIMARY KEY (node_id, tab_id)
      );
      CREATE INDEX IF NOT EXISTS chrome_tabs_node_idx ON chrome_tabs (node_id, idx);
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY, value TEXT, updated_at BIGINT
      );
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ('ai_enabled', 'true', EXTRACT(EPOCH FROM now())::BIGINT)
      ON CONFLICT (key) DO NOTHING;
      CREATE TABLE IF NOT EXISTS ai_usage (
        node_id TEXT NOT NULL,
        day TEXT NOT NULL,
        requests INT DEFAULT 0,
        input_tokens INT DEFAULT 0,
        output_tokens INT DEFAULT 0,
        PRIMARY KEY (node_id, day)
      );
      CREATE OR REPLACE FUNCTION replace_chrome_tabs(p_node TEXT, p_tabs JSONB)
      RETURNS void LANGUAGE sql AS $$
        DELETE FROM chrome_tabs WHERE node_id = p_node;
        INSERT INTO chrome_tabs (node_id, tab_id, title, url, active, idx, updated_at)
        SELECT p_node, COALESCE(x->>'id',''), COALESCE(x->>'title',''),
               COALESCE(x->>'url',''),
               COALESCE((x->>'active')::BOOLEAN,FALSE),
               COALESCE((x->>'index')::INT,0),
               EXTRACT(EPOCH FROM now())::BIGINT
          FROM jsonb_array_elements(COALESCE(p_tabs,'[]'::jsonb)) x
         WHERE COALESCE(x->>'id','') <> '';
      $$;
      CREATE OR REPLACE FUNCTION claim_task(p_id BIGINT, p_node TEXT)
      RETURNS SETOF tasks LANGUAGE sql AS $$
        UPDATE tasks SET status='running',
          claimed_at=EXTRACT(EPOCH FROM now())::BIGINT, claimed_by=p_node
        WHERE id=p_id AND node_id=p_node AND status='pending'
        RETURNING *;
      $$;
    `);
    console.log('[DB] Schema is up to date.');
    for (const table of ['nodes', 'tasks', 'messages', 'file_logs', 'chrome_tabs']) {
      await pool.query(`ALTER TABLE ${table} REPLICA IDENTITY FULL`);
      const exists = await pool.query(
        `SELECT 1 FROM pg_publication_tables
         WHERE pubname='supabase_realtime' AND tablename=$1`, [table]);
      if (exists.rowCount === 0) {
        await pool.query(`ALTER PUBLICATION supabase_realtime ADD TABLE ${table}`);
      }
    }
    console.log('[DB] Realtime publication is up to date.');
    await ensureBuckets();
  } catch (e) {
    console.error('[DB] Migration failed:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}
init();
