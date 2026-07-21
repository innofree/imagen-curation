# UX 개선 리포트 — 2026-07

브랜치: `ux/legibility-images-topbar`

폰트 가독성 · 상단 버튼/메뉴 · 이미지 깨짐 세 축의 UX 점검과 개선 내역, 각 페이지 before/after 스크린샷을 담은 리포트입니다.

👉 **[index.html](./index.html)** 을 브라우저로 열어 보세요 (before/after 나란히 비교 + 페이지별 갤러리).

- `assets/before/*.png` — 원본 빌드 캡처
- `assets/after/*.png` — 개선 빌드 캡처

> 스크린샷의 리뷰 갤러리에는 사용자 소유 데이터셋 이미지가 포함됩니다. 외부 게시는 하지 않았으며, 저장소에 이미지를 남기고 싶지 않다면 이 폴더를 `.gitignore` 처리하거나 커밋에서 제외하세요.

## 핵심 요약
- **이미지 깨짐**: 파일 부재/이동 시 깨진 아이콘 대신 플레이스홀더 폴백(`ImageWithFallback`). 근본 원인은 DB 저장 경로 드리프트(리팩터로 `app/` 이동) — 경로 정합성 수정 권장.
- **리뷰 성능**: 전량 렌더 → 60장 "더 보기" 페이징(문서 높이 10,652px → 3,576px).
- **TopBar**: 제목 truncate + 컨트롤 wrap/shrink로 좁은 폭 붕괴 해소, 삭제 버튼 danger화.
- **폰트**: 실시간 수치 `tabular-nums`, antialiased, 깨지던 이모지 로고 → 아이콘.
