"use client";
import { useEffect, useState } from "react";
import TopBar from "@/components/TopBar";
import { HELP } from "@/lib/help";
import { Locale, LOCALES, getSavedLocale, saveLocale } from "@/lib/i18n";

export default function HelpPage() {
  const [locale, setLocale] = useState<Locale>("ko");
  useEffect(() => { setLocale(getSavedLocale()); }, []);

  const change = (l: Locale) => { setLocale(l); saveLocale(l); };
  const doc = HELP[locale];

  return (
    <>
      <TopBar title={locale === "ko" ? "도움말" : "Help"}>
        <div className="flex gap-1">
          {LOCALES.map((l) => (
            <button key={l.value} onClick={() => change(l.value)} aria-pressed={locale === l.value}
              className={`btn ${locale === l.value ? "border-blue-500 text-blue-300 bg-blue-600/15" : "text-neutral-400"}`}>{l.label}</button>
          ))}
        </div>
      </TopBar>
      <div className="p-5 max-w-3xl">
        <h2 className="text-lg font-semibold mb-1">{doc.title}</h2>
        <p className="text-sm text-neutral-400 mb-5">{doc.intro}</p>
        <div className="space-y-4">
          {doc.sections.map((s, i) => (
            <div key={i} className="card p-4">
              <h3 className="text-sm font-medium mb-2">{s.h}</h3>
              <ul className="list-disc pl-5 space-y-1 text-sm text-neutral-300">
                {s.body.map((b, j) => <li key={j}>{b}</li>)}
              </ul>
            </div>
          ))}
        </div>
        <p className="text-xs text-neutral-600 mt-5">
          {locale === "ko"
            ? "언어 설정은 저장되며, 추후 앱 전체 다국어로 확장 가능합니다 (curation/README.md 참고)."
            : "The language choice is saved and can be extended to the whole app later (see curation/README.md)."}
        </p>
      </div>
    </>
  );
}
