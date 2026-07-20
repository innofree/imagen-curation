"use client";
import { X } from "lucide-react";

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
  const vl = img.vl || {};
  const reasons: string[] = img.quality_reasons || [];
  const issues: string[] = vl.issues || [];
  const decision = img.user_decision || img.decision || img.auto_decision;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card max-w-4xl w-full max-h-[92vh] overflow-hidden flex flex-col md:flex-row"
        onClick={(e) => e.stopPropagation()}>
        {/* image */}
        <div className="md:w-1/2 bg-black flex items-center justify-center relative">
          <img className="max-h-[92vh] w-full object-contain"
            src={`/api/img?path=${encodeURIComponent(img.path)}`} alt={img.filename} />
          <button className="absolute top-2 right-2 btn" onClick={onClose}><X size={16} /></button>
        </div>
        {/* scorecard */}
        <div className="md:w-1/2 p-4 overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <span className={`badge border ${decision === "keep" ? "border-green-600 text-green-300" : "border-red-600 text-red-300"}`}>
              {decision === "keep" ? "KEEP" : "REJECT"}
            </span>
            <div className="flex gap-2">
              <button className={`btn ${decision === "keep" ? "btn-primary" : ""}`} onClick={onKeep}>✓ keep</button>
              <button className={`btn ${decision === "reject" ? "btn-danger" : ""}`} onClick={onReject}>✗ reject</button>
            </div>
          </div>
          <div className="text-[11px] text-neutral-500 break-all mb-3">{img.filename}</div>

          {img.auto_reason && (
            <div className="mb-3 text-xs text-red-300 bg-red-950/30 border border-red-900 rounded p-2">
              자동 리젝트 사유: {img.auto_reason}
            </div>
          )}

          {/* 종합 점수 */}
          <h4 className="text-xs uppercase text-neutral-500 mt-2 mb-1">종합 점수</h4>
          <div className="mb-1">
            <div className="flex justify-between text-xs"><span className="text-neutral-400">품질 점수</span><span>{(img.quality_score ?? 0).toFixed(2)} / 1.00</span></div>
            <Bar frac={img.quality_score ?? 0} color="bg-sky-500" />
          </div>
          <div className="mb-1">
            <div className="flex justify-between text-xs"><span className="text-neutral-400">학습 적합도 (VL)</span><span>{vl.training_suitability ?? "?"} / 100</span></div>
            <Bar frac={(vl.training_suitability ?? 0) / 100} color="bg-emerald-500" />
          </div>
          <div className="mb-3">
            <div className="flex justify-between text-xs"><span className="text-neutral-400">고유성 (uniqueness)</span><span>{(img.uniqueness ?? 0).toFixed(2)} / 1.00</span></div>
            <Bar frac={img.uniqueness ?? 0} color="bg-violet-500" />
          </div>

          {/* 품질 항목 */}
          <h4 className="text-xs uppercase text-neutral-500 mt-3 mb-1">품질 게이트 (OpenCV)</h4>
          <Row label="판정" value={<span className={vColor[img.quality_verdict]}>{img.quality_verdict}</span>} />
          <Row label="해상도" value={`${img.width}×${img.height}`} />
          <Row label="얼굴 선명도 (눈 영역)" value={Math.round(img.face_sharpness)} hint="낮을수록 흐림" />
          <Row label="전역 선명도" value={Math.round(img.global_sharpness)} />
          <Row label="얼굴 검출" value={img.face_detected ? "O" : "X"} hint={`프레임 대비 ${(100 * (img.face_area_frac ?? 0)).toFixed(1)}%`} />
          {reasons.length > 0 && <Row label="품질 사유" value={reasons.join("; ")} />}

          {/* VL 분류 */}
          <h4 className="text-xs uppercase text-neutral-500 mt-3 mb-1">VL 평가 (Qwen3-VL)</h4>
          <Row label="샷 타입" value={vl.shot_type} />
          <Row label="뷰 앵글" value={vl.view_angle} />
          <Row label="얼굴 선명도(주관)" value={<span className={vl.face_clarity !== "sharp" ? "text-amber-300" : ""}>{vl.face_clarity}</span>} />
          <Row label="얼굴 보임 / 가림" value={`${vl.face_visible ? "O" : "X"} / ${vl.face_occluded ? "가림" : "없음"}`} />
          <Row label="인원 수" value={vl.subject_count} />
          <Row label="체형 노출" value={vl.body_shape_visible ? "O" : "X"} />
          <Row label="이슈" value={issues.length ? issues.join(", ") : "없음"} />
          {vl.reason && <Row label="VL 코멘트" value={vl.reason} />}

          {/* 중복/버킷 */}
          <h4 className="text-xs uppercase text-neutral-500 mt-3 mb-1">중복 / 분류</h4>
          <Row label="버킷" value={img.bucket} />
          <Row label="중복 여부" value={img.is_duplicate ? `중복 (클러스터 ${img.cluster_id})` : "단독"} />
          <Row label="자동 결정" value={img.auto_decision} />
          <Row label="수동 오버라이드" value={img.user_decision || "없음"} />
        </div>
      </div>
    </div>
  );
}
