import { ArrowLeft, Eye, LockKeyhole, Play, Radio, RefreshCcw, ShieldCheck, Signal, Trophy, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";

import type { PublicDomainEvent, VerifiedRoundReplayV1 } from "../../domain/types.ts";
import { useLocale } from "../../i18n/locale-context.tsx";
import { fetchPublicPlayback, fetchPublicRoomEvents } from "../../runtime/api.ts";
import { TeamIcon } from "../../shared/team/team-icons.tsx";
import { ViraLoader } from "../../shared/brand/ViraLoader.tsx";
import { createGuidedPlaybackShare } from "../../social/share.ts";
import { ViraShareButton } from "../../social/ViraShareButton.tsx";
import { buildGuidedPlaybackTimeline, countdownSeconds, guidedPlaybackStepAt, type GuidedPlaybackPhase } from "./guided-playback-model.ts";

const ROOM_ID = "judge-playback-france-spain-v2";

const copy = {
  en: {
    disclosure: "Certified TxLINE playback · not a current live match",
    disclosureBody: "A deterministic walkthrough reconstructed from the append-only ledger and verified production projection. No live delivery is claimed.",
    loading: "Reconstructing certified playback",
    unavailable: "Certified playback is temporarily unavailable",
    retry: "Retry",
    back: "Evaluation guide",
    inspect: "Inspect evidence",
    restart: "Replay from start",
    share: "Share result",
    competition: "World Cup · Certified fixture",
    home: "Home",
    away: "Away",
    final: "Final",
    prompt: "Will draw consensus reach 43% or more in this observation?",
    yes: "Yes",
    no: "No",
    private: "Answers stay private until the server locks the round.",
    phases: {
      countdown: ["Playback starts in", "The judge journey is ready. No login or live connection required."],
      kickoff: ["Match started", "France and Spain are live inside the certified reconstruction."],
      round_open: ["Make the call", "Two fans answer independently before the authoritative deadline."],
      answers_locked: ["Answers locked", "The server deadline closed both answers together."],
      txline_signal: ["TxLINE signal received", "Draw consensus moved from 42.2% to 43.4%."],
      resolved: ["Round resolved", "YES matched the deterministic rule. Ana receives 100 points."],
      finished: ["France wins 2–1", "The same ledger reproduces the result and ranking."],
    },
    statuses: ["Kickoff", "Round", "Server lock", "TxLINE", "Result", "Final"],
    verified: "Projection, ranking and hash chain verified",
    stream: "Ledger stream",
    opening: "Opening",
    observed: "Observed",
    leaderboard: "Final ranking",
    points: "pts",
  },
  "pt-BR": {
    disclosure: "Playback TxLINE certificado · não é uma partida ao vivo atual",
    disclosureBody: "Uma demonstração determinística reconstruída do ledger append-only e da projeção verificada de produção. Nenhuma transmissão ao vivo é alegada.",
    loading: "Reconstruindo playback certificado",
    unavailable: "O playback certificado está temporariamente indisponível",
    retry: "Tentar novamente",
    back: "Guia de avaliação",
    inspect: "Inspecionar evidência",
    restart: "Reproduzir novamente",
    share: "Compartilhar resultado",
    competition: "Copa do Mundo · Fixture certificada",
    home: "Casa",
    away: "Visitante",
    final: "Final",
    prompt: "O consenso de empate chega a 43% ou mais nesta observação?",
    yes: "Sim",
    no: "Não",
    private: "As respostas ficam privadas até o servidor fechar a rodada.",
    phases: {
      countdown: ["Playback começa em", "A jornada está pronta. Não exige login nem conexão ao vivo."],
      kickoff: ["Partida iniciada", "França e Espanha estão ao vivo dentro da reconstrução certificada."],
      round_open: ["Faça sua escolha", "Dois fãs respondem separadamente antes do prazo autoritativo."],
      answers_locked: ["Respostas fechadas", "O prazo do servidor fechou as duas respostas simultaneamente."],
      txline_signal: ["Sinal TxLINE recebido", "O consenso de empate mudou de 42,2% para 43,4%."],
      resolved: ["Rodada resolvida", "SIM correspondeu à regra determinística. Ana recebe 100 pontos."],
      finished: ["França vence por 2–1", "O mesmo ledger reproduz o resultado e o ranking."],
    },
    statuses: ["Início", "Rodada", "Lock", "TxLINE", "Resultado", "Final"],
    verified: "Projeção, ranking e cadeia de hashes verificadas",
    stream: "Stream do ledger",
    opening: "Abertura",
    observed: "Observado",
    leaderboard: "Ranking final",
    points: "pts",
  },
} as const;

type PlaybackData = Awaited<ReturnType<typeof fetchPublicPlayback>> & { replay: VerifiedRoundReplayV1 };

export function GuidedPlaybackScreen() {
  const { locale, localizedHref, timeZone, teamName } = useLocale();
  const strings = copy[locale];
  const homeTeam = teamName("France");
  const awayTeam = teamName("Spain");
  const navigate = useNavigate();
  const [data, setData] = useState<PlaybackData | null>(null);
  const [events, setEvents] = useState<PublicDomainEvent[]>([]);
  const [error, setError] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAt = useRef(0);

  const load = useCallback(async () => {
    setError(false);
    try {
      const [playback, publicEvents] = await Promise.all([fetchPublicPlayback(), fetchPublicRoomEvents(ROOM_ID)]);
      if (!playback.available || !playback.replay || playback.verification?.status !== "verified") throw new Error("playback_unavailable");
      setData(playback as PlaybackData);
      setEvents(publicEvents.events);
      startedAt.current = performance.now();
      setElapsedMs(0);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!data || error) return undefined;
    const tick = () => setElapsedMs(Math.min(27_000, performance.now() - startedAt.current));
    tick();
    const interval = window.setInterval(tick, 100);
    return () => window.clearInterval(interval);
  }, [data, error]);

  const timeline = useMemo(() => data ? buildGuidedPlaybackTimeline(events, data.replay) : [], [data, events]);
  const step = timeline.length ? guidedPlaybackStepAt(timeline, elapsedMs) : null;
  const phase = step?.phase ?? "countdown";
  const phaseIndex = Math.max(0, ["kickoff", "round_open", "answers_locked", "txline_signal", "resolved", "finished"].indexOf(phase));
  const final = phase === "finished";
  const score = final ? [2, 1] : [0, 0];
  const phaseCopy = strings.phases[phase];
  const restart = () => { startedAt.current = performance.now(); setElapsedMs(0); };

  if (error) return <main className="grid min-h-[70vh] place-items-center px-5 text-center"><div><Signal className="mx-auto size-8 text-amber-300" /><h1 className="mt-5 font-['Chakra_Petch'] text-4xl font-black uppercase">{strings.unavailable}</h1><button type="button" onClick={() => void load()} className="mt-7 min-h-12 border border-primary px-6 font-['Chakra_Petch'] text-xs font-black uppercase text-primary">{strings.retry}</button></div></main>;
  if (!data || !step) return <main className="grid min-h-[70vh] place-items-center"><ViraLoader label={strings.loading} /></main>;

  return <main className="min-h-screen bg-[#050914]/55 pb-16 text-white" data-testid="guided-playback" data-phase={phase}>
    <header className="border-b border-white/15 px-4 py-4 md:px-8"><div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3"><button type="button" onClick={() => navigate(localizedHref("/help#verified-playback"))} className="inline-flex min-h-10 items-center gap-2 font-['DM_Mono'] text-[9px] uppercase text-white/50 hover:text-white"><ArrowLeft className="size-4" />{strings.back}</button><div className="flex items-center gap-2 border border-primary/30 bg-primary/5 px-3 py-2 font-['DM_Mono'] text-[9px] uppercase text-primary"><ShieldCheck className="size-3" />{strings.disclosure}</div></div></header>

    <div className="mx-auto max-w-[1440px] px-4 pt-5 md:px-8">
      <section className="overflow-hidden border border-white/15 bg-[#08101a]">
        <div className="grid gap-8 border-b border-white/15 p-5 md:p-8 lg:grid-cols-[minmax(0,1fr)_34rem] lg:items-end">
          <div><p className="font-['DM_Mono'] text-[9px] uppercase tracking-[.18em] text-primary">{strings.competition}</p><h1 aria-live="polite" className="mt-5 font-['Chakra_Petch'] text-[clamp(2.8rem,6vw,6rem)] font-black uppercase leading-[.84]">{phaseCopy[0]}{phase === "countdown" ? <span className="block text-primary" data-testid="playback-countdown">{countdownSeconds(elapsedMs)}s</span> : null}</h1><p className="mt-6 max-w-2xl text-sm leading-6 text-white/50">{phaseCopy[1]}</p></div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3 border-y border-white/15 py-6">
            <Team name={homeTeam} iconName="France" label={strings.home} align="right" />
            <div className="px-3 text-center"><p className="font-['DM_Mono'] text-[9px] uppercase text-primary">{final ? strings.final : phase === "countdown" ? "Playback" : "Live"}</p><strong className="mt-2 block font-['Chakra_Petch'] text-6xl font-black tabular-nums">{score[0]}–{score[1]}</strong></div>
            <Team name={awayTeam} iconName="Spain" label={strings.away} align="left" />
          </div>
        </div>

        <ol className="grid grid-cols-3 gap-px bg-white/10 md:grid-cols-6" aria-label="Playback timeline">{strings.statuses.map((label, index) => <li key={label} className={`bg-[#08101a] px-3 py-4 ${phase !== "countdown" && index <= phaseIndex ? "text-primary" : "text-white/25"}`}><span className={`mb-3 block h-1 ${phase !== "countdown" && index <= phaseIndex ? "bg-primary" : "bg-white/10"}`} /><span className="font-['DM_Mono'] text-[8px] uppercase">0{index + 1} · {label}</span></li>)}</ol>

        <div className="grid gap-px bg-white/10 lg:grid-cols-[minmax(0,1.35fr)_minmax(20rem,.65fr)]">
          <section className="bg-[#08101a] p-5 md:p-8">
            {phase === "countdown" || phase === "kickoff" ? <WaitingScene phase={phase} /> : <RoundScene phase={phase} strings={strings} replay={data.replay} />}
          </section>
          <aside className="bg-[#0a121e] p-5 md:p-8">
            <p className="font-['DM_Mono'] text-[9px] uppercase text-white/35">{strings.stream}</p><strong className="mt-2 block font-['Chakra_Petch'] text-2xl font-black uppercase">v{step.sourceStreamVersions.join(", v") || "1"}</strong>
            <p className="mt-4 break-all font-['DM_Mono'] text-[8px] leading-4 text-white/30">{data.replay.replayHash}</p>
            <div className="mt-7 flex items-start gap-3 border-t border-white/10 pt-5"><ShieldCheck className="mt-0.5 size-5 text-primary" /><p className="text-xs leading-5 text-white/55">{strings.verified}</p></div>
            <p className="mt-5 text-xs leading-5 text-white/35">{strings.disclosureBody}</p>
          </aside>
        </div>
      </section>

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Link to={localizedHref("/help#verified-playback")} className="inline-flex min-h-12 items-center gap-2 border border-white/15 px-5 font-['Chakra_Petch'] text-xs font-black uppercase hover:border-primary hover:text-primary"><Eye className="size-4" />{strings.inspect}</Link>
        <button type="button" onClick={restart} className="inline-flex min-h-12 items-center gap-2 border border-white/15 px-5 font-['Chakra_Petch'] text-xs font-black uppercase hover:border-primary hover:text-primary"><RefreshCcw className="size-4" />{strings.restart}</button>
        {final ? <ViraShareButton label={strings.share} create={() => createGuidedPlaybackShare(ROOM_ID, { locale, timeZone })} /> : null}
      </div>
    </div>
  </main>;
}

function Team({ name, iconName, label, align }: { name: string; iconName: string; label: string; align: "left" | "right" }) {
  return <div className={align === "right" ? "text-right" : "text-left"}><span className={`mb-3 flex ${align === "right" ? "justify-end" : "justify-start"}`}><TeamIcon name={iconName} side={align === "right" ? "home" : "away"} size="lg" /></span><p className="font-['DM_Mono'] text-[8px] uppercase text-white/35">{label}</p><strong className="mt-1 block font-['Chakra_Petch'] text-xl font-black uppercase sm:text-3xl">{name}</strong></div>;
}

function WaitingScene({ phase }: { phase: GuidedPlaybackPhase }) {
  return <div className="grid min-h-72 place-items-center text-center"><div>{phase === "countdown" ? <Play className="mx-auto size-10 text-primary" /> : <Radio className="mx-auto size-10 text-primary" />}<p className="mt-6 font-['DM_Mono'] text-[10px] uppercase tracking-[.18em] text-white/40">TxLINE · certified fixture</p></div></div>;
}

function RoundScene({ phase, strings, replay }: { phase: GuidedPlaybackPhase; strings: typeof copy.en | typeof copy["pt-BR"]; replay: VerifiedRoundReplayV1 }) {
  const locked = ["answers_locked", "txline_signal", "resolved", "finished"].includes(phase);
  const signal = ["txline_signal", "resolved", "finished"].includes(phase);
  const resolved = ["resolved", "finished"].includes(phase);
  return <div className="min-h-72">
    <div className="flex items-center justify-between gap-4"><p className="font-['DM_Mono'] text-[9px] uppercase text-primary">Round 01</p><span className="inline-flex items-center gap-2 font-['DM_Mono'] text-[9px] uppercase text-white/40">{locked ? <LockKeyhole className="size-3 text-primary" /> : <Users className="size-3" />}{locked ? "Server locked" : "2 answers private"}</span></div>
    <h2 className="mt-5 max-w-4xl font-['Chakra_Petch'] text-3xl font-black uppercase leading-tight md:text-5xl">{strings.prompt}</h2>
    <div className="mt-7 grid gap-2 sm:grid-cols-2"><Answer label={strings.yes} active={resolved} detail={locked ? "1 / 2" : strings.private} /><Answer label={strings.no} detail={locked ? "1 / 2" : strings.private} /></div>
    {signal ? <div className="mt-6 grid grid-cols-2 gap-px bg-white/10"><Metric label={strings.opening} value={`${String(replay.opening.value ?? 42.2).replace(".", strings === copy.en ? "." : ",")}%`} /><Metric label={strings.observed} value={`${String(replay.resolution.observedValue ?? 43.4).replace(".", strings === copy.en ? "." : ",")}%`} active /></div> : null}
    {resolved ? <div className="mt-6 border-t border-white/10 pt-5"><p className="font-['DM_Mono'] text-[9px] uppercase text-white/35">{strings.leaderboard}</p><div className="mt-3 grid gap-2"><Rank rank={1} name="Ana" points={100} strings={strings} active /><Rank rank={2} name="Bruno" points={0} strings={strings} /></div></div> : null}
  </div>;
}

function Answer({ label, detail, active = false }: { label: string; detail: string; active?: boolean }) { return <div className={`border p-4 ${active ? "border-primary bg-primary/10" : "border-white/15"}`}><strong className="font-['Chakra_Petch'] text-xl font-black uppercase">{label}</strong><p className="mt-2 text-xs text-white/35">{detail}</p></div>; }
function Metric({ label, value, active = false }: { label: string; value: string; active?: boolean }) { return <div className="bg-[#0a121e] p-4"><p className="font-['DM_Mono'] text-[8px] uppercase text-white/35">{label}</p><strong className={`mt-2 block font-['Chakra_Petch'] text-3xl font-black ${active ? "text-primary" : ""}`}>{value}</strong></div>; }
function Rank({ rank, name, points, strings, active = false }: { rank: number; name: string; points: number; strings: typeof copy.en | typeof copy["pt-BR"]; active?: boolean }) { return <div className={`flex items-center gap-3 px-3 py-3 ${active ? "bg-primary text-[#050914]" : "bg-white/[.03]"}`}><span className="font-['DM_Mono'] text-xs">#{rank}</span><strong className="flex-1 text-sm">{name}</strong><span className="font-['DM_Mono'] text-xs">{points} {strings.points}</span>{active ? <Trophy className="size-4" /> : null}</div>; }
