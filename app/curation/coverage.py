"""Coverage / sufficiency analysis and balanced selection.

Given per-image records (quality + VL classification + dedup), this module:
  1. buckets images (by the purpose's bucket function; default view x shot),
  2. judges whether the dataset is sufficient for the training purpose,
  3. selects a de-biased, ranked subset by capping over-represented buckets.

The bucketing, sufficiency requirements, and the middle band of hard-reject
rules are supplied per-purpose by ``purposes.PurposePreset`` (default "face"
reproduces the original identity+body-shape behavior exactly). The universal
rules (quality-fail, duplicate, min-suitability) and the cap/rank/trim
machinery are purpose-independent and unchanged.
"""
from __future__ import annotations

import math
from collections import Counter, defaultdict
from typing import Any, Callable, Dict, List, Optional

from .config import CoverageConfig
from . import purposes


def _combined_score(rec: Dict[str, Any]) -> float:
    """Rank score = quality * suitability * (0.5 + 0.5*uniqueness)."""
    q = float(rec.get("quality_score", 0.0))
    suit = float(rec.get("vl", {}).get("training_suitability", 50)) / 100.0
    uniq = float(rec.get("uniqueness", 0.5))
    return q * suit * (0.5 + 0.5 * uniq)


# --- middle-band hard-reject rules (referenced by name from presets) --------
# Signature: (rec, vl, cfg, soft_face_thr) -> reason str or None. The first rule
# in a preset's ``hard_reject_rules`` list that returns a reason wins, matching
# the original first-match-wins if/elif chain for the face purpose.
def _rule_multiple_subjects(rec, vl, cfg, thr):
    if vl.get("subject_count", 1) > 1 or "multiple_subjects" in vl.get("issues", []):
        return "multiple subjects"
    return None


def _rule_face_blurry(rec, vl, cfg, thr):
    if vl.get("face_clarity") == "blurry" and vl.get("face_visible", True):
        return "vl:blurry face"
    return None


def _rule_soft_face(rec, vl, cfg, thr):
    # Conservative, dataset-adaptive soft-face cut (eye-region sharpness).
    if (thr > 0 and rec.get("face_detected") and vl.get("face_visible", True)
            and float(rec.get("face_sharpness", 0.0)) < thr):
        return f"soft face (sharpness {float(rec.get('face_sharpness',0)):.0f} < {thr:.0f})"
    return None


def _rule_body_not_visible(rec, vl, cfg, thr):
    if not vl.get("body_shape_visible", True):
        return "body not visible"
    return None


def _rule_pose_not_visible(rec, vl, cfg, thr):
    if not vl.get("pose_clearly_visible", True):
        return "pose not visible"
    return None


def _rule_garment_not_visible(rec, vl, cfg, thr):
    if not vl.get("garment_visible", True):
        return "garment not visible"
    return None


def _rule_garment_blurry(rec, vl, cfg, thr):
    if vl.get("garment_clarity") == "blurry":
        return "vl:blurry garment"
    return None


HARD_REJECT_RULES: Dict[str, Callable[[Dict, Dict, CoverageConfig, float], Optional[str]]] = {
    "multiple_subjects": _rule_multiple_subjects,
    "face_blurry": _rule_face_blurry,
    "soft_face": _rule_soft_face,
    "body_not_visible": _rule_body_not_visible,
    "pose_not_visible": _rule_pose_not_visible,
    "garment_not_visible": _rule_garment_not_visible,
    "garment_blurry": _rule_garment_blurry,
}


def hard_reject_reason(rec: Dict[str, Any], cfg: CoverageConfig,
                       soft_face_thr: float = 0.0, purpose: str = "face") -> str | None:
    """Reasons an image is rejected regardless of balancing.

    Order: universal quality-fail -> universal duplicate -> the preset's
    middle-band rules (in listed order, first match wins) -> universal
    min-suitability. For purpose="face" this is identical to the original chain.
    """
    if rec.get("quality_verdict") == "fail":
        return "quality:" + "; ".join(rec.get("quality_reasons", [])[:2])
    vl = rec.get("vl", {})
    if rec.get("is_duplicate"):
        return "duplicate"
    preset = purposes.resolve_preset(purpose)
    for rule_name in preset.hard_reject_rules:
        reason = HARD_REJECT_RULES[rule_name](rec, vl, cfg, soft_face_thr)
        if reason:
            return reason
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


