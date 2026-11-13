import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { verifySig, corsHeaders, optionsRes } from '@/lib/auth';
import { chatError, chatPayload, validMessage } from '@/lib/chat';

export async function OPTIONS() { return optionsRes(); }

export async function POST(req: Request) {
  const b = await chatPayload(req);
  if (!b || !validMessage(b) || typeof b.sig !== 'string') return chatError('invalid_message', 400);
  if (!verifySig(b.node_id as string, b.sig)) return NextResponse.json({ error: 'sig' }, { status: 401, headers: corsHeaders });
  
  // SỬA: created_at là BIGINT, insert trực tiếp Math.floor(Date.now() / 1000)
  try {
    const channel = b.event === true ? 'event_from_node' : 'to_operator';
    await pool.query(
    `INSERT INTO messages (node_id, channel, body, created_at) 
     VALUES ($1, $2, $3, $4)`,
    [b.node_id, channel, b.body, Math.floor(Date.now() / 1000)]
  );
  } catch (error) {
    console.error('[chat] send failed', error);
    return chatError('send_failed', 503);
  }
  
  return NextResponse.json({ status: 'ok' }, { headers: corsHeaders });
}
