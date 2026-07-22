"""Lightweight smoke tests — no GPU, no VL model, no network.

Heavy deps (cv2 / numpy / PIL / torch) are import-guarded with
``pytest.importorskip`` so this file also runs in a bare environment; the
pure-python checks (config, taxonomy, paths, prompts, db, gpu_prep) always run.
"""
import os

import pytest


def test_package_version():
    import curation
    assert curation.__version__


def test_config_defaults_and_overrides():
    from curation.config import CurationConfig, bucket_label

    cfg = CurationConfig()
    assert cfg.device.startswith("cuda")
    assert cfg.quality.min_side_fail > 0
    assert cfg.dedup.similarity_threshold == pytest.approx(0.90)

    # nested override — how the web UI passes per-job params
    cfg2 = CurationConfig.from_overrides(
        {"quantize": True, "quality": {"min_side_fail": 256}}
    )
    assert cfg2.quantize is True
    assert cfg2.quality.min_side_fail == 256

    # unknown keys are ignored, not fatal
    CurationConfig.from_overrides({"nope": 1, "quality": {"nope": 2}})

    assert bucket_label("front", "closeup_face") == "front|closeup_face"


def test_taxonomy_nonempty():
    from curation import config

    assert config.VIEW_ANGLES and config.SHOT_TYPES
    assert "front" in config.VIEW_ANGLES


def test_paths_layout_invariants():
    from curation import paths

    p = paths.get_paths()
    for key in ("imagen_root", "datasets_dir", "hf_home", "python"):
        assert key in p and p[key]

    # Layout: package under app/, Dockerfile at the project root.
    assert paths.PACKAGE_DIR.endswith(os.sep + "app")
    assert os.path.exists(os.path.join(paths.PROJECT_ROOT, "Dockerfile"))


def test_env_overrides_paths(monkeypatch):
    from curation import paths

    monkeypatch.setenv("DATASETS_DIR", "/tmp/xyz-datasets")
    assert paths.get_paths()["datasets_dir"] == "/tmp/xyz-datasets"


def test_prompts_parse_eval_is_robust():
    from curation import prompts

    assert prompts.EVAL_SYSTEM and prompts.EVAL_USER
    # tolerant of surrounding noise; returns a dict or None, never raises
    out = prompts.parse_eval('noise {"view_angle": "front", "suitability": 80} tail')
    assert out is None or isinstance(out, dict)
    assert prompts.parse_eval("not json at all") is None or isinstance(
        prompts.parse_eval("not json at all"), dict
    )


def test_purpose_default_is_face():
    from curation import purposes
    from curation.config import CurationConfig

    assert CurationConfig().purpose == "face"
    assert purposes.DEFAULT_PURPOSE == "face"
    assert purposes.resolve_preset(None).id == "face"
    assert purposes.resolve_preset("bogus").id == "face"      # unknown -> face
    assert set(purposes.PURPOSE_PRESETS) == {
        "face", "full_body", "pose", "outfit", "style"
    }


def test_face_preset_matches_legacy_constants():
    from curation import purposes, prompts
    from curation.quality import QualityWeights

    face = purposes.resolve_preset("face")
    # weights are the original hardcoded literals
    assert face.quality_weights == QualityWeights()
    assert (face.quality_weights.w_res, face.quality_weights.w_global,
            face.quality_weights.w_face, face.quality_weights.w_size,
            face.quality_weights.w_expo) == (0.18, 0.22, 0.32, 0.13, 0.15)
    # shared prompt text + face coerce
    assert face.eval_user == prompts.EVAL_USER
    assert (face.eval_system or prompts.EVAL_SYSTEM) == prompts.EVAL_SYSTEM
    assert face.coerce_fn is prompts._coerce_face


def test_coerce_face_matches_legacy_field_order():
    from curation import prompts

    sample = {
        "shot_type": "closeup_face", "view_angle": "front", "face_visible": True,
        "face_occluded": False, "face_clarity": "sharp", "subject_count": 1,
        "body_shape_visible": True, "issues": ["motion_blur"],
        "training_suitability": 88, "reason": "ok",
    }
    out = prompts._coerce_face(sample)
    assert list(out.keys()) == [
        "shot_type", "view_angle", "face_visible", "face_occluded",
        "face_clarity", "subject_count", "body_shape_visible", "issues",
        "training_suitability", "reason",
    ]
    # _coerce alias preserved for any legacy caller
    assert prompts._coerce is prompts._coerce_face
    # parse_eval(text) still defaults to the face normalizer (single-arg call)
    parsed = prompts.parse_eval('{"view_angle": "front", "training_suitability": 80}')
    assert parsed and parsed["view_angle"] == "front" and "face_clarity" in parsed


