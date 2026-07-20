"""Coverage / sufficiency analysis and balanced selection.

Given per-image records (quality + VL classification + dedup), this module:
  1. buckets images by (view_angle, shot_type),
  2. judges whether the dataset is sufficient for identity + body-shape LoRA,
  3. selects a de-biased, ranked subset by capping over-represented buckets.
"""
from __future__ import annotations

import math
from collections import Counter, defaultdict
from typing import Any, Dict, List

from .config import CoverageConfig, bucket_label


def _combined_score(rec: Dict[str, Any]) -> float:
    """Rank score = quality * suitability * (0.5 + 0.5*uniqueness)."""
    q = float(rec.get("quality_score", 0.0))
    suit = float(rec.get("vl", {}).get("training_suitability", 50)) / 100.0
    uniq = float(rec.get("uniqueness", 0.5))
    return q * suit * (0.5 + 0.5 * uniq)


def hard_reject_reason(rec: Dict[str, Any], cfg: CoverageConfig,
                       soft_face_thr: float = 0.0) -> str | None:
    """Reasons an image is rejected regardless of balancing."""
    if rec.get("quality_verdict") == "fail":
        return "quality:" + "; ".join(rec.get("quality_reasons", [])[:2])
    vl = rec.get("vl", {})
    if rec.get("is_duplicate"):
        return "duplicate"
    if vl.get("subject_count", 1) > 1 or "multiple_subjects" in vl.get("issues", []):
        return "multiple subjects"
    if vl.get("face_clarity") == "blurry" and vl.get("face_visible", True):
        return "vl:blurry face"
    # Conservative, dataset-adaptive soft-face cut (eye-region sharpness).
    if (soft_face_thr > 0 and rec.get("face_detected")
            and vl.get("face_visible", True)
            and float(rec.get("face_sharpness", 0.0)) < soft_face_thr):
        return f"soft face (sharpness {float(rec.get('face_sharpness',0)):.0f} < {soft_face_thr:.0f})"
    if vl.get("training_suitability", 100) < cfg.min_suitability:
        return f"low suitability ({vl.get('training_suitability')})"
    return None


