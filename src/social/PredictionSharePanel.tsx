import { Check, Share2 } from "lucide-react";
import { useEffect, useState } from "react";

import type { MatchSummary } from "../runtime/api";
import { createPredictionShare, fetchMyPrediction, presentShare } from "./share";

type Choice = "home" | "draw" | "away";

export function PredictionSharePanel({ fixture, displayName, onChangeDisplayName }: { fixture: MatchSummary; displayName: string; onChangeDisplayName: (value: string) => void }) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [state, setState] = useState<"idle" | "creating" | "shared" | "error">("idle");
  const [result, setResult] = useState<{ status: "open" | "resolved"; correct?: boolean; winningChoice?: string; finalScore?: { home: number; away: number } } | null>(null);
  const available = fixture.status === "scheduled" && (!fixture.startTime || Date.parse(fixture.startTime) > Date.now());
  const labels: Record<Choice, string> = { home: fixture.homeTeam, draw: "Empate", away: fixture.awayTeam };

  useEffect(() => {
    let cancelled = false;
    void fetchMyPrediction(fixture.fixtureId).then(({ prediction }) => {
      if (!cancelled && prediction) {
        setChoice(prediction.choice);
        setResult(prediction);
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [fixture.fixtureId]);

  const share = async () => {
    if (!choice || !displayName.trim()) return;
    setState("creating");
    try {
      const result = await createPredictionShare({ fixtureId: fixture.fixtureId, displayName: displayName.trim(), choice });
      window.localStorage.setItem("vira:displayName", displayName.trim());
      await presentShare(result);
      setState("shared");
    } catch {
      setState("error");
    }
  };

  return <section className="border-y border-white/15 bg-[#0d111c]">
    <div className="mx-auto grid max-w-[1440px] gap-8 px-5 py-14 sm:px-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-14">
      <div>
        <p className="font-['DM_Mono'] text-[10px] font-black uppercase text-primary">Palpite antes do jogo</p>
        <h2 className="mt-3 font-['Chakra_Petch'] text-[clamp(2.2rem,5vw,4.8rem)] font-black uppercase leading-[.9]">Quem vence hoje?</h2>
        <p className="mt-4 max-w-xl text-sm leading-6 text-white/50">Escolha um lado e convide seus amigos. Cada pessoa responde em privado pelo mesmo link.</p>
      </div>
      {result?.status === "resolved" ? <div className="border-l border-white/15 pl-6"><p className="font-['DM_Mono'] text-[10px] uppercase text-primary">Resultado oficial</p><strong className="mt-3 block font-['Chakra_Petch'] text-3xl font-black uppercase">{result.correct ? "Voce acertou" : "Palpite resolvido"}</strong><p className="mt-3 text-sm text-white/50">{result.finalScore ? `${fixture.homeTeam} ${result.finalScore.home} × ${result.finalScore.away} ${fixture.awayTeam}` : "Resultado confirmado pela partida."}</p></div> : available ? <div>
        <input aria-label="Seu nome" value={displayName} onChange={(event) => onChangeDisplayName(event.target.value)} maxLength={40} placeholder="Seu nome na sala" className="min-h-12 w-full border border-white/20 bg-transparent px-4 text-sm outline-none focus:border-primary" />
        <div className="mt-3 grid grid-cols-3 gap-2">{(["home", "draw", "away"] as Choice[]).map((item) => <button key={item} type="button" onClick={() => setChoice(item)} className={`min-h-16 border px-2 font-['Chakra_Petch'] text-xs font-black uppercase ${choice === item ? "border-primary bg-primary text-[#050814]" : "border-white/20 hover:border-primary"}`}>{choice === item ? <Check className="mx-auto mb-1 size-3" /> : null}{labels[item]}</button>)}</div>
        <button type="button" disabled={!choice || !displayName.trim() || state === "creating"} onClick={share} className="mt-3 flex min-h-14 w-full items-center justify-between bg-primary px-5 font-['Chakra_Petch'] text-sm font-black uppercase text-[#050814] disabled:opacity-40"><span>{state === "creating" ? "Criando convite" : state === "shared" ? "Link compartilhado" : "Palpitar e compartilhar"}</span><Share2 className="size-4" /></button>
        {state === "error" ? <p role="alert" className="mt-2 text-xs text-red-300">Nao foi possivel criar o convite agora.</p> : null}
      </div> : <div className="border-l border-white/15 pl-6"><p className="font-['DM_Mono'] text-[10px] uppercase text-primary">Palpites bloqueados</p><p className="mt-3 text-sm text-white/50">O kickoff encerrou esta previsao. O resultado oficial definira o grupo vencedor.</p></div>}
    </div>
  </section>;
}
