// Lightweight i18n + personalization foundation.
//
// Design intent (future-facing): locale is a per-user preference persisted in
// the Settings table (key "locale"), mirrored to localStorage for instant
// paint — the same pattern as the UI font. Today only the Help content is
// fully localized; UI strings can be migrated incrementally by adding keyed
// messages to `messages` below and reading them via `t(locale, key)`. When the
// whole app is localized, wrap the layout in a LocaleProvider/context so every
// component reacts to a change without a reload.

export type Locale = "ko" | "en";

export const LOCALES: { value: Locale; label: string }[] = [
  { value: "ko", label: "한국어" },
  { value: "en", label: "English" },
];

export const DEFAULT_LOCALE: Locale = "ko";

export function getSavedLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  const v = localStorage.getItem("locale");
  return v === "ko" || v === "en" ? v : DEFAULT_LOCALE;
}

export async function saveLocale(locale: Locale) {
  if (typeof window !== "undefined") localStorage.setItem("locale", locale);
  try {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "locale", value: locale }),
    });
  } catch {
    /* non-fatal: localStorage still holds the preference */
  }
}

// Seed message catalog. Extend per feature; fall back to the key if missing.
type Catalog = Record<string, { ko: string; en: string }>;
const messages: Catalog = {
  "nav.help": { ko: "도움말", en: "Help" },
};

export function t(locale: Locale, key: string): string {
  return messages[key]?.[locale] ?? key;
}
