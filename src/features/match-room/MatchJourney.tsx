import { Check, Circle } from "lucide-react";
import type { ViraExperienceModel } from "./experience-model";
import { useLocale } from "../../i18n/locale-context.tsx";

export function MatchJourney({ journey }: { journey: ViraExperienceModel["journey"] }) {
  const { t } = useLocale();
  if (journey.length < 2) return null;
  return <section id="match-journey" className="mt-8 scroll-mt-24 border-y border-white/15 py-6">
    <p className="font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.18em] text-primary">{t("journey.title")}</p>
    <h2 className="mt-2 font-['Chakra_Petch'] text-2xl font-black uppercase">{t("journey.verifiedRounds")}</h2>
    <div className="mt-5 flex overflow-x-auto border-l border-white/15">
      {journey.map((item) => <article key={item.id} className="min-w-40 border-r border-white/15 px-4 py-5">
        <div className="flex items-center justify-between"><span className="font-['DM_Mono'] text-[9px] uppercase text-white/35">{t("round.label", { number: String(item.number).padStart(2, "0") })}</span>{item.correct ? <Check className="size-4 text-primary" /> : <Circle className="size-4 text-white/25" />}</div>
        <strong className="mt-6 block font-['Chakra_Petch'] text-3xl font-black">{item.points > 0 ? `+${item.points}` : "0"}</strong>
      </article>)}
    </div>
  </section>;
}
