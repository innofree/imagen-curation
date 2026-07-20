# imagen-lab 서비스 통합 (참고)

이 저장소는 단독으로도 동작하지만(아래 "Standalone"), imagen-lab 서버에서는
`scripts/imagen-lab.sh` 서비스 매니저에 `curate-ui` 서비스로 등록되어 있다.
서버의 `imagen-lab.sh`는 이 저장소 밖(공용 스크립트)이라 여기엔 **추가된 블록만** 기록한다.

## 1) curate-ui 서비스 (aitk-ui 패턴 미러링)

```bash
CURATE_PORT="8680"

curate_run_foreground() { activate_env ai-toolkit; cd "$IMAGEN_ROOT/curation/app/ui"; exec npm run start; }
curate_stop() {
  pkill -TERM -f "concurrently.*next start -p $CURATE_PORT" 2>/dev/null || true; sleep 1
  pkill -KILL -f "concurrently.*next start -p $CURATE_PORT" 2>/dev/null || true
  pkill -TERM -f 'tsx .*cron/worker\.ts' 2>/dev/null || true
  svc_stop curate-ui "$CURATE_PORT"
}
curate_build() {
  activate_env ai-toolkit; cd "$IMAGEN_ROOT/curation/app/ui"
  npm install
  for p in @prisma/client @prisma/engines prisma esbuild; do npm approve-scripts "$p" || true; done
  npm rebuild @prisma/engines esbuild || true
  npm run update_db && npm run build
}
# dispatch: curate-ui {start|stop|status|restart|fg|build}, __exec curate-ui) curate_run_foreground
```

## 2) watch 데몬 확장 — 큐레이션 job을 GPU 점유자로 인식

`_training_gpus()`에 아래 루프를 추가하면, 큐레이션 job이 도는 GPU의 유휴 ComfyUI를
watch가 자동 정지/복구한다(학습 job과 동일 정책).

```bash
for pid in $(pgrep -f 'curation[./]curate' 2>/dev/null); do
  env="$(cat "/proc/$pid/environ" 2>/dev/null | tr '\0' '\n')"; [ -n "$env" ] || continue
  grep -qx 'IS_CURATION_JOB=1' <<<"$env" || continue
  sed -n 's/^CUDA_VISIBLE_DEVICES=//p' <<<"$env" | tr ',' '\n'
done
```

워커(`app/ui/cron/startJob.ts`)가 서브프로세스에 `IS_CURATION_JOB=1` + `CUDA_VISIBLE_DEVICES`를 주입한다.

## Standalone (imagen-lab.sh 없이)

```bash
# UI:
cd curation/app/ui
npm install && npm run update_db && npm run build && npm run start   # http://<host>:8680

# CLI: curation 패키지가 app/ 아래이므로 PYTHONPATH 지정 필요.
cd curation && PYTHONPATH=$PWD/app python -m curation.curate --src <dataset> --mode auto --recaption
```

경로/파이썬은 환경변수로 조정: `IMAGEN_ROOT`, `CURATION_PYTHON`(파이썬 인터프리터).
