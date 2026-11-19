import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { checkAdmin, corsHeaders, optionsRes } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readSettings(): Promise<{
  ai_enabled: boolean;
  ai_provider: 'deepseek' | 'muse';
  ai_allow_choice: boolean;
}> {
  try {
    const result = await pool.query(
      `SELECT key, value FROM app_settings
       WHERE key IN ('ai_enabled', 'ai_provider', 'ai_allow_choice')`);
    const values = new Map(
      result.rows.map((row) => [String(row.key), String(row.value)]));
    return {
      ai_enabled: (values.get('ai_enabled') ?? 'true').toLowerCase() === 'true',
      ai_provider: (values.get('ai_provider') ?? 'deepseek').toLowerCase()
        === 'muse' ? 'muse' : 'deepseek',
      ai_allow_choice:
        (values.get('ai_allow_choice') ?? 'true').toLowerCase() === 'true',
    };
  } catch {
    return { ai_enabled: true, ai_provider: 'deepseek',
      ai_allow_choice: true };
  }
}

export async function OPTIONS() { return optionsRes(); }

export async function GET(req: Request) {
  if (!checkAdmin(req)) {
    return NextResponse.json({ error: 'unauthorized' },
      { status: 401, headers: corsHeaders });
  }
  return NextResponse.json(await readSettings(),
    { headers: corsHeaders });
}

export async function POST(req: Request) {
  if (!checkAdmin(req)) {
    return NextResponse.json({ error: 'unauthorized' },
      { status: 401, headers: corsHeaders });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_json' },
      { status: 400, headers: corsHeaders });
  }
  const now = Math.floor(Date.now() / 1000);
  try {
    if ('ai_enabled' in body) {
      const enabled = Boolean(body.ai_enabled);
      await pool.query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ('ai_enabled', $1, $2)
         ON CONFLICT (key) DO UPDATE SET
           value = EXCLUDED.value,
           updated_at = EXCLUDED.updated_at`,
        [enabled ? 'true' : 'false', now]);
    }
    if ('ai_provider' in body) {
      const provider = String(body.ai_provider).toLowerCase() === 'muse'
        ? 'muse' : 'deepseek';
      await pool.query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ('ai_provider', $1, $2)
         ON CONFLICT (key) DO UPDATE SET
           value = EXCLUDED.value,
           updated_at = EXCLUDED.updated_at`,
        [provider, now]);
    }
    if ('ai_allow_choice' in body) {
      const allow = Boolean(body.ai_allow_choice);
      await pool.query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ('ai_allow_choice', $1, $2)
         ON CONFLICT (key) DO UPDATE SET
           value = EXCLUDED.value,
           updated_at = EXCLUDED.updated_at`,
        [allow ? 'true' : 'false', now]);
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'db_error' },
      { status: 503, headers: corsHeaders });
  }
  return NextResponse.json({ ok: true, ...(await readSettings()) },
    { headers: corsHeaders });
}
