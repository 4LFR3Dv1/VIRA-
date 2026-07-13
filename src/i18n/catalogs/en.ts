import { selectPluralCategory } from "../formatters.ts";
import type { TranslationCatalog } from "../translate.ts";

export const en = {
  "locale.selectorLabel": "Language",
  "locale.currentLanguage": ({ language }) => `Current language: ${language}`,
  "locale.option.en": "English",
  "locale.option.ptBR": "Portuguese",
  "common.loading": "Loading",
  "common.retry": "Try again",
  "common.close": "Close",
  "common.back": "Back",
  "common.continue": "Continue",
  "common.unavailable": "Unavailable",
  "common.genericError": "Something went wrong.",
  "room.playersWaiting": ({ count }) => selectPluralCategory("en", count) === "one" ? "1 player waiting" : `${count} players waiting`,
  "share.userPicked": ({ name, selection }) => `${name} picked ${selection}`,
} satisfies TranslationCatalog;
