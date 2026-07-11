import { Database, ShieldCheck } from "lucide-react";

type Props = { signalCount: number; reviewAvailable: boolean; onOpenReview: () => void; onOpenInspector: () => void };
import { formatMarketCount } from "../match-experience/state-model";

export function TxlineVerificationRail({ signalCount, reviewAvailable, onOpenReview, onOpenInspector }: Props) {
  return <section className="mt-8 grid border-y border-white/12 bg-[#07100b]/55 lg:grid-cols-[1fr_auto]">
    <div className="flex items-center gap-4 px-4 py-5 sm:px-7"><span className="grid size-11 shrink-0 place-items-center border border-primary/30 text-primary"><ShieldCheck className="size-5" /></span><div><p className="font-['DM_Mono'] text-[9px] font-black uppercase tracking-[.18em] text-primary">Dados fornecidos pela TxLINE</p><p className="mt-1 text-xs leading-5 text-white/45">{formatMarketCount(signalCount)}. Valores ausentes permanecem ausentes.</p></div></div>
    <div className="flex flex-col-reverse border-t border-white/12 sm:flex-row lg:border-l lg:border-t-0">
      <button type="button" onClick={onOpenInspector} className="inline-flex min-h-12 items-center justify-center gap-2 px-5 font-['DM_Mono'] text-[10px] uppercase tracking-[.1em] text-white/35 hover:text-white"><Database className="size-3.5" />Detalhes técnicos</button>
      <button type="button" disabled={!reviewAvailable} onClick={onOpenReview} className="min-h-16 border-b border-white/12 px-6 text-left font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.12em] text-primary hover:bg-primary/[.05] disabled:cursor-not-allowed disabled:text-white/25 sm:border-b-0 sm:border-l">{reviewAvailable ? "Abrir revisão oficial →" : "Revisão após entrar"}</button>
    </div>
  </section>;
}
