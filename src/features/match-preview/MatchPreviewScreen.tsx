import {
  ArrowLeft,
  ArrowRight,
  Check,
  Database,
  Eye,
  Radio,
  ShieldCheck,
  UserRound,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import type { MatchSummary, MatchTxlineContext, TxlineAvailableMarket } from "../../runtime/api";
import { fetchMatches, fetchMatchTxlineContext } from "../../runtime/api";
import { AnimatedNumber } from "../../shared/number/AnimatedNumber";
import { ViraLoader } from "../../shared/brand/ViraLoader";
import { AppShell } from "../../shared/shell/AppShell";
import { TeamIcon } from "../../shared/team/team-icons";
import { JoinRoomDialog } from "../lobby/JoinRoomDialog";
import { deriveCanonicalExperienceState, experienceCopy, formatMarketCount, formatObservedUpdateCount } from "../match-experience/state-model";
import { PredictionSharePanel } from "../../social/PredictionSharePanel";
import { fixtureAccent, useShellAtmosphere } from "../../app/shell/use-shell-atmosphere";

type ContextState = "idle" | "loading" | "ready" | "empty" | "error";
const CONTEXT_CACHE_TTL_MS = 60_000;
const percentageFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function formatPercentage(value: number) {
  return `${percentageFormatter.format(value)}%`;
}

function formatStartTime(value: string | null) {
  if (!value) return "Horario a confirmar";
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function contextCacheKey(fixtureId: string) {
  return `vira:txline-context:${fixtureId}`;
}

function readCachedContext(fixtureId: string): MatchTxlineContext | null {
  try {
    const raw = window.sessionStorage.getItem(contextCacheKey(fixtureId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt: number; context: MatchTxlineContext };
    if (!parsed.context || Date.now() - parsed.savedAt > CONTEXT_CACHE_TTL_MS) return null;
    return parsed.context;
  } catch {
    return null;
  }
}

function writeCachedContext(fixtureId: string, context: MatchTxlineContext) {
  try {
    window.sessionStorage.setItem(contextCacheKey(fixtureId), JSON.stringify({ savedAt: Date.now(), context }));
  } catch {
    // The cache is optional.
  }
}

function marketTitle(market: TxlineAvailableMarket) {
  if (market.marketType === "1X2_PARTICIPANT_RESULT") return "Resultado da partida";
  if (market.marketType === "OVERUNDER_PARTICIPANT_GOALS") return "Total de gols";
  if (market.marketType === "ASIANHANDICAP_PARTICIPANT_GOALS") return "Handicap de gols";
  return market.label || market.marketType.replaceAll("_", " ").toLowerCase();
}

function marketSubtitle(market: TxlineAvailableMarket) {
  const raw = market.marketParameters ?? "";
  const line = raw.match(/(?:^|[,;\s])line=(-?\d+(?:\.\d+)?)/i)?.[1] ?? null;
  const half = raw.match(/(?:^|[,;\s])half=(\d+)/i)?.[1] ?? null;
  const period = half === "1" || market.marketPeriod === "half=1"
    ? "1º tempo"
    : half === "2" || market.marketPeriod === "half=2"
      ? "2º tempo"
      : "Partida inteira";
  return [line ? `Linha ${line.replace(".", ",")}` : null, period].filter(Boolean).join(" · ");
}

function strongestMarketValue(market: TxlineAvailableMarket) {
  const option = market.leadingOption ?? market.options.find((item) => item.pct !== null) ?? null;
  return option?.pct == null ? null : { label: option.label, value: option.pct };
}

function TeamHeading({ name, side }: { name: string; side: "home" | "away" }) {
  return (
    <div className={`min-w-0 ${side === "away" ? "text-right" : "text-left"}`}>
      <div className={`mb-4 flex ${side === "away" ? "justify-end" : "justify-start"}`}>
        <TeamIcon name={name} side={side} size="lg" />
      </div>
      <p style={{ viewTransitionName: side === "home" ? "home-team" : "away-team" } as CSSProperties} className="break-words font-['Chakra_Petch'] text-[clamp(1.75rem,4.8vw,4.75rem)] font-black uppercase leading-[.88] text-white">
        {name}
      </p>
    </div>
  );
}

function Principle({ number, icon, title, children }: { number: string; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <article className="min-h-64 border-b border-white/15 p-7 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0 lg:p-10">
      <div className="flex items-center justify-between text-primary">
        <span className="font-['DM_Mono'] text-xs font-bold">{number}</span>
        {icon}
      </div>
      <h3 className="mt-16 font-['Chakra_Petch'] text-3xl font-black uppercase leading-none">{title}</h3>
      <p className="mt-4 max-w-sm text-sm leading-6 text-white/50">{children}</p>
    </article>
  );
}

function FootballPrompt({ label, prompt }: { label: string; prompt: string }) {
  return <article className="min-h-40 bg-[#0a0e1a] p-5 sm:p-6"><p className="font-['DM_Mono'] text-[9px] font-black uppercase tracking-[.16em] text-primary">{label}</p><h3 className="mt-8 font-['Chakra_Petch'] text-xl font-black uppercase leading-[.95]">{prompt}</h3></article>;
}

export function MatchPreviewScreen() {
  const { matchId = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [contextState, setContextState] = useState<ContextState>("idle");
  const [context, setContext] = useState<MatchTxlineContext | null>(null);
  const [playerName, setPlayerName] = useState(() => window.localStorage.getItem("vira:displayName") ?? "");
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const [inspectOnJoin, setInspectOnJoin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchMatches().then((response) => {
      if (!cancelled) {
        setMatches(response.matches);
        setLoadState("ready");
      }
    }).catch(() => !cancelled && setLoadState("error"));
    return () => { cancelled = true; };
  }, []);

  const match = useMemo(() => matches.find((item) => item.fixtureId === matchId) ?? matches[0] ?? null, [matchId, matches]);
  useShellAtmosphere("route:preview", match ? {
    atmosphere: match.status === "finished" ? "finished" : "anticipation",
    context: match.status === "finished" ? "post-match" : "fixture-preview",
    fixtureId: match.fixtureId,
    homeAccent: fixtureAccent(match.homeTeam, "home"),
    awayAccent: fixtureAccent(match.awayTeam, "away"),
    fixtureFocus: .42,
    priority: 20,
  } : null);

  useEffect(() => {
    if (!match) return;
    let cancelled = false;
    const cached = readCachedContext(match.fixtureId);
    if (cached) {
      setContext(cached);
      setContextState(cached.availableMarkets.length ? "ready" : "empty");
    } else {
      setContext(null);
      setContextState("loading");
    }
    fetchMatchTxlineContext(match.fixtureId).then((nextContext) => {
      if (cancelled) return;
      writeCachedContext(match.fixtureId, nextContext);
      setContext(nextContext);
      setContextState(nextContext.availableMarkets.length ? "ready" : "empty");
    }).catch(() => !cancelled && setContextState("error"));
    return () => { cancelled = true; };
  }, [match?.fixtureId]);

  const prediction = context?.suggestedPrediction ?? null;
  const probability = context?.endpoints.odds.data?.winProbability ?? null;
  const markets = useMemo(() => {
    const all = context?.availableMarkets ?? [];
    return [...all].sort((left, right) => {
      if (left.signature === prediction?.marketSignature) return -1;
      if (right.signature === prediction?.marketSignature) return 1;
      return Number(right.hasProbabilities) - Number(left.hasProbabilities);
    }).slice(0, 5);
  }, [context?.availableMarkets, prediction?.marketSignature]);

  const currentSignal = prediction
    ? `${prediction.priceLabel} · ${formatPercentage(prediction.pct)}`
    : probability
      ? `Empate · ${formatPercentage(probability.draw)}`
      : "Mercado em sincronizacao";
  const signalCount = (context?.endpoints.odds.summary.count ?? 0) + (context?.endpoints.oddsUpdates.summary.count ?? 0);
  const loadingContext = contextState === "idle" || contextState === "loading";
  const roomReady = Boolean(match && (context || contextState === "empty" || contextState === "error"));
  const canonical = deriveCanonicalExperienceState({ matchStatus: match?.status, roomExists: true, hasSignal: markets.length > 0, connectionState: contextState === "error" ? "reconnecting" : "live" });

  const openRoom = (inspect = false) => {
    setInspectOnJoin(inspect);
    setJoinDialogOpen(true);
  };

  const confirmOpenRoom = () => {
    if (!match || !playerName.trim()) return;
    const safeName = playerName.trim();
    window.localStorage.setItem("vira:displayName", safeName);
    window.localStorage.setItem(`vira:${match.fixtureId}:displayName`, safeName);
    const params = new URLSearchParams();
    const inviteCode = searchParams.get("invite");
    if (inviteCode) params.set("invite", inviteCode);
    if (inspectOnJoin) params.set("inspect", "true");
    navigate(`/match/${match.fixtureId}${params.size ? `?${params.toString()}` : ""}`);
  };

  if (loadState === "loading") {
    return <AppShell><main className="grid min-h-[calc(100vh-68px)] place-items-center"><ViraLoader label="Carregando partida" /></main></AppShell>;
  }

  if (loadState === "error" || !match) {
    return (
      <AppShell>
        <main className="mx-auto max-w-2xl px-6 py-20">
          <Link to="/matches" className="inline-flex items-center gap-2 text-sm text-white/50 hover:text-primary"><ArrowLeft className="size-4" /> Partidas</Link>
          <h1 className="mt-8 font-['Chakra_Petch'] text-5xl font-black uppercase">Partida indisponivel</h1>
          <p className="mt-4 text-white/50">Nao foi possivel carregar as partidas da TxLINE.</p>
        </main>
      </AppShell>
    );
  }

  const outcomes = probability ? [
    { id: "home", label: match.homeTeam, value: probability.home, active: prediction?.priceName === "part1" },
    { id: "draw", label: "Empate", value: probability.draw, active: prediction?.priceName === "draw" },
    { id: "away", label: match.awayTeam, value: probability.away, active: prediction?.priceName === "part2" },
  ] : [];

  return (
    <AppShell>
      <main className="overflow-hidden bg-[#070a13]/55 text-white">
        <section style={{ viewTransitionName: "featured-match" } as CSSProperties} className="relative isolate overflow-hidden border-b border-white/15">
          <div className="absolute inset-0 -z-10 grid grid-cols-2 opacity-80">
            <div className="bg-[linear-gradient(135deg,#263d20_0%,#101a17_56%,#070a13_100%)]" />
            <div className="bg-[linear-gradient(225deg,#24335c_0%,#11172a_56%,#070a13_100%)]" />
          </div>
          <div className="absolute inset-y-0 left-1/2 -z-10 w-px rotate-[14deg] bg-white/10" />
          <div className="mx-auto max-w-[1440px] px-5 py-8 sm:px-8 lg:px-14 lg:py-12">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/15 pb-6">
              <Link to="/matches" className="inline-flex items-center gap-2 text-xs font-bold uppercase text-white/55 hover:text-primary"><ArrowLeft className="size-4" /> Voltar ao lobby</Link>
              <div className="flex flex-wrap items-center gap-3 font-['DM_Mono'] text-[10px] uppercase text-white/50">
                <span>{match.competitionLabel.replace(/world cup/gi, "Copa do Mundo")} · {formatStartTime(match.startTime)}</span>
                <span className="inline-flex items-center gap-2 text-primary"><Radio className="size-3.5" /> {loadingContext ? "Sincronizando TxLINE" : "Mercados TxLINE online"}</span>
              </div>
            </div>

            <div className="mt-10 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-3 sm:gap-8 lg:mt-14">
              <TeamHeading name={match.homeTeam} side="home" />
              <span className="pb-2 font-['DM_Mono'] text-xs font-black text-primary sm:pb-5">VS</span>
              <TeamHeading name={match.awayTeam} side="away" />
            </div>

            <div className="mt-12 border-t border-white/15 pt-7 lg:mt-16">
              <p className="font-['DM_Mono'] text-[10px] font-bold uppercase text-white/45">Lider atual do mercado</p>
              <div className="mt-3 flex flex-wrap items-end justify-between gap-6">
                <h1 style={{ viewTransitionName: "market-value" } as CSSProperties} className="max-w-4xl font-['Chakra_Petch'] text-[clamp(2rem,4.6vw,4.9rem)] font-black uppercase leading-[.9]">
                  {loadingContext && !context ? "Lendo o mercado" : currentSignal}
                </h1>
                <p className="max-w-xs text-sm leading-6 text-white/50">O mercado ajuda o VIRA a identificar pressão e relevância. Os fatos da partida decidem o jogo.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-[1440px] gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:px-14 lg:py-24">
          <div className="min-w-0">
            <p className="font-['DM_Mono'] text-[10px] font-black uppercase text-primary">Desafios ao vivo</p>
            <h2 className="mt-5 max-w-5xl break-words font-['Chakra_Petch'] text-[clamp(2.15rem,4.8vw,5rem)] font-black uppercase leading-[.9]">O futebol cria a próxima pergunta.</h2>
            <p className="mt-6 max-w-3xl text-base leading-7 text-white/55">Quando surge um momento relevante, o VIRA abre uma janela curta para responder. Depois, você volta a acompanhar a partida até o fato ser confirmado.</p>

            <div className="mt-10 grid gap-px bg-white/15 sm:grid-cols-3">
              <FootballPrompt label="Gol" prompt={`${match.homeTeam} marca nos próximos 10 minutos?`} />
              <FootballPrompt label="Finalização" prompt={`${match.awayTeam} finaliza no alvo nos próximos 5 minutos?`} />
              <FootballPrompt label="Momento" prompt="Teremos um gol antes do fim do tempo?" />
            </div>

            <div className="mt-7 flex flex-wrap gap-3">
              <button type="button" disabled={!roomReady} onClick={() => openRoom(false)} className="inline-flex min-h-14 items-center gap-8 bg-primary px-5 font-['Chakra_Petch'] text-sm font-black uppercase text-[#070a13] disabled:opacity-40">Entrar na sala <ArrowRight className="size-4" /></button>
              <a href="#pre-match-prediction" className="inline-flex min-h-14 items-center border border-white/20 px-5 font-['Chakra_Petch'] text-xs font-black uppercase hover:border-primary hover:text-primary">Palpitar antes do jogo</a>
            </div>
          </div>

          <aside className="self-start border border-primary/35 bg-primary/[.055] p-6 lg:sticky lg:top-24">
            <div className="flex items-center justify-between text-primary"><p className="font-['DM_Mono'] text-[10px] font-black uppercase">{experienceCopy.room[canonical.room]} · {experienceCopy.match[canonical.match]}</p><Zap className="size-4" /></div>
            <h3 className="mt-5 font-['Chakra_Petch'] text-3xl font-black uppercase leading-[.9]">Entre em {match.homeTeam}<br />vs {match.awayTeam}</h3>
            <dl className="mt-8 divide-y divide-white/15 border-y border-white/15 text-sm">
              {[["Participantes", "Pessoas reais"], ["Resposta", "Uma por momento"], ["Resolucao", "Fatos oficiais da partida"]].map(([label, value]) => <div key={label} className="flex justify-between gap-4 py-4"><dt className="text-white/40">{label}</dt><dd className="text-right font-semibold">{value}</dd></div>)}
            </dl>
            <button type="button" disabled={!roomReady} onClick={() => openRoom(false)} className="mt-6 flex min-h-14 w-full items-center justify-between bg-primary px-5 font-['Chakra_Petch'] text-sm font-black uppercase text-[#070a13] disabled:opacity-40">Entrar na sala <ArrowRight className="size-4" /></button>
            <button type="button" onClick={() => openRoom(true)} className="mt-3 flex w-full items-center justify-center gap-2 py-3 text-xs font-bold uppercase text-white/45 hover:text-white"><Eye className="size-4" /> Ver revisao oficial</button>
          </aside>
        </section>

        <PredictionSharePanel fixture={match} displayName={playerName} onChangeDisplayName={setPlayerName} />

        <section className="border-y border-white/15 bg-[#0a0e1a]">
          <div className="mx-auto max-w-[1440px] px-5 py-12 sm:px-8 lg:px-14">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div><p className="font-['DM_Mono'] text-[10px] uppercase text-primary">Sinal de mercado</p><h2 className="mt-2 font-['Chakra_Petch'] text-3xl font-black uppercase">Distribuicao 1X2</h2></div>
              <span className="font-['DM_Mono'] text-[10px] uppercase text-white/35">Registro TxLINE</span>
            </div>
            {outcomes.length ? <div className="mt-8 flex min-h-24 overflow-hidden border border-white/10">{outcomes.map((outcome) => <div key={outcome.id} style={{ width: `${Math.max(15, outcome.value)}%` }} className={`relative min-w-[86px] border-r border-[#070a13] p-3 last:border-r-0 ${outcome.active ? "bg-primary text-[#070a13]" : "bg-white/[.07]"}`}><span className="block truncate text-[10px] font-black uppercase">{outcome.label}</span><strong className="absolute bottom-3 left-3 font-['Chakra_Petch'] text-2xl font-black"><AnimatedNumber value={outcome.value} suffix="%" format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} /></strong></div>)}</div> : <p className="mt-8 border-t border-white/15 py-8 text-sm text-white/45">Aguardando a primeira distribuicao 1X2 desta partida.</p>}
            <p className="mt-5 font-['DM_Mono'] text-[10px] uppercase text-white/35">{formatMarketCount(markets.length)} · {formatObservedUpdateCount(signalCount)} · partida monitorada</p>
          </div>
        </section>

        <section className="mx-auto max-w-[1440px] px-5 py-16 sm:px-8 lg:px-14 lg:py-24">
          <p className="font-['DM_Mono'] text-[10px] font-black uppercase text-primary">Mercados monitorados</p>
          <h2 className="mt-3 font-['Chakra_Petch'] text-4xl font-black uppercase">Contexto para o diretor de rodadas</h2>
          <div className="mt-8 border-t border-white/15">
            {markets.length ? markets.map((market, index) => {
              const strongest = strongestMarketValue(market);
              return <div key={market.id} className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-4 border-b border-white/15 py-6 transition hover:bg-white/[.025] sm:grid-cols-[48px_minmax(0,1fr)_180px]"><span className="font-['DM_Mono'] text-xs text-white/30">{String(index + 1).padStart(2, "0")}</span><div className="min-w-0"><p className="truncate font-['Chakra_Petch'] font-black uppercase">{marketTitle(market)}</p><p className="mt-1 truncate text-sm text-white/40">{marketSubtitle(market)}</p></div><div className="text-right"><strong className="block truncate text-sm text-primary sm:text-lg">{strongest ? `${strongest.label} ${formatPercentage(strongest.value)}` : "Aguardando"}</strong><span className="font-['DM_Mono'] text-[9px] uppercase text-white/30">{market.signature === prediction?.marketSignature ? "Ativo" : market.sourceEndpoint.includes("updates") ? "Atualizacao" : "Disponivel"}</span></div></div>;
            }) : <p className="border-b border-white/15 py-8 text-sm text-white/45">Nenhum mercado elegivel foi retornado agora.</p>}
          </div>
        </section>

        <section className="border-y border-white/15 bg-[#0a0e1a]">
          <div className="mx-auto grid max-w-[1440px] md:grid-cols-3">
            <Principle number="01" icon={<Database className="size-4" />} title="Dados reais">Fixtures, mercados e atualizacoes aparecem somente quando fornecidos pela TxLINE.</Principle>
            <Principle number="02" icon={<UserRound className="size-4" />} title="Pessoas reais">Cada participante entra por uma sessao e responde apenas uma vez por rodada.</Principle>
            <Principle number="03" icon={<ShieldCheck className="size-4" />} title="Sem aposta">Pontos, sequencias e ranking entre amigos. Nenhum dinheiro fica em jogo.</Principle>
          </div>
        </section>

        <section className="mx-auto flex max-w-[1440px] flex-col gap-7 px-5 py-14 sm:px-8 md:flex-row md:items-center md:justify-between lg:px-14">
          <div className="flex items-start gap-4"><span className="grid size-10 shrink-0 place-items-center border border-primary/30 text-primary"><Check className="size-5" /></span><div><p className="font-['DM_Mono'] text-[10px] uppercase text-primary">Verificado pela TxLINE</p><p className="mt-2 max-w-xl text-sm leading-6 text-white/45">A entrada, a normalizacao, a regra e o ranking podem ser auditados no modo publico.</p></div></div>
          <button type="button" onClick={() => openRoom(true)} className="inline-flex min-h-12 items-center justify-between gap-8 border border-white/20 px-5 font-['Chakra_Petch'] text-xs font-black uppercase hover:border-primary hover:text-primary">Abrir revisao oficial <Eye className="size-4" /></button>
        </section>

        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/15 bg-[#070a13]/95 p-3 backdrop-blur md:hidden">
          <button type="button" disabled={!roomReady} onClick={() => openRoom(false)} className="flex min-h-13 w-full items-center justify-between bg-primary px-5 font-['Chakra_Petch'] text-sm font-black uppercase text-[#070a13] disabled:opacity-40">Entrar na sala <ArrowRight className="size-4" /></button>
        </div>
      </main>

      <JoinRoomDialog open={joinDialogOpen} subtitle={`${match.homeTeam} × ${match.awayTeam}`} name={playerName} onChangeName={setPlayerName} onClose={() => setJoinDialogOpen(false)} onConfirm={confirmOpenRoom} />
    </AppShell>
  );
}
