#!/usr/bin/env python
"""Curation CLI orchestrator.

Modes:
  analyze  Evaluate every image (quality + VL + dedup + coverage), write results
           to the DB and reports. No files are moved.
  apply    Read final decisions (user override > auto) and move rejects to a
           sibling '<src>_rejected/' folder (or delete), optionally recaption.
  auto     analyze then apply in one process (default; no human review).

Examples:
  python -m curation.curate --src datasets/newface_v1 --mode analyze --dry-run
  python -m curation.curate --src datasets/newface_v1 --mode auto --recaption
  python -m curation.curate --job-id <uuid> --db curation/ui/curation.db --mode apply
"""
from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import sys
import uuid
from typing import Any, Dict, List, Optional

# Allow running both as `python -m curation.curate` and `python curation/curate.py`
if __package__ in (None, ""):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from curation.config import CurationConfig, IMAGE_EXTS  # noqa: E402
from curation import coverage as coverage_mod  # noqa: E402
from curation import embed_dedup, report  # noqa: E402
from curation.db import CurationDB  # noqa: E402
from curation.quality import QualityAnalyzer, read_bgr  # noqa: E402

REPO_ROOT = "/data/workspace/imagen-lab"
RUNS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "runs")


def log(msg: str):
    print(msg, flush=True)


def image_id(job_id: str, path: str) -> str:
    # Scope the id to the job so re-analyzing the same dataset in a new job does
    # not collide with (and overwrite) an earlier job's ImageResult rows.
    return hashlib.md5(f"{job_id}:{os.path.abspath(path)}".encode()).hexdigest()[:16]


def list_images(src: str) -> List[str]:
    """Top-level image files only (skip cache subdirs like _latent_cache)."""
    out = []
    for name in sorted(os.listdir(src)):
        full = os.path.join(src, name)
        if os.path.isfile(full) and name.lower().endswith(IMAGE_EXTS) and not name.startswith("."):
            out.append(full)
    return out


def caption_path(img_path: str) -> str:
    return os.path.splitext(img_path)[0] + ".txt"


