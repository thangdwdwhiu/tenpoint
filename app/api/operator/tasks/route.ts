import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { checkAdmin, corsHeaders, optionsRes } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function OPTIONS() { return optionsRes(); }

export async function GET(req: Request) {
  if (!checkAdmin(req)) return NextResponse.json({ error: 'unauth' }, { status: 401, headers: corsHeaders });
  const { searchParams } = new URL(req.url);
  const nodeId = searchParams.get('node_id');
  const limit = Math.min(Number(searchParams.get('limit') || 100) || 100, 500);

  const r = nodeId
    ? await pool.query('SELECT * FROM tasks WHERE node_id = $1 ORDER BY id DESC LIMIT $2', [nodeId, limit])
    : await pool.query('SELECT * FROM tasks ORDER BY id DESC LIMIT $1', [limit]);

  return NextResponse.json({ tasks: r.rows }, { headers: corsHeaders });
}

export async function POST(req: Request) {
  if (!checkAdmin(req)) return NextResponse.json({ error: 'unauth' }, { status: 401, headers: corsHeaders });
  const b = await req.json();
  if (!b || typeof b.task !== 'string' || !b.task.trim()) {
    return NextResponse.json({ error: 'invalid_task' }, { status: 400, headers: corsHeaders });
  }
  if (typeof b.node_id !== 'string' || !b.node_id) {
    return NextResponse.json({ error: 'invalid_node' }, { status: 400, headers: corsHeaders });
  }

  const now = Math.floor(Date.now() / 1000);
  const task = b.task;

  if (b.node_id === 'all') {
    const nodes = await pool.query('SELECT node_id FROM nodes');
    const ids: Array<string | number> = [];
    for (const n of nodes.rows) {
      const inserted = await pool.query(
        'INSERT INTO tasks (node_id, task, created_at) VALUES ($1,$2,$3) RETURNING id',
        [n.node_id, task, now],
      );
      ids.push(inserted.rows[0].id);
    }
    return NextResponse.json({ status: 'ok', ids }, { headers: corsHeaders });
  }

  const inserted = await pool.query(
    'INSERT INTO tasks (node_id, task, created_at) VALUES ($1,$2,$3) RETURNING id',
    [b.node_id, task, now],
  );

  return NextResponse.json({ status: 'ok', id: inserted.rows[0].id }, { headers: corsHeaders });
}
