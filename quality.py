"""Deterministic image-quality gate (OpenCV, CPU).

The load-bearing metric for this project is *face-region sharpness*: many
candidate images have a blurry / out-of-focus face outline that makes them
poor for identity LoRA training even when the overall image looks fine. We
detect the largest face (YuNet, with a Haar fallback) and measure the
variance-of-Laplacian on the face crop specifically, in addition to a global
sharpness measure, resolution, and exposure.
"""
from __future__ import annotations

import os
import urllib.request
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

from .config import QualityThresholds

# YuNet face detector (tiny, ~350KB). Downloaded once into curation/models/.
_YUNET_URL = (
    "https://github.com/opencv/opencv_zoo/raw/main/models/"
    "face_detection_yunet/face_detection_yunet_2023mar.onnx"
)
_MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")
_YUNET_PATH = os.path.join(_MODELS_DIR, "face_detection_yunet_2023mar.onnx")


@dataclass
class QualityResult:
    width: int
    height: int
    global_sharpness: float
    face_detected: bool
    face_sharpness: float           # 0.0 when no face
    face_area_frac: float           # face box area / frame area
    face_box: Optional[Tuple[int, int, int, int]]  # x,y,w,h in original px
    face_conf: float
    mean_luma: float
    clip_frac: float                # fraction of near-black/near-white pixels
    quality_score: float            # 0..1 combined
    verdict: str                    # "pass" | "warn" | "fail"
    reasons: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict:
        d = self.__dict__.copy()
        if self.face_box is not None:
            d["face_box"] = list(self.face_box)
        return d