# --------------------------------------------------------------------------
def run_analyze(src: str, cfg: CurationConfig, db: CurationDB, job_id: str,
                out_dir: str, evaluator, dry_run: bool,
                target: Optional[int] = None) -> Dict[str, Any]:
    from PIL import Image, ImageOps

    files = list_images(src)
    log(f"[analyze] {len(files)} images in {src}")
    db.update_job(job_id, status="analyzing", total_steps=len(files), step=0,
                  info="analyzing images")

    qa = QualityAnalyzer(cfg.quality)
    thumbs_dir = os.path.join(out_dir, "thumbs")
    os.makedirs(thumbs_dir, exist_ok=True)

    records: List[Dict[str, Any]] = []
    dedup_items: List[Dict[str, Any]] = []
    qscores: List[float] = []

    for i, path in enumerate(files):
        if db.should_stop(job_id):
            log("[analyze] stop requested")
            db.update_job(job_id, status="stopped", info="stopped by user")
            return {}
        # A single unreadable/corrupt image must not abort the whole job.
        try:
            iid = image_id(job_id, path)
            # downscaled PIL for VL + thumb + embedding
            pil = Image.open(path)
            orig_size = pil.size  # (w, h) from header, cheap
            pil = ImageOps.exif_transpose(pil).convert("RGB")

            # quality on a 1280px copy (stable thresholds) but true-res gate
            bgr = read_bgr(path, max_res=1280)
            if bgr is None:
                raise ValueError("unreadable image")
            q = qa.analyze(bgr, orig_size=orig_size)
            vl_img = pil
            if max(pil.size) > cfg.max_res:
                sc = cfg.max_res / max(pil.size)
                vl_img = pil.resize((int(pil.width * sc), int(pil.height * sc)), Image.BICUBIC)

            vl = evaluator.evaluate(vl_img) if evaluator else {}

            # thumbnail file for the UI
            thumb_rel = os.path.join("thumbs", f"{iid}.jpg")
            try:
                th = pil.copy()
                th.thumbnail((cfg.thumb_size, cfg.thumb_size))
                th.save(os.path.join(out_dir, thumb_rel), "JPEG", quality=82)
            except Exception:  # noqa: BLE001
                thumb_rel = ""

            rec = {
                "id": iid, "job_ref": job_id, "path": path,
                "filename": os.path.basename(path),
                "thumb_path": os.path.join(out_dir, thumb_rel) if thumb_rel else "",
                "width": q.width, "height": q.height,
                "quality_score": q.quality_score, "quality_verdict": q.verdict,
                "quality_reasons": q.reasons, "global_sharpness": q.global_sharpness,
                "face_sharpness": q.face_sharpness, "face_detected": int(q.face_detected),
                "face_area_frac": q.face_area_frac, "vl": vl, "bucket": "",
                "uniqueness": 0.0, "cluster_id": -1, "is_duplicate": 0,
                "auto_decision": "keep", "auto_reason": "",
            }
            records.append(rec)
            dedup_items.append({"path": path, "image": vl_img})
            qscores.append(q.quality_score)
        except Exception as e:  # noqa: BLE001
            log(f"[analyze] skipping {os.path.basename(path)}: {e}")
        db.set_progress(job_id, i + 1, len(files), f"analyzed {i+1}/{len(files)}")
        if (i + 1) % 20 == 0:
            log(f"[analyze] {i+1}/{len(files)}")

    if not records:
        db.update_job(job_id, status="error", info="no readable images")
        return {}

    # --- dedup + uniqueness (needs the whole set) ------------------------
    log("[analyze] deduplication + uniqueness")
    dd = embed_dedup.analyze_dedup(dedup_items, cfg.dedup, device=cfg.device,
                                   quality_scores=qscores, log=log)
    for idx, rec in enumerate(records):
        rec["uniqueness"] = dd.uniqueness[idx]
        rec["cluster_id"] = dd.cluster_id[idx]
        rec["is_duplicate"] = int(dd.is_duplicate[idx])

    # --- coverage + auto decisions ---------------------------------------
    log("[analyze] coverage + selection")
    cov = coverage_mod.analyze_coverage(
        [{**r, "quality_verdict": r["quality_verdict"],
          "quality_reasons": r["quality_reasons"]} for r in records],
        cfg.coverage, target=target,
    )
    decided = {r["id"]: r for r in cov["records"]}
    for rec in records:
        d = decided[rec["id"]]
        rec["bucket"] = d.get("bucket", "")
        rec["auto_decision"] = d["auto_decision"]
        rec["auto_reason"] = d["auto_reason"]

    # --- persist ---------------------------------------------------------
    db.clear_images(job_id)
    for rec in records:
        db.upsert_image(rec)

    summary = {
        "source_folder": src, "verdict": cov["verdict"], "gaps": cov["gaps"],
        "cap": cov["cap"], "stats": cov["stats"], "coverage_table": cov["coverage_table"],
    }
    report.write_json(out_dir, {"summary": summary, "records": records})
    md = report.write_markdown(out_dir, summary, records)
    gal = report.write_gallery(out_dir, summary, records)
    log(f"[analyze] report: {md}")
    log(f"[analyze] gallery: {gal}")

    db.update_job(job_id, verdict=summary, report_dir=out_dir,
                  info=f"analyzed {len(records)}; keep "
                       f"{cov['stats']['n_final_keep']}/{cov['stats']['n_input']}")
    return {"records": records, "summary": summary}


