import { ArrowLeft, ShieldCheck, UserRound } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useLocation, useNavigate, useOutlet } from "react-router";

import { ViraLoader } from "../../shared/brand/ViraLoader";
import { LocaleSelector } from "../../i18n/LocaleSelector.tsx";
import { useLocale, type LocaleContextValue } from "../../i18n/locale-context.tsx";
import type { StaticTranslationKey } from "../../i18n/translate.ts";
import { useShellExperience } from "./ShellContext";
import { OfficialReviewPortal } from "./OfficialReviewPortal";
import { matchCurrentRoute } from "../routing/route-manifest";
import { resolveNavigationTransition } from "../routing/navigation-transition";
import type { ShellActiveRoom } from "./shell-experience";
import { OPEN_OFFICIAL_REVIEW_EVENT, SHELL_OVERLAY_STATE_EVENT } from "./shell-events";
import { ViraShellBackground } from "./ViraShellBackground";
import { deriveMatchdayPulseV1, roundProgress, type MatchdayPulseV1 } from "./matchday-topbar-model.ts";

export function ViraAppShell() {
  const shell = useShellExperience();
  const { localizedHref } = useLocale();
  const navigate = useNavigate();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [roomTakeover, setRoomTakeover] = useState<ShellActiveRoom | null>(null);
  const [restored, setRestored] = useState(false);
  const [externalOverlays, setExternalOverlays] = useState<Set<string>>(() => new Set());
  const previousConnection = useRef(shell.connection.kind);
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => { const interval = window.setInterval(() => setNowMs(Date.now()), 1_000); return () => window.clearInterval(interval); }, []);
  useEffect(() => {
    const wasInterrupted = previousConnection.current !== "healthy";
    previousConnection.current = shell.connection.kind;
    if (!wasInterrupted || shell.connection.kind !== "healthy") return;
    setRestored(true);
    const timeout = window.setTimeout(() => setRestored(false), 1_500);
    return () => window.clearTimeout(timeout);
  }, [shell.connection.kind]);
  useEffect(() => {
    const openReview = () => setReviewOpen(true);
    window.addEventListener(OPEN_OFFICIAL_REVIEW_EVENT, openReview);
    return () => window.removeEventListener(OPEN_OFFICIAL_REVIEW_EVENT, openReview);
  }, []);
  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; open: boolean }>).detail;
      setExternalOverlays((current) => {
        const next = new Set(current);
        if (detail.open) next.add(detail.id); else next.delete(detail.id);
        return next;
      });
    };
    window.addEventListener(SHELL_OVERLAY_STATE_EVENT, update);
    return () => window.removeEventListener(SHELL_OVERLAY_STATE_EVENT, update);
  }, []);
  useEffect(() => {
    if (!roomTakeover || shell.mode !== "immersive") return undefined;
    const timeout = window.setTimeout(() => setRoomTakeover(null), 260);
    return () => window.clearTimeout(timeout);
  }, [roomTakeover, shell.mode]);
  const enterRoom = (room: ShellActiveRoom) => {
    if (roomTakeover) return;
    setRoomTakeover(room);
    window.setTimeout(() => navigate(localizedHref(`/match/${room.roomId}`)), 440);
  };
  const alertVisible = shell.connection.kind !== "healthy";
  const location = useLocation();
  const pulse = deriveMatchdayPulseV1({ routeId: shell.route.id, pathname: location.pathname, home: shell.matchday.home, homeAvailable: shell.matchday.kind === "ready", matchdayUpdatedAt: shell.matchday.updatedAt, activeRoom: shell.activeRoom, review: shell.review, connection: shell.connection });
  const currentFixtureId = location.pathname.match(/^\/match\/([^/]+)/)?.[1] ?? null;
  const activeFixtureId = shell.activeRoom.kind === "confirmed" ? shell.activeRoom.room.fixtureId : null;
  const overlayOpen = reviewOpen || externalOverlays.size > 0;
  const continuityVisible = shell.activeRoom.kind === "confirmed" && shell.mode !== "immersive" && !overlayOpen && activeFixtureId !== currentFixtureId;
  const style = { "--shell-alert-height": alertVisible ? "56px" : "0px", "--shell-mobile-dock-height": shell.mode === "immersive" ? "0px" : "68px", "--shell-continuity-height": continuityVisible ? "92px" : "0px" } as CSSProperties;
  return <LayoutGroup id="vira-shell"><div data-shell-mode={shell.mode} data-shell-alert={alertVisible ? "visible" : "hidden"} data-active-room={continuityVisible ? "visible" : "hidden"} style={style} className="vira-app-shell">
    <ViraShellBackground paused={overlayOpen || Boolean(roomTakeover)} />
    <div className="vira-app-shell__content">
    <ShellSignalRail pulse={pulse} nowMs={nowMs} />
    <ShellConnectionSurface />
    <ConnectionRestoredNotice open={restored} />
    <ShellHeader pulse={pulse} nowMs={nowMs} onOpenReview={() => setReviewOpen(true)} />
    <RouteTransitionFrame />
    {continuityVisible ? <ActiveRoomContinuity onEnterRoom={enterRoom} /> : null}
    <RoomTransitionTakeover room={roomTakeover} />
    {!overlayOpen ? <MobileContextDock onOpenReview={() => setReviewOpen(true)} /> : null}
    <OfficialReviewPortal open={reviewOpen} roomId={shell.review.kind === "available" ? shell.review.roomId : null} onClose={() => setReviewOpen(false)} />
    <ShellReadinessLayer />
    </div>
  </div></LayoutGroup>;
}

