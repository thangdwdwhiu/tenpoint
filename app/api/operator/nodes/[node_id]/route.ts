import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { checkAdmin, corsHeaders, optionsRes } from '@/lib/auth';

export async function OPTIONS() { return optionsRes(); }

export async function DELETE(req: Request, { params }: { params: { node_id: string } }) {
  if (!checkAdmin(req)) return NextResponse.json({ error: 'unauth' }, { status: 401, headers: corsHeaders });
  await pool.query('DELETE FROM nodes WHERE node_id = $1', [params.node_id]);
  return NextResponse.json({ status: 'ok' }, { headers: corsHeaders });
}