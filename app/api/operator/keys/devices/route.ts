import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { checkAdmin, corsHeaders, optionsRes } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS() { return optionsRes(); }

export async function GET(req: Request) {
  if (!checkAdmin(req)) {
    return NextResponse.json({ error: 'unauthorized' },
      { status: 401, headers: corsHeaders });
  }
  const keyId = Number(new URL(req.url).searchParams.get('id'));
  if (!Number.isFinite(keyId) || keyId <= 0) {
    return NextResponse.json({ error: 'missing_id' },
      { status: 400, headers: corsHeaders });
  }
  try {
    const result = await pool.query(
      `SELECT id, node_id, device_label, platform, activated_at,
              last_check_at, last_ip, check_count
         FROM license_key_devices
        WHERE key_id = $1
        ORDER BY activated_at ASC, id ASC`, [keyId]);
    return NextResponse.json(result.rows, { headers: corsHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'db_error' },
      { status: 503, headers: corsHeaders });
  }
}

export async function DELETE(req: Request) {
  if (!checkAdmin(req)) {
    return NextResponse.json({ error: 'unauthorized' },
      { status: 401, headers: corsHeaders });
  }
  const params = new URL(req.url).searchParams;
  const keyId = Number(params.get('id'));
  const nodeId = String(params.get('node_id') || '');
  if (!Number.isFinite(keyId) || keyId <= 0 || !nodeId) {
    return NextResponse.json({ error: 'missing_id' },
      { status: 400, headers: corsHeaders });
  }
  try {
    await pool.query(
      `DELETE FROM license_key_devices
        WHERE key_id = $1 AND node_id = $2`, [keyId, nodeId]);
    return NextResponse.json({ ok: true, id: keyId, node_id: nodeId },
      { headers: corsHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'db_error' },
      { status: 503, headers: corsHeaders });
  }
}
