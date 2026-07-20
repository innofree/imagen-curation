"use client";
import { useEffect, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import TopBar from "@/components/TopBar";
import StatusBadge from "@/components/StatusBadge";

const VERDICT_LABEL: Record<string, string> = {
  sufficient: "✅ 충분", marginal: "⚠️ 보통", insufficient: "❌ 부족",
};

export default function JobDetail({ params }: { params: Promise<{ jobID: string }> }) {
  const { jobID } = use(params);
  const router = useRouter();
  const [job, setJob] = useState<any>(null);

  useEffect(() => {
    const load = () => fetch(`/api/jobs/${jobID}`).then((r) => r.json()).then((d) => setJob(d.job));
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [jobID]);

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
        <button className="btn" onClick={del}>삭제</button>
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
          <div className="mt-1 text-xs text-neutral-500">{job.step}/{job.total_steps}</div>
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
                  <Stat label="입력" v={s.n_input} />
                  <Stat label="최종 유지" v={s.n_final_keep} accent />
                  <Stat label="품질/중복 리젝트" v={s.n_hard_reject} />
                  <Stat label="과다버킷 리젝트" v={s.n_overflow_reject} />
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

function Stat({ label, v, accent }: { label: string; v: any; accent?: boolean }) {
  return (
    <div className="bg-panel2 rounded-md px-3 py-2">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`text-lg font-semibold ${accent ? "text-green-300" : ""}`}>{v}</div>
    </div>
  );
}
