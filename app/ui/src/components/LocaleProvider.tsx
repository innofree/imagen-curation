"use client";
// App-wide locale context so every page reacts to a language change without a
// reload. Initializes to DEFAULT_LOCALE on the server + first client render (so
// hydration matches), then adopts the saved locale on mount — the same
// paint-then-correct pattern as FontApplier. `setLocale` updates all consumers
// and persists via saveLocale.

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import {
  Locale,
  DEFAULT_LOCALE,
  getSavedLocale,
  saveLocale,
  t as translate,
} from "@/lib/i18n";

type LocaleCtx = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const Ctx = createContext<LocaleCtx | null>(null);

export default function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    setLocaleState(getSavedLocale());
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    void saveLocale(l);
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => translate(locale, key, params),
    [locale]
  );

  return <Ctx.Provider value={{ locale, setLocale, t }}>{children}</Ctx.Provider>;
}

export function useLocale(): LocaleCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Fallback keeps non-wrapped usage (e.g. tests) from crashing.
    return {
      locale: DEFAULT_LOCALE,
      setLocale: () => {},
      t: (key, params) => translate(DEFAULT_LOCALE, key, params),
    };
  }
  return ctx;
}