class QualityAnalyzer:
    def __init__(self, thresholds: QualityThresholds | None = None):
        self.t = thresholds or QualityThresholds()
        self._yunet = None
        self._haar = None
        self._detector_kind = None

    # -- detector setup -----------------------------------------------------
    def _ensure_detector(self):
        if self._detector_kind is not None:
            return
        try:
            path = self._ensure_yunet_model()
            # input size is set per-image in detect()
            self._yunet = cv2.FaceDetectorYN.create(
                path, "", (320, 320), self.t.face_detect_conf, 0.3, 5000
            )
            self._detector_kind = "yunet"
        except Exception as e:  # noqa: BLE001 - fall back to bundled Haar
            print(f"[quality] YuNet unavailable ({e}); falling back to Haar cascade")
            cascade = os.path.join(
                cv2.data.haarcascades, "haarcascade_frontalface_default.xml"
            )
            self._haar = cv2.CascadeClassifier(cascade)
            self._detector_kind = "haar"

    def _ensure_yunet_model(self) -> str:
        if os.path.exists(_YUNET_PATH) and os.path.getsize(_YUNET_PATH) > 100_000:
            return _YUNET_PATH
        os.makedirs(_MODELS_DIR, exist_ok=True)
        print(f"[quality] downloading YuNet face detector -> {_YUNET_PATH}")
        urllib.request.urlretrieve(_YUNET_URL, _YUNET_PATH)
        return _YUNET_PATH

    # -- core metrics -------------------------------------------------------
    @staticmethod
    def _lap_var(gray: np.ndarray) -> float:
        return float(cv2.Laplacian(gray, cv2.CV_64F).var())

    def _detect_face(self, bgr: np.ndarray):
        """Return (box=(x,y,w,h), conf, eyes) for the largest face, or (None,0,None).

        eyes is ((rx,ry),(lx,ly)) from YuNet landmarks when available (Haar has
        no landmarks -> None)."""
        self._ensure_detector()
        h, w = bgr.shape[:2]
        if self._detector_kind == "yunet":
            self._yunet.setInputSize((w, h))
            _, faces = self._yunet.detect(bgr)
            if faces is None or len(faces) == 0:
                return None, 0.0, None
            # faces row: [x,y,w,h, rEye(x,y), lEye(x,y), nose, rMouth, lMouth, score]
            faces = sorted(faces, key=lambda f: f[2] * f[3], reverse=True)
            f = faces[0]
            box = (int(f[0]), int(f[1]), int(f[2]), int(f[3]))
            eyes = ((float(f[4]), float(f[5])), (float(f[6]), float(f[7])))
            return box, float(f[-1]), eyes
        else:
            gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
            dets = self._haar.detectMultiScale(gray, 1.1, 5, minSize=(40, 40))
            if len(dets) == 0:
                return None, 0.0, None
            dets = sorted(dets, key=lambda d: d[2] * d[3], reverse=True)
            x, y, fw, fh = [int(v) for v in dets[0]]
            return (x, y, fw, fh), 1.0, None

    @staticmethod
    def _eye_region_sharpness(bgr: np.ndarray, eyes) -> Optional[float]:
        """Laplacian-variance sharpness of the eye/brow band (the most
        identity-critical, blur-sensitive region). Normalized to a fixed width
        so the value is scale-stable. Returns None if the region is degenerate."""
        (rx, ry), (lx, ly) = eyes
        cx, cy = (rx + lx) / 2.0, (ry + ly) / 2.0
        dist = ((lx - rx) ** 2 + (ly - ry) ** 2) ** 0.5
        if dist < 6:
            return None
        half_w = dist * 1.25          # span both eyes + a margin
        half_h = dist * 0.55          # brow to under-eye
        h, w = bgr.shape[:2]
        x0, x1 = int(max(0, cx - half_w)), int(min(w, cx + half_w))
        y0, y1 = int(max(0, cy - half_h)), int(min(h, cy + half_h))
        crop = bgr[y0:y1, x0:x1]
        if crop.size == 0 or crop.shape[0] < 4 or crop.shape[1] < 4:
            return None
        g = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        # normalize width to 160px (keep aspect) so blur, not size, drives the value
        scale = 160.0 / g.shape[1]
        g = cv2.resize(g, (160, max(4, int(g.shape[0] * scale))), interpolation=cv2.INTER_AREA)
        return float(cv2.Laplacian(g, cv2.CV_64F).var())

    def analyze(self, bgr: np.ndarray,
                orig_size: Optional[Tuple[int, int]] = None) -> QualityResult:
        """Analyze a BGR uint8 image (as read by cv2).

        ``orig_size`` = (width, height) of the ORIGINAL image; pass it when
        ``bgr`` was downscaled for speed so the resolution gate reflects the
        true source resolution. Sharpness/face metrics are computed on ``bgr``
        and are resolution-normalized internally, so they stay comparable as
        long as callers feed a consistent processing size.
        """
        h, w = bgr.shape[:2]
        ow, oh = orig_size if orig_size else (w, h)
        t = self.t
        reasons: List[str] = []

        # --- global sharpness on a resolution-normalized copy --------------
        scale = t.sharpness_long_side / max(h, w)
        if scale < 1.0:
            norm = cv2.resize(bgr, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        else:
            norm = bgr
        gray_norm = cv2.cvtColor(norm, cv2.COLOR_BGR2GRAY)
        global_sharp = self._lap_var(gray_norm)

        # --- exposure ------------------------------------------------------
        gray_full = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        mean_luma = float(gray_full.mean())
        clip_frac = float(((gray_full < 6) | (gray_full > 249)).mean())

        # --- face detection + face sharpness (eye-region primary) ----------
        box, conf, eyes = self._detect_face(bgr)
        face_sharp = 0.0
        face_area_frac = 0.0
        face_detected = box is not None
        if box is not None:
            x, y, fw, fh = box
            x, y = max(0, x), max(0, y)
            crop = bgr[y : y + fh, x : x + fw]
            face_area_frac = (fw * fh) / float(w * h)
            face_crop_sharp = 0.0
            if crop.size > 0:
                crop_g = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
                crop_g = cv2.resize(crop_g, (256, 256), interpolation=cv2.INTER_AREA)
                face_crop_sharp = self._lap_var(crop_g)
            # Prefer the eye/brow-band sharpness (most identity-critical and
            # blur-sensitive); fall back to the whole face crop if no landmarks.
            eye_sharp = self._eye_region_sharpness(bgr, eyes) if eyes else None
            face_sharp = eye_sharp if eye_sharp is not None else face_crop_sharp

        # --- verdict logic -------------------------------------------------
        verdict = "pass"

        def demote(level: str, reason: str):
            nonlocal verdict
            reasons.append(reason)
            if level == "fail":
                verdict = "fail"
            elif level == "warn" and verdict != "fail":
                verdict = "warn"

        min_side = min(ow, oh)
        if min_side < t.min_side_fail:
            demote("fail", f"resolution too low ({min_side}px)")
        elif min_side < t.min_side_warn:
            demote("warn", f"low resolution ({min_side}px)")

        if global_sharp < t.global_sharpness_fail:
            demote("fail", f"image very blurry (sharpness {global_sharp:.0f})")
        elif global_sharp < t.global_sharpness_warn:
            demote("warn", f"image slightly soft (sharpness {global_sharp:.0f})")

        if face_detected and face_area_frac >= t.face_area_frac_min:
            if face_sharp < t.face_sharpness_fail:
                demote("fail", f"blurry face (face sharpness {face_sharp:.0f})")
            elif face_sharp < t.face_sharpness_warn:
                demote("warn", f"soft face (face sharpness {face_sharp:.0f})")
            if face_area_frac < t.face_area_frac_warn:
                demote("warn", f"small face ({face_area_frac*100:.1f}% of frame)")

        if clip_frac > t.clip_frac_warn:
            demote("warn", f"exposure clipping ({clip_frac*100:.0f}%)")
        if mean_luma < t.mean_luma_low:
            demote("warn", "underexposed")
        elif mean_luma > t.mean_luma_high:
            demote("warn", "overexposed")

        quality_score = self._score(
            min_side, global_sharp, face_detected, face_sharp, face_area_frac,
            clip_frac, mean_luma,
        )

        return QualityResult(
            width=ow, height=oh,
            global_sharpness=round(global_sharp, 1),
            face_detected=face_detected,
            face_sharpness=round(face_sharp, 1),
            face_area_frac=round(face_area_frac, 4),
            face_box=box, face_conf=round(conf, 3),
            mean_luma=round(mean_luma, 1), clip_frac=round(clip_frac, 3),
            quality_score=round(quality_score, 3),
            verdict=verdict, reasons=reasons,
        )

    def _score(self, min_side, global_sharp, face_detected, face_sharp,
               face_area_frac, clip_frac, mean_luma) -> float:
        """Combine metrics into a 0..1 quality score (soft, for ranking)."""
        t = self.t

        def ramp(v, lo, hi):
            if hi <= lo:
                return 1.0
            return float(np.clip((v - lo) / (hi - lo), 0.0, 1.0))

        s_res = ramp(min_side, t.min_side_fail, t.min_side_warn)
        s_global = ramp(global_sharp, t.global_sharpness_fail, t.global_sharpness_warn * 1.5)
        if face_detected and face_area_frac >= t.face_area_frac_min:
            s_face = ramp(face_sharp, t.face_sharpness_fail, t.face_sharpness_warn * 1.5)
            s_size = ramp(face_area_frac, t.face_area_frac_min, t.face_area_frac_warn * 2)
        else:
            # No usable face: neutral (body-only shots are still useful).
            s_face, s_size = 0.6, 0.6
        s_expo = 1.0 - ramp(clip_frac, t.clip_frac_warn, 0.8)
        # Weighted: face sharpness dominates for identity training.
        score = (
            0.18 * s_res + 0.22 * s_global + 0.32 * s_face
            + 0.13 * s_size + 0.15 * s_expo
        )
        return float(np.clip(score, 0.0, 1.0))


def read_bgr(path: str, max_res: Optional[int] = None) -> Optional[np.ndarray]:
    """Read an image as BGR uint8, optionally downscaling the long side.

    Uses PIL then converts, so it handles webp / odd modes that cv2.imread may
    choke on, and honors EXIF orientation-free RGB conversion.
    """
    from PIL import Image, ImageOps

    try:
        im = Image.open(path)
        im = ImageOps.exif_transpose(im).convert("RGB")
    except Exception as e:  # noqa: BLE001
        print(f"[quality] failed to read {path}: {e}")
        return None
    if max_res is not None and max(im.size) > max_res:
        scale = max_res / max(im.size)
        im = im.resize((int(im.width * scale), int(im.height * scale)), Image.BICUBIC)
    rgb = np.asarray(im)
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
