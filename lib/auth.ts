import crypto from 'crypto';

export function verifySig(nodeId: string, sig: string): boolean {
  const secret = process.env.SIGN_SECRET || 'dev_sign_secret';
  const now = Math.floor(Date.now() / 1000 / 60);
  // Chấp nhận cửa sổ thời gian hiện tại và 1 phút trước đó
  for (const w of [now, now - 1]) {
    const expected = crypto.createHash('sha256').update(`${secret}${nodeId}:${w}`).digest('hex');
    if (expected === sig) return true;
  }
  return false;
}

export function checkAdmin(req: Request): boolean {
  return req.headers.get('X-Operator-Key') === (process.env.OPERATOR_KEY || 'dev_operator_key');
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Operator-Key',
};

export function optionsRes() {
  return new Response(null, { status: 204, headers: corsHeaders });
}