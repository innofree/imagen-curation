"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ListChecks, PlusCircle, Settings, HelpCircle, Images } from "lucide-react";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/jobs/new", label: "New Curation", icon: PlusCircle },
  { href: "/jobs", label: "Jobs", icon: ListChecks },
  { href: "/help", label: "Help / 도움말", icon: HelpCircle },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Sidebar() {
  const path = usePathname();
  return (
    <aside className="w-56 shrink-0 border-r border-edge bg-panel h-screen sticky top-0 flex flex-col">
      <div className="px-4 py-4 border-b border-edge">
        <div className="font-semibold flex items-center gap-2">
          <Images size={18} className="text-blue-400 shrink-0" /> Curation Lab
        </div>
        <div className="text-xs text-neutral-500 mt-0.5">LoRA dataset curator</div>
      </div>
      <nav className="p-2 flex-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = path === href || (href !== "/jobs" && path.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm mb-1 ${
                active ? "bg-blue-600/20 text-blue-300" : "hover:bg-panel2 text-neutral-300"
              }`}
            >
              <Icon size={16} /> {label}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 text-[11px] text-neutral-600 border-t border-edge">
        Qwen3-VL abliterated · :8680
      </div>
    </aside>
  );
}
