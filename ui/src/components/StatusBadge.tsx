const COLORS: Record<string, string> = {
  queued: "bg-neutral-700 text-neutral-200",
  apply_queued: "bg-neutral-700 text-neutral-200",
  running: "bg-blue-600/30 text-blue-300 border-blue-600",
  analyzing: "bg-blue-600/30 text-blue-300 border-blue-600",
  applying: "bg-indigo-600/30 text-indigo-300 border-indigo-600",
  review: "bg-amber-600/30 text-amber-300 border-amber-600",
  analyzed: "bg-amber-600/30 text-amber-300 border-amber-600",
  completed: "bg-green-600/30 text-green-300 border-green-600",
  error: "bg-red-600/30 text-red-300 border-red-600",
  stopped: "bg-neutral-600/40 text-neutral-300",
};

export default function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge border ${COLORS[status] || "bg-panel2"}`}>{status}</span>
  );
}