function ConnectionRestoredNotice({ open }: { open: boolean }) {
  const { t } = useLocale();
  return <AnimatePresence>{open ? <motion.div role="status" initial={{ y: "-100%" }} animate={{ y: 0 }} exit={{ opacity: 0 }} className="fixed inset-x-0 top-0 z-[95] bg-primary px-4 py-3 text-[#050814]"><div className="mx-auto max-w-[1500px]"><p className="font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.14em]">{t("shell.connectionRestored.title")}</p><p className="mt-1 text-xs opacity-65">{t("shell.connectionRestored.description")}</p></div></motion.div> : null}</AnimatePresence>;
}

function RoomTransitionTakeover({ room }: { room: ShellActiveRoom | null }) {
  const { t, teamName } = useLocale();
  return <AnimatePresence>{room ? <motion.div className="fixed inset-0 z-[105] grid place-items-center overflow-hidden bg-[#050814] px-5" initial={{ clipPath: "inset(100% 0 0 0)" }} animate={{ clipPath: "inset(0% 0 0 0)" }} exit={{ opacity: 0 }} transition={{ duration: .4, ease: [.76, 0, .24, 1] }}>
    <div aria-hidden className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.04)_1px,transparent_1px)] [background-size:100%_90px,140px_100%]" />
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .14, duration: .24 }} className="relative text-center"><h2 className="font-['Chakra_Petch'] text-[clamp(2.8rem,8vw,7rem)] font-black uppercase leading-[.8]">{teamName(room.homeTeam)}<span className="mx-3 text-primary">x</span>{teamName(room.awayTeam)}</h2><p className="mt-7 font-['DM_Mono'] text-[10px] uppercase tracking-[.14em] text-white/40">{t("shell.returningToRoom")}</p></motion.div>
  </motion.div> : null}</AnimatePresence>;
}

function ShellSignalRail({ pulse, nowMs }: { pulse: MatchdayPulseV1; nowMs: number }) {
  const { connection, readiness } = useShellExperience();
  const { t } = useLocale();
  const reduceMotion = useReducedMotion();
  if (readiness.kind === "integrity_failed") return <div aria-label={t("shell.signal.integrityFailed")} className="fixed inset-x-0 top-0 z-[100] h-[3px] bg-red-500" />;
  const progress = roundProgress(pulse, nowMs);
  if (connection.kind === "healthy" && progress !== null) return <div aria-label={t("shell.signal.systemConfirmed")} className="fixed inset-x-0 top-0 z-[100] h-[3px] bg-white/10"><div className="h-full bg-primary transition-[width] duration-1000 motion-reduce:transition-none" style={{ width: `${progress * 100}%` }} /></div>;
  if (connection.kind === "healthy") return <div aria-label={t("shell.signal.systemConfirmed")} className="fixed inset-x-0 top-0 z-[100] h-[2px] bg-primary" />;
  if (connection.kind === "room_reconnecting" || connection.kind === "txline_reconnecting") return <div aria-label={t("shell.signal.reconnecting")} className="fixed inset-x-0 top-0 z-[100] h-[3px] overflow-hidden bg-white/10"><motion.div animate={reduceMotion ? undefined : { x: ["-100%", "300%"] }} transition={reduceMotion ? undefined : { duration: 1.4, repeat: Infinity, ease: "linear" }} className="h-full w-1/3 bg-primary" /></div>;
  return <div aria-label={t("shell.signal.unavailable")} className="fixed inset-x-0 top-0 z-[100] h-[3px] bg-amber-400" />;
}

