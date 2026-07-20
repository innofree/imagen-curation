# Docker & 경로 공유 (standalone 배포)

## 경로 공유 설정 (extra_model_paths.yaml 식)
하드코딩 없이 외부 경로를 한 곳에서 선언한다 → ComfyUI/ai-toolkit와 **모델·데이터셋 공유**.

- `curation/paths.yaml` (예시: `paths.yaml.example` 복사) 또는 환경변수로 지정. 우선순위: **env > paths.yaml > 파생 기본값**.
- 키:
  - `datasets_dir` — ai-toolkit이 학습에 쓰는 **동일** 데이터셋 폴더 (curation이 여기서 읽고, 리젝트를 `<name>_rejected/`로 이동).
  - `hf_home` — VL 모델 HF 캐시. ComfyUI/ai-toolkit과 **공유**(재다운로드 없음).
  - `python` — UI 워커가 파이프라인을 띄울 인터프리터(서버: ai-toolkit conda env / 컨테이너: `/usr/bin/python3`).
  - `comfyui_models`(선택), `imagen_lab_script`/`run_dir`(선택, 유휴 GPU 확보용 — 컨테이너엔 없음 → 자동 스킵).

Python·Next.js UI 양쪽이 같은 `paths.yaml`을 읽는다.

## Docker 실행 (GPU) — 조각난 경로에서도 원커맨드
전제:
- NVIDIA 드라이버 + **Docker** + **[NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/)**
  (미설치 서버라면: `curl -fsSL https://get.docker.com | sh` 후 nvidia-container-toolkit 설치·`nvidia-ctk runtime configure --runtime=docker`·`systemctl restart docker`).

경로가 서버마다 흩어져 있어도(예: ComfyUI·ai-toolkit·models가 제각각) **두 경로만** 지정하면 된다:
```bash
cd curation
cp .env.example .env      # DATASETS_DIR, HF_HOME 를 이 서버 경로로 수정
docker compose up --build # → http://<host>:8680
```
`.env`가 compose 변수로 자동 주입되어 아무 절대경로나 바인드된다.

**예 — comfy-models(infra-poc) 조각 레이아웃**
```
DATASETS_DIR=/home/interbus/workspace/ai-toolkit/datasets   # ai-toolkit 데이터셋(공유·RW)
HF_HOME=/home/interbus/.cache/huggingface                    # 기존 HF 캐시(42G, 모델 재다운로드 방지)
```
- **datasets**를 ai-toolkit과 같은 폴더로 바인드 → 데이터셋 공유(정리 결과가 학습셋에 바로 반영).
- **HF 캐시**를 기존 캐시로 바인드 → VL 모델 공유(없으면 최초 1회만 다운로드). 참고: `/data/models`는 ComfyUI 디퓨전 모델 트리라 큐레이션엔 불필요(공유 대상은 HF 캐시의 VL 모델).
- GPU는 컨테이너 전용 → 유휴 ComfyUI 정지 로직 불필요(스크립트 없으면 자동 스킵), 기본 bf16.

이미지 구성: CUDA 12.8 runtime + torch(cu128) + transformers/opencv + Node 22로 UI 빌드. VL 모델은 이미지에 굽지 않고 마운트된 HF 캐시로 처리.

> **Blackwell(예: RTX PRO 6000, sm_120) 주의**: cu128 torch가 sm_120을 지원해야 한다. 커널 미지원 에러 시
> `Dockerfile`의 torch index-url을 최신 cu128(또는 nightly)로 조정.

## 영속성 (볼륨)
- **datasets** — `${DATASETS_DIR}` 바인드 (ai-toolkit과 공유, 정리 결과 보존)
- **hf 캐시** — `${HF_HOME}` 바인드 (VL 모델 공유)
- **리포트/썸네일** — `curation_runs` 볼륨
- **작업 이력 DB** — `curation_db` 볼륨(`/data/db`). entrypoint(`docker-entrypoint.sh`)가 `ui/curation.db`를 이 볼륨으로 **심볼릭 링크**한 뒤 스키마를 생성하므로, Prisma 스키마 변경 없이 컨테이너 재생성에도 이력이 보존된다(서버 비-docker 설정은 그대로).

## 주의
- torch 휠 태그(cu128)는 호스트/베이스 CUDA에 맞춰 조정 가능(`Dockerfile`의 index-url).
- 단일 컨테이너에 워커+UI+파이썬이 함께 뜬다(워커가 `python3 -m curation.curate`를 spawn).

## Standalone (Docker 없이)
```bash
# paths.yaml로 경로 지정(또는 env). 이후:
cd curation/ui && npm install && npm run build_and_start   # :8680
# 또는 CLI:
python -m curation.curate --src <dataset> --mode auto --recaption
```
