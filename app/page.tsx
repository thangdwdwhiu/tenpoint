import { EmptyState, ErrorState, PageHeader, Panel, StatusBadge, NodeLink } from "@/components/ui";
import { displayDate, fetchApi, getRecords, valueOf } from "@/lib/api";

export const dynamic = "force-dynamic";

function StatCard({
  label,
  value,
  hint,
  icon,
  accent,
}: {
  label: string;
  value: number;
  hint: string;
  icon: React.ReactNode;
  accent: string;
}) {
  return (
    <Panel className="relative overflow-hidden">
      <div className={`absolute -right-7 -top-8 h-28 w-28 rounded-full blur-3xl ${accent}`} />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-muted">{label}</p>
          <p className="mt-4 text-4xl font-semibold tracking-tight text-white">{value}</p>
          <p className="mt-2 text-xs text-slate-500">{hint}</p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.04] text-accent">
          {icon}
        </div>
      </div>
    </Panel>
  );
}

export default async function DashboardPage() {
  let nodes: ReturnType<typeof getRecords> = [];
  let tasks: ReturnType<typeof getRecords> = [];
  let error = "";

  try {
    const [nodesPayload, tasksPayload] = await Promise.all([
      fetchApi("/api/operator/nodes"),
      fetchApi("/api/operator/tasks"),
    ]);
    nodes = getRecords(nodesPayload);
    tasks = getRecords(tasksPayload);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Unexpected API error";
  }

  const activeNodes = nodes.filter((node) => {
    const status = valueOf(node, "status", "state").toLowerCase();
    return status === "active" || status === "online" || status === "connected";
  }).length;
  const pendingTasks = tasks.filter((task) => {
    const status = valueOf(task, "status", "state").toLowerCase();
    return status === "pending" || status === "queued";
  }).length;
  const completedTasks = tasks.filter((task) => {
    const status = valueOf(task, "status", "state").toLowerCase();
    return status === "completed" || status === "complete" || status === "done" || status === "success";
  }).length;

  const activity = [...tasks]
    .sort((a, b) => {
      const aDate = new Date(valueOf(a, "created_at", "updated_at", "timestamp")).getTime();
      const bDate = new Date(valueOf(b, "created_at", "updated_at", "timestamp")).getTime();
      return bDate - aDate;
    })
    .slice(0, 6);

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Good to see you"
        description="Monitor your nodes and keep operations moving."
        action={
          <div className="flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-2 text-xs text-muted">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            Live overview
          </div>
        }
      />
      {error && <div className="mb-6"><ErrorState message={error} /></div>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Active nodes"
          value={activeNodes}
          hint={`${nodes.length} total nodes`}
          accent="bg-violet-500/10"
          icon={<svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true"><rect x="4" y="5" width="16" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" /><path d="M8 20h8m-4-4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>}
        />
        <StatCard
          label="Pending tasks"
          value={pendingTasks}
          hint="Waiting to be processed"
          accent="bg-amber-500/10"
          icon={<svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true"><path d="M7 4h10M7 8h10M7 12h6m-8-9h14a1 1 0 0 1 1 1v16l-4-2-4 2-4-2-4 2V4a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        />
        <StatCard
          label="Completed tasks"
          value={completedTasks}
          hint={`${tasks.length} total tasks`}
          accent="bg-emerald-500/10"
          icon={<svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true"><path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" /></svg>}
        />
      </div>

      <div className="mt-8 grid gap-5 xl:grid-cols-[1.55fr_1fr]">
        <Panel className="overflow-hidden p-0">
          <div className="flex items-center justify-between px-5 py-5 sm:px-6">
            <div>
              <h2 className="font-semibold text-white">Recent activity</h2>
              <p className="mt-1 text-xs text-muted">Latest task updates across your nodes</p>
            </div>
            <a href="/tasks" className="text-xs font-medium text-accent transition-colors hover:text-white">View all tasks <span aria-hidden="true">→</span></a>
          </div>
          {activity.length === 0 ? (
            <div className="px-5 pb-5 sm:px-6"><EmptyState title="Nothing to show yet" description="Recent tasks will appear here." /></div>
          ) : (
            <div>
              {activity.map((task, index) => {
                const id = valueOf(task, "id", "task_id");
                const nodeId = valueOf(task, "node_id", "nodeId");
                const status = valueOf(task, "status", "state");
                const title = valueOf(task, "name", "title", "type") || "Task update";
                return (
                  <div key={id || index} className="flex items-center gap-4 border-t border-line px-5 py-4 first:border-t-0 sm:px-6">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.04] text-muted">
                      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true"><path d="M8 5h8M8 9h8M8 13h5m-8-9h14v16l-4-2-4 2-4-2-4 2V4Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-200">{title}</p>
                      <p className="mt-1 truncate text-xs text-muted">
                        {nodeId ? <>Node <NodeLink nodeId={nodeId}><span className="font-mono text-slate-300">{nodeId}</span></NodeLink></> : "Node unavailable"}
                        <span className="mx-2 text-slate-600">·</span>
                        {displayDate(valueOf(task, "updated_at", "created_at", "timestamp"))}
                      </p>
                    </div>
                    <StatusBadge status={status} />
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
        <Panel>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-white">Node health</h2>
              <p className="mt-1 text-xs text-muted">Current fleet snapshot</p>
            </div>
            <a href="/nodes" className="text-xs font-medium text-accent transition-colors hover:text-white">Manage nodes <span aria-hidden="true">→</span></a>
          </div>
          <div className="mt-6 flex items-end gap-2">
            <span className="text-4xl font-semibold tracking-tight text-white">{activeNodes}</span>
            <span className="pb-1 text-sm text-muted">of {nodes.length} nodes active</span>
          </div>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-accent to-violet-400"
              style={{ width: `${nodes.length ? Math.min(100, (activeNodes / nodes.length) * 100) : 0}%` }}
            />
          </div>
          <div className="mt-5 space-y-3">
            <div className="flex justify-between text-xs"><span className="text-muted">Connected</span><span className="text-slate-300">{activeNodes}</span></div>
            <div className="flex justify-between text-xs"><span className="text-muted">Other status</span><span className="text-slate-300">{Math.max(0, nodes.length - activeNodes)}</span></div>
          </div>
        </Panel>
      </div>
    </>
  );
}
