import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { verifySig, corsHeaders, optionsRes } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SYSTEM_PROMPT = `Bạn là trợ lý AI hỗ trợ khách hàng của RelayDesk/SupportHelper.
- Trả lời bằng tiếng Việt, ngắn gọn, rõ ràng, theo từng bước.
- Chỉ hướng dẫn sử dụng phần mềm và xử lý sự cố thông thường.
- Không yêu cầu mật khẩu, OTP, dữ liệu cá nhân hoặc bí mật.
- Không hướng dẫn phá hệ thống, xoá dữ liệu, tắt bảo mật.
- Không tự nhận mình là hỗ trợ viên; bạn là trợ lý AI.
- Nếu không chắc chắn, hãy đề nghị khách gửi yêu cầu cho hỗ trợ viên.`;

type Attachment = {
  type?: string;
  name?: string;
  data?: string;
  text?: string;
};

type HistoryItem = { role: string; content: string };

type ProviderResult = {
  answer: string;
  provider: string;
  model: string;
  usage: Record<string, unknown>;
};

function mimeFromName(name: string): string {
  const lower = String(name || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  return 'image/jpeg';
}

function cleanHistory(value: unknown): HistoryItem[] {
  if (!Array.isArray(value)) return [];
  const items: HistoryItem[] = [];
  for (const raw of value.slice(-10)) {
    if (!raw || typeof raw !== 'object') continue;
    const role = (raw as Record<string, unknown>).role;
    const content = (raw as Record<string, unknown>).content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') {
      continue;
    }
    const text = content.trim();
    if (!text) continue;
    items.push({ role, content: text.slice(0, 2000) });
  }
  return items;
}

function cleanAttachment(value: unknown): Attachment | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const type = String(raw.type || '');
  const name = String(raw.name || '').slice(0, 200);
  if (type === 'image') {
    const data = String(raw.data || '');
    if (!data || data.length > 3_000_000) return null;
    return { type, name: name || 'image.jpg', data };
  }
  if (type === 'text') {
    const text = String(raw.text || '').slice(0, 20000);
    if (!text) return null;
    return { type, name: name || 'file.txt', text };
  }
  return null;
}

async function aiEnabled(): Promise<boolean> {
  try {
    const result = await pool.query(
      `SELECT value FROM app_settings WHERE key = 'ai_enabled'`);
    if (result.rowCount === 0) return true;
    return String(result.rows[0].value).toLowerCase() === 'true';
  } catch {
    return true;
  }
}

async function bumpUsage(nodeId: string, usage: Record<string, unknown>) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const input = Number(
      (usage as Record<string, unknown>).prompt_tokens ??
      (usage as Record<string, unknown>).input_tokens ?? 0);
    const output = Number(
      (usage as Record<string, unknown>).completion_tokens ??
      (usage as Record<string, unknown>).output_tokens ?? 0);
    await pool.query(
      `INSERT INTO ai_usage
         (node_id, day, requests, input_tokens, output_tokens)
       VALUES ($1, $2, 1, $3, $4)
       ON CONFLICT (node_id, day) DO UPDATE SET
         requests = ai_usage.requests + 1,
         input_tokens = ai_usage.input_tokens + EXCLUDED.input_tokens,
         output_tokens = ai_usage.output_tokens + EXCLUDED.output_tokens`,
      [nodeId, day, Number.isFinite(input) ? input : 0,
       Number.isFinite(output) ? output : 0]);
  } catch {
    // Usage accounting is best-effort; never fail the chat for it.
  }
}

async function broadcast(nodeId: string, payload: Record<string, unknown>) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    await fetch(`${url.replace(/\/$/, '')}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{
          topic: `ai-${nodeId}`,
          event: 'ai_message',
          payload,
          private: false,
        }],
      }),
      signal: controller.signal,
    });
  } catch {
    // Broadcast is optional; the HTTP answer is still returned.
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function buildUserContent(prompt: string, attachment: Attachment | null) {
  if (attachment?.type === 'image') {
    const mime = mimeFromName(attachment.name || '');
    return [
      { type: 'text', text: prompt || 'Hãy phân tích ảnh này.' },
      {
        type: 'image_url',
        image_url: { url: `data:${mime};base64,${attachment.data || ''}` },
      },
    ];
  }
  if (attachment?.type === 'text') {
    return `${prompt || 'Hãy phân tích file này.'}\n\n--- File: ${attachment.name} ---\n${attachment.text || ''}`;
  }
  return prompt || 'Hãy giải câu này.';
}

async function callDeepSeek(
  prompt: string, history: HistoryItem[], attachment: Attachment | null,
): Promise<ProviderResult> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error('missing DEEPSEEK_API_KEY');
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-flash';
  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: buildUserContent(prompt, attachment) },
  ];
  const response = await fetchJson(
    'https://api.deepseek.com/chat/completions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 1800,
        temperature: 0.3,
      }),
    },
    45000,
  );
  if (!response.ok) {
    throw new Error(`deepseek HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const data = await response.json() as Record<string, any>;
  const answer = data?.choices?.[0]?.message?.content;
  if (!answer || !String(answer).trim()) {
    throw new Error('deepseek empty answer');
  }
  return {
    answer: String(answer).trim(),
    provider: 'deepseek',
    model,
    usage: (data.usage || {}) as Record<string, unknown>,
  };
}

