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
