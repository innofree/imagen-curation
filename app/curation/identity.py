"""Cross-image face-identity consistency (OpenCV SFace).

For a single-person identity/face LoRA every image in the dataset should depict
the SAME person. The per-image quality and VL gates judge each image in
isolation, so a sharp, well-composed photo of a *different* person passes and
silently contaminates the training set — hurting the LoRA's precision. This
module computes an SFace identity embedding per face-detected image, finds the
dataset's dominant identity, and flags images whose face does not match it as
off-identity outliers (turned into a hard-reject reason by coverage.py).

SFace (``cv2.FaceRecognizerSF``) is the recognition companion to the YuNet
detector already used in quality.py: a small (~37MB) ONNX model, CPU-only, no
torch dependency, downloaded once into curation/models/ exactly like YuNet.
"""
from __future__ import annotations

import os
import urllib.request
from typing import List, Optional, Tuple

import cv2
import numpy as np

from .config import IdentityConfig
from .quality import ensure_yunet_model

# SFace recognizer (opencv_zoo). Paired with YuNet for detection + alignment.
_SFACE_URL = (
    "https://github.com/opencv/opencv_zoo/raw/main/models/"
    "face_recognition_sface/face_recognition_sface_2021dec.onnx"
)
_MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")
_SFACE_PATH = os.path.join(_MODELS_DIR, "face_recognition_sface_2021dec.onnx")


class IdentityAnalyzer:
    def __init__(self, cfg: IdentityConfig, log=print):
        self.cfg = cfg
        self.log = log
        self._detector = None
        self._recognizer = None

    # -- model setup --------------------------------------------------------
    def _ensure_sface_model(self) -> str:
        if os.path.exists(_SFACE_PATH) and os.path.getsize(_SFACE_PATH) > 100_000:
            return _SFACE_PATH
        os.makedirs(_MODELS_DIR, exist_ok=True)
        self.log(f"[identity] downloading SFace recognizer -> {_SFACE_PATH}")
        urllib.request.urlretrieve(_SFACE_URL, _SFACE_PATH)
        return _SFACE_PATH

    def _ensure(self):
        if self._recognizer is not None:
            return
        # own YuNet instance: SFace.alignCrop needs the full YuNet detection row
        # (box + 5 landmarks), which QualityAnalyzer does not expose.
        self._detector = cv2.FaceDetectorYN.create(
            ensure_yunet_model(), "", (320, 320), 0.6, 0.3, 5000
        )
        self._recognizer = cv2.FaceRecognizerSF.create(self._ensure_sface_model(), "")

    # -- per-image embedding ------------------------------------------------
    def embed(self, bgr: np.ndarray) -> Optional[np.ndarray]:
        """L2-normalized 128-d SFace embedding of the largest face, or None when
        no face is detected / recognition fails (never raises; a bad image must
        not abort the job)."""
        try:
            self._ensure()
            h, w = bgr.shape[:2]
            self._detector.setInputSize((w, h))
            _, faces = self._detector.detect(bgr)
            if faces is None or len(faces) == 0:
                return None
            faces = sorted(faces, key=lambda f: f[2] * f[3], reverse=True)
            aligned = self._recognizer.alignCrop(bgr, faces[0])
            feat = np.asarray(self._recognizer.feature(aligned), dtype=np.float32).flatten()
            n = float(np.linalg.norm(feat))
            return feat / n if n > 0 else feat
        except Exception as e:  # noqa: BLE001
            self.log(f"[identity] embed failed: {e}")
            return None

    # -- cross-image consistency -------------------------------------------
    def analyze_consistency(
        self, embeddings: List[Optional[np.ndarray]]
    ) -> Tuple[List[bool], List[Optional[float]], dict]:
        """Find the dominant identity and flag off-identity outliers.

        Returns (outlier, sim_to_dominant, info):
          outlier[i]         True  -> image i's face does not match the dominant
                                      identity (a different person).
          sim_to_dominant[i] cosine similarity of face i to the dominant
                             identity's medoid, or None if image i has no face.
          info               diagnostics (whether the check actually ran, counts).

        Images without a detected face are never flagged (identity is unknown;
        they are left to the other gates). The check is skipped entirely — with
        NO images flagged — when there are too few faces or no clear majority
        identity, so a genuinely diverse single-person set is never mass-rejected.
        """
        n = len(embeddings)
        outlier = [False] * n
        sim_out: List[Optional[float]] = [None] * n
        valid = [i for i, e in enumerate(embeddings) if e is not None]
        info: dict = {"checked": False, "n_faces": len(valid)}

        if len(valid) < self.cfg.min_faces:
            info["reason"] = f"too few faces ({len(valid)} < {self.cfg.min_faces})"
            return outlier, sim_out, info

        M = np.stack([embeddings[i] for i in valid])  # (k, 128), L2-normalized
        sim = M @ M.T                                  # cosine similarity matrix
        thr = self.cfg.threshold

        # medoid = the embedding most other faces agree with at the threshold;
        # its support count is the size of the dominant identity cluster.
        support = (sim >= thr).sum(axis=1)             # includes self
        medoid = int(np.argmax(support))
        dom_support = int(support[medoid])
        frac = dom_support / len(valid)
        info.update({
            "threshold": thr,
            "dominant_support": dom_support,
            "dominant_fraction": round(frac, 3),
        })
        if frac < self.cfg.min_dominant_fraction:
            info["reason"] = (f"no dominant identity "
                              f"(largest cluster {frac:.0%} < "
                              f"{self.cfg.min_dominant_fraction:.0%})")
            return outlier, sim_out, info

        info["checked"] = True
        dom_sims = sim[medoid]
        for local, gi in enumerate(valid):
            s = float(dom_sims[local])
            sim_out[gi] = round(s, 3)
            outlier[gi] = s < thr
        info["n_outliers"] = sum(outlier)
        return outlier, sim_out, info
