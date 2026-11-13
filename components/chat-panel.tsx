"use client";

import { FormEvent, useEffect, useState } from "react";
import { displayDate, RecordValue, valueOf } from "@/lib/api";
import { EmptyState, Panel } from "@/components/ui";

export function ChatPanel({ messages, nodeId }: { messages: RecordValue[]; nodeId: string }) {
  const [records, setRecords] = useState(messages);
  const [operatorKey, setOperatorKey] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [connected, setConnected] = useState(false);

  useEffect(() => { setRecords(messages); }, [messages]);

  useEffect(() => {
    setConnected(false);
    setLoadError("");
    if (!operatorKey) return;
    let active = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await fetch(`/api/operator/messages/${encodeURIComponent(nodeId)}`, {
          headers: { "X-Operator-Key": operatorKey }, cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Cannot load messages (${response.status}). Check operator key and connection.`);
        const payload = await response.json();
        if (active) {
          setRecords(payload.messages ?? []);
          setConnected(true);
          setLoadError("");
        }
      } catch (err) {
        if (active) {
          setConnected(false);
          setLoadError(err instanceof Error ? err.message : "Connection failed.");
        }
      } finally {
        if (active) timer = setTimeout(refresh, 3000);
      }
    }
    refresh();
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [nodeId, operatorKey]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !operatorKey || sending) return;
    setSending(true);
    setError("");
    try {
      const response = await fetch("/api/operator/messages", {
        method: "POST", headers: { "Content-Type": "application/json", "X-Operator-Key": operatorKey },
        body: JSON.stringify({ node_id: nodeId, body }), signal: AbortSignal.timeout(15000),
      });
      const result = await response.json();
      if (!response.ok || result.status !== "ok") throw new Error(`Send failed (${response.status}). Message kept for retry.`);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed. Message kept for retry.");
    } finally {
      setSending(false);
    }
  }

  const ordered = [...records].sort((a, b) => {
    const left = BigInt(valueOf(a, "id") || "0");
    const right = BigInt(valueOf(b, "id") || "0");
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return (
    <Panel className="flex min-h-[420px] flex-col overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <div>
          <h2 className="font-semibold text-white">Messages</h2>
          <p className="mt-0.5 text-xs text-muted">Conversation with this node</p>
        </div>
        <span className="flex items-center gap-2 text-xs text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
          {connected ? "Connected" : "Not connected"}
        </span>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        {ordered.length === 0 ? (
          <EmptyState title="No messages yet" description="Messages will appear here when available." />
        ) : (
          ordered.map((message, index) => {
            const text = valueOf(message, "content", "message", "text", "body");
            const sender = valueOf(message, "sender", "from", "role");
            const outgoing = message.channel === "to_node" || /operator|agent|user/i.test(sender);
            const timestamp = valueOf(message, "created_at", "timestamp", "sent_at");
            const epoch = /^\d+$/.test(timestamp) ? Number(timestamp) * 1000 : NaN;
            const date = Number.isFinite(epoch) && epoch <= 8640000000000000
              ? new Date(epoch).toISOString() : timestamp;
            return (
              <div key={valueOf(message, "id", "message_id") || index} className={`flex ${outgoing ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${outgoing ? "rounded-br-md bg-accent text-white" : "rounded-bl-md border border-line bg-white/[0.04] text-slate-200"}`}>
                  <p className="whitespace-pre-wrap text-sm">{text || "Message content unavailable"}</p>
                  <p className={`mt-2 text-[10px] ${outgoing ? "text-white/60" : "text-muted"}`}>
                    {displayDate(date)}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="border-t border-line p-4">
        <input type="password" aria-label="Operator key" placeholder="Enter operator key to chat"
          autoComplete="off" value={operatorKey} onChange={event => setOperatorKey(event.target.value)}
          className="mb-3 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-white" />
        <form onSubmit={send} className="flex items-center gap-3 rounded-xl border border-line bg-canvas px-4 py-3">
          <input
            type="text"
            aria-label="Message"
            placeholder="Write a message…"
            value={draft}
            onChange={event => setDraft(event.target.value)}
            maxLength={5000}
            disabled={sending || !operatorKey}
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-muted disabled:cursor-not-allowed"
          />
          <button type="submit" disabled={sending || !operatorKey || !draft.trim()} aria-label="Send message" className="rounded-lg bg-accent/40 p-2 text-white/60 disabled:cursor-not-allowed">
            <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
              <path d="m3 10 14-7-4.5 14-2.8-5.7L3 10Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              <path d="m9.7 11.3 3.1-3.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </form>
        {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
        {loadError && <p role="alert" className="mt-2 text-xs text-red-300">{loadError}</p>}
        <p className="mt-2 text-[11px] text-muted">{sending ? "Sending…" : "Updates every 3 seconds. The key is kept only while this page is open."}</p>
      </div>
    </Panel>
  );
}
