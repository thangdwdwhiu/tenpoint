import crypto from 'crypto';
import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { verifySig, corsHeaders, optionsRes } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizeKey(value: unknown): string {
  return String(value || '').toUpperCase().replace(/\s+/g, '')
    .replace(/_/g, '-').trim();
}

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

function signLicense(payload: Record<string, unknown>): string {
  const secret = process.env.LICENSE_SECRET || 'relaydesk-license-v1';
  const body = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret)
    .update(body).digest('base64url');
  return `${body}.${signature}`;
}

function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for') || '';
  return forwarded.split(',')[0].trim().slice(0, 100);
}

export async function OPTIONS() { return optionsRes(); }

export async function POST(req: Request) {
  let body: Record<string, any>;
  try {
    body = await req.json() as Record<string, any>;
  } catch {
    return NextResponse.json({ error: 'invalid_json' },
      { status: 400, headers: corsHeaders });
  }
  const nodeId = String(body.node_id || '');
  const sig = String(body.sig || '');
  if (!nodeId || !verifySig(nodeId, sig)) {
    return NextResponse.json({ error: 'sig' },
      { status: 401, headers: corsHeaders });
  }
  const key = normalizeKey(body.key);
  if (!key) {
    return NextResponse.json({ error: 'missing_key' },
      { status: 400, headers: corsHeaders });
  }
  const deviceLabel = String(body.device_label || '').slice(0, 120);
  const platform = String(body.platform || '').slice(0, 40);
  const ip = clientIp(req);
  const now = Math.floor(Date.now() / 1000);

  try {
    let result = await pool.query(
      `SELECT * FROM license_keys WHERE key_value = $1`, [key]);
    if (result.rowCount === 0) {
      return NextResponse.json({ error: 'invalid_key' },
        { status: 403, headers: corsHeaders });
    }
    let row = result.rows[0];

    if (!row.activated_at) {
      let expiresAt: number | null = null;
      if (row.expiry_mode === 'never') {
        expiresAt = null;
      } else if (row.expiry_mode === 'date') {
        expiresAt = Number(row.expires_at) || null;
      } else {
        const duration = Number(row.duration_seconds) || 0;
        expiresAt = now + Math.max(60, duration);
      }
      if (expiresAt && expiresAt <= now) {
        return NextResponse.json({ error: 'expired' },
          { status: 403, headers: corsHeaders });
      }
      const activated = await pool.query(
        `UPDATE license_keys
            SET activated_at = $1, expires_at = $2, bound_node_id = $3,
                device_label = COALESCE(NULLIF($4, ''), device_label),
                last_check_at = $1, last_ip = $5,
                check_count = COALESCE(check_count, 0) + 1
          WHERE id = $6 AND activated_at IS NULL
          RETURNING *`,
        [now, expiresAt, nodeId, deviceLabel, ip, row.id]);
      if (activated.rowCount === 0) {
        result = await pool.query(
          `SELECT * FROM license_keys WHERE key_value = $1`, [key]);
        row = result.rows[0];
      } else {
        row = activated.rows[0];
      }
    }

    if (row.bound_node_id && String(row.bound_node_id) !== nodeId) {
      return NextResponse.json({ error: 'key_in_use' },
        { status: 403, headers: corsHeaders });
    }
    // Legacy keys that were never bound: bind to the first node that checks.
    if (!row.bound_node_id) {
      await pool.query(
        `UPDATE license_keys SET bound_node_id = $1,
           device_label = COALESCE(NULLIF($2, ''), device_label),
           activated_at = COALESCE(activated_at, $3),
           last_check_at = $3, last_ip = $4,
           check_count = COALESCE(check_count, 0) + 1
         WHERE id = $5`,
        [nodeId, deviceLabel, now, ip, row.id]);
      row.bound_node_id = nodeId;
      row.device_label = deviceLabel || row.device_label;
      row.activated_at = row.activated_at || now;
    }

    let expiresAt = row.expires_at ? Number(row.expires_at) : null;
    if (!expiresAt && row.expiry_mode === 'days' && row.activated_at) {
      const duration = Number(row.duration_seconds) || 0;
      if (duration > 0) {
        expiresAt = Number(row.activated_at) + duration;
        await pool.query(
          `UPDATE license_keys SET expires_at = $1 WHERE id = $2`,
          [expiresAt, row.id]);
      }
    }
    if (expiresAt && expiresAt <= now) {
      return NextResponse.json({ error: 'expired' },
        { status: 403, headers: corsHeaders });
    }
    if (row.expiry_mode !== 'never' && !expiresAt) {
      return NextResponse.json({ error: 'invalid_key' },
        { status: 403, headers: corsHeaders });
    }
    if (expiresAt && row.bound_node_id === nodeId) {
      await pool.query(
        `UPDATE license_keys
            SET last_check_at = $1, last_ip = $2,
                check_count = COALESCE(check_count, 0) + 1
          WHERE id = $3`, [now, ip, row.id]);
    }

    const never = row.expiry_mode === 'never';
    const payload = {
      key,
      node_id: nodeId,
      activated_at: Number(row.activated_at) || now,
      expires_at: never ? null : expiresAt,
      never,
      server_time: now,
      device_label: row.device_label || deviceLabel || '',
      platform,
    };
    return NextResponse.json({
      ok: true,
      key,
      activated_at: payload.activated_at,
      expires_at: payload.expires_at,
      never,
      server_time: now,
      device_label: payload.device_label,
      token: signLicense(payload),
      // Re-check periodically for revocation, and always at expiry.
      check_after_seconds: never ? 21600
        : Math.max(60, Math.min(21600, (expiresAt || now) - now)),
    }, { headers: corsHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'db_error' },
      { status: 503, headers: corsHeaders });
  }
}
