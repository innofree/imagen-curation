"""Training-purpose presets: the single place that binds each LoRA training
purpose to its VL prompt, quality weighting, coverage buckets, coverage
requirements, and hard-reject rules.

Design intent — a data registry, not branching logic. ``quality.py``,
``coverage.py``, ``prompts.py``, and ``curate.py`` never ``if purpose == ...``;
they call the generic callables/values a ``PurposePreset`` supplies. Adding a
new purpose (or a refined sub-preset of an existing one — e.g. a stricter
"face_v2", or a body-type-grouped face variant) is therefore a matter of adding
ONE ``PurposePreset`` entry here (plus, at most, one small coerce helper reused
from the ones in ``prompts.py``), touching none of the engine modules.

``purpose == "face"`` reproduces the original identity-LoRA behavior exactly, so
any caller that does not set a purpose is unaffected.

Import position: this module sits ABOVE coverage.py / vl_evaluator.py / curate.py
and imports only config.py, quality.py, prompts.py (none of which import this),
so there is no import cycle. Hard-reject rule *callables* live in coverage.py
and are referenced here only by name (string), so this module does not import
coverage.py.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from .config import bucket_label
from .quality import QualityWeights
from . import prompts


# --- coverage requirement descriptor ---------------------------------------
@dataclass(frozen=True)
class CoverageRequirement:
    """A single sufficiency check for a purpose.

    kind == "count":   count survivors whose vl dict satisfies ``predicate``.
    kind == "distinct":count distinct non-null values of vl[``field``].

    A gap is reported when the resulting count is below the CoverageConfig
    attribute named ``min_count_attr``. ``gap_template`` is a str.format template
    receiving ``count`` and ``min`` and producing the exact user-facing gap
    message; ``display_label`` is the short label used in reports.
    """
    name: str
    display_label: str
    gap_template: str
    min_count_attr: str
    kind: str = "count"
    predicate: Optional[Callable[[Dict[str, Any]], bool]] = None
    field: Optional[str] = None
    # For kind=="distinct": value assumed when vl lacks ``field`` (mirrors the
    # coverage counters' defaults, e.g. a missing view_angle counts as "front",
    # so distinct_views stays consistent with view_counts on --no-vl records).
    field_default: str = "other"


# --- purpose preset ---------------------------------------------------------
@dataclass(frozen=True)
class PurposePreset:
    id: str
    label: str
    eval_user: str
    coerce_fn: Callable[[Dict[str, Any]], Dict[str, Any]]
    quality_weights: QualityWeights
    bucket_fn: Callable[[Dict[str, Any]], str]
    coverage_requirements: List[CoverageRequirement]
    hard_reject_rules: List[str]
    # None -> shared default EVAL_SYSTEM (all current presets reuse it).
    eval_system: Optional[str] = None
    # Order in which gaps are reported (names). None -> requirement order.
    gap_check_order: Optional[List[str]] = None
    # Optional CoverageConfig defaults for this preset, applied UNDER any
    # per-job user overrides (used by future sub-presets; empty for the 5 base
    # purposes since their thresholds are the CoverageConfig defaults).
    default_coverage_overrides: Dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# FACE (default) — a 1:1 translation of the original hardcoded coverage logic.
# The declaration order below IS the stats-dict key order; gap_check_order
# reproduces the (different) original gap-message order. Both were verified
# against the pre-refactor coverage.py to keep face output byte-identical.
# ---------------------------------------------------------------------------
FACE_COVERAGE_REQUIREMENTS = [
    CoverageRequirement(
        "front_face", "정면 얼굴", "정면 얼굴 컷 부족 ({count}/{min})", "min_front_face",
        predicate=lambda v: v.get("view_angle") == "front"
        and v.get("shot_type") in ("closeup_face", "head_and_shoulders")),
    CoverageRequirement(
        "profiles", "프로파일", "프로파일(측면) 부족 ({count}/{min})", "min_profiles",
        predicate=lambda v: str(v.get("view_angle", "")).startswith("profile")),
    CoverageRequirement(
        "three_quarter", "3/4", "3/4 뷰 부족 ({count}/{min})", "min_three_quarter",
        predicate=lambda v: str(v.get("view_angle", "")).startswith("three_quarter")),
    CoverageRequirement(
        "full_body", "전신", "전신(체형) 컷 부족 ({count}/{min})", "min_full_body",
        predicate=lambda v: v.get("shot_type") == "full_body"),
    CoverageRequirement(
        "distinct_views", "뷰 다양성", "뷰 다양성 부족 ({count}/{min} 방향)",
        "min_distinct_views", kind="distinct", field="view_angle", field_default="front"),
]
FACE_GAP_CHECK_ORDER = ["front_face", "three_quarter", "profiles", "full_body", "distinct_views"]


def _view_shot_bucket(vl: Dict[str, Any]) -> str:
    return bucket_label(vl.get("view_angle", "front"), vl.get("shot_type", "other"))


# ---------------------------------------------------------------------------
# Non-face purposes. Quality weights zero out face terms (face not the point);
# starting-point values, not empirically calibrated like face's.
# ---------------------------------------------------------------------------
FULL_BODY_COVERAGE_REQUIREMENTS = [
    CoverageRequirement(
        "full_body_shots", "전신 컷", "전신 컷 부족 ({count}/{min})", "min_full_body_shots",
        predicate=lambda v: v.get("shot_type") == "full_body"),
    CoverageRequirement(
        "body_visible", "체형 노출", "체형 노출 컷 부족 ({count}/{min})", "min_body_visible",
        predicate=lambda v: v.get("body_shape_visible") is True),
    CoverageRequirement(
        "distinct_views", "뷰 다양성", "뷰 다양성 부족 ({count}/{min} 방향)",
        "min_distinct_views", kind="distinct", field="view_angle", field_default="front"),
]

POSE_COVERAGE_REQUIREMENTS = [
    CoverageRequirement(
        "pose_categories", "포즈 종류", "포즈 다양성 부족 ({count}/{min} 종)",
        "min_pose_categories", kind="distinct", field="pose_category"),
    CoverageRequirement(
        "pose_visible", "포즈 선명", "포즈 선명 컷 부족 ({count}/{min})", "min_pose_visible",
        predicate=lambda v: v.get("pose_clearly_visible") is True),
]

OUTFIT_COVERAGE_REQUIREMENTS = [
    CoverageRequirement(
        "garment_types", "의상 종류", "의상 종류 부족 ({count}/{min} 종)",
        "min_garment_types", kind="distinct", field="garment_type"),
    CoverageRequirement(
        "garment_visible", "의상 노출", "의상 노출 컷 부족 ({count}/{min})",
        "min_garment_visible_shots", predicate=lambda v: v.get("garment_visible") is True),
]

STYLE_COVERAGE_REQUIREMENTS = [
    CoverageRequirement(
        "style_consistent", "스타일 일관", "스타일 일관 컷 부족 ({count}/{min})",
        "min_style_consistent", predicate=lambda v: v.get("style_consistent") is True),
    CoverageRequirement(
        "style_variety", "구도 다양성", "구도 다양성 부족 ({count}/{min} 종)",
        "min_style_variety", kind="distinct", field="shot_type"),
]


DEFAULT_PURPOSE = "face"

PURPOSE_PRESETS: Dict[str, PurposePreset] = {
    "face": PurposePreset(
        id="face", label="Face / Identity",
        eval_user=prompts.EVAL_USER,
        coerce_fn=prompts._coerce_face,
        quality_weights=QualityWeights(),  # original literals: 0.18/0.22/0.32/0.13/0.15
        bucket_fn=_view_shot_bucket,
        coverage_requirements=FACE_COVERAGE_REQUIREMENTS,
        gap_check_order=FACE_GAP_CHECK_ORDER,
        hard_reject_rules=["multiple_subjects", "face_blurry", "soft_face"],
    ),
    "full_body": PurposePreset(
        id="full_body", label="Full body",
        eval_user=prompts.EVAL_USER_FULL_BODY,
        coerce_fn=prompts._coerce_full_body,
        quality_weights=QualityWeights(w_res=0.25, w_global=0.35, w_face=0.10, w_size=0.05, w_expo=0.25),
        bucket_fn=_view_shot_bucket,
        coverage_requirements=FULL_BODY_COVERAGE_REQUIREMENTS,
        hard_reject_rules=["multiple_subjects", "body_not_visible"],
    ),
    "pose": PurposePreset(
        id="pose", label="Pose",
        eval_user=prompts.EVAL_USER_POSE,
        coerce_fn=prompts._coerce_pose,
        quality_weights=QualityWeights(w_res=0.25, w_global=0.40, w_face=0.0, w_size=0.0, w_expo=0.35),
        bucket_fn=lambda vl: vl.get("pose_category", "other"),
        coverage_requirements=POSE_COVERAGE_REQUIREMENTS,
        hard_reject_rules=["multiple_subjects", "pose_not_visible"],
    ),
    "outfit": PurposePreset(
        id="outfit", label="Outfit / Clothing",
        eval_user=prompts.EVAL_USER_OUTFIT,
        coerce_fn=prompts._coerce_outfit,
        quality_weights=QualityWeights(w_res=0.25, w_global=0.45, w_face=0.0, w_size=0.0, w_expo=0.30),
        bucket_fn=lambda vl: f"{vl.get('garment_type', 'other')}|{vl.get('view_angle', 'front')}",
        coverage_requirements=OUTFIT_COVERAGE_REQUIREMENTS,
        hard_reject_rules=["multiple_subjects", "garment_not_visible", "garment_blurry"],
    ),
    "style": PurposePreset(
        id="style", label="Art style",
        eval_user=prompts.EVAL_USER_STYLE,
        coerce_fn=prompts._coerce_style,
        quality_weights=QualityWeights(w_res=0.30, w_global=0.30, w_face=0.0, w_size=0.0, w_expo=0.40),
        bucket_fn=lambda vl: (vl.get("style_tags") or ["unknown"])[0],
        coverage_requirements=STYLE_COVERAGE_REQUIREMENTS,
        hard_reject_rules=[],
    ),
}


def resolve_preset(purpose: Optional[str]) -> PurposePreset:
    """Return the preset for ``purpose`` (falling back to the default face
    preset for None or an unknown id)."""
    return PURPOSE_PRESETS.get(purpose or DEFAULT_PURPOSE, PURPOSE_PRESETS[DEFAULT_PURPOSE])
