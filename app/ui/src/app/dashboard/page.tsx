"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import TopBar from "@/components/TopBar";
import StatusBadge from "@/components/StatusBadge";
import GpuStatus from "@/components/GpuStatus";
import { Folder, Cpu, Layers, Type, Trash2, FlaskConical } from "lucide-react";
import { useLocale } from "@/components/LocaleProvider";

const ACTIVE = ["running", "analyzing", "applying", "queued", "apply_queued"];

function parseParams(p: string) {
  try { return JSON.parse(p || "{}"); } catch { return {}; }
}
function vramMode(params: any) {
  if (params.quantize === true) return "fp8";
  if (params.quantize === false) return "bf16";
  return "auto";
}

function Chip({ icon: Icon, children, title }: any) {
  return (
    <span className="badge inline-flex items-center gap-1" title={title}>
      {Icon && <Icon size={11} />}{children}
    </span>
  );
}

export default function Dashboard() {
  const { t } = useLocale();
  const [jobs, setJobs] = useState<any[]>([]);
  const [gpus, setGpus] = useState<Record<number, any>>({});

  useEffect(() => {
    const load = () => {
      fetch("/api/jobs").then((r) => r.json()).then((d) => setJobs(d.jobs || []));
      fetch("/api/gpu").then((r) => r.json()).then((d) => {
        const m: Record<number, any> = {};
        (d.gpus || []).forEach((g: any) => (m[g.index] = g));
        setGpus(m);
      });
    };
    load();
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, []);

  const active = jobs.filter((j) => ACTIVE.includes(j.status));

  return (
    <>
      <TopBar title="Dashboard">
        <Link href="/jobs/new" className="btn btn-primary">+ New Curation</Link>
      </TopBar>
      <div className="p-5 space-y-6">
        <section>
          <h2 className="text-xs uppercase text-neutral-500 mb-2">{t("dash.gpu_status")}</h2>
          <GpuStatus />
        </section>

        <section>
          <h2 className="text-xs uppercase text-neutral-500 mb-2">{t("dash.in_progress")}</h2>
          {active.length === 0 && <div className="text-sm text-neutral-500">{t("dash.no_active")}</div>}
          <div className="grid gap-3 md:grid-cols-2">
            {active.map((j) => {
              const p = parseParams(j.params);
              const gi = Number(String(j.gpu_ids).split(",")[0]);
              const g = gpus[gi];
              const cap = p.coverage?.per_bucket_cap;
              return (
                <Link key={j.id} href={`/jobs/${j.id}`} className="card p-4 block hover:border-blue-600">
                  <div className="flex justify-between items-center">
                    <span className="font-medium text-sm truncate">{j.name}</span>
                    <StatusBadge status={j.status} />
                  </div>
                  {/* 조건 */}
                  <div className="flex flex-wrap gap-1 mt-2">
                    <Chip icon={Folder} title={t("dash.src_dataset")}>{j.source_folder.split("/").pop()}</Chip>
                    <Chip icon={FlaskConical} title={t("dash.mode")}>{j.mode}</Chip>
                    {cap ? <Chip icon={Layers} title={t("dash.per_bucket_cap")}>{t("dash.per_bucket", { cap })}</Chip> : null}
                    {j.target ? <Chip icon={Layers} title={t("dash.target_keep")}>{t("dash.target", { n: j.target })}</Chip> : null}
                    {j.recaption ? <Chip icon={Type} title={t("dash.recaption_title")}>recaption</Chip> : null}
                    {j.do_delete ? <Chip icon={Trash2} title={t("dash.hard_delete")}>delete</Chip> : null}
                    {j.dry_run ? <Chip title={t("dash.no_file_change")}>dry-run</Chip> : null}
                  </div>
                  {/* 리소스 */}
                  <div className="flex flex-wrap gap-1 mt-1">
                    <Chip icon={Cpu} title={t("dash.used_gpu")}>
                      <span className="tnum">GPU #{gi}
                      {g ? ` · ${g.util}% · ${(g.memUsed / 1024).toFixed(1)}/${(g.memTotal / 1024).toFixed(0)}GB` : ""}</span>
                    </Chip>
                    <Chip title={t("dash.vram_mode")}>VRAM {vramMode(p)}</Chip>
                    {p.auto_free_gpu !== false ? <Chip title={t("dash.idle_reclaim")}>idle-reclaim</Chip> : null}
                  </div>
                  <div className="text-xs text-neutral-500 mt-2">{j.info}</div>
                  {j.total_steps > 0 && (
                    <div className="mt-2 h-1.5 bg-panel2 rounded overflow-hidden">
                      <div className="h-full bg-blue-500 transition-all" style={{ width: `${(100 * j.step) / j.total_steps}%` }} />
                    </div>
                  )}
                  {j.total_steps > 0 && <div className="text-[11px] text-neutral-500 mt-1 tnum">{j.step}/{j.total_steps}</div>}
                </Link>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="text-xs uppercase text-neutral-500 mb-2">{t("dash.recent_jobs")}</h2>
          <div className="card divide-y divide-edge">
            {jobs.slice(0, 10).map((j) => (
              <Link key={j.id} href={`/jobs/${j.id}`} className="flex items-center justify-between px-4 py-2.5 hover:bg-panel2 text-sm">
                <span className="truncate">{j.name}</span>
                <StatusBadge status={j.status} />
              </Link>
            ))}
            {jobs.length === 0 && <div className="px-4 py-6 text-sm text-neutral-500">{t("dash.no_jobs")}</div>}
          </div>
        </section>
      </div>
    </>
  );
}
