"use client";
import { useEffect } from "react";

// Font choices -> CSS value applied to --ui-font (see globals.css).
export const FONT_OPTIONS: { value: string; label: string }[] = [
  { value: "noto", label: "Noto Sans KR (Google, 한/영 기본)" },
  { value: "system", label: "시스템 폰트" },
];

export function applyFont(value: string) {
  const map: Record<string, string> = {
    noto: "var(--font-noto)",
    system: "var(--font-system)",
  };
  document.documentElement.style.setProperty("--ui-font", map[value] || map.noto);
}

// Applies the saved font ASAP (localStorage for instant paint, then the
// server-persisted setting from the Settings table as the source of truth).
export default function FontApplier() {
  useEffect(() => {
    const cached = localStorage.getItem("ui_font");
    if (cached) applyFont(cached);
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        const f = d.ui_font || "noto";
        applyFont(f);
        localStorage.setItem("ui_font", f);
      })
      .catch(() => {});
  }, []);
  return null;
}
