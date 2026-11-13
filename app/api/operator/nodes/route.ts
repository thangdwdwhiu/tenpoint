import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { checkAdmin, corsHeaders, optionsRes } from '@/lib/auth';

export async function OPTIONS() { return optionsRes(); }

export async function GET(req: Request) {
  if (!checkAdmin(req)) return NextResponse.json({ error: 'unauth' }, { status: 401, headers: corsHeaders });
  const r = await pool.query('SELECT * FROM nodes ORDER BY last_seen DESC');
  return NextResponse.json({ nodes: r.rows }, { headers: corsHeaders });
}