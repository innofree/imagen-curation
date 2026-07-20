"use client";
import { useEffect, useMemo, useState, use } from "react";
import Link from "next/link";
import TopBar from "@/components/TopBar";
import ImageDetail from "@/components/ImageDetail";

export default function Review({ params }: { params: Promise<{ jobID: string }> }) {
  const { jobID } = use(params);
  const [images, setImages] = useState<any[]>([]);
  const [filter, setFilter] = useState<"all" | "keep" | "reject">("all");
  const [applying, setApplying] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);

  const load = () =>
    fetch(`/api/jobs/${jobID}/images`).then((r) => r.json()).then((d) => setImages(d.images || []));
  useEffect(() => { load(); }, [jobID]);

  const setDecision = async (img: any, next: "keep" | "reject") => {
    setImages((xs) => xs.map((x) => (x.id === img.id ? { ...x, decision: next, user_decision: next } : x)));
    setSelected((s: any) => (s && s.id === img.id ? { ...s, decision: next, user_decision: next } : s));
    await fetch(`/api/jobs/${jobID}/images`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: img.id, decision: next }),
    });
  };
  const toggle = (img: any) => setDecision(img, img.decision === "keep" ? "reject" : "keep");

  const groups = useMemo(() => {
    const g: Record<string, any[]> = {};
    for (const im of images) {
      if (filter !== "all" && im.decision !== filter) continue;
      (g[im.bucket || "(unbucketed)"] ||= []).push(im);
    }
    return g;
  }, [images, filter]);

  const keepCount = images.filter((i) => i.decision === "keep").length;

  const apply = async () => {
    if (!confirm(`유지 ${keepCount}장, 리젝트 ${images.length - keepCount}장으로 적용할까요?`)) return;
    setApplying(true);
    await fetch(`/api/jobs/${jobID}/apply`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recaption: true }),
    });
    setApplying(false);
  };

  return (
    <>
      <TopBar title="갤러리 리뷰">
        <span className="text-xs text-neutral-400">유지 {keepCount} / 전체 {images.length}</span>
        <select className="input w-28" value={filter} onChange={(e) => setFilter(e.target.value as any)}>
          <option value="all">전체</option>
          <option value="keep">유지</option>
          <option value="reject">리젝트</option>
        </select>
        <Link className="btn" href={`/jobs/${jobID}`}>작업</Link>
        <button className="btn btn-primary" disabled={applying} onClick={apply}>
          {applying ? "적용 중..." : "적용"}
        </button>
      </TopBar>
      <div className="p-5 space-y-6">
        <p className="text-xs text-neutral-500">썸네일을 클릭하면 항목별 점수 상세를 볼 수 있습니다. ✓/✗ 버튼으로 keep/reject를 바꿉니다.</p>
        {Object.keys(groups).sort().map((bucket) => (
          <section key={bucket}>
            <h3 className="text-sm font-medium mb-2">
              {bucket} <span className="text-neutral-500">({groups[bucket].length})</span>
            </h3>
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))" }}>
              {groups[bucket].map((im) => (
                <div key={im.id}
                  className={`card overflow-hidden border-2 ${im.decision === "keep" ? "border-green-600" : "border-red-700/70 opacity-80"}`}>
                  <div className="relative">
                    <img loading="lazy" className="w-full h-40 object-cover cursor-zoom-in"
                      onClick={() => setSelected(im)}
                      src={`/api/img?path=${encodeURIComponent(im.thumb_path || im.path)}`} alt={im.filename} />
                    <button
                      onClick={(e) => { e.stopPropagation(); toggle(im); }}
                      title="keep/reject 토글"
                      className={`absolute top-1 right-1 w-6 h-6 rounded-full text-xs font-bold ${
                        im.decision === "keep" ? "bg-green-600 text-white" : "bg-red-700 text-white"
                      }`}>
                      {im.decision === "keep" ? "✓" : "✗"}
                    </button>
                  </div>
                  <div className="p-2 text-[11px] space-y-1">
                    <div className="flex gap-1 flex-wrap">
                      <span className="badge">{im.vl?.shot_type}</span>
                      <span className={`badge ${im.vl?.face_clarity !== "sharp" ? "text-amber-300" : ""}`}>face:{im.vl?.face_clarity}</span>
                    </div>
                    <div className="text-blue-300">Q {im.quality_score?.toFixed(2)} · suit {im.vl?.training_suitability ?? "?"} · uniq {im.uniqueness?.toFixed(2)}</div>
                    <div className="text-neutral-500">faceSharp {Math.round(im.face_sharpness)}</div>
                    {im.decision === "reject" && <div className="text-red-300 truncate" title={im.auto_reason}>{im.auto_reason}</div>}
                    {im.user_decision && <div className="text-amber-300">수동 오버라이드</div>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
        {images.length === 0 && <div className="text-neutral-500 text-sm">분석 결과가 없습니다. 분석이 끝났는지 확인하세요.</div>}
      </div>
      {selected && (
        <ImageDetail img={selected} onClose={() => setSelected(null)}
          onKeep={() => setDecision(selected, "keep")} onReject={() => setDecision(selected, "reject")} />
      )}
    </>
  );
}
