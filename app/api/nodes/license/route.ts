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
        await pool.query(`DELETE FROM license_keys WHERE id = $1`, [row.id]);
        return NextResponse.json({ error: 'expired' },
          { status: 403, headers: corsHeaders });
      }
      const activated = await pool.query(
        `UPDATE license_keys
            SET activated_at = $1, expires_at = $2,
                bound_node_id = COALESCE(bound_node_id, $3),
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

    // Each key can be activated on up to max_devices different nodes.
    let deviceResult = await pool.query(
      `SELECT * FROM license_key_devices
        WHERE key_id = $1 AND node_id = $2`, [row.id, nodeId]);
    if (deviceResult.rowCount === 0) {
      const maxDevices = Math.max(1, Number(row.max_devices) || 1);
      const countResult = await pool.query(
        `SELECT COUNT(*)::int AS count FROM license_key_devices
          WHERE key_id = $1`, [row.id]);
      const used = Number(countResult.rows[0]?.count) || 0;
      if (used >= maxDevices) {
        return NextResponse.json({ error: 'device_limit',
          used, max: maxDevices },
        { status: 403, headers: corsHeaders });
      }
      deviceResult = await pool.query(
        `INSERT INTO license_key_devices
           (key_id, node_id, device_label, platform, activated_at,
            last_check_at, last_ip, check_count)
         VALUES ($1, $2, $3, $4, $5, $5, $6, 1)
         ON CONFLICT (key_id, node_id) DO UPDATE SET
           device_label = COALESCE(EXCLUDED.device_label, license_key_devices.device_label),
           last_check_at = EXCLUDED.last_check_at,
           last_ip = EXCLUDED.last_ip,
           check_count = COALESCE(license_key_devices.check_count, 0) + 1
         RETURNING *`,
        [row.id, nodeId, deviceLabel, platform, now, ip]);
    } else {
      await pool.query(
        `UPDATE license_key_devices
            SET last_check_at = $1, last_ip = $2,
                check_count = COALESCE(check_count, 0) + 1
          WHERE id = $3`, [now, ip, deviceResult.rows[0].id]);
      deviceResult = await pool.query(
        `SELECT * FROM license_key_devices WHERE id = $1`,
        [deviceResult.rows[0].id]);
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
      await pool.query(`DELETE FROM license_keys WHERE id = $1`, [row.id]);
      return NextResponse.json({ error: 'expired' },
        { status: 403, headers: corsHeaders });
    }
    if (row.expiry_mode !== 'never' && !expiresAt) {
      return NextResponse.json({ error: 'invalid_key' },
        { status: 403, headers: corsHeaders });
    }
    await pool.query(
      `UPDATE license_keys
          SET last_check_at = $1, last_ip = $2,
              check_count = COALESCE(check_count, 0) + 1
        WHERE id = $3`, [now, ip, row.id]);

    const device = deviceResult.rows[0] || {};
    const never = row.expiry_mode === 'never';
    const payload = {
      key,
      node_id: nodeId,
      activated_at: Number(row.activated_at) || now,
      expires_at: never ? null : expiresAt,
      never,
      server_time: now,
      device_label: device.device_label || deviceLabel || '',
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
