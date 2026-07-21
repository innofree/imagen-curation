# curation — LoRA 학습 데이터셋 자동 큐레이션

로컬 **비검열 VL 모델(Qwen3-VL-8B abliterated)** + OpenCV 품질 게이트 + 임베딩 dedup으로
ai-toolkit LoRA 학습용 데이터셋을 자동 선별한다. 사람의 주관적 과다선택을 대체하고,
뷰/샷 편중을 균형화하며, 흐린 얼굴·저품질·중복을 걸러내고, 데이터셋 충분성을 판정한다.

## 무엇을 하나
- **품질 게이트** (`quality.py`): 해상도, 전역 선명도, **얼굴영역 선명도(흐린 얼굴 검출)**, 노출.
- **VL 평가** (`vl_evaluator.py`): 뷰(정면/좌우 3-4/프로파일/후면) × 샷(클로즈업/상반신/전신) 분류,
  얼굴 선명도, 인원수, 체형 노출, 이슈 플래그, 학습 적합도(0-100). *야한 콘텐츠도 거부 없이 평가*.
- **dedup/uniqueness** (`embed_dedup.py`): 근접 중복 클러스터링 + uniqueness 랭킹.
- **커버리지/충분성** (`coverage.py`): 뷰×샷 버킷 집계, 편중 버킷 상한, 부족/과다 진단, sufficient/marginal/insufficient.
- **리포트** (`report.py`): JSON + Markdown + 로컬 HTML 갤러리.
- **적용**: 부적합/중복/과다분을 `datasets/<name>_rejected/`로 이동(또는 삭제), 유지분 비검열 캡션 재생성.

## 설치

**단계별 가이드를 docs에서 확인하세요:**
- **[Ubuntu (Linux)](./docs/install-ubuntu.md)** — Docker pull/build 또는 네이티브
- **[Windows](./docs/install-windows.md)** — WSL2 + Docker Desktop 또는 WSL2 네이티브

빠른 시작 (배포 이미지):
```bash
git clone https://github.com/innofree/imagen-curation.git curation && cd curation
cp .env.example .env    # DATASETS_DIR, HF_HOME 수정
docker compose -f docker-compose.pull.yml pull
docker compose -f docker-compose.pull.yml up -d --wait   # :8680
```

## 실행 환경
conda env **`ai-toolkit`** (transformers/torch/opencv/optimum-quanto). 모델은 `HF_HOME` 캐시에서 로드.

## 디렉토리 구조
```
curation/                 # 프로젝트 루트 = docker/릴리즈 관련 파일
├── Dockerfile  docker-compose.yml  docker-entrypoint.sh
├── .env.example  paths.yaml.example  README.md  CHANGELOG.md
├── app/                  # 소스
│   ├── curation/         # 파이썬 파이프라인 패키지 (import curation.*)
│   ├── ui/               # Next.js 웹 UI + cron 워커
│   └── requirements.txt  requirements-dev.txt
├── docs/                 # 문서
└── tests/                # pytest 스모크 테스트
```
`curation` 패키지가 `app/` 아래에 있으므로 CLI 실행 시 **`PYTHONPATH=<프로젝트>/app`을 반드시 지정**한다
(또는 `cd app` 후 실행). 프로젝트 루트에서 그냥 `python -m curation.curate` 하면 루트만 `sys.path`에
들어가 `ModuleNotFoundError`가 난다. UI 워커는 이 경로를 자동으로 설정한다.

## CLI
```bash
conda activate ai-toolkit          # 또는 아래 절대경로 python 사용
PY=/data/workspace/imagen-lab/miniconda3/envs/ai-toolkit/bin/python
export HF_HOME=/data/workspace/imagen-lab/downloads/hf
export PYTHONPATH=$PWD/app          # curation 패키지 경로 (프로젝트 루트에서)

# 1) 분석만 (파일 변경 없음) — 리포트/갤러리 확인
CUDA_VISIBLE_DEVICES=1 $PY -m curation.curate --src datasets/newface_v1 \
  --mode analyze --dry-run --quantize --low-vram --device cuda:0

# 2) 자동 (분석→적용) + 비검열 캡션 재생성
CUDA_VISIBLE_DEVICES=1 $PY -m curation.curate --src datasets/newface_v1 \
  --mode auto --recaption --quantize --low-vram --device cuda:0
```
주요 옵션: `--target N`(목표 유지 수), `--delete`(격리 대신 삭제), `--clear-cache`(_latent_cache 제거),
`--no-vl`(품질/dedup만, 디버그).

