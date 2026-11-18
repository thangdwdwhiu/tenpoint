import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { checkAdmin, corsHeaders, optionsRes } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readEnabled(): Promise<boolean> {
  try {
    const result = await pool.query(
      `SELECT value FROM app_settings WHERE key = 'ai_enabled'`);
    if (result.rowCount === 0) return true;
    return String(result.rows[0].value).toLowerCase() === 'true';
  } catch {
    return true;
  }
}

export async function OPTIONS() { return optionsRes(); }

export async function GET(req: Request) {
  if (!checkAdmin(req)) {
    return NextResponse.json({ error: 'unauthorized' },
      { status: 401, headers: corsHeaders });
  }
  return NextResponse.json({ ai_enabled: await readEnabled() },
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
  const enabled = Boolean(body.ai_enabled);
  try {
    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('ai_enabled', $1, $2)
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = EXCLUDED.updated_at`,
      [enabled ? 'true' : 'false', Math.floor(Date.now() / 1000)]);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'db_error' },
      { status: 503, headers: corsHeaders });
  }
  return NextResponse.json({ ok: true, ai_enabled: enabled },
    { headers: corsHeaders });
}
