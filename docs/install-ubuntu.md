# 설치 — Ubuntu (Linux)

curation을 Ubuntu에서 설치하는 방법. **Docker(권장)** 와 **네이티브(standalone)** 두 경로를 안내한다.
GPU(NVIDIA)가 필요하다 — VL 평가/품질 게이트가 CUDA로 동작한다.

- 검증 플랫폼: RTX A6000(sm_86), RTX PRO 6000 Blackwell(sm_120).
- 접속 포트: `8680` (변경 가능, 아래 `CURATION_PORT`).

---

## 사전 준비 (공통)

1. **NVIDIA 드라이버** (호스트에 CUDA 12.x 지원 드라이버):
   ```bash
   nvidia-smi   # 드라이버/GPU 인식 확인
   ```
   없으면: `sudo ubuntu-drivers autoinstall` 후 재부팅, 또는 NVIDIA 공식 드라이버 설치.

2. 공유할 두 경로를 정해둔다(호스트 어디든 가능):
   - **datasets** — ai-toolkit이 학습에 쓰는 데이터셋 폴더(RW). curation이 여기서 읽고 리젝트를 `<name>_rejected/`로 옮긴다.
   - **HF 캐시** — VL 모델이 담기는 HuggingFace 캐시(`HF_HOME`). 기존 캐시를 재사용하면 모델 재다운로드가 없다.

---

## 경로 A — Docker (권장)

### A-1. Docker + NVIDIA Container Toolkit 설치
```bash
# Docker Engine
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # 로그아웃/로그인 후 sudo 없이 docker 사용

# NVIDIA Container Toolkit (컨테이너 GPU 접근)
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
  | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
  | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
  | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker

# 확인: 컨테이너 안에서 GPU가 보이는가
docker run --rm --gpus all nvidia/cuda:12.8.0-base-ubuntu22.04 nvidia-smi
```

### A-2-a. Pull 방식 (배포 이미지, 빌드 없음 — 권장)
Docker Hub의 빌드된 이미지(`taeyong75/imagen-curation:latest`)를 pull해 바로 실행.
빠르고 간단하지만, 로컬 소스 변경은 반영 안 됨.

**옵션 1: docker run 직접 실행**
```bash
docker pull taeyong75/imagen-curation:latest

docker run -d --name curation --gpus all \
  -p 8680:8680 \
  -e IMAGEN_ROOT=/app -e CURATION_PYTHON=/usr/bin/python3 \
  -e HF_HOME=/data/hf -e DATASETS_DIR=/data/datasets \
  -v /path/to/ai-toolkit/datasets:/data/datasets \
  -v /path/to/huggingface/cache:/data/hf \
  -v curation_runs:/app/curation/runs \
  -v curation_db:/data/db \
  taeyong75/imagen-curation:latest
# → http://<host>:8680  (최초 기동 후 ~90s healthcheck)
```
`/path/to/...` 두 개만 이 서버 경로로 바꾼다.

**옵션 2: docker-compose.pull.yml로 실행 (권장)**
```bash
git clone https://github.com/innofree/imagen-curation.git curation
cd curation
cp .env.example .env      # DATASETS_DIR, HF_HOME 를 이 서버 경로로 수정

# Pull 방식: 빌드 없이 배포 이미지만 사용
docker compose -f docker-compose.pull.yml pull
docker compose -f docker-compose.pull.yml up -d --wait   # → :8680 (healthy까지 대기)
```
`.env`가 compose 변수로 자동 주입되어 흩어진 절대경로도 그대로 바인드된다.

### A-2-b. Build 방식 (소스에서 빌드)
소스 코드를 수정할 예정이거나, 다른 torch 채널(TORCH_INDEX_URL)로 커스텀 빌드하려는 경우.
```bash
git clone https://github.com/innofree/imagen-curation.git curation
cd curation
cp .env.example .env      # DATASETS_DIR, HF_HOME 를 이 서버 경로로 수정

# Build 방식: 소스에서 도커 이미지 빌드 후 실행 (~15분, 21GB 빌드)
docker compose up --build -d --wait   # → :8680 (healthy까지 대기)
```
기본 compose는 `Dockerfile`을 사용하고 TORCH_INDEX_URL로 커스텀 가능(`--build-arg` 또는 `.env`).

