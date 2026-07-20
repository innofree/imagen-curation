import { Locale } from "./i18n";

export interface HelpSection { h: string; body: string[] }
export interface HelpDoc { title: string; intro: string; sections: HelpSection[] }

// Help content sourced from curation/README.md, condensed for in-app use.
// Structured per-locale so more languages can be added later.
export const HELP: Record<Locale, HelpDoc> = {
  ko: {
    title: "도움말 — 데이터셋 큐레이션",
    intro:
      "로컬 비검열 VL 모델(Qwen3-VL abliterated) + OpenCV 품질 게이트 + 임베딩 중복제거로 " +
      "LoRA 학습용 데이터셋을 자동 선별합니다. 편중을 균형화하고, 흐린 얼굴·저품질·중복을 걸러내며, " +
      "데이터셋 충분성을 판정합니다.",
    sections: [
      { h: "워크플로 (자동 / 리뷰)", body: [
        "자동 모드: 분석 → 즉시 적용.",
        "리뷰 모드: 분석 → 갤러리에서 keep/reject 확인·수정 → 적용. 최종 결정권은 사람에게.",
        "적용 시 리젝트는 datasets/<name>_rejected/ 로 이동(되돌리기 가능), 유지분은 비검열 캡션 재생성.",
      ]},
      { h: "품질 게이트 (OpenCV)", body: [
        "해상도, 전역 선명도, 노출을 검사합니다.",
        "핵심: 얼굴 선명도는 눈/눈썹 영역(아이덴티티에 가장 민감) 기준으로 측정합니다.",
        "흐린 얼굴 컷은 데이터셋 분포에 적응하는 임계값 max(하한, 중앙값×비율)로 보수적으로 제거합니다.",
      ]},
      { h: "VL 평가 (Qwen3-VL abliterated)", body: [
        "뷰(정면/3-4 좌우/프로파일/후면) × 샷(클로즈업/상반신/전신)을 분류합니다.",
        "얼굴 선명도(주관), 인원 수, 체형 노출, 이슈, 학습 적합도(0-100)를 산출합니다.",
        "야한 콘텐츠도 거부 없이 객관적으로 평가하도록 비검열 모델을 사용합니다.",
      ]},
      { h: "중복 / 커버리지 / 선별", body: [
        "임베딩 유사도로 근접 중복을 묶고, 고유성(uniqueness) 점수를 매깁니다.",
        "뷰×샷 버킷으로 편중을 진단하고 충분성(충분/보통/부족)을 판정합니다.",
        "버킷당 최대 장수를 정하면 각 버킷에서 상위(품질×적합도×고유성) N장만 남겨 균형을 맞춥니다.",
      ]},
      { h: "GPU 정책", body: [
        "대상 GPU가 메모리만 점유하고 사용률 0%(유휴)면 그 ComfyUI를 정지해 확보 후 bf16로 실행하고, 끝나면 복구합니다.",
        "실사용 중이면 건드리지 않고 fp8로 공존, 여유가 충분하면 bf16.",
        "New Curation에서 GPU를 선택하고, VRAM 모드(자동/bf16/fp8)와 유휴 GPU 확보를 조절할 수 있습니다.",
      ]},
      { h: "이미지별 점수 보기", body: [
        "리뷰 갤러리에서 썸네일을 클릭하면 항목별 점수 상세(품질/VL/중복/결정)를 볼 수 있습니다.",
        "✓/✗ 버튼으로 keep/reject를 수동 오버라이드한 뒤 적용하세요.",
      ]},
    ],
  },
  en: {
    title: "Help — Dataset Curation",
    intro:
      "Automatically curates LoRA training datasets using a local uncensored VL model " +
      "(Qwen3-VL abliterated) + an OpenCV quality gate + embedding de-duplication. It " +
      "balances view/shot bias, filters blurry faces, low quality and duplicates, and " +
      "judges whether the dataset is sufficient.",
    sections: [
      { h: "Workflow (Auto / Review)", body: [
        "Auto: analyze then apply immediately.",
        "Review: analyze, then confirm/override keep-reject in the gallery, then apply. The human makes the final call.",
        "On apply, rejects move to datasets/<name>_rejected/ (reversible); kept images get uncensored recaptions.",
      ]},
      { h: "Quality gate (OpenCV)", body: [
        "Checks resolution, global sharpness, and exposure.",
        "Key: face sharpness is measured on the eye/brow band (most identity-critical, blur-sensitive).",
        "Soft faces are removed conservatively with a dataset-adaptive cut: max(floor, median × ratio).",
      ]},
      { h: "VL evaluation (Qwen3-VL abliterated)", body: [
        "Classifies view (front / 3-4 L·R / profile / back) × shot (closeup / upper body / full body).",
        "Produces face clarity, subject count, body-shape visibility, issues, and a training-suitability score (0-100).",
        "Uses an uncensored model so suggestive content is evaluated objectively without refusals.",
      ]},
      { h: "Dedup / Coverage / Selection", body: [
        "Groups near-duplicates by embedding similarity and assigns a uniqueness score.",
        "Diagnoses bias via view×shot buckets and judges sufficiency (sufficient / marginal / insufficient).",
        "A per-bucket cap keeps only the top N (quality × suitability × uniqueness) per bucket for balance.",
      ]},
      { h: "GPU policy", body: [
        "If the target GPU only holds memory at ~0% utilization (idle), it stops that ComfyUI to reclaim it, runs bf16, and restores it afterward.",
        "If actively in use, it coexists via fp8; if there is ample free VRAM, it runs bf16.",
        "In New Curation you can pick the GPU and control VRAM mode (auto/bf16/fp8) and idle-GPU reclaim.",
      ]},
      { h: "Per-image scores", body: [
        "Click a thumbnail in the review gallery to see the full per-item scorecard (quality / VL / dedup / decision).",
        "Use the ✓/✗ buttons to override keep/reject before applying.",
      ]},
    ],
  },
};
