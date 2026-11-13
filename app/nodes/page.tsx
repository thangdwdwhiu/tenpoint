import Link from "next/link";
import { EmptyState, ErrorState, PageHeader, Panel, StatusBadge } from "@/components/ui";
import { displayDate, fetchApi, getRecords, shortId, valueOf } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function NodesPage() {
  let nodes: ReturnType<typeof getRecords> = [];
  let error = "";
  try {
    nodes = getRecords(await fetchApi("/api/operator/nodes"));
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Unexpected API error";
  }

  return (
    <>
      <PageHeader
        eyebrow="Fleet"
        title="Nodes"
        description="View and manage the devices connected to your workspace."
        action={<span className="rounded-lg border border-line bg-panel px-3 py-2 text-sm text-slate-300">{nodes.length} nodes</span>}
      />
      {error && <div className="mb-6"><ErrorState message={error} /></div>}
      <Panel className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
          <div>
            <h2 className="text-sm font-semibold text-white">All nodes</h2>
            <p className="mt-1 text-xs text-muted">Device connection and account details</p>
          </div>
          <div className="relative">
            <svg viewBox="0 0 20 20" fill="none" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true"><circle cx="8.75" cy="8.75" r="5.75" stroke="currentColor" strokeWidth="1.5" /><path d="m13 13 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            <input aria-label="Search nodes" placeholder="Search nodes" className="w-full rounded-lg border border-line bg-canvas py-2 pl-9 pr-3 text-xs text-white outline-none placeholder:text-muted focus:border-accent/60 sm:w-52" />
          </div>
        </div>
        {nodes.length === 0 ? (
          <div className="p-5 sm:p-6"><EmptyState title="No nodes found" description="Connected nodes will appear here." /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead><tr className="table-head"><th className="px-5 py-3.5 sm:px-6">Device</th><th className="px-5 py-3.5">Account</th><th className="px-5 py-3.5">IP address</th><th className="px-5 py-3.5">Last seen</th><th className="px-5 py-3.5">Status</th><th className="px-5 py-3.5 text-right sm:px-6">Actions</th></tr></thead>
              <tbody>
                {nodes.map((node, index) => {
                  const id = valueOf(node, "id", "node_id", "nodeId");
                  const name = valueOf(node, "device_name", "device", "name", "hostname") || "Unnamed device";
                  const account = valueOf(node, "account", "account_name", "username", "email") || "—";
                  const ip = valueOf(node, "ip", "ip_address", "ipAddress") || "—";
                  const status = valueOf(node, "status", "state");
                  return (
                    <tr key={id || index} className="transition-colors hover:bg-white/[0.02]">
                      <td className="table-cell pl-5 sm:pl-6">
                        <Link href={`/nodes/${encodeURIComponent(id)}`} className="flex items-center gap-3 font-medium text-slate-200 hover:text-white">
                          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-white/[0.03] text-muted">
                            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true"><rect x="4" y="5" width="16" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" /><path d="M8 20h8m-4-4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                          </span>
                          <span><span className="block">{name}</span><span className="mt-0.5 block font-mono text-[10px] text-muted">{shortId(id) || "ID unavailable"}</span></span>
                        </Link>
                      </td>
                      <td className="table-cell text-slate-300">{account}</td>
                      <td className="table-cell font-mono text-xs text-slate-400">{ip}</td>
                      <td className="table-cell text-slate-400">{displayDate(valueOf(node, "last_seen", "last_seen_at", "lastSeen", "updated_at"))}</td>
                      <td className="table-cell"><StatusBadge status={status} /></td>
                      <td className="table-cell text-right pr-5 sm:pr-6">
                        <Link href={`/nodes/${encodeURIComponent(id)}`} className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-accent/50 hover:text-white">Details</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <p className="mt-4 text-xs text-muted">Showing <span className="text-slate-300">{nodes.length}</span> connected nodes</p>
    </>
  );
}
