# Changelog

## v0.1.0 — 2026-07-20 (1차 릴리즈)

### 저장소 구조
- 소스를 `app/`로 이동: 파이썬 파이프라인은 `app/curation/`(패키지명 `curation` 유지),
  웹 UI는 `app/ui/`, 의존성은 `app/requirements*.txt`. 루트에는 docker/릴리즈 파일만 남김.
- `docs/` 문서, `tests/`(pytest 스모크 테스트) 정리. `IMAGEN_ROOT`(트리 루트)와 패키지
  디렉토리(`app/`, PYTHONPATH)를 분리해 standalone·Docker 양쪽 경로 해석을 유지.


LoRA 학습 데이터셋 자동 큐레이션 도구의 첫 릴리즈. 비검열 VL 모델(Qwen3-VL-8B abliterated)
+ OpenCV 품질 게이트 + 임베딩 dedup으로 데이터셋을 자동 선별하고, 웹 UI로 리뷰/적용한다.

### 파이프라인
- 품질 게이트(`quality.py`): 해상도·전역 선명도·**얼굴영역 선명도(흐린 얼굴 검출)**·노출.
- VL 평가(`vl_evaluator.py`): 뷰×샷 분류, 얼굴 선명도, 인원수, 체형 노출, 이슈 플래그, 학습 적합도(0-100).
- dedup/uniqueness(`embed_dedup.py`), 커버리지/충분성 판정(`coverage.py`), JSON/Markdown/HTML 갤러리 리포트(`report.py`).
- 적용: 부적합/중복/과다분을 `<name>_rejected/`로 격리(또는 삭제) + 비검열 캡션 재생성.
- GPU 확보 정책: 유휴 ComfyUI 정지 후 bf16, 실사용 중이면 fp8 공존(자동 결정).

### 웹 UI (:8680)
- Next.js + Prisma/SQLite + cron 워커. DB가 작업 큐, 워커가 파이프라인을 detached spawn.
- 자동/리뷰 모드, 버킷별 keep/reject 오버라이드, per-job 파라미터 오버라이드.

### Docker / 배포 (파편화 호스트 대응)
- 단일 CUDA 이미지(파이프라인 + UI + 워커). `.env`의 `DATASETS_DIR`/`HF_HOME` **두 경로만** 지정하면
  경로가 흩어진 서버에서도 원커맨드 기동. VL 모델은 마운트된 HF 캐시로 공유(이미지에 굽지 않음).
- 운영 노브: `CURATION_PORT`(포트 충돌 회피), `TORCH_INDEX_URL`(GPU 세대 대응, 빌드아그),
  `/api/gpu` healthcheck(`up -d --wait`), 기동 시 마운트 프리플라이트 경고, `user:` 소유권 오버라이드.
- 작업 이력 DB/리포트는 named volume으로 영속(컨테이너 재생성에도 보존).
- **검증 플랫폼**: RTX A6000(sm_86), RTX PRO 6000 Blackwell(sm_120). stable cu128 torch 2.11이
  sm_120 커널을 포함해 Blackwell에서도 nightly 없이 동작(컨테이너 내 실연산 확인). nightly는
  torch/torchvision 짝 불일치로 빌드가 깨지므로 사용하지 않음.
