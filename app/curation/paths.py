"""Shared path resolution (standalone / Docker friendly).

Analogous to ComfyUI's extra_model_paths.yaml: external locations are declared
once so curation can share the VL model cache with ComfyUI/ai-toolkit and read
the same datasets directory as ai-toolkit, without hardcoding the imagen-lab
tree.

Precedence (highest first):
  1. environment variables (IMAGEN_ROOT, DATASETS_DIR, HF_HOME, CURATION_PYTHON,
     COMFYUI_MODELS, IMAGEN_LAB_SCRIPT)
  2. paths.yaml at the project root  (copy from paths.yaml.example)
  3. derived defaults from the imagen-lab tree

Layout note: this package lives at <project_root>/app/curation/, so the imagen-lab
tree root defaults to three levels up. IMAGEN_ROOT is that tree root (used to
derive datasets/HF/python defaults) and is distinct from the package dir (app/,
which is what must be on PYTHONPATH — the UI worker sets that separately).
"""
from __future__ import annotations

import os
from typing import Any, Dict

try:
    import yaml  # PyYAML
except Exception:  # noqa: BLE001
    yaml = None  # type: ignore

_HERE = os.path.dirname(os.path.abspath(__file__))          # <root>/app/curation
PACKAGE_DIR = os.path.dirname(_HERE)                          # <root>/app  (PYTHONPATH)
PROJECT_ROOT = os.path.dirname(PACKAGE_DIR)                   # <root>      (Dockerfile, docs)
_DEFAULT_ROOT = os.path.dirname(PROJECT_ROOT)                 # imagen-lab tree root


def _load_yaml() -> Dict[str, Any]:
    if yaml is None:
        return {}
    for name in ("paths.yaml", "paths.yml"):
        p = os.path.join(PROJECT_ROOT, name)
        if os.path.exists(p):
            try:
                with open(p) as f:
                    return yaml.safe_load(f) or {}
            except Exception:  # noqa: BLE001
                return {}
    return {}


def get_paths() -> Dict[str, str]:
    y = _load_yaml()
    root = os.environ.get("IMAGEN_ROOT") or y.get("imagen_root") or _DEFAULT_ROOT

    def pick(env: str, key: str, default: str) -> str:
        return os.environ.get(env) or y.get(key) or default

    return {
        "imagen_root": root,
        # shared with ai-toolkit (same training datasets folder)
        "datasets_dir": pick("DATASETS_DIR", "datasets_dir", os.path.join(root, "datasets")),
        # shared VL-model / HF cache (also used by ComfyUI/ai-toolkit)
        "hf_home": pick("HF_HOME", "hf_home", os.path.join(root, "downloads", "hf")),
        # python interpreter used by the UI worker to spawn the pipeline
        "python": pick("CURATION_PYTHON", "python",
                       os.path.join(root, "miniconda3", "envs", "ai-toolkit", "bin", "python")),
        # optional: ComfyUI shared diffusion-model tree (not required by curation today)
        "comfyui_models": pick("COMFYUI_MODELS", "comfyui_models", os.path.join(root, "models")),
        # optional: imagen-lab service manager (used for idle-GPU reclaim; absent in Docker)
        "script": pick("IMAGEN_LAB_SCRIPT", "imagen_lab_script",
                       os.path.join(root, "scripts", "imagen-lab.sh")),
        "run_dir": pick("IMAGEN_RUN_DIR", "run_dir", os.path.join(root, "run")),
    }


PATHS = get_paths()


def ensure_hf_home_env() -> None:
    """Export HF_HOME from the resolved paths if not already set, so the VL
    model resolves from the shared cache when running the CLI standalone."""
    if not os.environ.get("HF_HOME"):
        os.environ["HF_HOME"] = PATHS["hf_home"]
