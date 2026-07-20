"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import TopBar from "@/components/TopBar";
import StatusBadge from "@/components/StatusBadge";
import GpuStatus from "@/components/GpuStatus";

export default function Dashboard() {
  const [jobs, setJobs] = useState<any[]>([]);
  useEffect(() => {
    const load = () => fetch("/api/jobs").then((r) => r.json()).then((d) => setJobs(d.jobs || []));
    load();
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, []);

  const active = jobs.filter((j) => ["running", "analyzing", "applying", "queued", "apply_queued"].includes(j.status));

  return (
    <>
      <TopBar title="Dashboard">
        <Link href="/jobs/new" className="btn btn-primary">+ New Curation</Link>
      </TopBar>
      <div className="p-5 space-y-6">
        <section>
          <h2 className="text-xs uppercase text-neutral-500 mb-2">GPU 상태</h2>
          <GpuStatus />
        </section>
        <section>
          <h2 className="text-xs uppercase text-neutral-500 mb-2">진행 중</h2>
          {active.length === 0 && <div className="text-sm text-neutral-500">활성 작업 없음</div>}
          <div className="grid gap-3 md:grid-cols-2">
            {active.map((j) => (
              <Link key={j.id} href={`/jobs/${j.id}`} className="card p-4 block hover:border-blue-600">
                <div className="flex justify-between items-center">
                  <span className="font-medium text-sm">{j.name}</span>
                  <StatusBadge status={j.status} />
                </div>
                <div className="text-xs text-neutral-500 mt-1">{j.info}</div>
                {j.total_steps > 0 && (
                  <div className="mt-2 h-1.5 bg-panel2 rounded overflow-hidden">
                    <div className="h-full bg-blue-500" style={{ width: `${(100 * j.step) / j.total_steps}%` }} />
                  </div>
                )}
              </Link>
            ))}
          </div>
        </section>
        <section>
          <h2 className="text-xs uppercase text-neutral-500 mb-2">최근 작업</h2>
          <div className="card divide-y divide-edge">
            {jobs.slice(0, 10).map((j) => (
              <Link key={j.id} href={`/jobs/${j.id}`} className="flex items-center justify-between px-4 py-2.5 hover:bg-panel2 text-sm">
                <span className="truncate">{j.name}</span>
                <StatusBadge status={j.status} />
              </Link>
            ))}
            {jobs.length === 0 && <div className="px-4 py-6 text-sm text-neutral-500">아직 작업이 없습니다.</div>}
          </div>
        </section>
      </div>
    </>
  );
}
