import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { checkAdmin, corsHeaders, optionsRes } from '@/lib/auth';
import { chatError } from '@/lib/chat';

export async function OPTIONS() { return optionsRes(); }

export async function GET(req: Request, { params }: { params: { node_id: string } }) {
  if (!checkAdmin(req)) return NextResponse.json({ error: 'unauth' }, { status: 401, headers: corsHeaders });
  try {
    const r = await pool.query('SELECT * FROM messages WHERE node_id = $1 ORDER BY id DESC LIMIT 100', [params.node_id]);
    return NextResponse.json({ messages: r.rows }, { headers: corsHeaders });
  } catch (error) {
    console.error('[chat] history failed', error);
    return chatError('history_failed', 503);
  }
}

export async function DELETE(req: Request, { params }: { params: { node_id: string } }) {
  if (!checkAdmin(req)) return NextResponse.json({ error: 'unauth' }, { status: 401, headers: corsHeaders });
  try {
    const r = await pool.query('DELETE FROM messages WHERE node_id = $1', [params.node_id]);
    return NextResponse.json({ status: 'ok', deleted: r.rowCount ?? 0 }, { headers: corsHeaders });
  } catch (error) {
    console.error('[chat] delete failed', error);
    return chatError('delete_failed', 503);
  }
}