def _requirement_count(req, survivors: List[Dict[str, Any]]) -> int:
    """Evaluate one CoverageRequirement over the survivor vl dicts.

    For kind=="distinct", a missing field falls back to req.field_default (as
    the original view_counts Counter defaulted a missing view_angle to "front"),
    keeping distinct counts consistent with the *_counts stats on records whose
    vl omits the field (e.g. --no-vl runs)."""
    if req.kind == "distinct":
        return len({r["vl"].get(req.field, req.field_default) for r in survivors})
    return sum(1 for r in survivors if req.predicate(r["vl"]))


def analyze_coverage(records: List[Dict[str, Any]], cfg: CoverageConfig,
                     target: int | None = None, purpose: str = "face") -> Dict[str, Any]:
    """Produce coverage stats, sufficiency verdict, and keep/reject decisions.

    Mutates nothing; returns a dict. Each record gets an 'auto_decision' set on
    a shallow copy list returned as 'records'. Bucketing and sufficiency
    requirements come from the purpose preset (default "face" == original).
    """
    preset = purposes.resolve_preset(purpose)
    recs = [dict(r) for r in records]
    soft_thr = _soft_face_threshold(recs, cfg)

    # --- stage 1: hard rejects -------------------------------------------
    survivors = []
    for r in recs:
        reason = hard_reject_reason(r, cfg, soft_thr, purpose)
        if reason:
            r["auto_decision"] = "reject"
            r["auto_reason"] = reason
        else:
            r["auto_decision"] = "keep"  # provisional; balancing may demote
            r["auto_reason"] = ""
            survivors.append(r)

    # --- stage 2: bucket the survivors (purpose-defined bucket key) ------
    buckets: Dict[str, List[Dict]] = defaultdict(list)
    for r in survivors:
        vl = r.get("vl", {})
        r["bucket"] = preset.bucket_fn(vl)
        buckets[r["bucket"]].append(r)

    view_counts = Counter(r["vl"].get("view_angle", "front") for r in survivors)
    shot_counts = Counter(r["vl"].get("shot_type", "other") for r in survivors)

    # --- stage 3: sufficiency verdict (table-driven per purpose) ---------
    # req_counts insertion order == requirement declaration order (this is the
    # stats-dict order); gaps are emitted in gap_check_order (may differ).
    req_counts: Dict[str, int] = {}
    reqs_by_name = {}
    for req in preset.coverage_requirements:
        req_counts[req.name] = _requirement_count(req, survivors)
        reqs_by_name[req.name] = req

    gap_order = preset.gap_check_order or [r.name for r in preset.coverage_requirements]
    gaps: List[str] = []
    coverage_display: List[Dict[str, Any]] = []
    for name in gap_order:
        req = reqs_by_name[name]
        count = req_counts[name]
        minimum = getattr(cfg, req.min_count_attr)
        coverage_display.append({"label": req.display_label, "count": count, "min": minimum})
        if count < minimum:
            gaps.append(req.gap_template.format(count=count, min=minimum))

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
        "purpose": preset.id,
        "coverage_display": coverage_display,
        "stats": {
            "n_input": len(recs),
            "soft_face_threshold": round(soft_thr, 1),
            "n_hard_reject": len(recs) - n_survivors,
            "n_survivors": n_survivors,
            "n_overflow_reject": overflow,
            "n_final_keep": len(final_keep),
            # purpose-specific aggregate counts (for face: front_face, profiles,
            # three_quarter, full_body, distinct_views — original order/keys).
            **req_counts,
            "view_counts": dict(view_counts),
            "shot_counts": dict(shot_counts),
        },
        "coverage_table": coverage_table,
    }
