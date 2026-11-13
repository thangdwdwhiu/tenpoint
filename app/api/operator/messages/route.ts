import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { checkAdmin, corsHeaders, optionsRes } from '@/lib/auth';
import { chatError, chatPayload, validMessage } from '@/lib/chat';

export async function OPTIONS() { return optionsRes(); }

export async function POST(req: Request) {
  if (!checkAdmin(req)) return NextResponse.json({ error: 'unauth' }, { status: 401, headers: corsHeaders });
  const b = await chatPayload(req);
  if (!b || !validMessage(b)) return chatError('invalid_message', 400);
  try {
    await pool.query(`INSERT INTO messages (node_id, channel, body, created_at) VALUES ($1, 'to_node', $2, $3)`,
      [b.node_id, b.body, Math.floor(Date.now() / 1000)]);
  } catch (error) {
    console.error('[chat] send failed', error);
    return chatError('send_failed', 503);
  }
  return NextResponse.json({ status: 'ok' }, { headers: corsHeaders });
}
