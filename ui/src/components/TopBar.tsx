export default function TopBar({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="h-12 border-b border-edge flex items-center justify-between px-5 sticky top-0 bg-[#101012]/90 backdrop-blur z-10">
      <h1 className="text-sm font-semibold">{title}</h1>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}
