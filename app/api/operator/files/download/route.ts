import { NextResponse } from 'next/server';
import { checkAdmin, corsHeaders, optionsRes } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function OPTIONS() { return optionsRes(); }

export async function GET(req: Request) {
  if (!checkAdmin(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: corsHeaders });

  const { searchParams } = new URL(req.url);
  const rawPath = (searchParams.get('path') || '').trim();

  if (!rawPath) {
    return NextResponse.json({ error: 'Missing path param' }, { status: 400, headers: corsHeaders });
  }

  if (rawPath.includes('..')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400, headers: corsHeaders });
  }

  const storagePath = rawPath.startsWith('files/') ? rawPath : `files/${rawPath.replace(/^\/+/, '')}`;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 500, headers: corsHeaders });
  }

  const baseUrl = supabaseUrl.replace(/\/$/, '');
  const res = await fetch(`${baseUrl}/storage/v1/object/${storagePath}`, {
    headers: { Authorization: `Bearer ${supabaseKey}` },
    cache: 'no-store',
  });

  if (!res.ok) {
    return NextResponse.json({ error: `Storage returned ${res.status}` }, { status: 502, headers: corsHeaders });
  }

  const contentType = res.headers.get('Content-Type') || 'application/octet-stream';
  const filename = storagePath.split('/').pop() || 'file';
  const body = await res.arrayBuffer();

  return new Response(body, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(body.byteLength),
    },
  });
}
