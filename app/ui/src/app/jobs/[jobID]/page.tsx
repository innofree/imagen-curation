"use client";
import { useEffect, useState, useRef, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import TopBar from "@/components/TopBar";
import StatusBadge from "@/components/StatusBadge";
import { Trash2, Terminal, ChevronRight } from "lucide-react";
import { useLocale } from "@/components/LocaleProvider";
import { DEFAULT_PURPOSE, statTilesFor } from "@/lib/purposes";

const VERDICT_KEY: Record<string, string> = {
  sufficient: "job.verdict_sufficient", marginal: "job.verdict_marginal", insufficient: "job.verdict_insufficient",
};

export default function JobDetail({ params }: { params: Promise<{ jobID: string }> }) {
  const { jobID } = use(params);
  const { t } = useLocale();
  const router = useRouter();
  const [job, setJob] = useState<any>(null);
  const [showLog, setShowLog] = useState(false);
  const [log, setLog] = useState("");
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const load = () => fetch(`/api/jobs/${jobID}`).then((r) => r.json()).then((d) => setJob(d.job));
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [jobID]);

  // Poll the worker log while the panel is open; keep polling if the job is
  // active so progress streams in, then stop once it settles.
  useEffect(() => {
    if (!showLog) return;
    const load = () =>
      fetch(`/api/jobs/${jobID}/log`).then((r) => r.json()).then((d) => setLog(d.log || t("job.no_log")));
    load();
    const active = job && ["running", "analyzing", "applying", "queued", "apply_queued"].includes(job.status);
    if (!active) return;
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [showLog, jobID, job?.status]);

  // Keep the log scrolled to the newest line as it streams.
  useEffect(() => {
    if (showLog && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log, showLog]);

  if (!job) return <div className="p-6 text-neutral-500">{t("job.loading")}</div>;
  const verdict = job.verdict ? JSON.parse(job.verdict) : null;
  let jobParams: any = {};
  try { jobParams = job.params ? JSON.parse(job.params) : {}; } catch { jobParams = {}; }
  const active = ["running", "analyzing", "applying", "queued", "apply_queued"].includes(job.status);
  const canApply = ["review", "analyzed"].includes(job.status);
  const s = verdict?.stats;
  // purpose that actually ran (verdict) > requested (params) > default
  const purpose = verdict?.purpose || jobParams.purpose || DEFAULT_PURPOSE;
  const tiles = statTilesFor(purpose);
  const bucketIsViewShot = purpose === "face" || purpose === "full_body";

  const stop = () => fetch(`/api/jobs/${jobID}/stop`, { method: "POST" });
  const apply = async () => {
    await fetch(`/api/jobs/${jobID}/apply`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recaption: !!job.recaption, do_delete: !!job.do_delete }),
    });
  };
  const del = async () => {
    if (!confirm(t("job.confirm_delete"))) return;
    await fetch(`/api/jobs/${jobID}`, { method: "DELETE" });
    router.push("/jobs");
  };

  return (
    <>
      <TopBar title={job.name}>
        <StatusBadge status={job.status} />
        <span className="badge" title={t("job.purpose_title")}>{t(`purpose.${purpose}`)}</span>
        {active && <button className="btn btn-danger" onClick={stop}>{t("job.stop")}</button>}
        {(job.status === "review" || job.status === "analyzed" || job.status === "completed") && (
          <Link className="btn" href={`/review/${jobID}`}>{t("job.gallery_review")}</Link>
        )}
        {canApply && <button className="btn btn-primary" onClick={apply}>{t("job.apply")}</button>}
        <button className="btn btn-danger" onClick={del} aria-label={t("job.delete_aria")}><Trash2 size={14} /> {t("job.delete")}</button>
      </TopBar>
      <div className="p-5 space-y-5">
        <div className="card p-4 text-sm">
          <div className="text-neutral-400">{job.source_folder}</div>
          <div className="mt-1 text-neutral-500">{job.info}</div>
          {job.total_steps > 0 && (
            <div className="mt-3 h-2 bg-panel2 rounded overflow-hidden">
              <div className="h-full bg-blue-500 transition-all" style={{ width: `${(100 * job.step) / job.total_steps}%` }} />
            </div>
          )}
          <div className="mt-1 text-xs text-neutral-500 tnum">{job.step}/{job.total_steps}</div>
        </div>

        {/* Worker log (tail) — live pipeline output */}
        <div className="card">
          <button
            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-neutral-300 hover:bg-panel2 rounded-lg"
            onClick={() => setShowLog((s) => !s)} aria-expanded={showLog}>
            <ChevronRight size={15} className={`transition-transform ${showLog ? "rotate-90" : ""}`} />
            <Terminal size={15} /> {t("job.worker_log")}
            {active && <span className="ml-1 text-[11px] text-blue-300">· live</span>}
          </button>
          {showLog && (
            <pre ref={logRef}
              className="mx-4 mb-4 mt-1 max-h-96 overflow-auto rounded-md bg-[#0c0c0e] border border-edge p-3 text-[11px] leading-relaxed text-neutral-300 whitespace-pre-wrap break-all">
              {log || t("job.loading")}
            </pre>
          )}
        </div>

        {verdict && (
          <>
            <div className="card p-4">
              <div className="flex items-center gap-3">
                <span className="text-lg">{VERDICT_KEY[verdict.verdict] ? t(VERDICT_KEY[verdict.verdict]) : verdict.verdict}</span>
                <span className="text-sm text-neutral-400">{t("job.dataset_sufficiency")}</span>
              </div>
              {verdict.gaps?.length > 0 && (
                <ul className="mt-2 text-sm text-amber-300 list-disc pl-5">
                  {verdict.gaps.map((g: string, i: number) => <li key={i}>{g}</li>)}
                </ul>
              )}
              {s && (
                <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  {tiles.map((tile) =>
                    s[tile.key] !== undefined ? (
                      <Stat key={tile.key} label={t(tile.labelKey)} v={s[tile.key]} accent={tile.accent}
                        href={tile.filter ? `/review/${jobID}?filter=${tile.filter}` : undefined} />
                    ) : null
                  )}
                </div>
              )}
            </div>

            <div className="card p-4">
              <h3 className="text-xs uppercase text-neutral-500 mb-2">{t(bucketIsViewShot ? "job.coverage_title" : "job.coverage_title_bucket")}</h3>
              <table className="text-sm w-full max-w-md">
                <thead className="text-neutral-500 text-xs">
                  <tr><th className="text-left py-1">{t("job.col_bucket")}</th><th className="text-right">{t("job.col_total")}</th><th className="text-right">{t("job.col_kept")}</th></tr>
                </thead>
                <tbody>
                  {verdict.coverage_table?.map((r: any) => (
                    <tr key={r.bucket} className="border-t border-edge">
                      <td className="py-1">{r.bucket}</td>
                      <td className="text-right text-neutral-400">{r.total}</td>
                      <td className="text-right text-green-300">{r.kept}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Stat({ label, v, accent, href }: { label: string; v: any; accent?: boolean; href?: string }) {
  const { t } = useLocale();
  const body = (
    <>
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`text-lg font-semibold tnum ${accent ? "text-green-300" : ""}`}>{v}</div>
    </>
  );
  const cls = "block bg-panel2 rounded-md px-3 py-2";
  return href ? (
    <Link href={href} className={`${cls} hover:bg-[#2c2c31] hover:ring-1 hover:ring-blue-500/40 transition-colors`}
      title={t("job.stat_link_title")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
