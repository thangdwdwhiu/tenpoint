import Link from "next/link";
import { ChatPanel } from "@/components/chat-panel";
import { EmptyState, ErrorState, PageHeader, Panel, StatusBadge } from "@/components/ui";
import { displayDate, fetchApi, getRecords, shortId, valueOf } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function NodeDetailPage({ params }: { params: { node_id: string } }) {
  const nodeId = params.node_id;
  let node: ReturnType<typeof getRecords>[number] | undefined;
  let tasks: ReturnType<typeof getRecords> = [];
  let messages: ReturnType<typeof getRecords> = [];
  const errors: string[] = [];

  const [nodesResult, tasksResult, messagesResult] = await Promise.allSettled([
    fetchApi("/api/operator/nodes"),
    fetchApi("/api/operator/tasks"),
    fetchApi(`/api/operator/messages/${encodeURIComponent(nodeId)}`),
  ]);

  if (nodesResult.status === "fulfilled") {
    node = getRecords(nodesResult.value).find(
      (item) => valueOf(item, "id", "node_id", "nodeId") === nodeId,
    );
  } else {
    errors.push(`Node details: ${nodesResult.reason instanceof Error ? nodesResult.reason.message : "request failed"}`);
  }

  if (tasksResult.status === "fulfilled") {
    tasks = getRecords(tasksResult.value).filter(
      (task) => valueOf(task, "node_id", "nodeId") === nodeId,
    );
  } else {
    errors.push(`Tasks: ${tasksResult.reason instanceof Error ? tasksResult.reason.message : "request failed"}`);
  }

  if (messagesResult.status === "fulfilled") {
    messages = getRecords(messagesResult.value);
  } else {
    errors.push(`Messages: ${messagesResult.reason instanceof Error ? messagesResult.reason.message : "request failed"}`);
  }

  const name = node
    ? valueOf(node, "device_name", "device", "name", "hostname") || "Unnamed device"
    : "Node details";
  const status = node ? valueOf(node, "status", "state") : "";

  return (
    <>
      <div className="mb-7">
        <Link href="/nodes" className="inline-flex items-center gap-2 text-xs font-medium text-muted transition-colors hover:text-white">
          <span aria-hidden="true">←</span> All nodes
        </Link>
      </div>
      <PageHeader
        eyebrow="Node details"
        title={name}
        description={`Node ID · ${shortId(nodeId)}`}
        action={node ? <StatusBadge status={status} /> : undefined}
      />
      {errors.map((error) => <div key={error} className="mb-3"><ErrorState message={error} /></div>)}

      <div className="grid gap-5 xl:grid-cols-[1fr_1.2fr]">
        <div className="space-y-5">
          <Panel>
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-white">Device information</h2>
                <p className="mt-1 text-xs text-muted">Connection and account metadata</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-white/[0.03] text-accent">
                <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true"><rect x="4" y="5" width="16" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" /><path d="M8 20h8m-4-4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </div>
            </div>
            {node ? (
              <dl className="divide-y divide-line">
                {[
                  ["Device", valueOf(node, "device_name", "device", "name", "hostname") || "—"],
                  ["Node ID", nodeId],
                  ["Account", valueOf(node, "account", "account_name", "username", "email") || "—"],
                  ["IP address", valueOf(node, "ip", "ip_address", "ipAddress") || "—"],
                  ["Last seen", displayDate(valueOf(node, "last_seen", "last_seen_at", "lastSeen", "updated_at"))],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-start justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
                    <dt className="text-xs text-muted">{label}</dt>
                    <dd className="max-w-[65%] break-all text-right text-xs text-slate-200">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-muted">Node information is unavailable.</p>
            )}
          </Panel>

          <Panel className="overflow-hidden p-0">
            <div className="flex items-center justify-between px-5 py-5">
              <div>
                <h2 className="font-semibold text-white">Task history</h2>
                <p className="mt-1 text-xs text-muted">Recent work for this node</p>
              </div>
              <span className="rounded-md bg-white/[0.04] px-2 py-1 text-xs text-muted">{tasks.length}</span>
            </div>
            {tasks.length === 0 ? (
              <div className="px-5 pb-5"><EmptyState title="No tasks yet" description="Tasks for this node will appear here." /></div>
            ) : (
              <div>
                {[...tasks].sort((a, b) => new Date(valueOf(b, "created_at", "updated_at")).getTime() - new Date(valueOf(a, "created_at", "updated_at")).getTime()).slice(0, 8).map((task, index) => (
                  <div key={valueOf(task, "id", "task_id") || index} className="flex items-center justify-between gap-3 border-t border-line px-5 py-4 first:border-t-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-200">{valueOf(task, "name", "title", "type") || "Task"}</p>
                      <p className="mt-1 text-xs text-muted">{displayDate(valueOf(task, "created_at", "updated_at"))}</p>
                    </div>
                    <StatusBadge status={valueOf(task, "status", "state")} />
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
        <ChatPanel messages={messages} nodeId={nodeId} />
      </div>
    </>
  );
}