def _soft_face_threshold(records: List[Dict[str, Any]], cfg: CoverageConfig) -> float:
    """Adaptive soft-face sharpness cut = max(floor, median * ratio) over
    face-detected images. Returns 0.0 when disabled or no faces."""
    if not cfg.soft_face_reject:
        return 0.0
    vals = sorted(float(r.get("face_sharpness", 0.0)) for r in records
                  if r.get("face_detected") and float(r.get("face_sharpness", 0.0)) > 0)
    if not vals:
        return 0.0
    median = vals[len(vals) // 2]
    return max(cfg.soft_face_floor, median * cfg.soft_face_rel_ratio)


def analyze_coverage(records: List[Dict[str, Any]], cfg: CoverageConfig,
                     target: int | None = None) -> Dict[str, Any]:
    """Produce coverage stats, sufficiency verdict, and keep/reject decisions.

    Mutates nothing; returns a dict. Each record gets an 'auto_decision' set on
    a shallow copy list returned as 'records'.
    """
    recs = [dict(r) for r in records]
    soft_thr = _soft_face_threshold(recs, cfg)

    # --- stage 1: hard rejects -------------------------------------------
    survivors = []
    for r in recs:
        reason = hard_reject_reason(r, cfg, soft_thr)
        if reason:
            r["auto_decision"] = "reject"
            r["auto_reason"] = reason
        else:
            r["auto_decision"] = "keep"  # provisional; balancing may demote
            r["auto_reason"] = ""
            survivors.append(r)

    # --- stage 2: bucket the survivors -----------------------------------
    buckets: Dict[str, List[Dict]] = defaultdict(list)
    for r in survivors:
        vl = r.get("vl", {})
        r["bucket"] = bucket_label(vl.get("view_angle", "front"),
                                   vl.get("shot_type", "other"))
        buckets[r["bucket"]].append(r)

    view_counts = Counter(r["vl"].get("view_angle", "front") for r in survivors)
    shot_counts = Counter(r["vl"].get("shot_type", "other") for r in survivors)

    def count_where(pred) -> int:
        return sum(1 for r in survivors if pred(r["vl"]))

    front_face = count_where(
        lambda v: v.get("view_angle") == "front"
        and v.get("shot_type") in ("closeup_face", "head_and_shoulders")
    )
    profiles = count_where(lambda v: v.get("view_angle", "").startswith("profile"))
    three_q = count_where(lambda v: v.get("view_angle", "").startswith("three_quarter"))
    full_body = count_where(lambda v: v.get("shot_type") == "full_body")
    distinct_views = len([v for v, c in view_counts.items() if c > 0])

    # --- stage 3: sufficiency verdict ------------------------------------
    gaps: List[str] = []
    if front_face < cfg.min_front_face:
        gaps.append(f"정면 얼굴 컷 부족 ({front_face}/{cfg.min_front_face})")
    if three_q < cfg.min_three_quarter:
        gaps.append(f"3/4 뷰 부족 ({three_q}/{cfg.min_three_quarter})")
    if profiles < cfg.min_profiles:
        gaps.append(f"프로파일(측면) 부족 ({profiles}/{cfg.min_profiles})")
    if full_body < cfg.min_full_body:
        gaps.append(f"전신(체형) 컷 부족 ({full_body}/{cfg.min_full_body})")
    if distinct_views < cfg.min_distinct_views:
        gaps.append(f"뷰 다양성 부족 ({distinct_views}/{cfg.min_distinct_views} 방향)")

    n_survivors = len(survivors)
    if n_survivors < cfg.min_total_marginal:
        verdict = "insufficient"
    elif gaps or n_survivors < cfg.min_total_sufficient:
        verdict = "marginal"
    else:
        verdict = "sufficient"

    # --- stage 4: balanced selection (cap over-represented buckets) ------
    n_nonempty = max(1, len([b for b in buckets if buckets[b]]))
    if cfg.per_bucket_cap is not None:
        cap = cfg.per_bucket_cap
    elif target:
        cap = max(cfg.cap_min, math.ceil(target / n_nonempty * cfg.cap_factor))
    else:
        # median bucket size scaled up, floored at cap_min
        sizes = sorted(len(v) for v in buckets.values())
        median = sizes[len(sizes) // 2] if sizes else cfg.cap_min
        cap = max(cfg.cap_min, math.ceil(median * cfg.cap_factor))

    overflow = 0
    for bname, members in buckets.items():
        members.sort(key=_combined_score, reverse=True)
        for i, r in enumerate(members):
            if i >= cap:
                r["auto_decision"] = "reject"
                r["auto_reason"] = f"over-represented bucket '{bname}' (>{cap}); rank {i+1}"
                overflow += 1

    kept = [r for r in survivors if r["auto_decision"] == "keep"]

    # optional global target trim (drop lowest combined score, protecting
    # scarce buckets: never drop a bucket below 1)
    if target and len(kept) > target:
        kept.sort(key=_combined_score)
        protected = set()
        for r in kept:
            if r["bucket"] not in protected:
                protected.add(r["bucket"])
        drop = len(kept) - target
        for r in kept:
            if drop <= 0:
                break
            # protect the single best of each bucket
            best_in_bucket = max(buckets[r["bucket"]], key=_combined_score)
            if r is best_in_bucket:
                continue
            r["auto_decision"] = "reject"
            r["auto_reason"] = f"target trim (kept top {target})"
            drop -= 1

    final_keep = [r for r in survivors if r["auto_decision"] == "keep"]

    coverage_table = []
    for bname in sorted(buckets):
        members = buckets[bname]
        kept_ct = sum(1 for r in members if r["auto_decision"] == "keep")
        coverage_table.append({
            "bucket": bname, "total": len(members), "kept": kept_ct,
        })

    return {
        "records": recs,
        "verdict": verdict,
        "gaps": gaps,
        "cap": cap,
        "stats": {
            "n_input": len(recs),
            "soft_face_threshold": round(soft_thr, 1),
            "n_hard_reject": len(recs) - n_survivors,
            "n_survivors": n_survivors,
            "n_overflow_reject": overflow,
            "n_final_keep": len(final_keep),
            "front_face": front_face,
            "profiles": profiles,
            "three_quarter": three_q,
            "full_body": full_body,
            "distinct_views": distinct_views,
            "view_counts": dict(view_counts),
            "shot_counts": dict(shot_counts),
        },
        "coverage_table": coverage_table,
    }
