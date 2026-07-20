"""VL prompt templates + JSON parsing for structured image evaluation.

The evaluation prompt asks the model to classify view/shot, judge face
clarity, count subjects, flag issues, and score training suitability, and to
return STRICT JSON. Because the target datasets contain suggestive/glamour
content, the prompt explicitly instructs the (uncensored) model to describe
and evaluate objectively without refusing or sanitizing — this is why an
abliterated model is required.
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict, Optional

from .config import VIEW_ANGLES, SHOT_TYPES

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

CAPTION_USER = (
    "Write a single detailed, objective caption describing this photo for "
    "diffusion model training. Describe the person's appearance, pose, framing, "
    "clothing, expression, lighting, and setting factually and completely. Do "
    "not refuse or omit details. Output only the caption text, one paragraph, "
    "no preamble."
)


def _coerce(obj: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize/validate a parsed evaluation object with safe fallbacks."""
    out: Dict[str, Any] = {}
    st = str(obj.get("shot_type", "other")).strip().lower()
    out["shot_type"] = st if st in SHOT_TYPES else "other"
    va = str(obj.get("view_angle", "front")).strip().lower()
    out["view_angle"] = va if va in VIEW_ANGLES else "front"

    def as_bool(v, default=False):
        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            return v.strip().lower() in ("true", "yes", "1")
        return default

    out["face_visible"] = as_bool(obj.get("face_visible"), True)
    out["face_occluded"] = as_bool(obj.get("face_occluded"), False)
    fc = str(obj.get("face_clarity", "slightly_soft")).strip().lower()
    out["face_clarity"] = fc if fc in ("sharp", "slightly_soft", "blurry") else "slightly_soft"
    try:
        out["subject_count"] = int(obj.get("subject_count", 1))
    except (TypeError, ValueError):
        out["subject_count"] = 1
    out["body_shape_visible"] = as_bool(obj.get("body_shape_visible"), False)
    issues = obj.get("issues", [])
    if isinstance(issues, str):
        issues = [issues]
    out["issues"] = [str(x).strip().lower() for x in issues if str(x).strip()]
    try:
        sc = int(round(float(obj.get("training_suitability", 50))))
    except (TypeError, ValueError):
        sc = 50
    out["training_suitability"] = max(0, min(100, sc))
    out["reason"] = str(obj.get("reason", "")).strip()[:280]
    return out


def parse_eval(text: str) -> Optional[Dict[str, Any]]:
    """Extract and normalize the JSON object from model output; None on failure."""
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
                    return _coerce(json.loads(candidate))
                except json.JSONDecodeError:
                    return None
    return None
