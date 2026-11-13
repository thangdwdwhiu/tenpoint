import { NextResponse } from 'next/server';
import { checkAdmin, corsHeaders, optionsRes } from '@/lib/auth';

export const dynamic = 'force-dynamic';

type StorageEntry = {
  name: string;
  id: string | null;
  metadata: { size?: number; mimetype?: string } | null;
  created_at: string;
};

type StorageFile = {
  name: string;
  path: string;
  id: string | null;
  metadata: { size?: number; mimetype?: string } | null;
  created_at: string;
  node_id: string;
  delivery: boolean;
};

async function listFolder(
  baseUrl: string,
  key: string,
  prefix: string,
  depth: number,
  out: StorageFile[],
): Promise<void> {
  if (depth > 6 || out.length >= 2000) return;

  const res = await fetch(`${baseUrl}/storage/v1/object/list/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prefix,
      limit: 1000,
      sortBy: { column: 'created_at', order: 'desc' },
    }),
    cache: 'no-store',
  });

  if (!res.ok) return;

  const entries = (await res.json()) as StorageEntry[];

  for (const entry of entries) {
    if (out.length >= 2000) return;

    const full = prefix
      ? `${prefix.replace(/\/+$/, '')}/${entry.name}`
      : entry.name;
    const isFolder = entry.id === null || entry.metadata === null;

    if (isFolder) {
      await listFolder(baseUrl, key, `${full}/`, depth + 1, out);
      continue;
    }

    const first = full.split('/')[0];
    out.push({
      name: full,
      path: `files/${full}`,
      id: entry.id,
      metadata: entry.metadata,
      created_at: entry.created_at,
      node_id: first === 'deliver' ? (full.split('/')[1] || '') : first,
      delivery: first === 'deliver',
    });
  }
}

export async function OPTIONS() { return optionsRes(); }

export async function GET(req: Request) {
  if (!checkAdmin(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: corsHeaders });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 500, headers: corsHeaders });
  }

  const baseUrl = supabaseUrl.replace(/\/$/, '');
  const files: StorageFile[] = [];

  try {
    await listFolder(baseUrl, supabaseKey, '', 0, files);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'storage_error' },
      { status: 502, headers: corsHeaders },
    );
  }

  files.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return NextResponse.json({ files }, { headers: corsHeaders });
}
