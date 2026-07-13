import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { formatDateTime, formatNumber, formatPercent, type ZonedDateTimeFormatOptions } from "./formatters.ts";
import { applyBrowserLocale, applyDocumentLocale, localeFromSearch, resolveBrowserLocale, type SupportedLocale } from "./locale.ts";
import { translate, type TranslateFunction } from "./translate.ts";

export type LocaleContextValue = {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  t: TranslateFunction;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatPercent: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatDateTime: (value: string | Date, options: ZonedDateTimeFormatOptions) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<SupportedLocale>(() => resolveBrowserLocale().locale);

  const setLocale = useCallback((nextLocale: SupportedLocale) => {
    applyBrowserLocale(nextLocale);
    setLocaleState(nextLocale);
  }, []);

  useEffect(() => applyDocumentLocale(document, locale), [locale]);
  useEffect(() => {
    const onPopState = () => {
      const fromUrl = localeFromSearch(window.location.search);
      if (fromUrl) setLocaleState(fromUrl);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    setLocale,
    t: translate(locale),
    formatNumber: (number, options) => formatNumber(locale, number, options),
    formatPercent: (number, options) => formatPercent(locale, number, options),
    formatDateTime: (date, options) => formatDateTime(locale, date, options),
  }), [locale, setLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useLocale must be used inside LocaleProvider");
  return context;
}