# --------------------------------------------------------------------------
def run_apply(src: str, cfg: CurationConfig, db: CurationDB, job_id: str,
              recaption: bool, do_delete: bool, dry_run: bool,
              clear_cache: bool, evaluator) -> Dict[str, Any]:
    recs = db.get_images(job_id)
    if not recs:
        log("[apply] no analyzed records found")
        db.update_job(job_id, status="error", info="no analyzed records for apply")
        return {}

    rejected_dir = src.rstrip("/") + "_rejected"
    keep = [r for r in recs if db.final_decision(r) == "keep"]
    reject = [r for r in recs if db.final_decision(r) == "reject"]
    log(f"[apply] keep {len(keep)} · reject {len(reject)} · dry_run={dry_run}")
    db.update_job(job_id, status="applying",
                  info=f"applying: keep {len(keep)}, reject {len(reject)}")

    if not dry_run and reject:
        os.makedirs(rejected_dir, exist_ok=True)

    moved = 0
    for r in reject:
        img = r["path"]
        cap = caption_path(img)
        if dry_run:
            continue
        try:
            if do_delete:
                for p in (img, cap):
                    if os.path.exists(p):
                        os.remove(p)
            else:
                for p in (img, cap):
                    if os.path.exists(p):
                        shutil.move(p, os.path.join(rejected_dir, os.path.basename(p)))
            db.mark_applied(r["id"])
            moved += 1
        except Exception as e:  # noqa: BLE001
            log(f"[apply] failed to move {img}: {e}")

    # --- recaption kept images -------------------------------------------
    recap = 0
    if recaption and not dry_run and keep:
        from PIL import Image, ImageOps

        if evaluator is None:
            db.update_job(job_id, info="recaption requested but VL model not loaded")
        else:
            db.update_job(job_id, status="applying", total_steps=len(keep), step=0,
                          info="recaptioning kept images")
            for i, r in enumerate(keep):
                if db.should_stop(job_id):
                    db.update_job(job_id, status="stopped",
                                  info=f"stopped during recaption ({recap}/{len(keep)} done; "
                                       f"{'deleted' if do_delete else 'moved'} {moved})")
                    log("[apply] stop requested during recaption")
                    return {"moved": moved, "recap": recap, "keep": len(keep)}
                try:
                    pil = ImageOps.exif_transpose(Image.open(r["path"])).convert("RGB")
                    if max(pil.size) > cfg.max_res:
                        sc = cfg.max_res / max(pil.size)
                        pil = pil.resize((int(pil.width * sc), int(pil.height * sc)), Image.BICUBIC)
                    cap = evaluator.caption(pil)
                    with open(caption_path(r["path"]), "w", encoding="utf-8") as f:
                        f.write(cap)
                    recap += 1
                except Exception as e:  # noqa: BLE001
                    log(f"[apply] recaption failed {r['path']}: {e}")
                db.set_progress(job_id, i + 1, len(keep), f"recaption {i+1}/{len(keep)}")

    # --- stale cache handling --------------------------------------------
    if not dry_run and (moved or recap):
        for cache in ("_latent_cache", "_t_e_cache"):
            cdir = os.path.join(src, cache)
            if os.path.isdir(cdir):
                if clear_cache:
                    shutil.rmtree(cdir, ignore_errors=True)
                    log(f"[apply] cleared {cdir}")
                else:
                    log(f"[apply] NOTE: stale cache remains at {cdir} "
                        f"(ai-toolkit will ignore orphans; use --clear-cache to remove)")

    info = (f"applied: {'deleted' if do_delete else 'moved'} {moved}, "
            f"recaptioned {recap}, kept {len(keep)}"
            + (" (dry-run: no changes)" if dry_run else ""))
    db.update_job(job_id, status="completed", info=info)
    log(f"[apply] {info}")
    return {"moved": moved, "recap": recap, "keep": len(keep)}


# --------------------------------------------------------------------------
def build_config(job: Optional[Dict[str, Any]], args) -> CurationConfig:
    overrides: Dict[str, Any] = {}
    if job and job.get("params"):
        import json
        try:
            overrides = json.loads(job["params"]) if isinstance(job["params"], str) else job["params"]
        except (TypeError, ValueError):
            overrides = {}
    if args.model:
        overrides["model_name_or_path"] = args.model
    if args.device:
        overrides["device"] = args.device
    if args.quantize:
        overrides["quantize"] = True
    if args.low_vram:
        overrides["low_vram"] = True
    return CurationConfig.from_overrides(overrides)


