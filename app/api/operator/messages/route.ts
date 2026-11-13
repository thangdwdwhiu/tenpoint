import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { checkAdmin, corsHeaders, optionsRes } from '@/lib/auth';
import { chatError, chatPayload, validMessage } from '@/lib/chat';

export async function OPTIONS() { return optionsRes(); }

export async function POST(req: Request) {
  if (!checkAdmin(req)) return NextResponse.json({ error: 'unauth' }, { status: 401, headers: corsHeaders });
  const b = await chatPayload(req);
  if (!b || !validMessage(b)) return chatError('invalid_message', 400);
  const channel = b.event === true ? 'event_to_node' : 'to_node';
  try {
    await pool.query(`INSERT INTO messages (node_id, channel, body, created_at) VALUES ($1, $2, $3, $4)`,
      [b.node_id, channel, b.body, Math.floor(Date.now() / 1000)]);
  } catch (error) {
    console.error('[chat] send failed', error);
    return chatError('send_failed', 503);
  }
  return NextResponse.json({ status: 'ok' }, { headers: corsHeaders });
}
