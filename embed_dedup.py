"""Near-duplicate detection + uniqueness ranking.

Approach follows FiftyOne Brain (uniqueness in [0,1], near-duplicate via a
similarity threshold) and LoRA-Dataset-Automaker (embedding-cosine dedup).

Default embedding is a zero-download perceptual feature vector (pHash bits +
downscaled grayscale structure + HSV color histogram) that works fully
offline. Optionally, CLIP embeddings via transformers can be enabled for
semantic dedup (config.dedup.use_clip_embeddings).
"""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple

import numpy as np
from PIL import Image

from .config import DedupConfig


# --- perceptual feature embedding (no downloads) ---------------------------
def _phash_bits(gray32: np.ndarray, size: int) -> np.ndarray:
    """DCT-based perceptual hash bits from a 32x32 grayscale image."""
    import cv2

    dct = cv2.dct(np.float32(gray32))
    low = dct[:size, :size]
    med = np.median(low[1:, 1:])  # exclude DC term from median
    return (low > med).astype(np.uint8).flatten()


def perceptual_embedding(im: Image.Image, phash_size: int = 16) -> Tuple[np.ndarray, np.ndarray]:
    """Return (feature_vector, phash_bits).

    feature_vector is L2-normalized float32 combining structure + color, used
    for cosine similarity. phash_bits is used for exact-duplicate prefiltering.
    """
    import cv2

    rgb = np.asarray(im.convert("RGB"))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    g32 = cv2.resize(gray, (32, 32), interpolation=cv2.INTER_AREA)
    bits = _phash_bits(g32, phash_size)

    def unit(v: np.ndarray) -> np.ndarray:
        n = np.linalg.norm(v)
        return v / n if n > 0 else v

    # structure: 24x24 grayscale, zero-mean (layout of the actual subject/pose)
    g = cv2.resize(gray, (24, 24), interpolation=cv2.INTER_AREA).astype(np.float32).flatten()
    g -= g.mean()
    struct = unit(g)
    # perceptual-hash bits centered to {-1,+1}
    ph = unit((bits.astype(np.float32) * 2.0 - 1.0))
    # color: HSV histogram as a distribution (weak signal; downweighted so that
    # plain-background portraits are not all judged near-duplicate)
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    hist = cv2.calcHist([hsv], [0, 1, 2], None, [8, 8, 4], [0, 180, 0, 256, 0, 256])
    color = unit(hist.flatten().astype(np.float32))

    # weight: structure + phash dominate; color is a minor tint
    feat = np.concatenate([0.62 * struct, 0.62 * ph, 0.22 * color])
    return unit(feat).astype(np.float32), bits


def _clip_embed(paths: List[str], cfg: DedupConfig, device: str, log) -> Optional[np.ndarray]:
    try:
        import torch
        from transformers import CLIPModel, CLIPProcessor

        log(f"[dedup] loading CLIP {cfg.clip_model}")
        model = CLIPModel.from_pretrained(cfg.clip_model).to(device).eval()
        proc = CLIPProcessor.from_pretrained(cfg.clip_model)
        feats = []
        with torch.no_grad():
            for p in paths:
                im = Image.open(p).convert("RGB")
                inp = proc(images=im, return_tensors="pt").to(device)
                f = model.get_image_features(**inp)
                f = f / f.norm(dim=-1, keepdim=True)
                feats.append(f.cpu().numpy()[0])
        del model
        return np.stack(feats).astype(np.float32)
    except Exception as e:  # noqa: BLE001
        log(f"[dedup] CLIP embeddings unavailable ({e}); using perceptual features")
        return None


def hamming(a: np.ndarray, b: np.ndarray) -> int:
    return int(np.count_nonzero(a != b))


class DedupResult:
    def __init__(self, n: int):
        self.cluster_id = [-1] * n       # near-dup cluster index (-1 = singleton)
        self.is_duplicate = [False] * n  # True if a non-representative of its cluster
        self.uniqueness = [1.0] * n      # [0,1], higher = more unique
        self.clusters: Dict[int, List[int]] = {}


def analyze_dedup(
    items: List[dict],
    cfg: DedupConfig,
    device: str = "cpu",
    quality_scores: Optional[List[float]] = None,
    log=print,
) -> DedupResult:
    """Cluster near-duplicates and compute uniqueness.

    items: list of dicts each with an 'image' (PIL) or 'path'.
    quality_scores: optional per-item quality (0..1); the highest-quality item
    in each near-dup cluster is kept as representative.
    """
    n = len(items)
    res = DedupResult(n)
    if n == 0:
        return res

    feats: np.ndarray
    phashes: List[np.ndarray] = []
    embeds = None
    if cfg.use_clip_embeddings:
        paths = [it.get("path") for it in items]
        if all(paths):
            embeds = _clip_embed(paths, cfg, device, log)
    if embeds is not None:
        feats = embeds
        # still compute phash for exact-dup prefilter
        for it in items:
            im = it.get("image") or Image.open(it["path"])
            _, bits = perceptual_embedding(im, cfg.phash_size)
            phashes.append(bits)
    else:
        flist = []
        for it in items:
            im = it.get("image") or Image.open(it["path"])
            f, bits = perceptual_embedding(im, cfg.phash_size)
            flist.append(f)
            phashes.append(bits)
        feats = np.stack(flist)

    # cosine similarity matrix (features are L2-normalized)
    sim = feats @ feats.T
    np.fill_diagonal(sim, 0.0)

    # --- union-find clustering over near-duplicate edges ------------------
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    thr = cfg.similarity_threshold
    for i in range(n):
        for j in range(i + 1, n):
            near = sim[i, j] >= thr
            if not near and phashes:
                near = hamming(phashes[i], phashes[j]) <= cfg.phash_exact_max_hamming
            if near:
                union(i, j)

    groups: Dict[int, List[int]] = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)

    cid = 0
    q = quality_scores or [1.0] * n
    for root, members in groups.items():
        if len(members) < 2:
            continue
        res.clusters[cid] = members
        # representative = highest quality (tie-break: most unique later)
        rep = max(members, key=lambda m: q[m])
        for m in members:
            res.cluster_id[m] = cid
            res.is_duplicate[m] = m != rep
        cid += 1

    # --- uniqueness: 1 - max similarity to any other image ----------------
    max_sim = sim.max(axis=1) if n > 1 else np.zeros(n)
    uniq = 1.0 - max_sim
    # normalize to [0,1] across the set for interpretability
    lo, hi = float(uniq.min()), float(uniq.max())
    if hi > lo:
        uniq = (uniq - lo) / (hi - lo)
    res.uniqueness = [round(float(u), 3) for u in uniq]
    return res
