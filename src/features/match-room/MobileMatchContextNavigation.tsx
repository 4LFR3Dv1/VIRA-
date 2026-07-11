import { ListChecks, ShieldCheck, Trophy } from "lucide-react";

interface Props { hasJourney: boolean; onReview: () => void }

export function MobileMatchContextNavigation({ hasJourney, onReview }: Props) {
  const scroll = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  return <nav aria-label="Contexto da partida" className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#050814]/96 backdrop-blur-xl lg:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
    <div className="grid h-16 grid-cols-3">
      <button type="button" onClick={() => scroll("match-ranking")} className="flex flex-col items-center justify-center gap-1 text-white/55 hover:text-primary"><Trophy className="size-4" /><span className="font-['DM_Mono'] text-[9px] font-black uppercase">Ranking</span></button>
      <button type="button" disabled={!hasJourney} onClick={() => scroll("match-journey")} className="flex flex-col items-center justify-center gap-1 text-white/55 hover:text-primary disabled:opacity-25"><ListChecks className="size-4" /><span className="font-['DM_Mono'] text-[9px] font-black uppercase">Jornada</span></button>
      <button type="button" onClick={onReview} className="flex flex-col items-center justify-center gap-1 text-white/55 hover:text-primary"><ShieldCheck className="size-4" /><span className="font-['DM_Mono'] text-[9px] font-black uppercase">Revisao</span></button>
    </div>
  </nav>;
}
