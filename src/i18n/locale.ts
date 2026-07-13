export const SUPPORTED_LOCALES = ["en", "pt-BR"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = "en";
export const LOCALE_STORAGE_KEY = "vira:locale";

export type LocaleSource = "url" | "storage" | "browser" | "fallback";

export type LocaleResolution = {
  locale: SupportedLocale;
  source: LocaleSource;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function normalizeLocale(value: string | null | undefined): SupportedLocale | null {
  if (!value) return null;
  const normalized = value.trim().replaceAll("_", "-").toLowerCase();
  if (normalized === "pt" || normalized === "pt-br") return "pt-BR";
  if (normalized === "en" || normalized.startsWith("en-")) return "en";
  return null;
}

export function localeFromSearch(search: string): SupportedLocale | null {
  try {
    return normalizeLocale(new URLSearchParams(search).get("lang"));
  } catch {
    return null;
  }
}

export function readPersistedLocale(storage: StorageLike | null | undefined): SupportedLocale | null {
  try {
    return normalizeLocale(storage?.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function persistLocale(storage: StorageLike | null | undefined, locale: SupportedLocale): boolean {
  try {
    storage?.setItem(LOCALE_STORAGE_KEY, locale);
    return Boolean(storage);
  } catch {
    return false;
  }
}

export function resolveLocale(input: {
  search?: string;
  storedLocale?: string | null;
  browserLocales?: readonly string[];
}): LocaleResolution {
  const fromUrl = localeFromSearch(input.search ?? "");
  if (fromUrl) return { locale: fromUrl, source: "url" };

  const fromStorage = normalizeLocale(input.storedLocale);
  if (fromStorage) return { locale: fromStorage, source: "storage" };

  for (const candidate of input.browserLocales ?? []) {
    const fromBrowser = normalizeLocale(candidate);
    if (fromBrowser) return { locale: fromBrowser, source: "browser" };
  }

  return { locale: DEFAULT_LOCALE, source: "fallback" };
}

export function withLocaleInUrl(href: string, locale: SupportedLocale): string {
  const url = new URL(href);
  url.searchParams.set("lang", locale);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function applyDocumentLocale(
  documentLike: Pick<Document, "documentElement">,
  locale: SupportedLocale,
): void {
  documentLike.documentElement.lang = locale;
}

export function resolveBrowserLocale(): LocaleResolution {
  if (typeof window === "undefined") return { locale: DEFAULT_LOCALE, source: "fallback" };
  return resolveLocale({
    search: window.location.search,
    storedLocale: readPersistedLocale(window.localStorage),
    browserLocales: navigator.languages?.length ? navigator.languages : [navigator.language],
  });
}

export function initializeDocumentLocale(): LocaleResolution {
  const resolution = resolveBrowserLocale();
  if (typeof document !== "undefined") applyDocumentLocale(document, resolution.locale);
  if (typeof window !== "undefined") persistLocale(window.localStorage, resolution.locale);
  return resolution;
}

export function applyBrowserLocale(locale: SupportedLocale): void {
  if (typeof document !== "undefined") applyDocumentLocale(document, locale);
  if (typeof window === "undefined") return;
  persistLocale(window.localStorage, locale);
  const nextUrl = withLocaleInUrl(window.location.href, locale);
  window.history.replaceState(window.history.state, "", nextUrl);
}
