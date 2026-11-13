import { NextResponse } from 'next/server';
import { checkAdmin, corsHeaders, optionsRes } from '@/lib/auth';

export const dynamic = 'force-dynamic';

type StorageEntry = {
  name: string;
  id: string | null;
  metadata: unknown;
};

async function listPaths(
  baseUrl: string,
  key: string,
  prefix: string,
  out: string[],
  depth = 0,
): Promise<void> {
  if (depth > 5 || out.length >= 5000) return;

  const res = await fetch(`${baseUrl}/storage/v1/object/list/screenshots`, {
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

  if (!res.ok) {
    throw new Error(`list ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const entries = (await res.json()) as StorageEntry[];
  for (const entry of entries) {
    const full = prefix
      ? `${prefix.replace(/\/+$/, '')}/${entry.name}`
      : entry.name;
    const isFolder = entry.id === null || entry.metadata === null;
    if (isFolder) {
      await listPaths(baseUrl, key, `${full}/`, out, depth + 1);
      continue;
    }
    out.push(full);
    if (out.length >= 5000) return;
  }
}

export async function OPTIONS() { return optionsRes(); }

export async function DELETE(req: Request) {
  if (!checkAdmin(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: corsHeaders });
  }

  const { searchParams } = new URL(req.url);

  let prefixes = searchParams.getAll('path')
    .map((p) => p.trim().replace(/^\/+/, ''))
    .filter(Boolean)
    .map((p) => (p.startsWith('screenshots/') ? p.slice('screenshots/'.length) : p));

  const nodeId = (searchParams.get('node_id') || '').trim().replace(/^\/+|\/+$/g, '');
  const all = searchParams.get('all') === '1';

  if (prefixes.some((p) => p.includes('..')) || nodeId.includes('..')) {
    return NextResponse.json({ error: 'invalid_path' }, { status: 400, headers: corsHeaders });
  }
  if (!prefixes.length && !nodeId && !all) {
    return NextResponse.json({ error: 'nothing_selected' }, { status: 400, headers: corsHeaders });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 500, headers: corsHeaders });
  }
  const baseUrl = supabaseUrl.replace(/\/$/, '');

  try {
    if (!prefixes.length) {
      // "all" deletes every screenshot; "node_id" deletes that device folder.
      const folder = all ? '' : `${nodeId}/`;
      const found: string[] = [];
      await listPaths(baseUrl, supabaseKey, folder, found);
      prefixes = found;
    }

    if (!prefixes.length) {
      return NextResponse.json({ status: 'ok', deleted: 0 }, { headers: corsHeaders });
    }

    let deleted = 0;
    for (let i = 0; i < prefixes.length; i += 100) {
      const chunk = prefixes.slice(i, i + 100);
      const res = await fetch(`${baseUrl}/storage/v1/object/screenshots`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prefixes: chunk }),
      });
      if (!res.ok) {
        const err = await res.text();
        return NextResponse.json(
          { error: `Storage returned ${res.status}: ${err.slice(0, 300)}`, deleted },
          { status: 502, headers: corsHeaders },
        );
      }
      deleted += chunk.length;
    }

    return NextResponse.json({ status: 'ok', deleted }, { headers: corsHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'delete_failed' },
      { status: 502, headers: corsHeaders },
    );
  }
}
