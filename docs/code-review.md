# 코드 리뷰 프로세스 (Codex)

이 저장소는 원격에 푸시/공유하기 전에 **OpenAI Codex로 코드 리뷰**를 거친다.
Claude Code에서 OpenAI 공식 플러그인 [`codex-plugin-cc`](https://github.com/openai/codex-plugin-cc)를 사용한다.

## 설치 (1회)
Claude Code CLI에서:
```
/plugin marketplace add openai/codex-plugin-cc
/plugin install codex@openai-codex
/reload-plugins        # 또는 세션 재시작
/codex:setup           # codex CLI/로그인 확인 등 1회 설정
```
전제조건: `codex` CLI 설치 + `codex login`(ChatGPT 구독 또는 OpenAI API 키), Node 18.18+.

> 참고: 마켓플레이스 추가/설치는 `claude plugin marketplace add ...` / `claude plugin install ...`
> 셸 명령으로도 가능하지만, 슬래시 커맨드(`/codex:*`)는 **플러그인 로드(reload/새 세션) 후** 사용 가능하다.

## 리뷰 실행
- 커밋 전 작업분 리뷰:            `/codex:review`
- 브랜치 대비(푸시 전 권장):     `/codex:review --base main`
- 설계까지 파고드는 적대적 리뷰:  `/codex:adversarial-review`
- 작업 위임(버그 조사/수정):      `/codex:rescue`
- 백그라운드 작업 관리:           `/codex:status`, `/codex:result`, `/codex:cancel`

## 권장 흐름 (푸시 전)
1. 변경 정리 후 커밋.
2. Claude Code에서 `/codex:review --base main` 실행 → 지적사항 확인·반영.
3. (선택) `/codex:setup`의 Stop 훅 리뷰 게이트를 켜면, 세션 종료 시 자동 리뷰를 걸 수 있다.
4. 리뷰 반영 후 원격에 push.

## 플러그인 없이 (CLI 직접)
codex CLI만으로도 동일 리뷰가 가능하다:
```
codex review --base main          # 브랜치 대비
codex review --uncommitted        # 스테이징/미스테이징/미추적 변경
codex review --commit <sha>       # 특정 커밋
```
