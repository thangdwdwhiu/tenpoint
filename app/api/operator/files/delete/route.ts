import { NextResponse } from 'next/server';
import { checkAdmin, corsHeaders, optionsRes } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function OPTIONS() { return optionsRes(); }

export async function DELETE(req: Request) {
  if (!checkAdmin(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: corsHeaders });

  const { searchParams } = new URL(req.url);
  const rawPath = (searchParams.get('path') || '').trim();

  if (!rawPath || rawPath.includes('..')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400, headers: corsHeaders });
  }

  const objectPath = rawPath.startsWith('files/')
    ? rawPath.slice('files/'.length)
    : rawPath.replace(/^\/+/, '');

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 500, headers: corsHeaders });
  }

  const baseUrl = supabaseUrl.replace(/\/$/, '');
  const res = await fetch(`${baseUrl}/storage/v1/object/files`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prefixes: [objectPath] }),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: `Storage returned ${res.status}: ${err.slice(0, 300)}` }, { status: 502, headers: corsHeaders });
  }

  return NextResponse.json({ status: 'ok', deleted: objectPath }, { headers: corsHeaders });
}