### A-3. 확인
```bash
curl -fsS http://localhost:8680/api/health     # {"status":"ok",...}
docker compose ps                               # (또는 docker ps) → healthy
```
브라우저에서 `http://<host>:8680`.

---

## 경로 B — 네이티브 (Docker 없이)

Python 파이프라인 + Next.js UI를 호스트에 직접 설치한다. ai-toolkit conda 환경을 재사용하는 것을 권장.

### B-1. 사전 요건
- **conda 환경** (`ai-toolkit`) 또는 Python 3.10+ venv — torch(cu128)/transformers/opencv/optimum-quanto/accelerate.
- **Node.js 22** — UI 빌드.
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
  ```

### B-2. Python 의존성
```bash
git clone https://github.com/innofree/imagen-curation.git curation && cd curation
conda activate ai-toolkit          # 또는 python -m venv .venv && source .venv/bin/activate
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
pip install -r app/requirements.txt
```

### B-3. 경로 지정 (`paths.yaml` 또는 env)
```bash
cp paths.yaml.example paths.yaml   # datasets_dir / hf_home / python 을 이 서버 경로로 수정
```
우선순위: **env > paths.yaml > 파생 기본값**. 자세한 키는 [설정](#설정-공통) 참고.

### B-4. 웹 UI 빌드 & 기동 (:8680)
```bash
cd app/ui
npm install
npm run build_and_start     # npm install + prisma db push + next build + worker/UI 기동
# → http://<host>:8680
```

### B-5. CLI (UI 없이 파이프라인만)
`curation` 패키지가 `app/` 아래라 **`PYTHONPATH=<프로젝트>/app`** 이 필요하다:
```bash
cd curation
export HF_HOME=/path/to/huggingface/cache
export PYTHONPATH=$PWD/app
python -m curation.curate --src datasets/<name> --mode auto --recaption --device cuda:0
```

---

## 설정 (공통)

`.env`(Docker) 또는 `paths.yaml`/환경변수(네이티브)로 제어. **env가 최우선.**

| 키 | 용도 |
|---|---|
| `DATASETS_DIR` | 데이터셋 루트(ai-toolkit과 공유, RW) |
| `HF_HOME` | VL 모델 HF 캐시(공유 → 재다운로드 방지) |
| `DEFAULT_MODEL` | 기본 VL 평가 모델(New Curation 기본값·워커 폴백) |
| `HF_TOKEN` | 게이트/레이트리밋 모델 풀용 HF 토큰(워커에 주입, UI엔 노출 안 됨) |
| `EXTRA_DATASET_DIRS` | 기본 외 추가 데이터셋 루트(콤마/개행 구분). Docker면 각 경로도 바인드 필요 |
| `CURATION_PORT` | 호스트 포트(기본 8680) — 포트 충돌 시 변경 |
| `TORCH_INDEX_URL` | torch 휠 채널(기본 stable cu128; Blackwell/sm_120까지 커버, 대개 불필요) |

관측/헬스: `GET /api/health`(liveness), `GET /api/metrics`(Prometheus).

---

## 트러블슈팅
- **컨테이너에서 GPU 안 보임** — NVIDIA Container Toolkit 미설치/`nvidia-ctk runtime configure` 누락. A-1 재확인.
- **`no datasets`만 표시** — `DATASETS_DIR` 오타/빈 폴더. 컨테이너 로그(`docker compose logs`)의 마운트 프리플라이트 경고 확인.
- **모델이 매번 다운로드** — `HF_HOME`이 기존 캐시를 안 가리킴. 경로 재확인.
- **8680 포트 충돌** — `CURATION_PORT=8681` 등으로 변경.
- **`ModuleNotFoundError: curation`** (네이티브 CLI) — `PYTHONPATH=<프로젝트>/app` 누락.
- Docker 상세: [`docs/docker.md`](./docker.md).
