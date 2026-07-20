"use client";
import { useEffect, useState } from "react";
import TopBar from "@/components/TopBar";
import { FONT_OPTIONS, applyFont } from "@/components/FontApplier";
import { Locale, LOCALES, saveLocale } from "@/lib/i18n";

export default function SettingsPage() {
  const [info, setInfo] = useState<any>(null);
  const [font, setFont] = useState("noto");
  const [locale, setLocale] = useState<Locale>("ko");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((d) => {
      setInfo(d);
      setFont(d.ui_font || "noto");
      setLocale((d.locale as Locale) || "ko");
    });
  }, []);

  const changeLocale = (v: Locale) => {
    setLocale(v);
    saveLocale(v);
    setSaved(true); setTimeout(() => setSaved(false), 1500);
  };

  const changeFont = async (value: string) => {
    setFont(value);
    applyFont(value);                        // instant
    localStorage.setItem("ui_font", value);
    await fetch("/api/settings", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "ui_font", value }),
    });
    setSaved(true); setTimeout(() => setSaved(false), 1500);
  };

  const pathKeys = info
    ? Object.entries(info).filter(([k]) => k !== "ui_font" && k !== "locale")
    : [];

  return (
    <>
      <TopBar title="Settings" />
      <div className="p-5 max-w-2xl space-y-5">
        {/* User-editable preferences */}
        <div className="card p-4">
          <h3 className="text-xs uppercase text-neutral-500 mb-3">환경설정 (사용자)</h3>
          <label className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm">UI 폰트</div>
              <div className="text-[11px] text-neutral-500">
                Google 호스팅 한/영 웹폰트(Noto Sans KR) 기본, 빌드 시 자체 호스팅. 여기서 변경 가능
              </div>
            </div>
            <select className="input w-56" value={font} onChange={(e) => changeFont(e.target.value)}>
              {FONT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-4 mt-4">
            <div>
              <div className="text-sm">언어 / Language</div>
              <div className="text-[11px] text-neutral-500">
                도움말 등에 적용. 추후 앱 전체 다국어로 확장 예정 (개인화 저장)
              </div>
            </div>
            <select className="input w-56" value={locale} onChange={(e) => changeLocale(e.target.value as Locale)}>
              {LOCALES.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          {saved && <div className="text-[11px] text-green-400 mt-2">저장됨 / Saved</div>}
        </div>

        {/* Read-only environment (derived from paths / config) */}
        <div className="card p-4 text-sm space-y-2">
          <h3 className="text-xs uppercase text-neutral-500 mb-1">환경 (읽기 전용)</h3>
          {info ? (
            pathKeys.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-edge py-1.5">
                <span className="text-neutral-500">{k}</span>
                <span className="text-neutral-300 font-mono text-xs truncate">{String(v)}</span>
              </div>
            ))
          ) : (
            <div className="text-neutral-500">로딩...</div>
          )}
        </div>
        <p className="text-xs text-neutral-500">
          경로/모델은 환경변수(CURATION_PYTHON, IMAGEN_ROOT)와 curation/config.py로 제어됩니다.
          폰트 등 UI 환경설정은 curation.db의 Settings 테이블에 저장됩니다.
        </p>
      </div>
    </>
  );
}
