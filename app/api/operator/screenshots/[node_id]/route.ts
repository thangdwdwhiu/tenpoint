import { NextResponse } from 'next/server';
import { checkAdmin, corsHeaders, optionsRes } from '@/lib/auth';

export async function OPTIONS() { return optionsRes(); }

export async function GET(req: Request, { params }: { params: { node_id: string } }) {
  if (!checkAdmin(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: corsHeaders });

  const { node_id } = params;
  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY!;

  const res = await fetch(`${supabaseUrl}/storage/v1/object/list/screenshots`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prefix: `${node_id}/`, limit: 500, sortBy: { column: 'created_at', order: 'desc' } }),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: err }, { status: 502, headers: corsHeaders });
  }

  const data = await res.json() as Array<{
    name: string;
    id: string;
    created_at: string;
  }>;

  const screenshots = data.map((f) => ({
    name: `${node_id}/${f.name}`,
    id: f.id,
    created_at: f.created_at,
    node_id,
    url: `${supabaseUrl}/storage/v1/object/public/screenshots/${node_id}/${f.name}`,
  }));

  return NextResponse.json({ screenshots }, { headers: corsHeaders });
}
