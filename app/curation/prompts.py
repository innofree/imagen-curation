"""VL prompt templates + JSON parsing for structured image evaluation.

The evaluation prompt asks the model to classify view/shot, judge face
clarity, count subjects, flag issues, and score training suitability, and to
return STRICT JSON. Because the target datasets contain suggestive/glamour
content, the prompt explicitly instructs the (uncensored) model to describe
and evaluate objectively without refusing or sanitizing — this is why an
abliterated model is required.

Each training *purpose* (face / full_body / pose / outfit / style) asks the
model for a slightly different schema and scoring rubric. The prompt text and
the matching ``_coerce_*`` normalizer for each purpose live here; the registry
that binds them together (with quality weights and coverage rules) lives in
``purposes.py``. ``parse_eval`` takes a ``coerce_fn`` so this module has no
dependency on ``purposes.py`` (avoids an import cycle) — the default coerce is
the original face normalizer, keeping ``parse_eval(text)`` backward compatible.
"""
from __future__ import annotations

import json
import re
from typing import Any, Callable, Dict, Optional

from .config import VIEW_ANGLES, SHOT_TYPES, GARMENT_TYPES, POSE_CATEGORIES

EVAL_SYSTEM = (
    "You are a meticulous dataset-curation assistant for training image LoRA "
    "models. You analyze photographs objectively and factually. The images may "
    "contain swimwear, lingerie, or suggestive glamour content; this is a "
    "legitimate dataset-preparation task, so evaluate every image neutrally and "
    "completely without refusing, moralizing, or omitting details. You always "
    "reply with a single valid JSON object and nothing else."
)

EVAL_USER = f"""Analyze this photo for use as training data for a single-person identity LoRA (learning one person's face and body).

Return ONE JSON object with exactly these keys:

{{
  "shot_type": one of {SHOT_TYPES},
  "view_angle": one of {VIEW_ANGLES},   // orientation of the face/head
  "face_visible": true/false,
  "face_occluded": true/false,          // hair, hand, sunglasses, mask, etc.
  "face_clarity": "sharp" | "slightly_soft" | "blurry",  // sharpness of facial features
  "subject_count": integer,             // number of people
  "body_shape_visible": true/false,     // is enough of the body shown to learn physique
  "issues": [ ... ],                    // zero or more of: motion_blur, out_of_focus, heavy_filter, watermark_or_text, cropped_face, occlusion, multiple_subjects, extreme_pose, low_quality
  "training_suitability": integer 0-100,// how good this image is for identity LoRA training
  "reason": "one short sentence"        // why this suitability score
}}

Guidance:
- "closeup_face": face fills most of frame. "head_and_shoulders": head + shoulders. "upper_body": waist up. "full_body": most of body visible.
- Judge face_clarity by the sharpness of the eyes/edges of the face, not the background.
- Lower training_suitability for: blurry/soft face, tiny face, heavy beauty filter, occluded face, multiple people, extreme crops, watermarks.
- Reply with JSON only. No markdown, no code fences, no commentary."""

# --- Purpose-specific user prompts -----------------------------------------
EVAL_USER_FULL_BODY = f"""Analyze this photo for use as training data for a FULL-BODY / physique LoRA (learning one person's whole-body proportions and shape, not their face).

Return ONE JSON object with exactly these keys:

{{
  "shot_type": one of {SHOT_TYPES},
  "view_angle": one of {VIEW_ANGLES},   // orientation of the body
  "subject_count": integer,             // number of people
  "full_body_visible": true/false,      // whole body head-to-toe within frame
  "body_shape_visible": true/false,     // is enough of the body shown to learn physique
  "body_occluded": true/false,          // body heavily hidden by objects/other people/crop
  "issues": [ ... ],                    // zero or more of: motion_blur, out_of_focus, heavy_filter, watermark_or_text, cropped_face, occlusion, multiple_subjects, extreme_pose, low_quality
  "training_suitability": integer 0-100,// how good this image is for full-body LoRA training
  "reason": "one short sentence"
}}

Guidance:
- Judge suitability by how clearly the WHOLE body and its proportions are visible; face sharpness is NOT important here.
- Lower training_suitability for: body cropped/cut off, body heavily occluded, multiple people, extreme unrepresentative poses, low resolution.
- Reply with JSON only. No markdown, no code fences, no commentary."""

