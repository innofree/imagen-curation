"use client";
import { useEffect, useMemo, useState, use, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import TopBar from "@/components/TopBar";
import ImageDetail from "@/components/ImageDetail";
import ImageWithFallback from "@/components/ImageWithFallback";
import { useLocale } from "@/components/LocaleProvider";

const PAGE = 60; // images rendered per "더 보기" step (avoids a 10k px DOM dump)

// Filter categories. `keep`/`reject` follow the current (possibly user-overridden)
// decision; `hard`/`overflow` mirror the analyze-time auto categories behind the
// job-detail stat tiles (품질/중복 리젝트 vs 과다버킷 리젝트).
type Filter = "all" | "keep" | "reject" | "hard" | "overflow";
// Labels are translation keys resolved at render (see FILTERS.map below); the
// hook can't run at module scope.
const FILTERS: { value: Filter; labelKey: string }[] = [
  { value: "all", labelKey: "review.filterAll" },
  { value: "keep", labelKey: "review.filterKeep" },
  { value: "reject", labelKey: "review.filterReject" },
  { value: "hard", labelKey: "review.filterHard" },
  { value: "overflow", labelKey: "review.filterOverflow" },
];
const isOverflow = (im: any) => /^over-represented bucket/.test(im.auto_reason || "");
function inCategory(im: any, f: Filter): boolean {
  switch (f) {
    case "all": return true;
    case "keep": return im.decision === "keep";
    case "reject": return im.decision === "reject";
    case "hard": return im.auto_decision === "reject" && !isOverflow(im);
    case "overflow": return im.auto_decision === "reject" && isOverflow(im);
  }
}

function ReviewInner({ params }: { params: Promise<{ jobID: string }> }) {
  const { jobID } = use(params);
  const { t } = useLocale();
  const [images, setImages] = useState<any[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [applying, setApplying] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);
  const [visible, setVisible] = useState(PAGE);

  // Deep-link from the job-detail stat tiles: /review/<id>?filter=hard etc.
  // Re-syncs whenever the URL's filter changes (not just on first mount), so
  // client navigation between filter links updates the selection.
  const urlFilter = useSearchParams().get("filter");
  useEffect(() => {
    if (urlFilter && FILTERS.some((x) => x.value === urlFilter)) setFilter(urlFilter as Filter);
  }, [urlFilter]);

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

  // reset paging when the filter changes
  useEffect(() => { setVisible(PAGE); }, [filter]);

  const filtered = useMemo(
    () => (filter === "all" ? images : images.filter((im) => inCategory(im, filter))),
    [images, filter]
  );

  // Only render up to `visible` images; group that slice by bucket. Large jobs
  // (hundreds/thousands) would otherwise mount every card at once.
  const groups = useMemo(() => {
    const g: Record<string, any[]> = {};
    for (const im of filtered.slice(0, visible)) {
      (g[im.bucket || "(unbucketed)"] ||= []).push(im);
    }
    return g;
  }, [filtered, visible]);

  const shown = Math.min(visible, filtered.length);
  const keepCount = images.filter((i) => i.decision === "keep").length;

  const apply = async () => {
    if (!confirm(t("review.applyConfirm", { keep: keepCount, reject: images.length - keepCount }))) return;
    setApplying(true);
    await fetch(`/api/jobs/${jobID}/apply`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recaption: true }),
    });
    setApplying(false);
  };

  return (
    <>
      <TopBar title={t("review.title")}>
        <span className="text-xs text-neutral-400 tnum">{t("review.keepTotal", { keep: keepCount, total: images.length })}</span>
        <select className="input w-40" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          {FILTERS.map((f) => <option key={f.value} value={f.value}>{t(f.labelKey)}</option>)}
        </select>
        <Link className="btn" href={`/jobs/${jobID}`}>{t("review.job")}</Link>
        <button className="btn btn-primary" disabled={applying} onClick={apply}>
          {applying ? t("review.applying") : t("review.apply")}
        </button>
      </TopBar>
      <div className="p-5 space-y-6">
        <p className="text-xs text-neutral-500">{t("review.hint")}</p>
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
                    <ImageWithFallback
                      className="w-full h-40 cursor-zoom-in"
                      imgClassName="w-full h-40 object-cover"
                      onClick={() => setSelected(im)}
                      src={`/api/img?path=${encodeURIComponent(im.thumb_path || im.path)}`}
                      alt={im.filename}
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); toggle(im); }}
                      title={t("review.toggleTitle")}
                      aria-label={im.decision === "keep" ? t("review.toReject") : t("review.toKeep")}
                      className={`absolute top-1.5 right-1.5 w-8 h-8 flex items-center justify-center rounded-full text-sm font-bold shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
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
                    <div className="text-blue-300 tnum">Q {im.quality_score?.toFixed(2)} · suit {im.vl?.training_suitability ?? "?"} · uniq {im.uniqueness?.toFixed(2)}</div>
                    <div className="text-neutral-500 tnum">faceSharp {Math.round(im.face_sharpness)}</div>
                    {im.decision === "reject" && <div className="text-red-300 truncate" title={im.auto_reason}>{im.auto_reason}</div>}
                    {im.user_decision && <div className="text-amber-300">{t("review.manualOverride")}</div>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
        {shown < filtered.length && (
          <div className="flex flex-col items-center gap-2 pt-2">
            <div className="text-xs text-neutral-500 tnum">{t("review.showing", { shown, total: filtered.length })}</div>
            <button className="btn" onClick={() => setVisible((v) => v + PAGE)}>{t("review.loadMore", { count: filtered.length - shown })}</button>
          </div>
        )}
        {images.length === 0 && <div className="text-neutral-500 text-sm">{t("review.emptyNoResults")}</div>}
        {images.length > 0 && filtered.length === 0 && (
          <div className="text-neutral-500 text-sm">{t("review.emptyNoMatch")}</div>
        )}
      </div>
      {selected && (
        <ImageDetail img={selected} onClose={() => setSelected(null)}
          onKeep={() => setDecision(selected, "keep")} onReject={() => setDecision(selected, "reject")} />
      )}
    </>
  );
}

// useSearchParams() requires a Suspense boundary during prerender.
export default function Review({ params }: { params: Promise<{ jobID: string }> }) {
  return (
    <Suspense fallback={null}>
      <ReviewInner params={params} />
    </Suspense>
  );
}
