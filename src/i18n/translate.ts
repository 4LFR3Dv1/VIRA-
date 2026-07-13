import { en } from "./catalogs/en.ts";
import { ptBR } from "./catalogs/pt-BR.ts";
import type { SupportedLocale } from "./locale.ts";

export type TranslationMessages = {
  "locale.selectorLabel": undefined;
  "locale.currentLanguage": { language: string };
  "locale.option.en": undefined;
  "locale.option.ptBR": undefined;
  "common.loading": undefined;
  "common.retry": undefined;
  "common.close": undefined;
  "common.back": undefined;
  "common.continue": undefined;
  "common.unavailable": undefined;
  "common.genericError": undefined;
  "room.playersWaiting": { count: number };
  "share.userPicked": { name: string; selection: string };
};

export type TranslationKey = keyof TranslationMessages;
export type MessageValue<Params> = Params extends undefined ? string : (params: Params) => string;
export type TranslationCatalog = { [Key in TranslationKey]: MessageValue<TranslationMessages[Key]> };
export type TranslateFunction = <Key extends TranslationKey>(
  key: Key,
  ...args: TranslationMessages[Key] extends undefined ? [] : [params: TranslationMessages[Key]]
) => string;

export const catalogs: Record<SupportedLocale, TranslationCatalog> = { en, "pt-BR": ptBR };

export const translate: (locale: SupportedLocale) => TranslateFunction = (locale) => (key, ...args) => {
  const message = catalogs[locale][key] as string | ((params: unknown) => string);
  return typeof message === "function" ? message(args[0]) : message;
};
