import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { verifySig, corsHeaders, optionsRes } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SYSTEM_PROMPT = `Bạn là Xuanova, một trợ lý AI đa năng chạy trên máy Windows của người dùng.
Bạn có thể trả lời mọi câu hỏi thông thường, phân tích, lập trình, dịch, tóm tắt, đọc tài liệu và hướng dẫn sử dụng phần mềm.
Bạn KHÔNG tự nhận mình là hỗ trợ viên hay nhân viên; bạn là Xuanova.
Không hướng dẫn chế tạo malware, tấn công hệ thống, trộm mật khẩu hoặc hành vi phạm pháp.
Khi người dùng yêu cầu hành động trên máy, hãy dùng công cụ bên dưới và thực thi ngay, không cần hỏi lại.`;

const AGENT_PROMPT = `BẠN ĐANG Ở CHẾ ĐỘ AGENT.
Bạn có thể yêu cầu bot thực hiện một công cụ. Khi cần công cụ, chỉ trả về ĐÚNG MỘT object JSON, không kèm văn bản, không dùng markdown:
{"tool":"<tên_công_cụ>","args":{...}}

Công cụ có sẵn:
- read_file: {"path":"C:\\\\duong\\\\dan\\\\file"} — đọc text/PDF/DOCX/XLSX, tối đa ~200KB.
- write_file: {"path":"C:\\\\...","content":"...","base64":false} — ghi/ghi đè file.
- list_dir: {"path":"C:\\\\..."} — liệt kê thư mục.
- run_shell: {"command":"..."} — chạy lệnh CMD.
- get_info: {} — thông tin máy.
- chrome_tabs: {} — liệt kê tab Chrome.
- chrome_open: {"url":"https://..."} — mở URL trong Chrome.
- chrome_switch: {"index":0} — chuyển tab.
- chrome_read_dom: {} — đọc text trang hiện tại.
- chrome_read_html: {} — đọc HTML trang hiện tại.
- chrome_read_forms: {} — liệt kê input/textarea/select kèm selector để điền.
- chrome_fill: {"selector":"CSS","value":"..."} — điền input/textarea.
- chrome_click: {"selector":"CSS"} — bấm phần tử.
- chrome_eval: {"code":"JS"} — chạy JavaScript trong tab.

Sau khi nhận kết quả công cụ, bạn sẽ được gọi lại để tiếp tục. Nếu đã đủ thông tin, trả lời cuối cùng bằng văn bản bình thường.
Công cụ được thực thi tự động. Nếu công cụ lỗi, hãy thử cách khác hoặc giải thích ngắn gọn.
Ảnh/file đính kèm có thể được gửi lại ở mỗi bước; đó vẫn là nội dung ban đầu của người dùng, không phải yêu cầu mới. Khi có ảnh/file, hãy xem/đọc trực tiếp và trả lời; tuyệt đối không yêu cầu người dùng gửi lại ảnh.
Khi giải bài hoặc ghi file, trình bày đủ ý nhưng ngắn gọn (tối đa khoảng 1200 từ), không lặp lại toàn bộ đề.`;

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