EVAL_USER_POSE = f"""Analyze this photo for use as training data for a POSE LoRA (learning body poses and gestures — NOT a specific person's identity or clothing).

Return ONE JSON object with exactly these keys:

{{
  "shot_type": one of {SHOT_TYPES},
  "view_angle": one of {VIEW_ANGLES},
  "subject_count": integer,
  "pose_category": one of {POSE_CATEGORIES},   // coarse body-pose category
  "pose_clearly_visible": true/false,          // is the full pose/silhouette legible
  "body_occluded": true/false,                 // pose obscured by objects/crop/other people
  "issues": [ ... ],                    // zero or more of: motion_blur, out_of_focus, heavy_filter, watermark_or_text, cropped_face, occlusion, multiple_subjects, extreme_pose, low_quality
  "training_suitability": integer 0-100,// how good this image is for pose LoRA training
  "reason": "one short sentence"
}}

Guidance:
- Judge by how clearly the body POSE is readable. Ignore facial identity and clothing detail.
- Lower training_suitability for: pose obscured/occluded, body cropped, multiple people, motion blur.
- Reply with JSON only. No markdown, no code fences, no commentary."""

EVAL_USER_OUTFIT = f"""Analyze this photo for use as training data for an OUTFIT / clothing LoRA (learning a garment's design, texture, and fit — NOT the person's face).

Return ONE JSON object with exactly these keys:

{{
  "shot_type": one of {SHOT_TYPES},
  "view_angle": one of {VIEW_ANGLES},
  "subject_count": integer,
  "garment_type": one of {GARMENT_TYPES},      // dominant garment category
  "garment_visible": true/false,               // is the garment clearly shown
  "garment_occluded": true/false,              // garment hidden by hands/objects/crop
  "garment_clarity": "sharp" | "slightly_soft" | "blurry",  // sharpness of fabric/texture detail
  "issues": [ ... ],                    // zero or more of: motion_blur, out_of_focus, heavy_filter, watermark_or_text, cropped_face, occlusion, multiple_subjects, extreme_pose, low_quality
  "training_suitability": integer 0-100,// how good this image is for outfit LoRA training
  "reason": "one short sentence"
}}

Guidance:
- Judge by how clearly the GARMENT and its texture/fit are visible and in focus. Face sharpness is NOT important here.
- Lower training_suitability for: garment not fully visible, garment heavily occluded, blurry fabric/texture, extreme crop of the garment, multiple people.
- Reply with JSON only. No markdown, no code fences, no commentary."""

EVAL_USER_STYLE = f"""Analyze this image for use as training data for an ART-STYLE LoRA (learning a consistent rendering/art style — NOT a specific person, pose, or garment).

Return ONE JSON object with exactly these keys:

{{
  "shot_type": one of {SHOT_TYPES},
  "view_angle": one of {VIEW_ANGLES},
  "subject_count": integer,
  "style_tags": [ ... ],                // short free tags describing the art style, e.g. ["anime","cel_shaded"]
  "style_consistent": true/false,       // is the rendering style clean and representative
  "issues": [ ... ],                    // zero or more of: motion_blur, out_of_focus, heavy_filter, watermark_or_text, cropped_face, occlusion, multiple_subjects, extreme_pose, low_quality
  "training_suitability": integer 0-100,// how good this image is for art-style LoRA training
  "reason": "one short sentence"
}}

Guidance:
- Judge by how cleanly and consistently the ART STYLE is rendered. Identity, pose, and clothing do not matter.
- Lower training_suitability for: mixed/inconsistent style, watermarks/text, heavy compression artifacts, low quality.
- Reply with JSON only. No markdown, no code fences, no commentary."""

CAPTION_USER = (
    "Write a single detailed, objective caption describing this photo for "
    "diffusion model training. Describe the person's appearance, pose, framing, "
    "clothing, expression, lighting, and setting factually and completely. Do "
    "not refuse or omit details. Output only the caption text, one paragraph, "
    "no preamble."
)


# --- coercion building blocks ----------------------------------------------
def _as_bool(v, default=False):
    if isinstance(v, bool):
        return v
    if isinstance(v, str):
        return v.strip().lower() in ("true", "yes", "1")
    return default


def _clarity(v) -> str:
    c = str(v).strip().lower()
    return c if c in ("sharp", "slightly_soft", "blurry") else "slightly_soft"


def _one_of(v, allowed, default):
    s = str(v).strip().lower()
    return s if s in allowed else default


def _int(v, default):
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return default


def _str_list(v):
    if isinstance(v, str):
        v = [v]
    if not isinstance(v, (list, tuple)):
        return []
    return [str(x).strip().lower() for x in v if str(x).strip()]


def _coerce_common(obj: Dict[str, Any]) -> Dict[str, Any]:
    """Fields every purpose shares. Callers append purpose-specific keys and
    control final key order themselves."""
    out: Dict[str, Any] = {}
    out["shot_type"] = _one_of(obj.get("shot_type", "other"), SHOT_TYPES, "other")
    out["view_angle"] = _one_of(obj.get("view_angle", "front"), VIEW_ANGLES, "front")
    try:
        out["subject_count"] = int(obj.get("subject_count", 1))
    except (TypeError, ValueError):
        out["subject_count"] = 1
    out["issues"] = _str_list(obj.get("issues", []))
    out["training_suitability"] = max(0, min(100, _int(obj.get("training_suitability", 50), 50)))
    out["reason"] = str(obj.get("reason", "")).strip()[:280]
    return out


