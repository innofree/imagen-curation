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

## Docker 실행 (GPU)
전제: NVIDIA 드라이버 + [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/).

```bash
cd curation
DATASETS_DIR=/data/workspace/imagen-lab/datasets \
HF_HOME=/data/workspace/imagen-lab/downloads/hf \
docker compose up --build
# → http://<host>:8680
```
- **datasets 볼륨**을 ai-toolkit과 같은 폴더로 바인드하면 데이터셋이 공유된다.
- **hf 볼륨**을 기존 HF 캐시로 바인드하면 VL 모델(~17GB)을 재다운로드하지 않는다(없으면 최초 1회 자동 다운로드).
- GPU가 컨테이너에 전용 할당되므로 유휴 ComfyUI 정지 로직은 불필요(스크립트 없으면 자동 스킵)하고 기본 bf16로 동작.

이미지 구성: CUDA 12.8 runtime + torch(cu128) + transformers/opencv + Node 22로 UI 빌드. VL 모델은 이미지에 굽지 않고 마운트된 HF 캐시로 처리.

## 주의 / 한계
- **작업 이력 DB**(`ui/curation.db`)는 이미지 내부라 컨테이너 재생성 시 초기화된다. 실제 산출물(정리된 datasets)과 리포트(`curation_runs` 볼륨)는 보존된다. 이력까지 영구화하려면 Prisma `url = env("DATABASE_URL")`로 바꾸고 `/data`에 두면 된다(후속 작업).
- torch 휠 태그(cu128)는 호스트/베이스 CUDA에 맞춰 조정 가능(`Dockerfile`의 index-url).
- 단일 컨테이너에 워커+UI+파이썬이 함께 뜬다(워커가 `python3 -m curation.curate`를 spawn).

## Standalone (Docker 없이)
```bash
# paths.yaml로 경로 지정(또는 env). 이후:
cd curation/ui && npm install && npm run build_and_start   # :8680
# 또는 CLI:
python -m curation.curate --src <dataset> --mode auto --recaption
```
