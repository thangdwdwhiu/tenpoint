import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { verifySig, corsHeaders, optionsRes } from '@/lib/auth';

export async function OPTIONS() { return optionsRes(); }

export async function POST(req: Request) {
  try {
    const b = await req.json();
    if (!verifySig(b.node_id, b.sig)) return NextResponse.json({ error: 'sig' }, { status: 401, headers: corsHeaders });
    const now = Math.floor(Date.now() / 1000);
    const exp = now + (b.ttl || 3600);
    await pool.query(`
      INSERT INTO nodes (node_id, device_label, account_label, platform, last_ip, consent_at, expires_at, last_seen)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $6)
      ON CONFLICT (node_id) DO UPDATE SET expires_at = $7, last_seen = $6
    `, [b.node_id, b.device_label, b.account_label, b.platform, req.headers.get('x-forwarded-for') || 'LAN', now, exp]);
    return NextResponse.json({ status: 'ok', expires_at: exp }, { headers: corsHeaders });
  } catch { return NextResponse.json({ error: 'err' }, { status: 400, headers: corsHeaders }); }
}