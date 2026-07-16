import { ArrowRight, CalendarDays, Check, Play, Radio, Share2, Trophy, Users } from "lucide-react";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router";

import { fixtureAccent, useShellAtmosphere } from "../../app/shell/use-shell-atmosphere";
import { useLocale } from "../../i18n/locale-context.tsx";
import { fixtureHeadline, fixtureMarketStatement, fixtureSchedule } from "../../i18n/semantic-copy.ts";
import { ViraLoader } from "../../shared/brand/ViraLoader";
import { TeamIcon } from "../../shared/team/team-icons";
import { fetchHome, presentShare, savePrediction, shareSavedPrediction, trackHome, type HomeProjection } from "../../social/share";
import { TournamentJourney } from "../tournament-journey/TournamentJourney";

type Choice = "home" | "draw" | "away";

const immersiveCopy = {
  en: {
    liveExperience: "Experience VIRA live now",
    choose: "Choose your side",
    chosen: (selection: string) => `${selection} has your support`,
    drawChosen: "You are calling the draw",
    returnChosen: (name: string, selection: string) => `${name}, you're with ${selection}`,
    returnDraw: (name: string) => `${name}, you called the draw`,
    identify: "Make it yours",
    identifyBody: "Add the name your friends will see, then confirm your call.",
    confirm: "Confirm my pick",
    confirming: "Confirming your pick",
    confirmed: "Your pick is confirmed",
    confirmedBody: "Your call is part of this match. Share it now or follow the road to the final.",
    change: "Change selection",
    liveReturn: (name: string) => `${name}, the match is live`,
    liveReturnBody: "Your Match Room is open. Join the same moments as everyone else.",
    resultReturn: (name: string) => `${name}, the result is in`,
    calendarPrompt: "Choose the next match. Your VIRA continues from kickoff to the final whistle.",
  },
  "pt-BR": {
    liveExperience: "Viva o VIRA ao vivo agora",
    choose: "Escolha seu lado",
    chosen: (selection: string) => `${selection} tem sua torcida`,
    drawChosen: "Seu palpite é empate",
    returnChosen: (name: string, selection: string) => `${name}, você está com ${selection}`,
    returnDraw: (name: string) => `${name}, seu palpite é empate`,
    identify: "Deixe com a sua cara",
    identifyBody: "Adicione o nome que seus amigos verão e confirme seu palpite.",
    confirm: "Confirmar meu palpite",
    confirming: "Confirmando seu palpite",
    confirmed: "Seu palpite está confirmado",
    confirmedBody: "Sua escolha já faz parte desta partida. Compartilhe agora ou acompanhe o caminho até a final.",
    change: "Alterar escolha",
    liveReturn: (name: string) => `${name}, a partida está ao vivo`,
    liveReturnBody: "Sua Match Room está aberta. Entre nos mesmos momentos que todo mundo.",
    resultReturn: (name: string) => `${name}, o resultado chegou`,
    calendarPrompt: "Escolha a próxima partida. Seu VIRA continua do início ao apito final.",
  },
} as const;