function ShellHeader({ pulse, nowMs, onOpenReview }: { pulse: MatchdayPulseV1; nowMs: number; onOpenReview: () => void }) {
  const { route, connection, activeRoom, review } = useShellExperience();
  const { locale, timeZone, t, localizedHref, formatDateTime, formatNumber, teamName } = useLocale();
  const confirmedRoom = activeRoom.kind === "confirmed" ? activeRoom.room : null;
  const identity = confirmedRoom?.participantName || window.localStorage.getItem("vira:displayName")?.trim() || null;
  const section = sectionLabel(route.id, locale);
  const pulseText = presentPulse(pulse, nowMs, { locale, timeZone, formatDateTime, formatNumber, teamName, connected: connection.kind === "healthy" });
  const txline = providerLabel(pulse, nowMs, locale, connection.kind === "healthy");
  return <header style={{ top: "var(--shell-alert-height)" }} className="sticky z-40 border-b border-white/10 bg-[#050814]/92 backdrop-blur-xl">
    <div className="mx-auto grid min-h-[76px] max-w-[1720px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 sm:h-[72px] sm:min-h-0 sm:grid-cols-[minmax(13rem,.75fr)_minmax(18rem,1.4fr)_minmax(13rem,.75fr)] sm:px-5 lg:px-7">
      <div className="flex min-w-0 items-center gap-3">{route.backPath ? <Link to={localizedHref(route.backPath)} aria-label={t("shell.back")} className="hidden size-9 shrink-0 place-items-center border border-white/15 hover:border-primary hover:text-primary lg:grid"><ArrowLeft className="size-4" /></Link> : null}<Link to={localizedHref("/")} aria-label="VIRA Home" className="flex shrink-0 items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><img src="/vira-icon.png" alt="VIRA" className="hidden h-8 w-auto object-contain sm:block" /><img src="/vira-symbol.png" alt="" className="h-8 w-8 object-contain sm:hidden" /></Link><div className="hidden min-w-0 border-l border-white/10 pl-3 sm:block"><motion.p key={section} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="truncate font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.14em]">{section}</motion.p><p className="mt-1 truncate font-['DM_Mono'] text-[8px] font-bold uppercase tracking-[.12em] text-white/38">World Cup</p></div></div>
      <Link to={localizedHref(pulse.destination ?? "/")} aria-label={pulseText.aria} className="min-w-0 justify-self-center text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><p className="truncate font-['Chakra_Petch'] text-[12px] font-black uppercase tracking-[.03em] text-white sm:text-[15px]">{pulseText.primary}</p><p className={`mt-1 truncate font-['DM_Mono'] text-[8px] font-bold uppercase tracking-[.1em] sm:text-[9px] ${pulse.kind === "round_open" || pulse.kind === "live" ? "text-primary" : "text-white/42"}`}>{pulseText.secondary}</p></Link>
      <div className="flex items-center justify-end gap-2">
        <span title={txline.detail} className={`hidden h-10 items-center gap-2 border px-3 font-['DM_Mono'] text-[8px] font-bold uppercase lg:inline-flex ${pulse.providerState === "unavailable" ? "border-amber-400/30 text-amber-300" : "border-white/12 text-white/58"}`}><img src="/txline-logo.svg" alt="TxLINE" className="h-3.5 w-auto opacity-90" /><span aria-hidden className="h-4 w-px bg-white/15" /><span className={`size-1.5 rounded-full ${pulse.providerState === "live" ? "bg-primary motion-safe:animate-pulse" : pulse.providerState === "unavailable" ? "bg-amber-300" : "bg-primary"}`} />{txline.label}</span>
        {review.kind === "available" ? <button type="button" onClick={onOpenReview} aria-label={t("shell.openReview")} className="hidden size-10 place-items-center border border-white/10 text-white/45 hover:border-primary hover:text-primary md:grid"><ShieldCheck className="size-4" /></button> : null}
        <LocaleSelector />
        <span title={identity ?? (locale === "pt-BR" ? "Visitante" : "Guest")} aria-label={identity ? `${locale === "pt-BR" ? "Perfil" : "Profile"}: ${identity}` : locale === "pt-BR" ? "Perfil de visitante" : "Guest profile"} className="hidden h-10 max-w-32 items-center gap-2 border border-white/10 px-3 text-white/58 xl:flex">{identity ? <><span className="grid size-5 place-items-center rounded-full bg-white/8 font-['DM_Mono'] text-[9px] font-black text-primary">{identity.slice(0, 1).toUpperCase()}</span><span className="truncate font-['DM_Mono'] text-[8px] font-bold uppercase">{identity}</span></> : <UserRound className="size-4" />}</span>
      </div>
    </div>
  </header>;
}

