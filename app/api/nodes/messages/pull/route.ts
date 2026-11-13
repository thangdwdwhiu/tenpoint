import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { verifySig, corsHeaders, optionsRes } from '@/lib/auth';
import { chatError, chatPayload } from '@/lib/chat';

export async function OPTIONS() { return optionsRes(); }

export async function POST(req: Request) {
  const b = await chatPayload(req);
  if (!b || typeof b.node_id !== 'string' || typeof b.sig !== 'string') return chatError('invalid_request', 400);
  if (!verifySig(b.node_id, b.sig)) return NextResponse.json({ error: 'sig' }, { status: 401, headers: corsHeaders });
  
  // Keep BIGINT cursors as strings to preserve IDs above Number.MAX_SAFE_INTEGER.
  const hasId = b.last_id !== undefined;
  const cursor = String(hasId ? b.last_id : (b.since ?? 0));
  if (!/^\d{1,19}$/.test(cursor) || BigInt(cursor) > BigInt('9223372036854775807')) {
    return NextResponse.json({ error: 'invalid_cursor' }, { status: 400, headers: corsHeaders });
  }

  // Legacy timestamp clients remain supported; current clients paginate by ID.
  try {
    const rows = await pool.query(
    `SELECT id, body, channel, created_at 
     FROM messages 
     WHERE node_id = $1 
     AND channel IN ('to_node', 'event_to_node', 'event_from_node')
     AND ${hasId ? 'id' : 'created_at'} > $2 
     ORDER BY id ASC LIMIT 20`, 
    [b.node_id, cursor]
  );
  
  return NextResponse.json({ messages: rows.rows }, { headers: corsHeaders });
  } catch (error) {
    console.error('[chat] pull failed', error);
    return chatError('pull_failed', 503);
  }
}
