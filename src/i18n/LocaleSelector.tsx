import { useLocale } from "./locale-context.tsx";
import type { SupportedLocale } from "./locale.ts";

const options: Array<{ locale: SupportedLocale; shortLabel: string; nameKey: "locale.option.en" | "locale.option.ptBR" }> = [
  { locale: "pt-BR", shortLabel: "PT", nameKey: "locale.option.ptBR" },
  { locale: "en", shortLabel: "EN", nameKey: "locale.option.en" },
];
const localeNameKeys = { en: "locale.option.en", "pt-BR": "locale.option.ptBR" } as const;

export function LocaleSelector() {
  const { locale, setLocale, t } = useLocale();
  const currentLanguage = t(localeNameKeys[locale]);
  return <div
    role="group"
    aria-label={t("locale.selectorLabel")}
    title={t("locale.currentLanguage", { language: currentLanguage })}
    className="flex h-10 items-center border border-white/10 p-1 font-['DM_Mono'] text-[9px] font-black uppercase tracking-[.08em]"
  >
    {options.map((option) => <button
      key={option.locale}
      type="button"
      aria-pressed={locale === option.locale}
      aria-label={t(option.nameKey)}
      title={t(option.nameKey)}
      onClick={() => setLocale(option.locale)}
      className={`grid h-7 min-w-7 place-items-center px-1 transition-colors ${locale === option.locale ? "bg-primary text-[#050814]" : "text-white/45 hover:text-white"}`}
    >{option.shortLabel}</button>)}
  </div>;
}