function sectionLabel(routeId: string, locale: "en" | "pt-BR") {
  const labels = locale === "pt-BR"
    ? { home: "Jornada da Copa", matches: "Briefing das partidas", "match-preview": "Briefing da partida", "match-picks": "VIRA Picks", "match-room": "Match Room", "judge-playback": "Playback certificado", help: "Guia de avaliação", "match-companion": "Companion" }
    : { home: "World Cup journey", matches: "Match briefing", "match-preview": "Match briefing", "match-picks": "VIRA Picks", "match-room": "Match Room", "judge-playback": "Certified playback", help: "Evaluation guide", "match-companion": "Companion" };
  return labels[routeId as keyof typeof labels] ?? "MY VIRA";
}

function presentPulse(pulse: MatchdayPulseV1, nowMs: number, context: Pick<LocaleContextValue, "locale" | "timeZone" | "formatDateTime" | "formatNumber" | "teamName"> & { connected: boolean }) {
  const pt = context.locale === "pt-BR";
  const home = pulse.homeTeam ? context.teamName(pulse.homeTeam) : null; const away = pulse.awayTeam ? context.teamName(pulse.awayTeam) : null;
  const matchup = home && away ? `${home} × ${away}` : pulse.champion ? `${context.teamName(pulse.champion)} · ${pt ? "campeã" : "champions"}` : pt ? "Copa do Mundo" : "World Cup";
  const score = pulse.homeScore !== null && pulse.awayScore !== null ? `${context.formatNumber(pulse.homeScore)}–${context.formatNumber(pulse.awayScore)}` : null;
  const clock = pulse.matchClockSec !== null ? `${context.formatNumber(Math.floor(pulse.matchClockSec / 60))}′` : null;
  const connected = context.connected ? (pt ? "conectado" : "connected") : (pt ? "reconectando" : "reconnecting");
  const stage = pulse.stage === "semi_final" ? (pt ? "semifinal" : "semifinal") : pulse.stage === "third_place" ? (pt ? "terceiro lugar" : "third place") : pulse.stage === "final" ? "final" : null;
  if (pulse.kind === "round_open") {
    const seconds = pulse.roundLocksAt ? Math.max(0, Math.ceil((Date.parse(pulse.roundLocksAt) - nowMs) / 1_000)) : 0;
    const secondary = `${pt ? "Rodada aberta" : "Round open"} · ${pt ? "responda em" : "answer within"} ${context.formatNumber(seconds)}s`;
    return { primary: `${matchup}${score ? ` · ${score}` : ""}`, secondary, aria: `${matchup}. ${secondary}` };
  }
  if (pulse.kind === "captured_playback") {
    const secondary = pt ? "TxLINE capturada · playback certificado" : "Captured TxLINE · certified playback";
    return { primary: matchup, secondary, aria: `${matchup}. ${secondary}` };
  }
  if (pulse.kind === "live") {
    const status = pulse.fixtureStatus === "paused" ? (pt ? "pausada" : "paused") : (pt ? "ao vivo" : "live");
    const population = pulse.roomPopulation !== null ? ` · ${context.formatNumber(pulse.roomPopulation)} ${pt ? "na sala" : "in room"}` : "";
    const secondary = `${status}${clock ? ` · ${clock}` : ""} · ${connected}${population}`;
    return { primary: score ? `${home} ${score} ${away}` : matchup, secondary, aria: `${matchup}. ${secondary}` };
  }
  if (pulse.kind === "upcoming") {
    const countdown = pulse.kickoffAt ? compactCountdown(Date.parse(pulse.kickoffAt) - nowMs, context.locale) : null;
    const kickoff = pulse.kickoffAt ? context.formatDateTime(pulse.kickoffAt, { timeZone: context.timeZone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : null;
    const secondary = [stage, countdown ?? kickoff ?? (pt ? "agendada" : "scheduled")].filter(Boolean).join(" · ");
    return { primary: matchup, secondary, aria: `${matchup}. ${secondary}` };
  }
  if (pulse.kind === "final") {
    const secondary = pulse.verified ? (pt ? "Final · resultado verificado" : "Final · result verified") : (pt ? "Final · resultado oficial" : "Final · official result");
    return { primary: score ? `${home} ${score} ${away}` : matchup, secondary, aria: `${matchup}. ${secondary}` };
  }
  if (pulse.kind === "exceptional") {
    const states: Record<string, [string, string]> = { paused: ["Paused", "Pausada"], postponed: ["Postponed", "Adiada"], cancelled: ["Cancelled", "Cancelada"], unknown: ["Status unavailable", "Status indisponível"] };
    const secondary = states[pulse.fixtureStatus ?? "unknown"]?.[pt ? 1 : 0] ?? (pt ? "Status indisponível" : "Status unavailable");
    return { primary: matchup, secondary, aria: `${matchup}. ${secondary}` };
  }
  const secondary = pulse.champion ? (pt ? "Torneio concluído" : "Tournament complete") : (pt ? "Torneio em andamento" : "Tournament active");
  return { primary: matchup, secondary, aria: `${matchup}. ${secondary}` };
}

function compactCountdown(ms: number, locale: "en" | "pt-BR") {
  if (!Number.isFinite(ms) || ms <= 0) return locale === "pt-BR" ? "começa em breve" : "starting soon";
  const totalMinutes = Math.floor(ms / 60_000); const days = Math.floor(totalMinutes / 1_440); const hours = Math.floor((totalMinutes % 1_440) / 60); const minutes = totalMinutes % 60;
  if (days > 0) return `${locale === "pt-BR" ? "em" : "in"} ${days}d ${String(hours).padStart(2, "0")}h`;
  return `${locale === "pt-BR" ? "em" : "in"} ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m`;
}

function providerLabel(pulse: MatchdayPulseV1, nowMs: number, locale: "en" | "pt-BR", connected: boolean) {
  const pt = locale === "pt-BR";
  if (pulse.providerState === "captured") return { label: pt ? "Capturada" : "Captured", detail: pt ? "Fixture TxLINE capturada e sanitizada." : "Sanitized captured TxLINE fixture." };
  if (pulse.providerState === "unavailable" || !connected) return { label: pt ? "Indisponível" : "Unavailable", detail: pt ? "A autoridade TxLINE não está disponível agora." : "TxLINE authority is not currently available." };
  if (pulse.providerState === "live") return { label: "Live", detail: pt ? "Sala conectada ao estado atual da partida." : "Room connected to the current match state." };
  const ageSec = pulse.providerUpdatedAt ? Math.max(0, Math.floor((nowMs - Date.parse(pulse.providerUpdatedAt)) / 1_000)) : null;
  const age = ageSec === null || !Number.isFinite(ageSec) ? null : ageSec < 60 ? `${ageSec}s` : ageSec < 3_600 ? `${Math.floor(ageSec / 60)}m` : `${Math.floor(ageSec / 3_600)}h`;
  return { label: age ? `${pt ? "Atualizada há" : "Updated"} ${age}${pt ? "" : " ago"}` : pt ? "Atualizada" : "Updated", detail: pt ? "Última aquisição pública confirmada." : "Last confirmed public acquisition." };
}

function RouteTransitionFrame() {
  const outlet = useOutlet();
  const location = useLocation();
  const { mode } = useShellExperience();
  const reduceMotion = useReducedMotion();
  const key = location.pathname;
  const previousPath = useRef(location.pathname);
  const transitionKind = resolveNavigationTransition(matchCurrentRoute(previousPath.current), matchCurrentRoute(location.pathname));
  useEffect(() => { previousPath.current = location.pathname; }, [location.pathname]);
  const animateRoute = !reduceMotion && transitionKind === "route";
  return <main data-navigation-transition={transitionKind} className={`w-full min-w-0 max-w-full overflow-x-clip ${mode === "discovery" ? "pb-[calc(var(--shell-mobile-dock-height)+var(--shell-continuity-height)+env(safe-area-inset-bottom)+24px)] lg:pb-[calc(var(--shell-continuity-height)+32px)]" : ""}`}><AnimatePresence mode="wait" initial={false}><motion.div className="w-full min-w-0 max-w-full" key={key} initial={animateRoute ? { opacity: 0, y: 14 } : { opacity: 1 }} animate={{ opacity: 1, y: 0 }} exit={animateRoute ? { opacity: 0, y: -6 } : { opacity: 1 }} transition={{ duration: animateRoute ? .24 : 0, ease: [.22, 1,.36, 1] }}>{outlet}</motion.div></AnimatePresence></main>;
}

function ActiveRoomContinuity({ onEnterRoom }: { onEnterRoom: (room: ShellActiveRoom) => void }) {
  const { activeRoom, mode } = useShellExperience();
  const { t, localizedHref, teamName } = useLocale();
  const [enteringRoom, setEnteringRoom] = useState(false);
  if (activeRoom.kind !== "confirmed" || mode === "immersive") return null;
  const room = activeRoom.room;
  const enter = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (enteringRoom) return;
    setEnteringRoom(true);
    onEnterRoom(room);
  };
  return <>
    <motion.aside aria-busy={enteringRoom} initial={{ opacity: 0, y: 24 }} animate={{ opacity: enteringRoom ? 0 : 1, y: enteringRoom ? 10 : 0 }} transition={{ duration: .2 }} className="fixed left-1/2 z-50 w-[min(580px,calc(100%-24px))] -translate-x-1/2 border border-primary/35 bg-[#07100b]/95 backdrop-blur-xl bottom-[calc(var(--shell-mobile-dock-height)+env(safe-area-inset-bottom)+12px)] lg:bottom-6 lg:left-auto lg:right-[max(24px,calc((100vw-1380px)/2))] lg:w-[510px] lg:translate-x-0">
      <Link to={localizedHref(`/match/${room.roomId}`)} onClick={enter} className="grid grid-cols-[auto_1fr_auto] items-center gap-4 p-4"><span className="relative grid size-11 place-items-center border border-primary/25"><motion.span animate={room.phase === "action_required" || room.phase === "answer_confirmed" ? { opacity: [.2, .8, .2], scale: [.7, 1.2, .7] } : undefined} transition={{ duration: 1.8, repeat: Infinity }} className="absolute size-7 border border-primary" /><span className="size-2 bg-primary" /></span><div className="min-w-0"><p className="truncate font-['DM_Mono'] text-[9px] font-black uppercase tracking-[.16em] text-primary">{t(`shell.roomPhase.${room.phase === "action_required" ? "actionRequired" : room.phase === "answer_confirmed" ? "answerConfirmed" : room.phase === "result_available" ? "resultAvailable" : room.phase}` as StaticTranslationKey)}</p><p className="mt-1 truncate text-sm font-black uppercase">{teamName(room.homeTeam)} x {teamName(room.awayTeam)}</p>{room.answerConfirmed ? <p className="mt-1 text-[9px] uppercase tracking-[.12em] text-white/40">{t("shell.answerConfirmed")}</p> : null}</div><span aria-hidden>-&gt;</span></Link>
    </motion.aside>
  </>;
}

function MobileContextDock({ onOpenReview }: { onOpenReview: () => void }) {
  const { mode, route, activeRoom, review } = useShellExperience();
  const { t, localizedHref } = useLocale();
  if (mode === "immersive") return null;
  const room = activeRoom.kind === "confirmed" ? activeRoom.room : null;
  const actions = [{ id: "home", label: t("navigation.home"), href: localizedHref("/"), active: route.id === "home" }, { id: "matches", label: t("navigation.matches"), href: localizedHref("/matches"), active: route.id === "matches" }, ...(room ? [{ id: "room", label: t("navigation.room"), href: localizedHref(`/match/${room.roomId}`), active: false }] : [])];
  const count = actions.length + (review.kind === "available" ? 1 : 0);
  const content = (id: string, label: string, active: boolean) => <>{active ? <motion.span layoutId="mobile-context-active" className="absolute top-0 h-[3px] w-10 bg-primary" /> : null}{id === "room" ? <span className="size-2 bg-primary" /> : id === "review" ? <ShieldCheck className="size-4 text-primary" /> : null}<span className={`font-['DM_Mono'] text-[9px] font-black uppercase tracking-[.12em] ${active ? "text-white" : "text-white/45"}`}>{label}</span></>;
  return <nav aria-label={t("navigation.contextual")} className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#050814]/95 backdrop-blur-xl lg:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}><div className="grid h-[var(--shell-mobile-dock-height)]" style={{ gridTemplateColumns: `repeat(${count},minmax(0,1fr))` }}>{actions.map((action) => <Link key={action.id} to={action.href} className="relative flex h-full flex-col items-center justify-center gap-1">{content(action.id, action.label, action.active)}</Link>)}{review.kind === "available" ? <button type="button" onClick={onOpenReview} className="relative flex h-full flex-col items-center justify-center gap-1">{content("review", t("navigation.review"), false)}</button> : null}</div></nav>;
}

function ShellConnectionSurface() {
  const { connection } = useShellExperience();
  const { t } = useLocale();
  if (connection.kind === "healthy") return null;
  const copyKeys: Record<typeof connection.kind, [StaticTranslationKey, StaticTranslationKey]> = {
    offline: ["shell.connection.offline.title", "shell.connection.offline.description"],
    backend_unavailable: ["shell.connection.backendUnavailable.title", "shell.connection.backendUnavailable.description"],
    txline_unavailable: ["shell.connection.txlineUnavailable.title", "shell.connection.txlineUnavailable.description"],
    room_reconnecting: ["shell.connection.txlineReconnecting.title", "shell.connection.txlineReconnecting.description"],
    txline_reconnecting: ["shell.connection.txlineReconnecting.title", "shell.connection.txlineReconnecting.description"],
  };
  const copy = copyKeys[connection.kind];
  return <aside role={connection.kind === "backend_unavailable" ? "alert" : "status"} className="fixed inset-x-0 top-0 z-[90] min-h-14 border-b border-amber-400/25 bg-[#171307]/97 px-4 py-3"><div className="mx-auto max-w-[1500px]"><p className="font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.14em] text-amber-300">{t(copy[0])}</p><p className="mt-1 text-xs text-white/50">{t(copy[1])}</p></div></aside>;
}

function ShellReadinessLayer() {
  const shell = useShellExperience();
  const { t } = useLocale();
  const { readiness } = shell;
  if (readiness.kind === "ready" || ("scope" in readiness && readiness.scope === "background")) return null;
  if (readiness.kind === "integrity_failed") return <div role="alert" className="fixed inset-0 z-[120] grid place-items-center bg-[#050814] px-5 text-center"><div><p className="font-['DM_Mono'] text-[10px] uppercase text-red-400">{t("shell.integrity.label")}</p><h1 className="mt-5 font-['Chakra_Petch'] text-5xl font-black uppercase">{t("shell.integrity.title")}</h1><p className="mt-4 text-white/50">{t("shell.integrity.description")}</p></div></div>;
  const labels: Record<string, StaticTranslationKey> = { booting: "shell.readiness.booting", hydrating_room: "shell.readiness.hydratingRoom", replaying_ledger: "shell.readiness.replayingLedger", verifying_projection: "shell.readiness.verifyingProjection" };
  const steps = [
    { label: t("shell.step.browser"), complete: shell.connectivity.browser === "online" },
    { label: t("shell.step.backend"), complete: shell.connectivity.backend === "healthy" },
    { label: t("shell.step.session"), complete: shell.activeRoom.kind !== "revalidating" },
  ];
  return <div className="fixed inset-0 z-[120] grid place-items-center bg-[#050814]"><ViraLoader size={150} label={t(labels[readiness.kind])} /><div className="absolute bottom-10 left-1/2 grid w-[min(440px,calc(100%-40px))] -translate-x-1/2 grid-cols-3 gap-2">{steps.map((step) => <div key={step.label}><div className={`h-[2px] ${step.complete ? "bg-primary" : "bg-white/10"}`} /><p className={`mt-2 font-['DM_Mono'] text-[9px] font-black uppercase tracking-[.12em] ${step.complete ? "text-white" : "text-white/30"}`}>{step.label}</p></div>)}</div></div>;
}
