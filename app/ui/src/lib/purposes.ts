// Training-purpose options for a curation job.
//
// The `value` strings are passed verbatim to the Python CLI as
// `--purpose <value>` (no translation layer), so they MUST match the keys in
// app/curation/purposes.py PURPOSE_PRESETS exactly (case + underscores).
// Adding a purpose later is a one-line append here + one entry in purposes.py.
//
// Display strings are NOT stored here — they live in the i18n catalog
// (lib/messages.ts) under `purpose.<value>` / `purpose.<value>_desc` for the
// selector and `job.stat_*` for the stat tiles — and are resolved with the
// bound t() from useLocale() at render. Shared by the New Curation form, the
// job-detail badge, and the job-detail stat tiles.

export type PurposeOption = { value: string };

export const PURPOSE_OPTIONS: PurposeOption[] = [
  { value: "face" },
  { value: "full_body" },
  { value: "pose" },
  { value: "outfit" },
  { value: "style" },
];

export const PURPOSE_VALUES = new Set(PURPOSE_OPTIONS.map((p) => p.value));

export const DEFAULT_PURPOSE = "face";

// Job-detail stat tiles. The first four are generic pipeline counts shown for
// every purpose; the per-purpose tail maps a verdict.stats key -> i18n label
// key. Tiles whose `key` is absent from verdict.stats simply do not render, so
// a purpose can ship UI-side before its Python stats exist without breaking.
export type StatTile = { key: string; labelKey: string; filter?: string; accent?: boolean };

export const COMMON_STAT_TILES: StatTile[] = [
  { key: "n_input", labelKey: "job.stat_input", filter: "all" },
  { key: "n_final_keep", labelKey: "job.stat_final_keep", filter: "keep", accent: true },
  { key: "n_hard_reject", labelKey: "job.stat_hard_reject", filter: "hard" },
  { key: "n_overflow_reject", labelKey: "job.stat_overflow_reject", filter: "overflow" },
];

// The `key` values must match the aggregate stat keys emitted by
// app/curation/purposes.py coverage requirements (their `name` field).
export const PURPOSE_STAT_TILES: Record<string, StatTile[]> = {
  face: [
    { key: "front_face", labelKey: "job.stat_front_face" },
    { key: "three_quarter", labelKey: "job.stat_three_quarter" },
    { key: "profiles", labelKey: "job.stat_profiles" },
    { key: "full_body", labelKey: "job.stat_full_body" },
  ],
  full_body: [
    { key: "full_body_shots", labelKey: "job.stat_full_body_shots" },
    { key: "body_visible", labelKey: "job.stat_body_visible" },
    { key: "distinct_views", labelKey: "job.stat_distinct_views" },
  ],
  pose: [
    { key: "pose_categories", labelKey: "job.stat_pose_categories" },
    { key: "pose_visible", labelKey: "job.stat_pose_visible" },
  ],
  outfit: [
    { key: "garment_types", labelKey: "job.stat_garment_types" },
    { key: "garment_visible", labelKey: "job.stat_garment_visible" },
  ],
  style: [
    { key: "style_consistent", labelKey: "job.stat_style_consistent" },
    { key: "style_variety", labelKey: "job.stat_style_variety" },
  ],
};

export function statTilesFor(purpose: string): StatTile[] {
  return [...COMMON_STAT_TILES, ...(PURPOSE_STAT_TILES[purpose] || PURPOSE_STAT_TILES.face)];
}
