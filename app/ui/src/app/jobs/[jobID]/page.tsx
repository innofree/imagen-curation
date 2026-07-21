"use client";
import { useEffect, useState, useRef, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import TopBar from "@/components/TopBar";
import StatusBadge from "@/components/StatusBadge";
import { Trash2, Terminal, ChevronRight } from "lucide-react";

const VERDICT_LABEL: Record<string, string> = {
  sufficient: "✅ 충분", marginal: "⚠️ 보통", insufficient: "❌ 부족",
};

export default function JobDetail({ params }: { params: Promise<{ jobID: string }> }) {
  const { jobID } = use(params);
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
      fetch(`/api/jobs/${jobID}/log`).then((r) => r.json()).then((d) => setLog(d.log || "(로그 없음)"));
    load();
    const active = job && ["running", "analyzing", "applying", "queued", "apply_queued"].includes(job.status);
    if (!active) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [showLog, jobID, job?.status]);

  // Keep the log scrolled to the newest line as it streams.
  useEffect(() => {
    if (showLog && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log, showLog]);

  if (!job) return <div className="p-6 text-neutral-500">로딩...</div>;
  const verdict = job.verdict ? JSON.parse(job.verdict) : null;
  const active = ["running", "analyzing", "applying", "queued", "apply_queued"].includes(job.status);
  const canApply = ["review", "analyzed"].includes(job.status);
  const s = verdict?.stats;

  const stop = () => fetch(`/api/jobs/${jobID}/stop`, { method: "POST" });
  const apply = async () => {
    await fetch(`/api/jobs/${jobID}/apply`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recaption: !!job.recaption, do_delete: !!job.do_delete }),
    });
  };
  const del = async () => {
    if (!confirm("작업을 삭제할까요?")) return;
    await fetch(`/api/jobs/${jobID}`, { method: "DELETE" });
    router.push("/jobs");
  };

  return (
    <>
      <TopBar title={job.name}>
        <StatusBadge status={job.status} />
        {active && <button className="btn btn-danger" onClick={stop}>중지</button>}
        {(job.status === "review" || job.status === "analyzed" || job.status === "completed") && (
          <Link className="btn" href={`/review/${jobID}`}>갤러리 리뷰</Link>
        )}
        {canApply && <button className="btn btn-primary" onClick={apply}>적용</button>}
        <button className="btn btn-danger" onClick={del} aria-label="작업 삭제"><Trash2 size={14} /> 삭제</button>
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
            <Terminal size={15} /> 작업 로그
            {active && <span className="ml-1 text-[11px] text-blue-300">· live</span>}
          </button>
          {showLog && (
            <pre ref={logRef}
              className="mx-4 mb-4 mt-1 max-h-96 overflow-auto rounded-md bg-[#0c0c0e] border border-edge p-3 text-[11px] leading-relaxed text-neutral-300 whitespace-pre-wrap break-all">
              {log || "로딩..."}
            </pre>
          )}
        </div>

        {verdict && (
          <>
            <div className="card p-4">
              <div className="flex items-center gap-3">
                <span className="text-lg">{VERDICT_LABEL[verdict.verdict] || verdict.verdict}</span>
                <span className="text-sm text-neutral-400">데이터셋 충분성</span>
              </div>
              {verdict.gaps?.length > 0 && (
                <ul className="mt-2 text-sm text-amber-300 list-disc pl-5">
                  {verdict.gaps.map((g: string, i: number) => <li key={i}>{g}</li>)}
                </ul>
              )}
              {s && (
                <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <Stat label="입력" v={s.n_input} href={`/review/${jobID}?filter=all`} />
                  <Stat label="최종 유지" v={s.n_final_keep} accent href={`/review/${jobID}?filter=keep`} />
                  <Stat label="품질/중복 리젝트" v={s.n_hard_reject} href={`/review/${jobID}?filter=hard`} />
                  <Stat label="과다버킷 리젝트" v={s.n_overflow_reject} href={`/review/${jobID}?filter=overflow`} />
                  <Stat label="정면 얼굴" v={s.front_face} />
                  <Stat label="3/4" v={s.three_quarter} />
                  <Stat label="프로파일" v={s.profiles} />
                  <Stat label="전신" v={s.full_body} />
                </div>
              )}
            </div>

            <div className="card p-4">
              <h3 className="text-xs uppercase text-neutral-500 mb-2">뷰 × 샷 커버리지</h3>
              <table className="text-sm w-full max-w-md">
                <thead className="text-neutral-500 text-xs">
                  <tr><th className="text-left py-1">버킷</th><th className="text-right">전체</th><th className="text-right">유지</th></tr>
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
  const body = (
    <>
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`text-lg font-semibold tnum ${accent ? "text-green-300" : ""}`}>{v}</div>
    </>
  );
  const cls = "block bg-panel2 rounded-md px-3 py-2";
  return href ? (
    <Link href={href} className={`${cls} hover:bg-[#2c2c31] hover:ring-1 hover:ring-blue-500/40 transition-colors`}
      title="이 목록을 갤러리에서 보기">
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
