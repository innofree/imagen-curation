# 설치 — Windows

curation을 Windows에서 실행하는 방법. **WSL2 + Docker Desktop(권장)** 과 **WSL2 네이티브** 두 경로를 안내한다.

GPU(NVIDIA)가 필수다 — VL 평가/품질 게이트가 CUDA로 동작한다.
Windows에서는 **NVIDIA GPU가 호스트 Windows에만 보이고 WSL2 커널에도 보여야 한다**(CUDA for WSL).

- 권장 환경: Windows 11 + NVIDIA 드라이버 555+, WSL2, Docker Desktop for Windows.
- 검증: RTX 3090 이상(sm_86+) — Blackwell(sm_120)은 최신 torch/CUDA 필요.

---

## 사전 준비

### 1. WSL2 활성화
```bash
# PowerShell (관리자)
wsl --install                # WSL2 자동 설치 (Ubuntu 22.04 기본)
wsl --update                 # WSL2 커널 최신화
```
완료 후 재부팅 및 `wsl` 명령으로 Ubuntu 터미널 진입.

### 2. NVIDIA CUDA for WSL (GPU 접근)
```bash
# 호스트 Windows(PowerShell 관리자)에서
# NVIDIA 드라이버는 Windows 드라이버만 설치 (WSL2 드라이버 따로 필요 없음 550+부터)
nvidia-smi   # GPU 확인

# WSL2 ubuntu 터미널에서 검증
nvidia-smi   # WSL 안에서도 GPU 보이는가 (비어있어도 OK — 곧 설치)
```
**없으면**: NVIDIA 공식 가이드 https://docs.nvidia.com/cuda/wsl-user-guide/ 따라 설치.

### 3. 공유할 두 경로 (WSL 마운트)
- **datasets** — 데이터셋 루트 (WSL에 마운트, RW).
- **HF 캐시** — VL 모델 캐시 (WSL에 마운트, 공유 → 재다운로드 방지).

Windows 경로를 WSL에 마운트하거나, WSL 내 `/mnt/c/...`로 직접 접근 가능.

---

## 경로 A — WSL2 + Docker Desktop (권장)

### A-1. Docker Desktop for Windows 설치
```bash
# Windows에서:
# 1. Docker Desktop 다운로드: https://www.docker.com/products/docker-desktop
# 2. 설치 후 Settings > Resources > WSL Integration에서
#    - Enable integration with my default WSL distro 체크
#    - Ubuntu-22.04 (또는 설치한 distro) 체크
# 3. Docker Desktop 재시작
```

### A-2. WSL2 Ubuntu 터미널에서 확인
```bash
wsl
docker --version          # Docker Desktop이 보이는가
docker run --rm --gpus all nvidia/cuda:12.8.0-base-ubuntu22.04 nvidia-smi
  # → GPU 메모리 표시됨
```

### A-3. Pull 방식 (빌드 없이)
```bash
# WSL 터미널
git clone https://github.com/innofree/imagen-curation.git curation
cd curation
cp .env.example .env

# Windows 경로를 WSL에서 접근 가능하도록 설정
# 예: DATASETS_DIR=/mnt/c/path/to/datasets
# 또는: WSL 내 경로 사용 (나중에 Windows에서 접근 필요시)
nano .env      # DATASETS_DIR, HF_HOME 수정

docker compose -f docker-compose.pull.yml pull
docker compose -f docker-compose.pull.yml up -d --wait   # → :8680
```

### A-4. Build 방식
```bash
docker compose up --build -d --wait   # ~15분, GPU 활용
```

---

## 경로 B — WSL2 네이티브 (Docker 없이)

Python 파이프라인 + Next.js UI를 WSL2 Ubuntu에 직접 설치.

### B-1. 사전 요건 (WSL 터미널)
```bash
wsl
sudo apt-get update && sudo apt-get install -y \
  build-essential python3.10 python3-venv python3-pip \
  curl wget git

# conda 설치 (선택; Python venv도 가능)
curl -fsSL https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -o miniconda.sh
bash miniconda.sh -b && rm miniconda.sh

# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
```

### B-2. 소스 클론 + Python 의존성
```bash
git clone https://github.com/innofree/imagen-curation.git curation && cd curation
conda create -n ai-toolkit python=3.10 -y && conda activate ai-toolkit
  # 또는: python3 -m venv .venv && source .venv/bin/activate

pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
pip install -r app/requirements.txt
```

### B-3. 경로 지정 (`paths.yaml` 또는 env)
```bash
cp paths.yaml.example paths.yaml

# 예: Windows 폴더를 WSL에서 접근
# datasets_dir: /mnt/c/Users/user/datasets
# hf_home: /mnt/c/Users/user/.cache/huggingface

nano paths.yaml   # 편집
```

### B-4. 웹 UI 빌드 & 기동
```bash
cd app/ui
npm install
npm run build_and_start     # → http://localhost:8680
```
Windows 브라우저에서 `http://localhost:8680` 또는 `http://127.0.0.1:8680`.

### B-5. CLI (파이프라인만)
```bash
export HF_HOME=/path/to/huggingface/cache
export PYTHONPATH=$PWD/app
python -m curation.curate --src /mnt/c/path/to/dataset --mode auto --device cuda:0
```

---

## WSL2 경로 접근 팁

| 상황 | 경로 |
|---|---|
| **Windows 파일을 WSL에서** | `/mnt/c/Users/...` |
| **WSL 파일을 Windows에서** | `\\wsl.localhost\Ubuntu-22.04\home\...` (파일탐색기) |
| **WSL 내 공유 폴더** | `cd ~` 또는 `/home/<user>` |

성능: WSL2 내 작업(`/home/...`)이 `/mnt/c/` 접근보다 훨씬 빠르다.
데이터셋이 크면 **WSL 내에 로컬 복사본**을 두는 게 권장.

---

## 트러블슈팅

- **`docker: command not found`** (WSL 터미널) — Docker Desktop과 WSL 통합이 안 됨. A-1 재확인.
- **`nvidia-smi` 안 보임 (WSL)** — CUDA for WSL 미설치. NVIDIA 공식 가이드 참고.
- **포트 8680 접근 안 됨** — WSL은 호스트와 localhost 공유. Windows 방화벽/VPN 확인.
- **모델 반복 다운로드** — `HF_HOME`이 Windows/WSL 경계를 넘나듦. 한쪽에만 고정.
- **느린 성능** — 데이터셋이 `/mnt/c/` 에 있으면 WSL 내 복사 추천.

---

## 주의

- WSL2에서 `docker`는 **Docker Desktop for Windows** 데몬과 통신한다 (호스트 hyper-V).
  GPU는 호스트 드라이버를 공유하고, WSL은 CUDA for WSL로 접근.
- 빌드(`docker compose up --build`)는 상당히 느릴 수 있다 (WSL ↔ host I/O).
  Pull 방식(`docker-compose.pull.yml`)이 빠르다.
