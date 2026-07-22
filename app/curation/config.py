"""Curation configuration: tunable thresholds, taxonomy, and defaults.

All thresholds live here so the pipeline can be tuned from one place (and the
web UI can override them per-job via the ``params`` JSON on a Job row).
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List

# --- Model -----------------------------------------------------------------
# Uncensored (abliterated) Qwen3-VL. Resolves from HF_HOME cache or downloads.
# huihui-ai's abliteration of Qwen3-VL-8B-Instruct: non-gated, arch
# Qwen3VLForConditionalGeneration (same code path as the base), VQA-capable.
# (prithivMLmods/Qwen3-VL-8B-Abliterated-Caption-it is gated -> not used.)
DEFAULT_VL_MODEL = "huihui-ai/Huihui-Qwen3-VL-8B-Instruct-abliterated"

# --- Taxonomy --------------------------------------------------------------
# The VL model must classify each image into exactly one of these labels.
VIEW_ANGLES = [
    "front",
    "three_quarter_left",
    "three_quarter_right",
    "profile_left",
    "profile_right",
    "back",
]
SHOT_TYPES = [
    "closeup_face",
    "head_and_shoulders",
    "upper_body",
    "full_body",
    "other",
]
# Issues the VL model may flag (free list; unknown values are kept as-is).
KNOWN_ISSUES = [
    "motion_blur",
    "out_of_focus",
    "heavy_filter",
    "watermark_or_text",
    "cropped_face",
    "occlusion",
    "multiple_subjects",
    "extreme_pose",
    "low_quality",
]
# Purpose-specific taxonomies (used by the corresponding VL prompt + coerce +
# coverage buckets in purposes.py). The default "face" purpose uses only
# VIEW_ANGLES / SHOT_TYPES above and ignores these.
GARMENT_TYPES = [            # outfit purpose: coarse garment category
    "dress",
    "top",
    "bottom",
    "outerwear",
    "swimwear",
    "full_outfit",
    "other",
]
POSE_CATEGORIES = [          # pose purpose: coarse body-pose category
    "standing",
    "sitting",
    "walking",
    "lying",
    "action",
    "kneeling",
    "other",
]


@dataclass
class QualityThresholds:
    """Deterministic OpenCV quality-gate thresholds."""
    min_side_fail: int = 512          # reject if min(w,h) < this
    min_side_warn: int = 768          # warn if below this
    # Variance-of-Laplacian sharpness. Values are for images downscaled so the
    # long side is `sharpness_long_side` px, making thresholds resolution-stable.
    sharpness_long_side: int = 1024
    global_sharpness_fail: float = 40.0
    global_sharpness_warn: float = 90.0
    # Face sharpness (the key "blurry face outline" gate). Measured on the
    # eye/brow band (identity-critical, blur-sensitive), normalized to 160px
    # width. Calibrated on newface_v1: soft faces ~110-260, median ~740.
    # The absolute fail only catches clearly-broken faces; the conservative,
    # dataset-adaptive soft-face cut lives in CoverageConfig (soft_face_*).
    face_sharpness_fail: float = 60.0
    face_sharpness_warn: float = 480.0
    # Face must occupy at least this fraction of the frame area to be useful
    # for face learning (below -> warn, very small -> treated as no usable face).
    face_area_frac_warn: float = 0.015
    face_area_frac_min: float = 0.004
    face_detect_conf: float = 0.6     # YuNet detection score threshold
    # Exposure: fraction of pixels clipped at black/white before flagging.
    clip_frac_warn: float = 0.35
    mean_luma_low: float = 25.0
    mean_luma_high: float = 232.0


@dataclass
class DedupConfig:
    """Near-duplicate / uniqueness configuration."""
    # Cosine-similarity threshold above which two images are near-duplicates.
    # Validated on newface_v1: near-dups (brightness/crop variants) score
    # 0.93-1.0 while distinct poses stay <=0.62, so 0.90 is a safe cut.
    similarity_threshold: float = 0.90
    # Use transformers CLIP embeddings if available (semantic dedup). When
    # False (default), use a zero-download perceptual feature vector.
    use_clip_embeddings: bool = False
    clip_model: str = "openai/clip-vit-base-patch32"
    phash_size: int = 16              # pHash DCT low-freq block side
    phash_exact_max_hamming: int = 4  # <= this hamming distance => exact-dup


@dataclass
class CoverageConfig:
    """Per-bucket minimums and balancing targets for an identity LoRA.

    Buckets are (view_angle, shot_type). Rather than requiring every cell, we
    require minimums on *aggregates* that matter for face + body-shape learning.
    """
    # Minimum quality-passing images required for a "sufficient" verdict.
    min_total_sufficient: int = 25
    min_total_marginal: int = 15
    # Aggregate minimums (counted over quality-passing, non-duplicate images).
    min_front_face: int = 4           # front closeup/head_and_shoulders
    min_profiles: int = 2             # any profile_left/right (outline)
    min_three_quarter: int = 4        # 3/4 left+right combined
    min_full_body: int = 3            # for body-shape ("체형") learning
    min_distinct_views: int = 3       # distinct view_angle labels present
    # Balancing: cap any single (view x shot) bucket to avoid over-representation.
    # If None, computed as max(cap_min, ceil(target/ n_nonempty_buckets * cap_factor)).
    per_bucket_cap: int | None = None
    cap_min: int = 6
    cap_factor: float = 1.5
    # VL suitability score (0-100) below which an image is rejected outright.
    min_suitability: int = 45
    # Conservative, dataset-adaptive soft-face rejection: reject a face-detected
    # image whose eye-region sharpness is below max(soft_face_floor,
    # median * soft_face_rel_ratio). Adapts to the set's overall sharpness so it
    # is strict without being brittle. Set soft_face_reject=False to disable.
    soft_face_reject: bool = True
    soft_face_floor: float = 200.0
    soft_face_rel_ratio: float = 0.45
    # --- Aggregate minimums for non-face purposes ------------------------
    # These are consumed only by the corresponding purpose presets (see
    # purposes.py); the default "face" purpose never reads them. Kept here so
    # the web UI can override any of them via the same coverage params JSON.
    min_body_visible: int = 8         # full_body: body-shape-visible images
    min_full_body_shots: int = 6      # full_body: full_body shot_type images
    min_pose_categories: int = 5      # pose: distinct pose_category labels
    min_pose_visible: int = 8         # pose: images with a clearly-visible pose
    min_garment_types: int = 3        # outfit: distinct garment_type labels
    min_garment_visible_shots: int = 8  # outfit: images with the garment visible
    min_style_consistent: int = 10    # style: style-consistent images
    min_style_variety: int = 4        # style: distinct shot_type labels (variety)


@dataclass
class CurationConfig:
    # Training purpose this dataset is being curated for. Resolved against
    # purposes.PURPOSE_PRESETS by the pipeline (quality weights, VL prompt,
    # coverage buckets, hard-reject rules). "face" == the original
    # identity-LoRA behavior; kept as a bare string here (not an import) so
    # config.py has no dependency on purposes.py.
    purpose: str = "face"
    model_name_or_path: str = DEFAULT_VL_MODEL
    device: str = "cuda:0"
    dtype: str = "bf16"
    quantize: bool = False            # fp8 (~9-10GB) to fit alongside ComfyUI
    qtype: str = "float8"             # optimum.quanto weight type
    low_vram: bool = False            # keep on CPU until after quantize
    max_res: int = 1024               # downscale long side before VL/quality
    vl_max_new_tokens: int = 512
    thumb_size: int = 384
    quality: QualityThresholds = field(default_factory=QualityThresholds)
    dedup: DedupConfig = field(default_factory=DedupConfig)
    coverage: CoverageConfig = field(default_factory=CoverageConfig)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_overrides(cls, overrides: Dict[str, Any] | None) -> "CurationConfig":
        """Build a config, applying a (possibly nested) overrides dict.

        Accepts either flat top-level keys or nested {"quality": {...}} blocks,
        which is how the web UI passes per-job params.
        """
        cfg = cls()
        if not overrides:
            return cfg
        sub_map = {
            "quality": cfg.quality,
            "dedup": cfg.dedup,
            "coverage": cfg.coverage,
        }
        for key, val in overrides.items():
            if key in sub_map and isinstance(val, dict):
                for k, v in val.items():
                    if hasattr(sub_map[key], k) and v is not None:
                        setattr(sub_map[key], k, v)
            elif hasattr(cfg, key) and val is not None and key not in sub_map:
                setattr(cfg, key, val)
        return cfg


IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".bmp")


def bucket_label(view_angle: str, shot_type: str) -> str:
    return f"{view_angle}|{shot_type}"
