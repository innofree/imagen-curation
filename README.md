🌐 **Language** — [English](./README.md) | [한국어](./docs/README.ko.md) | [日本語](./docs/README.ja.md) (coming soon)

---

# curation — LoRA Training Dataset Auto-Curation

Automatically curate high-quality LoRA training datasets using a **local uncensored VL model (Qwen3-VL)** + **OpenCV quality gates** + **embedding dedup**.

Replace subjective human over-selection with **objective metrics**: balance view/shot distribution, filter blurry faces and low-quality images, remove duplicates, and assess dataset sufficiency.

> **Web UI** (:8680) + **CLI pipeline** + **Docker deployment** + **GPU-aware scheduling**.
> Tested on RTX A6000 (sm_86) and RTX PRO 6000 Blackwell (sm_120).

---

## What It Does

| Component | Function |
|-----------|----------|
| **Quality Gate** (`quality.py`) | Resolution, global sharpness, **face-region sharpness** (blur detection), exposure |
| **VL Evaluation** (`vl_evaluator.py`) | View (frontal/3-way/profile/back) × shot (close-up/half-body/full-body) classification, face clarity, head count, body exposure, issues, training fitness (0–100). *Analyzes uncensored content without refusal.* |
| **Dedup & Uniqueness** (`embed_dedup.py`) | Proximity clustering + uniqueness ranking |
| **Coverage & Sufficiency** (`coverage.py`) | View×shot bucket aggregation, over-representation caps, diagnosis (sufficient/marginal/insufficient) |
| **Reports** (`report.py`) | JSON + Markdown + local HTML gallery |
| **Apply** | Move/delete unsuitable/duplicate/over-represented to `datasets/<name>_rejected/`, regenerate captions for keepers |

---

## Quick Start

### Docker (Recommended — no build, no local setup)

```bash
git clone https://github.com/innofree/imagen-curation.git curation && cd curation
cp .env.example .env  # Set DATASETS_DIR, HF_HOME to your paths
docker compose -f docker-compose.pull.yml pull
docker compose -f docker-compose.pull.yml up -d --wait  # → http://localhost:8680
```

**Images available at `docker.io/jimotmi/imagen-curation`** (latest + v0.2.0).

### Installation Guides

- **[Ubuntu/Linux](./docs/install-ubuntu.md)** — Docker pull/build or native (conda + Node.js)
- **[Windows](./docs/install-windows.md)** — WSL2 + Docker Desktop or WSL2 native

---

## Environment Setup

**Requirements:**
- NVIDIA GPU with CUDA 12.x support (driver 550+)
- Docker + NVIDIA Container Toolkit (for containers)
- OR conda env `ai-toolkit` + Python 3.10+

**Key Paths:**
- `DATASETS_DIR` — Root folder for datasets (read/write; rejects moved here)
- `HF_HOME` — HuggingFace model cache (shared to avoid re-downloads)
- `DEFAULT_MODEL` — Default VL model (Qwen/Qwen3-VL-4B-Instruct recommended)
- `HF_TOKEN` — Optional, for gated models (injected into worker env, never leaked to UI)

---

## Project Structure

```
curation/
├── Dockerfile, docker-compose.yml, docker-entrypoint.sh
├── .env.example, paths.yaml.example
├── app/
│   ├── curation/          # Python pipeline (import curation.*)
│   ├── ui/                # Next.js 15 web UI + cron worker
│   └── requirements.txt
├── docs/
│   ├── install-ubuntu.md
│   ├── install-windows.md
│   ├── docker.md
│   └── README.ko.md       # Korean
├── tests/                 # pytest smoke tests
└── CHANGELOG.md
```

**Important:** `curation` package lives under `app/`. When running CLI, set `PYTHONPATH=$PWD/app`:
```bash
export PYTHONPATH=$PWD/app
python -m curation.curate --src datasets/mydata --mode auto --device cuda:0
```

---

## CLI Usage

```bash
# Analyze only (no changes, check reports)
python -m curation.curate --src datasets/mydata \
  --mode analyze --quantize --device cuda:0

# Auto-apply (analyze → move rejects → regenerate captions)
python -m curation.curate --src datasets/mydata \
  --mode auto --recaption --quantize --device cuda:0
```

**Common options:**
- `--target N` — Keep up to N samples
- `--delete` — Delete (instead of moving to `_rejected/`)
- `--quantize` — Force fp8 quantization (for CoexistenceCommodity shared GPU)
- `--no-quantize` — Force bf16 (full precision)
- `--no-vl` — Skip VL evaluation, quality/dedup only (debug)

### GPU Scheduling (Default)

- **Idle GPU** (memory occupied, util ~0%) → Stop ComfyUI, run in **bf16** (fast), auto-restore when done
- **Busy GPU** (util >0%) → Run in **fp8 quantization** (~9-10GB) alongside
- **Plenty of VRAM** (≥20GB) → Run in **bf16**

---

## Web UI (:8680)

Next.js 15 (App Router) + Prisma/SQLite + cron worker.

**Features:**
- **New Curation**: Select dataset, mode (auto/review), target count, recaption, quantization, GPU
- **Review Mode**: Inspect gallery (sorted by bucket), override auto decisions with 1-click keep/reject
- **Auto Mode**: Analyze → apply immediately
- **Live Logs**: Tail worker output in real-time
- **Model Selection**: Pick or enter a custom VL model
- **Settings**: Configure paths, model, HF token
- **Health & Metrics**: `/api/health` (liveness), `/api/metrics` (Prometheus)

---

## Configuration

Set via **env** (highest priority) → **paths.yaml** → defaults:

| Key | Purpose |
|-----|---------|
| `DATASETS_DIR` | Dataset root (r/w; rejects moved here) |
| `HF_HOME` | HuggingFace cache (shared, avoids re-downloads) |
| `DEFAULT_MODEL` | Default VL model for jobs (e.g., `Qwen/Qwen3-VL-4B-Instruct`) |
| `HF_TOKEN` | Gated-model access token (injected to worker, not exposed in UI) |
| `EXTRA_DATASET_DIRS` | Additional dataset roots (comma-separated) |
| `CURATION_PORT` | Host port (default 8680) |
| `TORCH_INDEX_URL` | Torch wheel channel (default: stable cu128) |

---

## v0.2.0 Release Highlights

- **UX**: Legible fonts, graceful image fallback, "load more" paging, category filters
- **Features**: Job log viewer, VL model picker, config files (paths.yaml + env), health/metrics endpoints
- **Security**: Image endpoint hardened (extension allowlist + symlink-safe), Prometheus label escaping
- **Docs**: Ubuntu/Windows installation guides, multi-language support (EN/KO)
- **Deployment**: `docker-compose.pull.yml` (no-build), Docker Hub (`jimotmi/imagen-curation`)

---

## Tuning

Quality thresholds and parameters live in `config.py` (resolution, face sharpness, dedup similarity, bucket minimums, etc.).

Per-job overrides are supported via UI `params` JSON.

---

## References

- **GitHub**: https://github.com/innofree/imagen-curation
- **Releases**: https://github.com/innofree/imagen-curation/releases
- **Docker Hub**: https://hub.docker.com/r/jimotmi/imagen-curation

---

## License & Attribution

Powered by **Qwen3-VL**, **OpenCV**, **torch**, **Next.js**, and **Prisma**.

🤖 Built with [Claude Code](https://claude.com/claude-code).
