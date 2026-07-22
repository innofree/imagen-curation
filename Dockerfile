# Curation tool (Python pipeline + Next.js UI) in one CUDA image.
# The UI's worker spawns the Python pipeline in-container, so both runtimes are
# present. The VL model is NOT baked in — it is fetched into the mounted HF
# cache (shared with ComfyUI/ai-toolkit) at first run.
# -devel base (not -runtime): ships nvcc + CUDA headers so optimum-quanto can
# JIT-compile its fp8 marlin kernels at model-load time on Blackwell (sm_120).
# A -runtime image lacks nvcc/headers, so fp8 aborts at load; the pipeline also
# falls back to bf16 in that case (see vl_evaluator._build), but this image is
# meant to actually support the fp8 coexist path.
FROM nvidia/cuda:12.8.0-cudnn-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# System deps: python (+headers), node 22, git, OpenCV runtime libs (libGL/glib),
# and a host C/C++ toolchain (build-essential) required by nvcc for the quanto
# fp8 kernel JIT build.
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-pip python3-dev git curl ca-certificates libgl1 libglib2.0-0 \
        build-essential \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps: CUDA-matched torch first, then the pipeline requirements.
# TORCH_INDEX_URL is a build arg so a host with a different GPU generation can
# swap the wheel channel without editing this file, e.g.:
#   docker compose build --build-arg TORCH_INDEX_URL=https://download.pytorch.org/whl/nightly/cu128
# (Blackwell / sm_120 such as RTX PRO 6000 is already covered by stable cu128.)
ARG TORCH_INDEX_URL=https://download.pytorch.org/whl/cu128
COPY app/requirements.txt ./
RUN python3 -m pip install --upgrade pip \
    && python3 -m pip install torch torchvision --index-url ${TORCH_INDEX_URL} \
    && python3 -m pip install -r requirements.txt

# App source (respects .dockerignore): app/ maps to /app so the `curation`
# package lands at /app/curation and the UI at /app/ui (PYTHONPATH=/app).
COPY app/ /app/
# Entrypoint lives at the project root (root = docker-related files).
COPY docker-entrypoint.sh /app/docker-entrypoint.sh

# Build the web UI (installs dev deps, generates Prisma client + db, next build).
WORKDIR /app/ui
RUN npm install --no-audit --no-fund \
    && npm run update_db \
    && npm run build \
    && chmod +x /app/docker-entrypoint.sh

# Runtime config: paths resolve inside the container; data comes from volumes.
ENV IMAGEN_ROOT=/app \
    PYTHONPATH=/app \
    CURATION_PYTHON=/usr/bin/python3 \
    HF_HOME=/data/hf \
    DATASETS_DIR=/data/datasets \
    HF_HUB_ENABLE_HF_TRANSFER=1

EXPOSE 8680
# Entrypoint symlinks the job DB onto the /data/db volume (persisted across
# container recreation), then starts the worker + Next server.
CMD ["/app/docker-entrypoint.sh"]
