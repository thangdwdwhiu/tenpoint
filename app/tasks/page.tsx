import Link from "next/link";
import { EmptyState, ErrorState, PageHeader, Panel, StatusBadge } from "@/components/ui";
import { displayDate, fetchApi, getRecords, shortId, valueOf } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  let tasks: ReturnType<typeof getRecords> = [];
  let error = "";
  try {
    tasks = getRecords(await fetchApi("/api/operator/tasks"));
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Unexpected API error";
  }

  const sortedTasks = [...tasks].sort((a, b) => {
    const aDate = new Date(valueOf(a, "created_at", "updated_at")).getTime();
    const bDate = new Date(valueOf(b, "created_at", "updated_at")).getTime();
    return bDate - aDate;
  });

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Tasks"
        description="Track task progress across all connected nodes."
        action={<span className="rounded-lg border border-line bg-panel px-3 py-2 text-sm text-slate-300">{tasks.length} total</span>}
      />
      {error && <div className="mb-6"><ErrorState message={error} /></div>}
      <Panel className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
          <div>
            <h2 className="text-sm font-semibold text-white">All tasks</h2>
            <p className="mt-1 text-xs text-muted">Sorted by most recent activity</p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-line bg-canvas px-3 py-2 text-xs text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            All statuses
          </div>
        </div>
        {sortedTasks.length === 0 ? (
          <div className="p-5 sm:p-6"><EmptyState title="No tasks found" description="Tasks will appear here when they are created." /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead><tr className="table-head"><th className="px-5 py-3.5 sm:px-6">Task</th><th className="px-5 py-3.5">Node</th><th className="px-5 py-3.5">Created</th><th className="px-5 py-3.5">Status</th><th className="px-5 py-3.5">Task ID</th></tr></thead>
              <tbody>
                {sortedTasks.map((task, index) => {
                  const taskId = valueOf(task, "id", "task_id");
                  const nodeId = valueOf(task, "node_id", "nodeId");
                  return (
                    <tr key={taskId || index} className="transition-colors hover:bg-white/[0.02]">
                      <td className="table-cell pl-5 sm:pl-6">
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.04] text-muted">
                            <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true"><path d="M6 3.5h8M6 7h8M6 10.5h5m-7-8h12v15l-3.5-1.8L9 17.5l-3.5-1.8L2 17.5v-15Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          </span>
                          <span className="font-medium text-slate-200">{valueOf(task, "name", "title", "type") || "Task"}</span>
                        </div>
                      </td>
                      <td className="table-cell">
                        {nodeId ? <Link href={`/nodes/${encodeURIComponent(nodeId)}`} className="font-mono text-xs text-slate-300 hover:text-white">{shortId(nodeId)}</Link> : <span className="text-muted">—</span>}
                      </td>
                      <td className="table-cell text-slate-400">{displayDate(valueOf(task, "created_at", "updated_at"))}</td>
                      <td className="table-cell"><StatusBadge status={valueOf(task, "status", "state")} /></td>
                      <td className="table-cell font-mono text-xs text-muted">{shortId(taskId) || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
