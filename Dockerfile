# Curation tool (Python pipeline + Next.js UI) in one CUDA image.
# The UI's worker spawns the Python pipeline in-container, so both runtimes are
# present. The VL model is NOT baked in — it is fetched into the mounted HF
# cache (shared with ComfyUI/ai-toolkit) at first run.
FROM nvidia/cuda:12.8.0-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# System deps: python, node 22, git, and OpenCV runtime libs (libGL/glib).
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-pip git curl ca-certificates libgl1 libglib2.0-0 \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/curation

# Python deps: CUDA-matched torch first, then the pipeline requirements.
# TORCH_INDEX_URL is a build arg so a host with a different GPU generation can
# swap the wheel channel without editing this file, e.g.:
#   docker compose build --build-arg TORCH_INDEX_URL=https://download.pytorch.org/whl/nightly/cu128
# (Blackwell / sm_120 such as RTX PRO 6000 may need a newer or nightly cu128.)
ARG TORCH_INDEX_URL=https://download.pytorch.org/whl/cu128
COPY requirements.txt ./
RUN python3 -m pip install --upgrade pip \
    && python3 -m pip install torch torchvision --index-url ${TORCH_INDEX_URL} \
    && python3 -m pip install -r requirements.txt

# Project source (respects .dockerignore).
COPY . /app/curation

# Build the web UI (installs dev deps, generates Prisma client + db, next build).
WORKDIR /app/curation/ui
RUN npm install --no-audit --no-fund \
    && npm run update_db \
    && npm run build \
    && chmod +x /app/curation/docker-entrypoint.sh

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
CMD ["/app/curation/docker-entrypoint.sh"]