### GPU 확보 정책 (기본 동작)
시작 시 대상 GPU를 점검한다:
- **메모리는 점유됐지만 사용률 ~0%(유휴 ComfyUI)** → 그 ComfyUI를 정지시켜 GPU를 비우고 **bf16**(빠름)로 실행.
  작업이 끝나면 ComfyUI를 자동 복구한다.
- **사용률이 높음(실사용 중)** → 건드리지 않고 **fp8 양자화**(~9-10GB)로 공존.
- **이미 여유(≥20GB)** → 그대로 bf16.

`watch` 데몬이 켜져 있으면 curation job(`IS_CURATION_JOB=1`)을 GPU 점유자로 인식해 ComfyUI 정지/복구를
**watch가 담당**한다(학습 job과 동일 정책). watch가 꺼져 있으면 파이프라인이 직접 정지/복구한다.

옵션 오버라이드: `--quantize`(fp8 강제) · `--no-quantize`(bf16 강제) · `--no-free-gpu`(유휴 GPU라도 정지 안 함).

## 웹 UI (:8680)
`app/ui/` — Next.js(App Router) + Prisma/SQLite + cron 워커. ai-toolkit UI와 동일 구조.
DB(`app/ui/curation.db`)가 작업 큐 역할을 하고, 워커가 `curate.py`를 detached로 spawn한다.

```bash
S=/data/workspace/imagen-lab/scripts/imagen-lab.sh
$S curate-ui build     # npm install + prisma + next build
$S curate-ui start     # http://<host>:8680
$S curate-ui status | $S curate-ui stop
```
- **New Curation**: 데이터셋/모드(자동·리뷰)/목표수/recaption/양자화/GPU 선택.
- **리뷰 모드**: 갤러리에서 버킷별 자동 keep/reject·점수·사유 확인 후 클릭으로 오버라이드 → "적용".
- **자동 모드**: 분석 후 즉시 적용.

## Docker / 경로 공유 (standalone 배포)
`paths.yaml`(예시: `paths.yaml.example`)로 datasets/HF캐시/python 경로를 선언하면 하드코딩 없이
ComfyUI/ai-toolkit와 **모델·데이터셋을 공유**한다(env가 최우선). 경로가 서버마다 흩어져 있어도
(ComfyUI·ai-toolkit·models가 제각각) **두 경로만** 지정하면 원커맨드로 뜬다:
```bash
cd curation
cp .env.example .env            # DATASETS_DIR, HF_HOME 만 이 서버 경로로 수정
docker compose up --build -d --wait   # → :8680 (healthy까지 대기)
```
운영 노브(전부 `.env`/빌드아그로 조절, 파일 수정 불필요):
- `CURATION_PORT` — 호스트 포트(기본 8680). 기존 UI와 포트 충돌 시 변경.
- `TORCH_INDEX_URL` — torch 휠 채널(기본 stable cu128). stable cu128 torch 2.11이 **Blackwell/sm_120까지 커버**하므로 대개 불필요.
- `user:` (compose 주석) — 공유 서버에서 rejects/recaption 파일 소유권 조정.
- 기동 시 마운트 프리플라이트 경고 + `/api/gpu` healthcheck 내장.

**검증 플랫폼**: RTX A6000(sm_86, imagen-lab), RTX PRO 6000 Blackwell(sm_120, comfy-models) — 빌드·기동·GPU 연산 확인.
자세한 내용: `docs/docker.md`.

## 튜닝
임계값은 `config.py`에 집중되어 있다 (품질 임계값, dedup 유사도 0.90, 버킷 최소치, 최소 적합도 등).
UI 작업은 `params` JSON으로 per-job 오버라이드 가능.
