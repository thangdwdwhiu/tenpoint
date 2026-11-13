import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { verifySig, corsHeaders, optionsRes } from '@/lib/auth';

export const dynamic = 'force-dynamic';

type TaskResult = {
  ok?: boolean;
  path?: string;
  size?: number;
  dest?: string;
  error?: string;
};

export async function OPTIONS() { return optionsRes(); }

export async function POST(req: Request) {
  const b = await req.json();
  if (!verifySig(b.node_id, b.sig)) return NextResponse.json({ error: 'sig' }, { status: 401, headers: corsHeaders });

  const now = Math.floor(Date.now() / 1000);
  const report = typeof b.report === 'string' ? b.report : String(b.report ?? '');

  const updated = await pool.query(
    `UPDATE tasks SET status = $1, report = $2, executed_at = $3
     WHERE id = $4 AND node_id = $5
     RETURNING task`,
    [b.status, report.substring(0, 200000), now, b.task_id, b.node_id],
  );

  const taskText: string = updated.rows[0]?.task || '';

  if (!report.trim().startsWith('{')) {
    return NextResponse.json({ status: 'ok' }, { headers: corsHeaders });
  }

  let parsed: TaskResult;
  try {
    parsed = JSON.parse(report) as TaskResult;
  } catch {
    return NextResponse.json({ status: 'ok' }, { headers: corsHeaders });
  }

  if (parsed.ok !== true) {
    return NextResponse.json({ status: 'ok' }, { headers: corsHeaders });
  }

  try {
    if (taskText.startsWith('UPLOAD_FILE')) {
      await pool.query(
        `INSERT INTO file_logs (node_id, action, file_path, storage_path, file_size, created_at)
         VALUES ($1, 'upload', $2, $3, $4, $5)`,
        [b.node_id, taskText.slice('UPLOAD_FILE'.length).trim(), parsed.path || null, parsed.size || null, now],
      );
    } else if (taskText.startsWith('SCREENSHOT')) {
      await pool.query(
        `INSERT INTO file_logs (node_id, action, file_path, storage_path, file_size, created_at)
         VALUES ($1, 'screenshot', $2, $3, $4, $5)`,
        [b.node_id, parsed.path || null, parsed.path || null, null, now],
      );
    } else if (taskText.startsWith('DELIVER_FILE')) {
      const arg = taskText.slice('DELIVER_FILE'.length).trim();
      const storagePath = arg.split('|')[0] || null;
      await pool.query(
        `INSERT INTO file_logs (node_id, action, file_path, storage_path, file_size, created_at)
         VALUES ($1, 'deliver', $2, $3, $4, $5)`,
        [b.node_id, parsed.dest || null, storagePath, parsed.size || null, now],
      );
    }
  } catch {
    // Logging must never break task reporting.
  }

  return NextResponse.json({ status: 'ok' }, { headers: corsHeaders });
}