async function callMuse(
  prompt: string, history: HistoryItem[], attachment: Attachment | null,
): Promise<ProviderResult> {
  const key = process.env.MUSE_API_KEY;
  if (!key) throw new Error('missing MUSE_API_KEY');
  const model = process.env.MUSE_MODEL || 'muse-spark-1.3';
  const historyText = history
    .map((item) => `${item.role === 'user' ? 'Khách' : 'AI'}: ${item.content}`)
    .join('\n');
  const base = `${SYSTEM_PROMPT}\n\n` +
    (historyText ? `Lịch sử hội thoại:\n${historyText}\n\n` : '') +
    `Câu hỏi hiện tại: ${prompt || 'Hãy giải câu này.'}`;

  let input: unknown = base;
  if (attachment?.type === 'image') {
    const mime = mimeFromName(attachment.name || '');
    input = [{
      role: 'user',
      content: [
        { type: 'input_text', text: base },
        {
          type: 'input_image',
          image_url: `data:${mime};base64,${attachment.data || ''}`,
        },
      ],
    }];
  } else if (attachment?.type === 'text') {
    input = `${base}\n\n--- File: ${attachment.name} ---\n${attachment.text || ''}`;
  }

  const response = await fetchJson(
    'https://api.meta.ai/v1/responses',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, input }),
    },
    50000,
  );
  if (!response.ok) {
    throw new Error(`muse HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const data = await response.json() as Record<string, any>;
  let answer = '';
  for (const item of data?.output || []) {
    if (item?.type !== 'message') continue;
    for (const content of item?.content || []) {
      if (content?.type === 'output_text') answer += content?.text || '';
    }
  }
  if (!answer.trim()) throw new Error('muse empty answer');
  return {
    answer: answer.trim(),
    provider: 'muse',
    model,
    usage: (data.usage || {}) as Record<string, unknown>,
  };
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
  if (!(await aiEnabled())) {
    return NextResponse.json(
      { ok: false, error: 'AI đang tắt cho khách. Vui lòng liên hệ hỗ trợ viên.' },
      { status: 403, headers: corsHeaders });
  }

  const prompt = String(body.prompt || '').trim().slice(0, 4000);
  const history = cleanHistory(body.history);
  const attachment = cleanAttachment(body.attachment);
  if (!prompt && !attachment) {
    return NextResponse.json({ ok: false, error: 'empty prompt' },
      { status: 400, headers: corsHeaders });
  }

  const requestId = crypto.randomUUID();
  const now = Date.now();
  await broadcast(nodeId, {
    id: `${requestId}-user`,
    role: 'user',
    status: 'done',
    body: prompt || (attachment?.type === 'image'
      ? 'Hãy phân tích ảnh này.' : 'Hãy phân tích file này.'),
    attachment: attachment
      ? { type: attachment.type, name: attachment.name } : null,
    ts: now,
  });
  await broadcast(nodeId, {
    id: `${requestId}-status`,
    role: 'assistant',
    status: 'thinking',
    body: 'AI đang trả lời...',
    ts: now,
  });

  let result: ProviderResult | null = null;
  let lastError = '';
  try {
    result = await callDeepSeek(prompt, history, attachment);
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    console.warn('[AI] DeepSeek failed, falling back to Muse:', lastError);
  }
  if (!result) {
    try {
      result = await callMuse(prompt, history, attachment);
    } catch (error) {
      const museError = error instanceof Error ? error.message : String(error);
      lastError = `${lastError} | muse: ${museError}`;
    }
  }

  if (!result) {
    await broadcast(nodeId, {
      id: `${requestId}-error`,
      role: 'assistant',
      status: 'error',
      body: lastError.slice(0, 300) || 'AI tạm thời không trả lời được.',
      ts: Date.now(),
    });
    return NextResponse.json(
      { ok: false, error: 'AI tạm thời không trả lời được. Vui lòng thử lại sau.' },
      { status: 502, headers: corsHeaders });
  }

  await bumpUsage(nodeId, result.usage);
  await broadcast(nodeId, {
    id: `${requestId}-answer`,
    role: 'assistant',
    status: 'done',
    body: result.answer,
    provider: result.provider,
    model: result.model,
    usage: result.usage,
    ts: Date.now(),
  });
  return NextResponse.json({
    ok: true,
    answer: result.answer,
    provider: result.provider,
    model: result.model,
    usage: result.usage,
  }, { headers: corsHeaders });
}
