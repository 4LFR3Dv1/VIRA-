import type { SupportedLocale } from "./locale.ts";

const pluralRules = new Map<SupportedLocale, Intl.PluralRules>();

export function selectPluralCategory(locale: SupportedLocale, count: number): Intl.LDMLPluralRule {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules.select(count);
}

export function formatNumber(locale: SupportedLocale, value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatPercent(locale: SupportedLocale, value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, { style: "percent", ...options }).format(value);
}

export type ZonedDateTimeFormatOptions = Intl.DateTimeFormatOptions & { timeZone: string };

export function formatDateTime(locale: SupportedLocale, value: string | Date, options: ZonedDateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(locale, options).format(date);
}
