export default function TopBar({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="min-h-12 border-b border-edge flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 py-2 sticky top-0 bg-[#101012]/90 backdrop-blur z-10">
      <h1 className="text-sm font-semibold min-w-0 truncate" title={title}>{title}</h1>
      <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">{children}</div>
    </div>
  );
}
