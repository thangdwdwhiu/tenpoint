import { NextResponse } from 'next/server';
import { corsHeaders } from '@/lib/auth';

export function chatError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: corsHeaders });
}

export async function chatPayload(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const value = await req.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export function validMessage(b: Record<string, unknown>): boolean {
  return typeof b.node_id === 'string' && b.node_id.trim().length > 0 &&
    typeof b.body === 'string' && b.body.trim().length > 0 && b.body.length <= 5000;
}