def main():
    ap = argparse.ArgumentParser(description="LoRA dataset curation")
    ap.add_argument("--src", help="source dataset folder")
    ap.add_argument("--mode", choices=["analyze", "apply", "auto"], default="auto")
    ap.add_argument("--job-id", default=None)
    ap.add_argument("--db", default=None, help="SQLite path (default: <out>/curation.db)")
    ap.add_argument("--out", default=None, help="report/thumbnail output dir")
    ap.add_argument("--model", default=None)
    ap.add_argument("--device", default=None)
    ap.add_argument("--target", type=int, default=None, help="target kept image count")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--recaption", action="store_true")
    ap.add_argument("--delete", action="store_true", help="hard-delete rejects instead of moving")
    ap.add_argument("--clear-cache", action="store_true", help="remove _latent_cache/_t_e_cache on apply")
    ap.add_argument("--no-vl", action="store_true", help="skip VL model (quality+dedup only; debug)")
    ap.add_argument("--quantize", action="store_true", help="force fp8 quantize (coexist on a busy GPU)")
    ap.add_argument("--no-quantize", action="store_true", help="force bf16 (never quantize)")
    ap.add_argument("--low-vram", action="store_true", help="keep model on CPU until after quantize")
    ap.add_argument("--no-free-gpu", action="store_true",
                    help="do NOT stop an idle ComfyUI holding the target GPU's VRAM")
    args = ap.parse_args()

    job_id = args.job_id or uuid.uuid4().hex[:16]
    out_dir = args.out or os.path.join(RUNS_DIR, job_id)
    os.makedirs(out_dir, exist_ok=True)
    db_path = args.db or os.path.join(out_dir, "curation.db")
    db = CurationDB(db_path)

    job = db.get_job(job_id)
    if job is None:
        if not args.src:
            ap.error("--src is required when the job does not already exist in the DB")
        db.create_job({
            "id": job_id, "name": f"{os.path.basename(args.src.rstrip('/'))}-{job_id[:6]}",
            "source_folder": os.path.abspath(args.src), "mode": args.mode,
            "params": {}, "status": "running",
            "dry_run": int(args.dry_run), "recaption": int(args.recaption),
            "do_delete": int(args.delete), "target": args.target,
        })
        job = db.get_job(job_id)

    src = args.src or job["source_folder"]
    cfg = build_config(job, args)
    if args.target:
        cfg.coverage.per_bucket_cap = None  # let target drive selection
    log(f"[curate] job={job_id} mode={args.mode} src={src} model={cfg.model_name_or_path}")
    log(f"[curate] db={db_path} out={out_dir}")

    # Load VL model once if needed for this run.
    need_vl_analyze = args.mode in ("analyze", "auto") and not args.no_vl
    need_vl_apply = args.mode in ("apply", "auto") and args.recaption
    evaluator = None
    if need_vl_analyze or need_vl_apply:
        # Reclaim an idle-but-occupied GPU, then choose bf16 vs fp8 by free VRAM.
        free_after = None
        if not args.no_free_gpu:
            from curation import gpu_prep
            phys = gpu_prep.physical_index(cfg.device, log=log)
            free_after = gpu_prep.prepare(phys, need_mb=20000, log=log)["free_mb"]
        if args.quantize:
            cfg.quantize, cfg.low_vram = True, True
        elif args.no_quantize:
            cfg.quantize = False
        elif free_after is not None:
            if free_after < 20000:
                cfg.quantize, cfg.low_vram = True, True
                log(f"[curate] {free_after:.0f}MB free < 20GB → fp8 quantize")
            else:
                cfg.quantize = False
                log(f"[curate] {free_after:.0f}MB free → bf16 (no quantize)")
        from curation.vl_evaluator import VLEvaluator
        evaluator = VLEvaluator(cfg, log=log)
        evaluator.load()

    if args.mode in ("analyze", "auto"):
        res = run_analyze(src, cfg, db, job_id, out_dir,
                          None if args.no_vl else evaluator, args.dry_run,
                          target=args.target)
        if not res:
            return
        if args.mode == "analyze":
            db.update_job(job_id, status="review" if job["mode"] == "review" else "analyzed")
            log("[curate] analyze complete")
            if args.dry_run or job["mode"] == "review":
                return

    if args.mode in ("apply", "auto"):
        if args.dry_run:
            run_apply(src, cfg, db, job_id, args.recaption, args.delete,
                      True, args.clear_cache, evaluator)
            log("[curate] dry-run: no files changed")
        else:
            run_apply(src, cfg, db, job_id, args.recaption, args.delete,
                      False, args.clear_cache, evaluator)

    log("[curate] done")


if __name__ == "__main__":
    main()