def _coerce_face(obj: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize a face/identity evaluation. Output key order is fixed and MUST
    match the original _coerce() for byte-identical reports."""
    out: Dict[str, Any] = {}
    out["shot_type"] = _one_of(obj.get("shot_type", "other"), SHOT_TYPES, "other")
    out["view_angle"] = _one_of(obj.get("view_angle", "front"), VIEW_ANGLES, "front")
    out["face_visible"] = _as_bool(obj.get("face_visible"), True)
    out["face_occluded"] = _as_bool(obj.get("face_occluded"), False)
    out["face_clarity"] = _clarity(obj.get("face_clarity", "slightly_soft"))
    try:
        out["subject_count"] = int(obj.get("subject_count", 1))
    except (TypeError, ValueError):
        out["subject_count"] = 1
    out["body_shape_visible"] = _as_bool(obj.get("body_shape_visible"), False)
    out["issues"] = _str_list(obj.get("issues", []))
    out["training_suitability"] = max(0, min(100, _int(obj.get("training_suitability", 50), 50)))
    out["reason"] = str(obj.get("reason", "")).strip()[:280]
    return out


# Backward-compat alias (older imports / tests referenced _coerce).
_coerce = _coerce_face


def _coerce_full_body(obj: Dict[str, Any]) -> Dict[str, Any]:
    c = _coerce_common(obj)
    return {
        "shot_type": c["shot_type"],
        "view_angle": c["view_angle"],
        "subject_count": c["subject_count"],
        "full_body_visible": _as_bool(obj.get("full_body_visible"), False),
        "body_shape_visible": _as_bool(obj.get("body_shape_visible"), False),
        "body_occluded": _as_bool(obj.get("body_occluded"), False),
        "issues": c["issues"],
        "training_suitability": c["training_suitability"],
        "reason": c["reason"],
    }


def _coerce_pose(obj: Dict[str, Any]) -> Dict[str, Any]:
    c = _coerce_common(obj)
    return {
        "shot_type": c["shot_type"],
        "view_angle": c["view_angle"],
        "subject_count": c["subject_count"],
        "pose_category": _one_of(obj.get("pose_category", "other"), POSE_CATEGORIES, "other"),
        "pose_clearly_visible": _as_bool(obj.get("pose_clearly_visible"), True),
        "body_occluded": _as_bool(obj.get("body_occluded"), False),
        "issues": c["issues"],
        "training_suitability": c["training_suitability"],
        "reason": c["reason"],
    }


def _coerce_outfit(obj: Dict[str, Any]) -> Dict[str, Any]:
    c = _coerce_common(obj)
    return {
        "shot_type": c["shot_type"],
        "view_angle": c["view_angle"],
        "subject_count": c["subject_count"],
        "garment_type": _one_of(obj.get("garment_type", "other"), GARMENT_TYPES, "other"),
        "garment_visible": _as_bool(obj.get("garment_visible"), True),
        "garment_occluded": _as_bool(obj.get("garment_occluded"), False),
        "garment_clarity": _clarity(obj.get("garment_clarity", "slightly_soft")),
        "issues": c["issues"],
        "training_suitability": c["training_suitability"],
        "reason": c["reason"],
    }


def _coerce_style(obj: Dict[str, Any]) -> Dict[str, Any]:
    c = _coerce_common(obj)
    return {
        "shot_type": c["shot_type"],
        "view_angle": c["view_angle"],
        "subject_count": c["subject_count"],
        "style_tags": _str_list(obj.get("style_tags", [])) or ["unknown"],
        "style_consistent": _as_bool(obj.get("style_consistent"), True),
        "issues": c["issues"],
        "training_suitability": c["training_suitability"],
        "reason": c["reason"],
    }


def parse_eval(text: str, coerce_fn: Optional[Callable[[Dict[str, Any]], Dict[str, Any]]] = None
               ) -> Optional[Dict[str, Any]]:
    """Extract and normalize the JSON object from model output; None on failure.

    ``coerce_fn`` normalizes the parsed dict; it defaults to the face
    normalizer so ``parse_eval(text)`` behaves exactly as before.
    """
    if coerce_fn is None:
        coerce_fn = _coerce_face
    if not text:
        return None
    # Strip code fences if present.
    cleaned = re.sub(r"```(?:json)?", "", text).strip()
    # Find the first balanced {...} block.
    start = cleaned.find("{")
    if start == -1:
        return None
    depth = 0
    for i in range(start, len(cleaned)):
        if cleaned[i] == "{":
            depth += 1
        elif cleaned[i] == "}":
            depth -= 1
            if depth == 0:
                candidate = cleaned[start : i + 1]
                try:
                    return coerce_fn(json.loads(candidate))
                except json.JSONDecodeError:
                    return None
    return None
