"use client";
import { useEffect, useState } from "react";
import TopBar from "@/components/TopBar";
import { FONT_OPTIONS, applyFont } from "@/components/FontApplier";
import { Locale, LOCALES } from "@/lib/i18n";
import { useLocale } from "@/components/LocaleProvider";

export default function SettingsPage() {
  const { locale, setLocale, t } = useLocale();
  const [info, setInfo] = useState<any>(null);
  const [font, setFont] = useState("noto");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((d) => {
      setInfo(d);
      setFont(d.ui_font || "noto");
    });
  }, []);

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
          <h3 className="text-xs uppercase text-neutral-500 mb-3">{t("settings.prefs_title")}</h3>
          <label className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm">{t("settings.ui_font_label")}</div>
              <div className="text-[11px] text-neutral-500">
                {t("settings.ui_font_desc")}
              </div>
            </div>
            <select className="input w-56" value={font} onChange={(e) => changeFont(e.target.value)}>
              {FONT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{t(`font.${o.value}`)}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-4 mt-4">
            <div>
              <div className="text-sm">{t("settings.language_label")}</div>
              <div className="text-[11px] text-neutral-500">
                {t("settings.language_desc")}
              </div>
            </div>
            <select className="input w-56" value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
              {LOCALES.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          {saved && <div className="text-[11px] text-green-400 mt-2">{t("settings.saved")}</div>}
        </div>

        {/* Read-only environment (derived from paths / config) */}
        <div className="card p-4 text-sm space-y-2">
          <h3 className="text-xs uppercase text-neutral-500 mb-1">{t("settings.env_title")}</h3>
          {info ? (
            pathKeys.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-edge py-1.5">
                <span className="text-neutral-500">{k}</span>
                <span className="text-neutral-300 font-mono text-xs truncate">{String(v)}</span>
              </div>
            ))
          ) : (
            <div className="text-neutral-500">{t("settings.loading")}</div>
          )}
        </div>
        <p className="text-xs text-neutral-500">
          {t("settings.env_note")}
        </p>
      </div>
    </>
  );
}
