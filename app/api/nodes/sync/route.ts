import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { verifySig, corsHeaders, optionsRes } from '@/lib/auth';

export async function OPTIONS() { return optionsRes(); }

export async function POST(req: Request) {
  const b = await req.json();
  if (!verifySig(b.node_id, b.sig)) return NextResponse.json({ error: 'sig' }, { status: 401, headers: corsHeaders });
  const now = Math.floor(Date.now() / 1000);
  
  const res = await pool.query('SELECT expires_at FROM nodes WHERE node_id = $1', [b.node_id]);
  if (res.rowCount === 0) return NextResponse.json({ error: 'not_found' }, { status: 401, headers: corsHeaders });
  if (res.rows[0].expires_at < now) {
    await pool.query('DELETE FROM nodes WHERE node_id = $1', [b.node_id]);
    return NextResponse.json({ tasks: [], expired: true }, { headers: corsHeaders });
  }
  await pool.query('UPDATE nodes SET last_seen = $1 WHERE node_id = $2', [now, b.node_id]);
  const tasks = await pool.query(`SELECT id, task FROM tasks WHERE node_id = $1 AND status = 'pending' ORDER BY id ASC LIMIT 10`, [b.node_id]);
  return NextResponse.json({ tasks: tasks.rows }, { headers: corsHeaders });
}