import crypto from 'crypto';
import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { checkAdmin, corsHeaders, optionsRes } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomKey(): string {
  const bytes = crypto.randomBytes(16);
  const chars: string[] = [];
  for (let i = 0; i < 16; i += 1) {
    chars.push(KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length]);
  }
  const groups = [];
  for (let i = 0; i < 16; i += 4) groups.push(chars.slice(i, i + 4).join(''));
  return `RD-${groups.join('-')}`;
}

function asEpoch(value: unknown): number | null {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number > 1e12 ? Math.floor(number / 1000) : Math.floor(number);
}

export async function OPTIONS() { return optionsRes(); }

export async function GET(req: Request) {
  if (!checkAdmin(req)) {
    return NextResponse.json({ error: 'unauthorized' },
      { status: 401, headers: corsHeaders });
  }
  try {
    // Remove keys whose validity has ended so the panel list stays clean.
    await pool.query(
      `DELETE FROM license_keys
        WHERE expires_at IS NOT NULL
          AND expires_at <= EXTRACT(EPOCH FROM now())::BIGINT`);
    const result = await pool.query(
      `SELECT k.id, k.key_value, k.expiry_mode, k.duration_seconds,
              k.expires_at, k.created_at, k.activated_at,
              k.bound_node_id, k.device_label, k.last_check_at,
              k.check_count, k.max_devices,
              (SELECT COUNT(*)::int FROM license_key_devices d
                WHERE d.key_id = k.id) AS device_count
         FROM license_keys k
        ORDER BY k.created_at DESC, k.id DESC
        LIMIT 1000`);
    return NextResponse.json(result.rows, { headers: corsHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'db_error' },
      { status: 503, headers: corsHeaders });
  }
}

export async function POST(req: Request) {
  if (!checkAdmin(req)) {
    return NextResponse.json({ error: 'unauthorized' },
      { status: 401, headers: corsHeaders });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_json' },
      { status: 400, headers: corsHeaders });
  }

  const never = Boolean(body.never);
  const expiresAt = asEpoch(body.expires_at);
  const days = Number(body.duration_days);
  const maxDevices = Math.max(
    1, Math.min(1000, Math.floor(Number(body.max_devices) || 1)));
  let mode = 'days';
  let durationSeconds: number | null = null;
  let expiry: number | null = null;

  if (never) {
    mode = 'never';
  } else if (expiresAt) {
    mode = 'date';
    expiry = expiresAt;
    if (expiry <= Math.floor(Date.now() / 1000)) {
      return NextResponse.json({ error: 'expires_at must be in the future' },
        { status: 400, headers: corsHeaders });
    }
  } else if (Number.isFinite(days) && days > 0) {
    mode = 'days';
    durationSeconds = Math.max(60, Math.round(days * 86400));
  } else {
    return NextResponse.json({ error: 'missing_duration' },
      { status: 400, headers: corsHeaders });
  }

  const now = Math.floor(Date.now() / 1000);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const value = randomKey();
    try {
      const result = await pool.query(
        `INSERT INTO license_keys
           (key_value, expiry_mode, duration_seconds, expires_at,
            created_at, max_devices)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, key_value, expiry_mode, duration_seconds, expires_at,
                   created_at, activated_at, max_devices, device_label`,
        [value, mode, durationSeconds, expiry, now, maxDevices]);
      return NextResponse.json(result.rows[0],
        { status: 201, headers: corsHeaders });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '23505') continue; // duplicate, retry
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'db_error' },
        { status: 503, headers: corsHeaders });
    }
  }
  return NextResponse.json({ error: 'could_not_generate_key' },
    { status: 500, headers: corsHeaders });
}

export async function DELETE(req: Request) {
  if (!checkAdmin(req)) {
    return NextResponse.json({ error: 'unauthorized' },
      { status: 401, headers: corsHeaders });
  }
  const id = Number(new URL(req.url).searchParams.get('id'));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'missing_id' },
      { status: 400, headers: corsHeaders });
  }
  try {
    await pool.query(`DELETE FROM license_keys WHERE id = $1`, [id]);
    return NextResponse.json({ ok: true, id },
      { headers: corsHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'db_error' },
      { status: 503, headers: corsHeaders });
  }
}
