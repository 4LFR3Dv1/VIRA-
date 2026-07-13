import { motion } from "motion/react";

import type { ViraExperienceModel } from "./experience-model";
import { useLocale } from "../../i18n/locale-context.tsx";
import type { StaticTranslationKey } from "../../i18n/translate.ts";

const steps: StaticTranslationKey[] = ["room.lifecycle.preMatch", "room.lifecycle.open", "room.lifecycle.live", "room.lifecycle.final", "room.lifecycle.verified"];

function activeIndex(model: ViraExperienceModel) {
  if (model.verification.status === "verified") return 4;
  if (model.fixture.status === "finished") return 3;
  if (model.fixture.status === "live") return 2;
  return 1;
}

export function TournamentLifecycleRail({ model }: { model: ViraExperienceModel }) {
  const { t } = useLocale();
  const active = activeIndex(model);
  return (
    <nav aria-label={t("room.lifecycle")} className="mx-auto w-full max-w-[1440px] px-4 py-5 md:px-7 lg:px-10">
      <div className="relative">
        <div className="absolute left-2 right-2 top-2 h-px bg-white/15" />
        <motion.div className="absolute left-2 top-2 h-px bg-primary" animate={{ width: `calc(${(active / (steps.length - 1)) * 100}% - 1rem)` }} />
        <ol className="relative grid grid-cols-5">
          {steps.map((key, index) => <li key={key} className={index === steps.length - 1 ? "text-right" : index ? "text-center" : "text-left"}>
            <span className={`inline-block size-4 rounded-full border ${index <= active ? "border-primary bg-primary" : "border-white/20 bg-[#070a13]"}`} />
            <span className={`mt-2 block font-['DM_Mono'] text-[9px] font-bold uppercase ${index <= active ? "text-white" : "text-white/30"}`}>{t(key)}</span>
          </li>)}
        </ol>
      </div>
    </nav>
  );
}
