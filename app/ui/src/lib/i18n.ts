// Lightweight i18n foundation.
//
// Locale is a per-user preference persisted in the Settings table (key
// "locale") and mirrored to localStorage for instant paint — the same pattern
// as the UI font. The message catalog lives in ./messages; components read
// strings reactively via the LocaleProvider context (see
// components/LocaleProvider). `t(locale, key, params)` is the low-level lookup;
// most components use the bound `t` from `useLocale()`.

import { messages } from "./messages";

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

// Low-level lookup. Falls back to the key when missing. Fills `{name}`
// placeholders from `params`.
export function t(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>
): string {
  let s = messages[key]?.[locale] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return s;
}
