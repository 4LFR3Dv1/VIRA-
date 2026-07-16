import { ArrowRight, CalendarDays, Radio, Share2, Trophy, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";

import { fixtureAccent, useShellAtmosphere } from "../../app/shell/use-shell-atmosphere";
import { useLocale } from "../../i18n/locale-context.tsx";
import { fixtureHeadline, fixtureMarketStatement, fixtureSchedule } from "../../i18n/semantic-copy.ts";
import { ViraLoader } from "../../shared/brand/ViraLoader";
import { TeamIcon } from "../../shared/team/team-icons";
import { fetchHome, presentShare, savePrediction, shareSavedPrediction, trackHome, type HomeProjection } from "../../social/share";
import { TournamentJourney } from "../tournament-journey/TournamentJourney";

type Choice = "home" | "draw" | "away";

export function HomeScreen() {
  const navigate = useNavigate();
  const { locale, timeZone, t, formatDateTime, formatPercent, localizedHref } = useLocale();
  const [home, setHome] = useState<HomeProjection | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [name, setName] = useState(() => localStorage.getItem("vira:displayName") ?? "");
  const [choice, setChoice] = useState<Choice | null>(null);
  const [action, setAction] = useState<"idle" | "saving" | "sharing" | "error">("idle");

  const editorialContext = { locale, timeZone };
  const load = useCallback(() => void fetchHome({ locale, timeZone }).then((projection) => {
    setHome(projection);
    setChoice(projection.editorial.prediction?.choice ?? null);
    setName((current) => current || (projection.player?.displayName !== "Fan" ? projection.player?.displayName ?? "" : ""));
    setStatus("ready");
    void trackHome("home.editorial_viewed", projection.editorial.kind, projection.editorial.fixture?.fixtureId).catch(() => undefined);
  }).catch(() => setStatus("error")), [locale, timeZone]);
  useEffect(() => {
    load();
    const interval = window.setInterval(load, 15_000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [load]);

  const fixture = home?.editorial.fixture ?? null;
  const projection = fixture?.consumerProjection ?? null;
  useShellAtmosphere("home", { atmosphere: fixture?.status === "live" ? "live" : "idle", context: "discovery", fixtureId: fixture?.fixtureId, homeAccent: fixture ? fixtureAccent(fixture.homeTeam, "home") : undefined, awayAccent: fixture ? fixtureAccent(fixture.awayTeam, "away") : undefined, fixtureFocus: fixture ? .22 : 0, priority: 10 });
  const labels: Record<Choice, string> = { home: fixture?.homeTeam ?? t("home.choice.home"), draw: t("home.choice.draw"), away: fixture?.awayTeam ?? t("home.choice.away") };
  const selected = home?.editorial.prediction?.choice ?? choice;

  const persist = async (next: Choice) => {
    if (!fixture || !name.trim()) return;
    setChoice(next); setAction("saving");
    try {
      await savePrediction({ fixtureId: fixture.fixtureId, displayName: name.trim(), choice: next });
      localStorage.setItem("vira:displayName", name.trim());
      setHome(await fetchHome(editorialContext)); setAction("idle");
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
  const headline = projection && fixture ? fixtureHeadline(t, projection, { homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam }) : t("fixture.headline.unavailable");
  const marketLeader = market ? labels[market.leadingChoice] : null;
  const marketStatement = projection ? fixtureMarketStatement(t, projection, marketLeader) : t("home.scoreDecides");
  const pct = (value: number) => formatPercent(value <= 1 ? value : value / 100, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  return <section className="mx-auto grid min-h-[calc(100dvh-72px)] max-w-[1500px] content-between px-5 py-8 sm:px-8 lg:px-14 lg:py-12">
    <header className="flex items-center justify-between border-b border-white/12 pb-4">
      <div><p className="font-['DM_Mono'] text-[10px] font-black uppercase text-primary">{t("home.kicker")}</p><p className="mt-1 text-xs text-white/40">{home.player?.displayName ?? t("home.firstPick")}</p></div>
      <div className="flex gap-2"><Link to={localizedHref("/help")} className="inline-flex min-h-10 items-center border border-white/15 px-3 text-[9px] font-black uppercase hover:border-primary sm:px-4 sm:text-[10px]">{t("home.playback")}</Link><Link to={localizedHref("/matches")} className="inline-flex min-h-10 items-center gap-2 border border-white/15 px-3 text-[9px] font-black uppercase hover:border-primary sm:px-4 sm:text-[10px]"><CalendarDays className="size-4" /> {t("home.matches")}</Link></div>
    </header>

    {editorial.kind === "predict_fixture" && fixture ? <div className="grid gap-10 py-10 lg:grid-cols-[1.2fr_.8fr] lg:items-center">
      <div><p className="font-['DM_Mono'] text-[10px] font-black uppercase text-primary">{schedule}</p><h1 className="mt-5 max-w-[980px] font-['Chakra_Petch'] text-[clamp(3.2rem,8vw,8rem)] font-black uppercase leading-[.82]">{headline}</h1><div className="mt-8 flex flex-wrap items-center gap-4"><TeamIcon name={fixture.homeTeam} size="lg" /><strong className="uppercase">{fixture.homeTeam}</strong><span className="text-primary">×</span><strong className="uppercase">{fixture.awayTeam}</strong><TeamIcon name={fixture.awayTeam} size="lg" /></div><p className="mt-5 text-sm text-white/45">{marketStatement}</p>{market?.freshness.observedAt ? <p className="mt-2 font-['DM_Mono'] text-[9px] uppercase text-white/30">{t("home.marketObservedAt", { dateTime: formatDateTime(market.freshness.observedAt, { timeZone: projection?.temporal.timeZone ?? timeZone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) })}</p> : null}</div>
      <div className="border-y border-white/15 py-6">{!home.player ? <input aria-label={t("home.nameLabel")} value={name} onChange={(event) => setName(event.target.value)} maxLength={40} placeholder={t("home.namePlaceholder")} className="mb-4 min-h-12 w-full border border-white/20 bg-[#050814]/45 px-4 text-sm outline-none focus:border-primary" /> : null}<div className="grid gap-2">{(["home", "draw", "away"] as Choice[]).map((item) => <button key={item} type="button" disabled={!name.trim() || action === "saving"} onClick={() => void persist(item)} className={`grid min-h-16 grid-cols-[1fr_auto] items-center border px-4 text-left disabled:opacity-40 ${selected === item ? "border-primary bg-primary text-[#050814]" : "border-white/20 bg-[#050814]/40 hover:border-primary"}`}><span className="font-['Chakra_Petch'] text-sm font-black uppercase">{labels[item]}</span><span className="font-['DM_Mono'] text-xs font-black">{market ? pct(market.selections[item]) : ""}</span></button>)}</div>{selected ? <button type="button" onClick={() => void share()} className="mt-3 flex min-h-14 w-full items-center justify-between border border-primary px-5 text-sm font-black uppercase text-primary"><span>{action === "sharing" ? t("home.share.opening") : t("home.share.selection", { selection: labels[selected] })}</span><Share2 className="size-4" /></button> : null}{action === "error" ? <p className="mt-3 text-xs text-red-300">{t("home.actionError")}</p> : null}</div>
    </div> : null}

    {editorial.kind === "join_live_room" && fixture ? <div className="py-14"><p className="inline-flex items-center gap-2 font-['DM_Mono'] text-[10px] font-black uppercase text-primary"><Radio className="size-4" /> {t("home.liveNow")}</p><h1 className="mt-5 font-['Chakra_Petch'] text-[clamp(3.5rem,10vw,9rem)] font-black uppercase leading-[.78]">{fixture.homeTeam}<br /><span className="text-primary">×</span> {fixture.awayTeam}</h1><button type="button" onClick={() => go(`/match/${fixture.fixtureId}`)} className="mt-10 inline-flex min-h-16 items-center gap-5 bg-primary px-7 font-black uppercase text-[#050814]">{t("home.enterMatch")} <ArrowRight className="size-5" /></button></div> : null}

    {editorial.kind === "result_available" && fixture && editorial.prediction ? <div className="grid gap-10 py-14 lg:grid-cols-[1fr_400px] lg:items-end"><div><p className="font-['DM_Mono'] text-[10px] font-black uppercase text-primary">{t("home.result.official")}</p><h1 className="mt-5 font-['Chakra_Petch'] text-[clamp(4rem,11vw,9rem)] font-black uppercase leading-[.76]">{editorial.prediction.correct ? t("home.result.correct") : t("home.result.defined")}</h1><p className="mt-7 text-xl font-black uppercase">{fixture.homeTeam} {editorial.prediction.finalScore?.home} × {editorial.prediction.finalScore?.away} {fixture.awayTeam}</p><p className="mt-3 text-sm text-white/45">{t("home.result.yourPick", { selection: labels[editorial.prediction.choice] })}</p></div><div><button type="button" onClick={() => void share()} className="flex min-h-16 w-full items-center justify-between bg-primary px-6 font-black uppercase text-[#050814]">{t("home.result.share")} <Share2 className="size-5" /></button><button type="button" onClick={() => go(`/match/${fixture.fixtureId}/preview`)} className="mt-2 flex min-h-14 w-full items-center justify-between border border-white/20 px-6 font-black uppercase">{t("home.result.view")} <ArrowRight className="size-4" /></button></div></div> : null}

    {editorial.kind === "open_calendar" ? fixture ? <div className="py-14"><p className="font-['DM_Mono'] text-[10px] font-black uppercase text-primary">{t("home.calendar.nextFixture")}</p><h1 className="mt-5 max-w-6xl font-['Chakra_Petch'] text-[clamp(3.5rem,9vw,8rem)] font-black uppercase leading-[.8]">{fixture.homeTeam}<br /><span className="text-primary">×</span> {fixture.awayTeam}</h1><div className="mt-8 flex flex-wrap items-center gap-4"><TeamIcon name={fixture.homeTeam} size="lg" /><span className="font-['DM_Mono'] text-xs font-black uppercase text-white/60">{formattedKickoff ?? t("home.timeToConfirm")}</span><TeamIcon name={fixture.awayTeam} size="lg" /></div><p className="mt-5 max-w-xl text-sm leading-6 text-white/45">{t("home.calendar.predictionsLater")}</p><div className="mt-9 flex flex-wrap gap-3"><button type="button" onClick={() => go(`/match/${fixture.fixtureId}/preview`)} className="inline-flex min-h-16 items-center gap-4 bg-primary px-7 font-black uppercase text-[#050814]">{t("home.calendar.viewFixture")} <ArrowRight className="size-5" /></button><button type="button" onClick={() => go("/matches")} className="inline-flex min-h-16 items-center gap-4 border border-white/20 px-7 font-black uppercase">{t("home.calendar.open")} <CalendarDays className="size-5" /></button></div></div> : <div className="py-16"><p className="font-['DM_Mono'] text-[10px] font-black uppercase text-primary">{t("home.calendar.kicker")}</p><h1 className="mt-5 max-w-5xl font-['Chakra_Petch'] text-[clamp(3.5rem,9vw,8rem)] font-black uppercase leading-[.8]">{t("home.calendar.headline")}</h1><button type="button" onClick={() => go("/matches")} className="mt-9 inline-flex min-h-16 items-center gap-4 bg-primary px-7 font-black uppercase text-[#050814]">{t("home.calendar.open")} <CalendarDays className="size-5" /></button></div> : null}

    {home.journey ? <TournamentJourney journey={home.journey} /> : null}
    <footer className="grid gap-4 border-t border-white/12 pt-5 sm:grid-cols-3"><Footer label={t("home.footer.authority")} value={editorial.authority === "txline_fixture_market" ? t("home.footer.fixtureMarket") : t("home.footer.officialState")} /><Footer label={t("home.footer.yourGroup")} value={home.player?.miniLeagues.length ? t("home.footer.miniLeagues", { count: home.player.miniLeagues.length }) : t("home.footer.noGroup")} icon={<Users className="size-4 text-primary" />} /><Footer label={t("home.footer.champion")} value={home.journey?.champion?.name ?? (home.journey ? t("home.footer.tournamentActive") : t("home.footer.outrightUnavailable"))} icon={<Trophy className="size-4" />} /></footer>
  </section>;
}

function Footer({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return <div><p className="font-['DM_Mono'] text-[9px] uppercase text-white/35">{label}</p><p className="mt-2 flex items-center gap-2 text-xs font-black uppercase text-white/65">{icon}{value}</p></div>;
}
