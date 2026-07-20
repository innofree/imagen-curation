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
COPY requirements.txt ./
RUN python3 -m pip install --upgrade pip \
    && python3 -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128 \
    && python3 -m pip install -r requirements.txt

# Project source (respects .dockerignore).
COPY . /app/curation

# Build the web UI (installs dev deps, generates Prisma client + db, next build).
WORKDIR /app/curation/ui
RUN npm install --no-audit --no-fund \
    && npm run update_db \
    && npm run build

# Runtime config: paths resolve inside the container; data comes from volumes.
ENV IMAGEN_ROOT=/app \
    PYTHONPATH=/app \
    CURATION_PYTHON=/usr/bin/python3 \
    HF_HOME=/data/hf \
    DATASETS_DIR=/data/datasets \
    HF_HUB_ENABLE_HF_TRANSFER=1

EXPOSE 8680
# Starts the cron worker + Next server (worker spawns `python3 -m curation.curate`).
CMD ["npm", "run", "start"]