function cleanHistory(value: unknown, limit = 10): HistoryItem[] {
  if (!Array.isArray(value)) return [];
  const items: HistoryItem[] = [];
  for (const raw of value.slice(-limit)) {
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

async function aiProvider(): Promise<'deepseek' | 'muse'> {
  try {
    const result = await pool.query(
      `SELECT value FROM app_settings WHERE key = 'ai_provider'`);
    if (result.rowCount === 0) return 'deepseek';
    return String(result.rows[0].value).toLowerCase() === 'muse'
      ? 'muse' : 'deepseek';
  } catch {
    return 'deepseek';
  }
}

async function nodeAiBlocked(nodeId: string): Promise<boolean> {
  try {
    const result = await pool.query(
      `SELECT ai_blocked FROM nodes WHERE node_id = $1`, [nodeId]);
    if (result.rowCount === 0) return false;
    return Boolean(result.rows[0].ai_blocked);
  } catch {
    return false;
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

type FetchResult = {
  ok: boolean;
  status: number;
  text: string;
  data: any;
};

async function fetchJson(
  url: string, init: RequestInit, timeoutMs: number,
): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    // Read the body while the timer is still armed. Clearing it right after
    // fetch() would let a slow generation run past the provider timeout and
    // past Vercel's 60 s function limit.
    const text = await response.text();
    let data: any = null;
    try { data = JSON.parse(text); } catch { data = null; }
    return { ok: response.ok, status: response.status, text, data };
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
  systemPrompt: string = SYSTEM_PROMPT, timeoutMs: number = 50000,
): Promise<ProviderResult> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error('missing DEEPSEEK_API_KEY');
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-flash';
  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: systemPrompt },
    ...history,
  ];
  if (prompt || attachment) {
    messages.push({ role: 'user', content: buildUserContent(prompt, attachment) });
  }
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
        max_tokens: 16384,
        // deepseek-flash otherwise spends the whole budget on hidden
        // reasoning and returns an empty answer for dense exam images.
        reasoning_effort: 'none',
        temperature: 0.3,
      }),
    },
    timeoutMs,
  );
  if (!response.ok) {
    throw new Error(`deepseek HTTP ${response.status}: ${response.text.slice(0, 300)}`);
  }
  const data = response.data as Record<string, any>;
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
  systemPrompt: string = SYSTEM_PROMPT, timeoutMs: number = 40000,
): Promise<ProviderResult> {
  const key = process.env.MUSE_API_KEY;
  if (!key) throw new Error('missing MUSE_API_KEY');
  const model = process.env.MUSE_MODEL || 'muse-spark-1.3';
  const historyText = history
    .map((item) => `${item.role === 'user' ? 'Khách' : 'AI'}: ${item.content}`)
    .join('\n');
  const base = `${systemPrompt}\n\n` +
    (historyText ? `Lịch sử hội thoại:\n${historyText}\n\n` : '') +
    (prompt ? `Câu hỏi hiện tại: ${prompt}` : 'Hãy tiếp tục xử lý yêu cầu trên.');

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
    timeoutMs,
  );
  if (!response.ok) {
    throw new Error(`muse HTTP ${response.status}: ${response.text.slice(0, 300)}`);
  }
  const data = response.data as Record<string, any>;
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
  if (await nodeAiBlocked(nodeId)) {
    return NextResponse.json(
      { ok: false, error: 'AI đang bị chặn cho máy này. Vui lòng liên hệ hỗ trợ viên.' },
      { status: 403, headers: corsHeaders });
  }

  const agent = Boolean(body.agent);
  const step = Math.max(0, Number(body.step) || 0);
  const silent = Boolean(body.silent);
  const prompt = String(body.prompt || '').trim().slice(0, 4000);
  const history = cleanHistory(body.history, agent ? 30 : 10);
  const attachment = cleanAttachment(body.attachment);
  if (!prompt && !attachment && history.length === 0) {
    return NextResponse.json({ ok: false, error: 'empty prompt' },
      { status: 400, headers: corsHeaders });
  }
  const systemPrompt = agent
    ? `${SYSTEM_PROMPT}\n\n${AGENT_PROMPT}`
    : SYSTEM_PROMPT;

  const requestId = crypto.randomUUID();
  const now = Date.now();
  // Agent steps after the first resend the attachment so vision survives
  // tool calls; do not echo it as a new user message in the panel.
  if ((prompt || attachment) && !silent && (!agent || step === 0)) {
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
  }
  if (!agent) {
    await broadcast(nodeId, {
      id: `${requestId}-status`,
      role: 'assistant',
      status: 'thinking',
      body: 'AI đang trả lời...',
      ts: now,
    });
  }

  let result: ProviderResult | null = null;
  let lastError = '';
  const started = Date.now();
  const preferred = await aiProvider();
  const primary = preferred === 'muse' ? callMuse : callDeepSeek;
  const fallback = preferred === 'muse' ? callDeepSeek : callMuse;
  const primaryName = preferred === 'muse' ? 'Muse' : 'DeepSeek';
  const fallbackName = preferred === 'muse' ? 'DeepSeek' : 'Muse';
  // One provider must not eat Vercel's 60 s budget: DeepSeek gets 50 s,
  // Muse 40 s, and the fallback only whatever remains of 55 s.
  const primaryTimeout = preferred === 'muse' ? 40000 : 50000;
  try {
    result = await primary(
      prompt, history, attachment, systemPrompt, primaryTimeout);
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    console.warn(`[AI] ${primaryName} failed, falling back to ${fallbackName}:`,
      lastError);
  }
  if (!result) {
    const remaining = Math.max(6000, 55000 - (Date.now() - started));
    try {
      result = await fallback(
        prompt, history, attachment, systemPrompt, remaining);
    } catch (error) {
      const fallbackError = error instanceof Error
        ? error.message : String(error);
      lastError = `${lastError} | ${fallbackName.toLowerCase()}: ${fallbackError}`;
    }
  }

  if (!result) {
    console.warn('[AI] all providers failed:', lastError);
    await broadcast(nodeId, {
      id: `${requestId}-error`,
      role: 'assistant',
      status: 'error',
      body: lastError.slice(0, 300) || 'AI tạm thời không trả lời được.',
      ts: Date.now(),
    });
    return NextResponse.json(
      {
        ok: false,
        error: 'AI tạm thời không trả lời được. Vui lòng thử lại sau.',
        detail: lastError.slice(0, 500),
      },
      { status: 502, headers: corsHeaders });
  }

  await bumpUsage(nodeId, result.usage);
  if (!agent) {
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
  }
  return NextResponse.json({
    ok: true,
    answer: result.answer,
    provider: result.provider,
    model: result.model,
    usage: result.usage,
  }, { headers: corsHeaders });
}