export function HomeScreen() {
  const navigate = useNavigate();
  const { locale, timeZone, t, formatDateTime, formatPercent, localizedHref, teamName } = useLocale();
  const c = immersiveCopy[locale];
  const [home, setHome] = useState<HomeProjection | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [name, setName] = useState(() => localStorage.getItem("vira:displayName") ?? "");
  const [draft, setDraft] = useState<{ fixtureId: string; choice: Choice } | null>(null);
  const [action, setAction] = useState<"idle" | "saving" | "sharing" | "error">("idle");

  const editorialContext = { locale, timeZone };
  const load = useCallback(() => void fetchHome({ locale, timeZone }).then((projection) => {
    setHome(projection);
    const confirmed = projection.editorial.prediction?.choice ?? null;
    const fixtureId = projection.editorial.fixture?.fixtureId ?? null;
    setDraft((current) => confirmed && fixtureId ? { fixtureId, choice: confirmed } : current?.fixtureId === fixtureId ? current : null);
    setName((current) => current || (projection.player?.displayName !== "Fan" ? projection.player?.displayName ?? "" : ""));
    setStatus("ready");
    void trackHome("home.editorial_viewed", projection.editorial.kind, fixtureId ?? undefined).catch(() => undefined);
  }).catch(() => setStatus("error")), [locale, timeZone]);

  useEffect(() => {
    load();
    const interval = window.setInterval(load, 15_000);
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", refreshWhenVisible); };
  }, [load]);

  const fixture = home?.editorial.fixture ?? null;
  const homeLabel = fixture ? teamName(fixture.homeTeam) : t("home.choice.home");
  const awayLabel = fixture ? teamName(fixture.awayTeam) : t("home.choice.away");
  const projection = fixture?.consumerProjection ?? null;
  const confirmedChoice = home?.editorial.prediction?.choice ?? null;
  const choice = draft && fixture && draft.fixtureId === fixture.fixtureId ? draft.choice : null;
  const selected = confirmedChoice ?? choice;
  const labels: Record<Choice, string> = { home: homeLabel, draw: t("home.choice.draw"), away: awayLabel };
  const selectedTeam = selected === "home" ? fixture?.homeTeam ?? null : selected === "away" ? fixture?.awayTeam ?? null : null;
  const homeAccent = fixture ? fixtureAccent(fixture.homeTeam, "home") : undefined;
  const awayAccent = fixture ? fixtureAccent(fixture.awayTeam, "away") : undefined;

  useShellAtmosphere("home", {
    atmosphere: fixture?.status === "live" ? "live" : fixture?.status === "finished" ? "finished" : selected ? "anticipation" : "idle",
    context: fixture?.status === "live" ? "match-room" : fixture?.status === "finished" ? "post-match" : "discovery",
    fixtureId: fixture?.fixtureId,
    homeAccent: selected === "away" ? "#182033" : homeAccent,
    awayAccent: selected === "home" ? "#182033" : awayAccent,
    fixtureFocus: selected ? .58 : fixture ? .28 : 0,
    priority: 10,
  });

  const choose = (next: Choice) => {
    if (confirmedChoice || action === "saving") return;
    if (fixture) setDraft({ fixtureId: fixture.fixtureId, choice: next });
    setAction("idle");
  };

  const persist = async () => {
    if (!fixture || !choice || !name.trim()) return;
    setAction("saving");
    try {
      await savePrediction({ fixtureId: fixture.fixtureId, displayName: name.trim(), choice });
      localStorage.setItem("vira:displayName", name.trim());
      setHome(await fetchHome(editorialContext));
      setAction("idle");
    } catch { setAction("error"); }
  };

  const share = async () => {
    if (!fixture) return;
    setAction("sharing");
    try { await presentShare(await shareSavedPrediction(fixture.fixtureId, editorialContext)); setAction("idle"); }
    catch { setAction("error"); }
  };

  const go = (path: string) => {
    if (home) void trackHome("home.primary_action_clicked", home.editorial.kind, fixture?.fixtureId).catch(() => undefined);
    navigate(localizedHref(path));
  };

  if (status === "loading") return <div className="grid min-h-[calc(100dvh-72px)] place-items-center"><ViraLoader label={t("home.loading")} /></div>;
  if (status === "error" || !home) return <div className="grid min-h-[calc(100dvh-72px)] place-items-center"><button type="button" onClick={load} className="border border-white/20 px-5 py-3 text-xs font-black uppercase">{t("home.retry")}</button></div>;

  const editorial = home.editorial;
  const market = projection?.availability.canShowMarket ? fixture?.market ?? null : null;
  const formattedKickoff = projection?.fixture.kickoffAt ? formatDateTime(projection.fixture.kickoffAt, { timeZone: projection.temporal.timeZone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : null;
  const schedule = projection ? fixtureSchedule(t, projection, formattedKickoff) : t("home.timeToConfirm");
  const baseHeadline = projection && fixture ? fixtureHeadline(t, projection, { homeTeam: homeLabel, awayTeam: awayLabel }) : t("fixture.headline.unavailable");
  const returningName = home.player?.displayName && home.player.displayName !== "Fan" ? home.player.displayName : "";
  const headline = editorial.kind === "predict_fixture" && selected
    ? confirmedChoice && returningName
      ? selected === "draw" ? c.returnDraw(returningName) : c.returnChosen(returningName, labels[selected])
      : selected === "draw" ? c.drawChosen : c.chosen(labels[selected])
    : baseHeadline;
  const marketLeader = market ? labels[market.leadingChoice] : null;
  const marketStatement = projection ? fixtureMarketStatement(t, projection, marketLeader) : t("home.scoreDecides");
  const pct = (value: number) => formatPercent(value <= 1 ? value : value / 100, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const playerName = home.player?.displayName && home.player.displayName !== "Fan" ? home.player.displayName : name.trim();
  const heroStyle = fixture ? {
    "--hero-home": homeAccent,
    "--hero-away": awayAccent,
    backgroundImage: selected === "home"
      ? `linear-gradient(105deg, color-mix(in srgb, ${homeAccent} 16%, transparent), transparent 62%)`
      : selected === "away"
        ? `linear-gradient(255deg, color-mix(in srgb, ${awayAccent} 18%, transparent), transparent 62%)`
        : selected === "draw"
          ? "linear-gradient(135deg, rgb(255 255 255 / 7%), transparent 58%)"
          : undefined,
  } as CSSProperties : undefined;

  return <section className="mx-auto grid min-h-[calc(100dvh-72px)] max-w-[1500px] content-between px-5 py-8 sm:px-8 lg:px-14 lg:py-12">
    <header className="flex items-center justify-between border-b border-white/12 pb-4">
      <div><p className="font-['DM_Mono'] text-[10px] font-black uppercase text-primary">{t("home.kicker")}</p><p className="mt-1 text-xs text-white/40">{playerName || t("home.firstPick")}</p></div>
      <div className="flex gap-2"><Link to={localizedHref("/match/judge-playback-france-spain-v2")} className="inline-flex min-h-10 items-center gap-2 border border-primary/45 px-3 text-[9px] font-black uppercase text-primary hover:bg-primary hover:text-[#050814] sm:px-4 sm:text-[10px]"><Play className="size-3.5" /> <span className="hidden sm:inline">{c.liveExperience}</span><span className="sm:hidden">VIRA live</span></Link><Link to={localizedHref("/matches")} className="inline-flex min-h-10 items-center gap-2 border border-white/15 px-3 text-[9px] font-black uppercase hover:border-primary sm:px-4 sm:text-[10px]"><CalendarDays className="size-4" /> {t("home.matches")}</Link></div>
    </header>

    {editorial.kind === "predict_fixture" && fixture ? <div data-home-immersion={confirmedChoice ? "confirmed" : selected ? "identified" : "choosing"} className="relative my-6 overflow-hidden border-y border-white/12 px-0 py-9 transition-colors duration-500 motion-reduce:transition-none lg:my-8 lg:px-8 lg:py-12" style={heroStyle}>
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[.07] [background-image:repeating-linear-gradient(135deg,transparent_0,transparent_8px,#fff_9px,transparent_10px)]" />
      <div className="relative grid gap-10 lg:grid-cols-[1.14fr_.86fr] lg:items-center">
        <div><p className="font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.18em] text-primary">{schedule}</p><h1 aria-live="polite" className="mt-5 max-w-[980px] font-['Chakra_Petch'] text-[clamp(3rem,7vw,7.3rem)] font-black uppercase leading-[.82]">{headline}</h1><div className="mt-8 flex flex-wrap items-center gap-4"><TeamIcon name={fixture.homeTeam} size="lg" /><strong className={selected === "away" ? "uppercase text-white/35" : "uppercase"}>{homeLabel}</strong><span className="text-primary">×</span><strong className={selected === "home" ? "uppercase text-white/35" : "uppercase"}>{awayLabel}</strong><TeamIcon name={fixture.awayTeam} size="lg" /></div><p className="mt-5 max-w-xl text-sm text-white/48">{confirmedChoice ? c.confirmedBody : marketStatement}</p>{market?.freshness.observedAt ? <p className="mt-2 font-['DM_Mono'] text-[9px] uppercase text-white/30">{t("home.marketObservedAt", { dateTime: formatDateTime(market.freshness.observedAt, { timeZone: projection?.temporal.timeZone ?? timeZone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) })}</p> : null}</div>

        <div className="border-y border-white/15 bg-[#050814]/45 p-5 backdrop-blur-sm sm:p-6">
          <div className="mb-5 flex items-center justify-between"><div><p className="font-['DM_Mono'] text-[9px] font-black uppercase tracking-[.18em] text-primary">{confirmedChoice ? c.confirmed : selected ? c.identify : c.choose}</p>{selected && !confirmedChoice && !home.player ? <p className="mt-2 max-w-sm text-xs leading-5 text-white/45">{c.identifyBody}</p> : null}</div>{confirmedChoice ? <span className="grid size-9 place-items-center rounded-full bg-primary text-[#050814]"><Check className="size-5" /></span> : null}</div>
          <div className="grid gap-2">{(["home", "draw", "away"] as Choice[]).map((item) => <button key={item} type="button" aria-pressed={selected === item} disabled={Boolean(confirmedChoice) || action === "saving"} onClick={() => choose(item)} className={`grid min-h-16 grid-cols-[1fr_auto] items-center border px-4 text-left transition-colors motion-reduce:transition-none disabled:cursor-default ${selected === item ? "border-primary bg-primary text-[#050814]" : "border-white/20 bg-[#050814]/40 hover:border-primary"}`}><span className="font-['Chakra_Petch'] text-sm font-black uppercase">{labels[item]}</span><span className="font-['DM_Mono'] text-xs font-black">{market ? pct(market.selections[item]) : ""}</span></button>)}</div>

          {selected && !confirmedChoice ? <div className="mt-4 border-t border-white/12 pt-4">{!home.player ? <input autoFocus aria-label={t("home.nameLabel")} value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && name.trim()) void persist(); }} maxLength={40} placeholder={t("home.namePlaceholder")} className="mb-3 min-h-12 w-full border border-white/20 bg-[#050814]/70 px-4 text-sm outline-none focus:border-primary" /> : null}<button type="button" disabled={!name.trim() || action === "saving"} onClick={() => void persist()} className="flex min-h-14 w-full items-center justify-between bg-primary px-5 text-sm font-black uppercase text-[#050814] disabled:opacity-40"><span>{action === "saving" ? c.confirming : c.confirm}</span><ArrowRight className="size-4" /></button><button type="button" onClick={() => setDraft(null)} className="mt-2 min-h-9 w-full text-[9px] font-black uppercase text-white/40 hover:text-white">{c.change}</button></div> : null}
          {confirmedChoice ? <button type="button" onClick={() => void share()} className="mt-4 flex min-h-14 w-full items-center justify-between border border-primary px-5 text-sm font-black uppercase text-primary"><span>{action === "sharing" ? t("home.share.opening") : t("home.share.selection", { selection: labels[confirmedChoice] })}</span><Share2 className="size-4" /></button> : null}
          {action === "error" ? <p role="alert" className="mt-3 text-xs text-red-300">{t("home.actionError")}</p> : null}
        </div>
      </div>
    </div> : null}

    {editorial.kind === "join_live_room" && fixture ? <div className="py-14"><p className="inline-flex items-center gap-2 font-['DM_Mono'] text-[10px] font-black uppercase text-primary"><Radio className="size-4" /> {t("home.liveNow")}</p><h1 className="mt-5 font-['Chakra_Petch'] text-[clamp(3.5rem,10vw,9rem)] font-black uppercase leading-[.78]">{playerName ? c.liveReturn(playerName) : baseHeadline}</h1><p className="mt-6 max-w-xl text-sm leading-6 text-white/48">{c.liveReturnBody}</p><button type="button" onClick={() => go(`/match/${fixture.fixtureId}`)} className="mt-10 inline-flex min-h-16 items-center gap-5 bg-primary px-7 font-black uppercase text-[#050814]">{t("home.enterMatch")} <ArrowRight className="size-5" /></button></div> : null}

    {editorial.kind === "result_available" && fixture && editorial.prediction ? <div className="grid gap-10 py-14 lg:grid-cols-[1fr_400px] lg:items-end"><div><p className="font-['DM_Mono'] text-[10px] font-black uppercase text-primary">{t("home.result.official")}</p><h1 className="mt-5 font-['Chakra_Petch'] text-[clamp(4rem,10vw,8.5rem)] font-black uppercase leading-[.78]">{playerName ? c.resultReturn(playerName) : editorial.prediction.correct ? t("home.result.correct") : t("home.result.defined")}</h1><p className="mt-7 text-xl font-black uppercase">{homeLabel} {editorial.prediction.finalScore?.home} × {editorial.prediction.finalScore?.away} {awayLabel}</p><p className="mt-3 text-sm text-white/45">{t("home.result.yourPick", { selection: labels[editorial.prediction.choice] })}</p></div><div><button type="button" onClick={() => void share()} className="flex min-h-16 w-full items-center justify-between bg-primary px-6 font-black uppercase text-[#050814]">{t("home.result.share")} <Share2 className="size-5" /></button><button type="button" onClick={() => go(`/match/${fixture.fixtureId}/preview`)} className="mt-2 flex min-h-14 w-full items-center justify-between border border-white/20 px-6 font-black uppercase">{t("home.result.view")} <ArrowRight className="size-4" /></button></div></div> : null}

    {editorial.kind === "open_calendar" ? fixture ? <div className="py-14"><p className="font-['DM_Mono'] text-[10px] font-black uppercase text-primary">{t("home.calendar.nextFixture")}</p><h1 className="mt-5 max-w-6xl font-['Chakra_Petch'] text-[clamp(3.5rem,9vw,8rem)] font-black uppercase leading-[.8]">{homeLabel}<br /><span className="text-primary">×</span> {awayLabel}</h1><div className="mt-8 flex flex-wrap items-center gap-4"><TeamIcon name={fixture.homeTeam} size="lg" /><span className="font-['DM_Mono'] text-xs font-black uppercase text-white/60">{formattedKickoff ?? t("home.timeToConfirm")}</span><TeamIcon name={fixture.awayTeam} size="lg" /></div><p className="mt-5 max-w-xl text-sm leading-6 text-white/45">{c.calendarPrompt}</p><div className="mt-9 flex flex-wrap gap-3"><button type="button" onClick={() => go(`/match/${fixture.fixtureId}/preview`)} className="inline-flex min-h-16 items-center gap-4 bg-primary px-7 font-black uppercase text-[#050814]">{t("home.calendar.viewFixture")} <ArrowRight className="size-5" /></button><button type="button" onClick={() => go("/matches")} className="inline-flex min-h-16 items-center gap-4 border border-white/20 px-7 font-black uppercase">{t("home.calendar.open")} <CalendarDays className="size-5" /></button></div></div> : <div className="py-16"><p className="font-['DM_Mono'] text-[10px] font-black uppercase text-primary">{t("home.calendar.kicker")}</p><h1 className="mt-5 max-w-5xl font-['Chakra_Petch'] text-[clamp(3.5rem,9vw,8rem)] font-black uppercase leading-[.8]">{t("home.calendar.headline")}</h1><button type="button" onClick={() => go("/matches")} className="mt-9 inline-flex min-h-16 items-center gap-4 bg-primary px-7 font-black uppercase text-[#050814]">{t("home.calendar.open")} <CalendarDays className="size-5" /></button></div> : null}

    {home.journey ? <TournamentJourney journey={home.journey} highlightTeam={selectedTeam} /> : null}
    <footer className="grid gap-4 border-t border-white/12 pt-5 sm:grid-cols-3"><Footer label={t("home.footer.authority")} value={editorial.authority === "txline_fixture_market" ? t("home.footer.fixtureMarket") : t("home.footer.officialState")} /><Footer label={t("home.footer.yourGroup")} value={home.player?.miniLeagues.length ? t("home.footer.miniLeagues", { count: home.player.miniLeagues.length }) : t("home.footer.noGroup")} icon={<Users className="size-4 text-primary" />} /><Footer label={t("home.footer.champion")} value={home.journey?.champion?.name ?? (home.journey ? t("home.footer.tournamentActive") : t("home.footer.outrightUnavailable"))} icon={<Trophy className="size-4" />} /></footer>
  </section>;
}

function Footer({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return <div><p className="font-['DM_Mono'] text-[9px] uppercase text-white/35">{label}</p><p className="mt-2 flex items-center gap-2 text-xs font-black uppercase text-white/65">{icon}{value}</p></div>;
}
