"use client";
import { X } from "lucide-react";
import ImageWithFallback from "@/components/ImageWithFallback";
import { useLocale } from "@/components/LocaleProvider";

function Row({ label, value, hint }: { label: string; value: any; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 border-b border-edge/60">
      <span className="text-neutral-400 text-xs">{label}</span>
      <span className="text-right text-xs">
        <span className="text-neutral-100">{value}</span>
        {hint && <span className="block text-[10px] text-neutral-500">{hint}</span>}
      </span>
    </div>
  );
}

function Bar({ frac, color }: { frac: number; color: string }) {
  return (
    <div className="h-1.5 bg-panel2 rounded-full overflow-hidden mt-1">
      <div className={`h-full ${color}`} style={{ width: `${Math.max(0, Math.min(1, frac)) * 100}%` }} />
    </div>
  );
}

const vColor: Record<string, string> = { pass: "text-green-300", warn: "text-amber-300", fail: "text-red-300" };

export default function ImageDetail({ img, onClose, onKeep, onReject }: {
  img: any; onClose: () => void; onKeep: () => void; onReject: () => void;
}) {
  const { t } = useLocale();
  const vl = img.vl || {};
  const reasons: string[] = img.quality_reasons || [];
  const issues: string[] = vl.issues || [];
  const decision = img.user_decision || img.decision || img.auto_decision;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card max-w-4xl w-full max-h-[92vh] overflow-hidden flex flex-col md:flex-row"
        onClick={(e) => e.stopPropagation()}>
        {/* image */}
        <div className="md:w-1/2 bg-black flex items-center justify-center relative min-h-[240px]">
          <ImageWithFallback
            className="w-full flex items-center justify-center"
            imgClassName="max-h-[92vh] w-full object-contain min-h-[240px]"
            src={`/api/img?path=${encodeURIComponent(img.path)}`}
            fallbackSrc={img.thumb_path ? `/api/img?path=${encodeURIComponent(img.thumb_path)}` : undefined}
            alt={img.filename}
            note={img.filename}
          />
          <button className="absolute top-2 right-2 btn" onClick={onClose} aria-label={t("imgd.close")}><X size={16} /></button>
        </div>
        {/* scorecard */}
        <div className="md:w-1/2 p-4 overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <span className={`badge border ${decision === "keep" ? "border-green-600 text-green-300" : "border-red-600 text-red-300"}`}>
              {decision === "keep" ? "KEEP" : "REJECT"}
            </span>
            <div className="flex gap-2">
              <button className={`btn ${decision === "keep" ? "btn-primary" : ""}`} onClick={onKeep} aria-label={t("imgd.setKeep")} aria-pressed={decision === "keep"}>✓ keep</button>
              <button className={`btn ${decision === "reject" ? "btn-danger" : ""}`} onClick={onReject} aria-label={t("imgd.setReject")} aria-pressed={decision === "reject"}>✗ reject</button>
            </div>
          </div>
          <div className="text-[11px] text-neutral-500 break-all mb-3">{img.filename}</div>

          {img.auto_reason && (
            <div className="mb-3 text-xs text-red-300 bg-red-950/30 border border-red-900 rounded p-2">
              {t("imgd.autoRejectReason", { reason: img.auto_reason })}
            </div>
          )}

          {/* 종합 점수 */}
          <h4 className="text-xs uppercase text-neutral-500 mt-2 mb-1">{t("imgd.overallScore")}</h4>
          <div className="mb-1">
            <div className="flex justify-between text-xs"><span className="text-neutral-400">{t("imgd.qualityScore")}</span><span className="tnum">{(img.quality_score ?? 0).toFixed(2)} / 1.00</span></div>
            <Bar frac={img.quality_score ?? 0} color="bg-sky-500" />
          </div>
          <div className="mb-1">
            <div className="flex justify-between text-xs"><span className="text-neutral-400">{t("imgd.trainingSuitability")}</span><span className="tnum">{vl.training_suitability ?? "?"} / 100</span></div>
            <Bar frac={(vl.training_suitability ?? 0) / 100} color="bg-emerald-500" />
          </div>
          <div className="mb-3">
            <div className="flex justify-between text-xs"><span className="text-neutral-400">{t("imgd.uniqueness")}</span><span className="tnum">{(img.uniqueness ?? 0).toFixed(2)} / 1.00</span></div>
            <Bar frac={img.uniqueness ?? 0} color="bg-violet-500" />
          </div>

          {/* 품질 항목 */}
          <h4 className="text-xs uppercase text-neutral-500 mt-3 mb-1">{t("imgd.qualityGate")}</h4>
          <Row label={t("imgd.verdict")} value={<span className={vColor[img.quality_verdict]}>{img.quality_verdict}</span>} />
          <Row label={t("imgd.resolution")} value={`${img.width}×${img.height}`} />
          <Row label={t("imgd.faceSharpness")} value={Math.round(img.face_sharpness)} hint={t("imgd.faceSharpnessHint")} />
          <Row label={t("imgd.globalSharpness")} value={Math.round(img.global_sharpness)} />
          <Row label={t("imgd.faceDetected")} value={img.face_detected ? "O" : "X"} hint={t("imgd.faceAreaHint", { pct: (100 * (img.face_area_frac ?? 0)).toFixed(1) })} />
          {reasons.length > 0 && <Row label={t("imgd.qualityReasons")} value={reasons.join("; ")} />}

          {/* VL 분류 */}
          <h4 className="text-xs uppercase text-neutral-500 mt-3 mb-1">{t("imgd.vlEval")}</h4>
          <Row label={t("imgd.shotType")} value={vl.shot_type} />
          <Row label={t("imgd.viewAngle")} value={vl.view_angle} />
          <Row label={t("imgd.faceClaritySubjective")} value={<span className={vl.face_clarity !== "sharp" ? "text-amber-300" : ""}>{vl.face_clarity}</span>} />
          <Row label={t("imgd.faceVisibleOccluded")} value={`${vl.face_visible ? "O" : "X"} / ${vl.face_occluded ? t("imgd.occluded") : t("imgd.none")}`} />
          <Row label={t("imgd.subjectCount")} value={vl.subject_count} />
          <Row label={t("imgd.bodyShapeVisible")} value={vl.body_shape_visible ? "O" : "X"} />
          <Row label={t("imgd.issues")} value={issues.length ? issues.join(", ") : t("imgd.none")} />
          {vl.reason && <Row label={t("imgd.vlComment")} value={vl.reason} />}

          {/* 중복/버킷 */}
          <h4 className="text-xs uppercase text-neutral-500 mt-3 mb-1">{t("imgd.dupClassification")}</h4>
          <Row label={t("imgd.bucket")} value={img.bucket} />
          <Row label={t("imgd.isDuplicate")} value={img.is_duplicate ? t("imgd.duplicateCluster", { id: img.cluster_id }) : t("imgd.standalone")} />
          <Row label={t("imgd.autoDecision")} value={img.auto_decision} />
          <Row label={t("imgd.manualOverride")} value={img.user_decision || t("imgd.none")} />
        </div>
      </div>
    </div>
  );
}
