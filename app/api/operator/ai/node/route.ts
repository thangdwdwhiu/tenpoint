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
  const nodeId = new URL(req.url).searchParams.get('node_id') || '';
  if (!nodeId) {
    return NextResponse.json({ error: 'missing_node' },
      { status: 400, headers: corsHeaders });
  }
  try {
    const result = await pool.query(
      `SELECT ai_blocked FROM nodes WHERE node_id = $1`, [nodeId]);
    if (result.rowCount === 0) {
      return NextResponse.json({ error: 'node_not_found' },
        { status: 404, headers: corsHeaders });
    }
    return NextResponse.json(
      { node_id: nodeId, blocked: Boolean(result.rows[0].ai_blocked) },
      { headers: corsHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'db_error' },
      { status: 503, headers: corsHeaders });
  }
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
  const nodeId = String(body.node_id || '');
  if (!nodeId) {
    return NextResponse.json({ error: 'missing_node' },
      { status: 400, headers: corsHeaders });
  }
  const blocked = Boolean(body.blocked);
  try {
    const result = await pool.query(
      `UPDATE nodes SET ai_blocked = $1 WHERE node_id = $2`,
      [blocked, nodeId]);
    if (result.rowCount === 0) {
      return NextResponse.json({ error: 'node_not_found' },
        { status: 404, headers: corsHeaders });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'db_error' },
      { status: 503, headers: corsHeaders });
  }
  return NextResponse.json({ ok: true, node_id: nodeId, blocked },
    { headers: corsHeaders });
}