def test_hard_reject_face_order_unchanged():
    from curation import coverage
    from curation.config import CoverageConfig

    # A record that trips BOTH face_blurry and soft_face at once must report the
    # earlier rule (face_blurry) — the original first-match-wins semantics.
    rec = {
        "quality_verdict": "pass", "is_duplicate": 0, "face_detected": True,
        "face_sharpness": 10.0,
        "vl": {"subject_count": 1, "issues": [], "face_visible": True,
               "face_clarity": "blurry", "training_suitability": 90},
    }
    reason = coverage.hard_reject_reason(rec, CoverageConfig(), soft_face_thr=500.0,
                                         purpose="face")
    assert reason == "vl:blurry face"


def test_analyze_coverage_face_stats_key_order():
    from curation import coverage
    from curation.config import CoverageConfig

    recs = [
        {"id": "a", "quality_score": 0.8, "quality_verdict": "pass",
         "quality_reasons": [], "face_detected": True, "face_sharpness": 600.0,
         "uniqueness": 0.5, "is_duplicate": 0,
         "vl": {"view_angle": "front", "shot_type": "closeup_face",
                "face_visible": True, "face_clarity": "sharp", "subject_count": 1,
                "body_shape_visible": True, "issues": [], "training_suitability": 80}},
    ]
    cov = coverage.analyze_coverage(recs, CoverageConfig())  # purpose defaults to face
    assert list(cov["stats"].keys()) == [
        "n_input", "soft_face_threshold", "n_hard_reject", "n_survivors",
        "n_overflow_reject", "n_final_keep", "front_face", "profiles",
        "three_quarter", "full_body", "distinct_views", "view_counts",
        "shot_counts",
    ]
    assert cov["purpose"] == "face"


def test_outfit_purpose_behaviour():
    from curation import coverage, prompts
    from curation.config import CoverageConfig

    def outfit_rec(rid, garment_type, visible, clarity="sharp"):
        vl = prompts._coerce_outfit({
            "shot_type": "full_body", "view_angle": "front",
            "garment_type": garment_type, "garment_visible": visible,
            "garment_clarity": clarity, "subject_count": 1,
            "training_suitability": 80, "face_clarity": "blurry",  # must be ignored
        })
        return {"id": rid, "quality_score": 0.8, "quality_verdict": "pass",
                "quality_reasons": [], "face_detected": True, "face_sharpness": 20.0,
                "uniqueness": 0.5, "is_duplicate": 0, "vl": vl}

    recs = [outfit_rec("a", "dress", True), outfit_rec("b", "top", True),
            outfit_rec("c", "bottom", False), outfit_rec("d", "dress", True, "blurry")]
    cov = coverage.analyze_coverage(recs, CoverageConfig(), purpose="outfit")
    byid = {r["id"]: r for r in cov["records"]}
    # garment_type x view_angle bucketing (not view x shot)
    assert byid["a"]["bucket"] == "dress|front"
    # garment-visibility / clarity hard rejects
    assert byid["c"]["auto_reason"] == "garment not visible"
    assert byid["d"]["auto_reason"] == "vl:blurry garment"
    # face_clarity="blurry" does NOT reject an outfit image (no face rule)
    assert byid["a"]["auto_decision"] == "keep"
    # purpose-specific stat keys present, not the face ones
    assert "garment_types" in cov["stats"] and "front_face" not in cov["stats"]


def test_db_job_roundtrip(tmp_path):
    from curation.db import CurationDB

    db = CurationDB(str(tmp_path / "t.db"))
    db.create_job({"id": "job1", "source_folder": "/x", "status": "queued"})
    got = db.get_job("job1")
    assert got and got["id"] == "job1" and got["status"] == "queued"

    db.update_job("job1", status="running")
    assert db.get_job("job1")["status"] == "running"
    assert db.get_job("missing") is None


def test_gpu_prep_physical_index(monkeypatch):
    from curation import gpu_prep

    monkeypatch.setenv("CUDA_VISIBLE_DEVICES", "3")
    assert gpu_prep.physical_index("cuda:0") == 3

    monkeypatch.delenv("CUDA_VISIBLE_DEVICES", raising=False)
    assert gpu_prep.physical_index("cuda:2") == 2


def test_quality_analyzer_importable():
    pytest.importorskip("cv2")
    pytest.importorskip("numpy")
    from curation.quality import QualityAnalyzer

    assert QualityAnalyzer is not None


def test_curate_cli_importable():
    # curate pulls report/quality/embed at import time (PIL/cv2/numpy).
    pytest.importorskip("cv2")
    pytest.importorskip("numpy")
    pytest.importorskip("PIL")
    import curation.curate as c

    assert hasattr(c, "main")
