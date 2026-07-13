import { ArrowLeft, Radio, ShieldCheck, UserRound } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useLocation, useNavigate, useOutlet } from "react-router";

import { ViraLoader } from "../../shared/brand/ViraLoader";
import { LocaleSelector } from "../../i18n/LocaleSelector.tsx";
import { useLocale } from "../../i18n/locale-context.tsx";
import type { StaticTranslationKey } from "../../i18n/translate.ts";
import viraLogo from "../../shared/shell/logo.png";
import { useShellExperience } from "./ShellContext";
import { OfficialReviewPortal } from "./OfficialReviewPortal";
import { matchCurrentRoute } from "../routing/route-manifest";
import { resolveNavigationTransition } from "../routing/navigation-transition";
import type { ShellActiveRoom } from "./shell-experience";
import { OPEN_OFFICIAL_REVIEW_EVENT, SHELL_OVERLAY_STATE_EVENT } from "./shell-events";
import { ViraShellBackground } from "./ViraShellBackground";

export function ViraAppShell() {
  const shell = useShellExperience();
  const { localizedHref } = useLocale();
  const navigate = useNavigate();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [roomTakeover, setRoomTakeover] = useState<ShellActiveRoom | null>(null);
  const [restored, setRestored] = useState(false);
  const [externalOverlays, setExternalOverlays] = useState<Set<string>>(() => new Set());
  const previousConnection = useRef(shell.connection.kind);
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
  const currentFixtureId = location.pathname.match(/^\/match\/([^/]+)/)?.[1] ?? null;
  const activeFixtureId = shell.activeRoom.kind === "confirmed" ? shell.activeRoom.room.fixtureId : null;
  const overlayOpen = reviewOpen || externalOverlays.size > 0;
  const continuityVisible = shell.activeRoom.kind === "confirmed" && shell.mode !== "immersive" && !overlayOpen && activeFixtureId !== currentFixtureId;
  const style = { "--shell-alert-height": alertVisible ? "56px" : "0px", "--shell-mobile-dock-height": shell.mode === "immersive" ? "0px" : "68px", "--shell-continuity-height": continuityVisible ? "92px" : "0px" } as CSSProperties;
  return <LayoutGroup id="vira-shell"><div data-shell-mode={shell.mode} data-shell-alert={alertVisible ? "visible" : "hidden"} data-active-room={continuityVisible ? "visible" : "hidden"} style={style} className="vira-app-shell">
    <ViraShellBackground paused={overlayOpen || Boolean(roomTakeover)} />
    <div className="vira-app-shell__content">
    <ShellSignalRail />
    <ShellConnectionSurface />
    <ConnectionRestoredNotice open={restored} />
    <ShellHeader onOpenReview={() => setReviewOpen(true)} />
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
  const { t } = useLocale();
  return <AnimatePresence>{room ? <motion.div className="fixed inset-0 z-[105] grid place-items-center overflow-hidden bg-[#050814] px-5" initial={{ clipPath: "inset(100% 0 0 0)" }} animate={{ clipPath: "inset(0% 0 0 0)" }} exit={{ opacity: 0 }} transition={{ duration: .4, ease: [.76, 0, .24, 1] }}>
    <div aria-hidden className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.04)_1px,transparent_1px)] [background-size:100%_90px,140px_100%]" />
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .14, duration: .24 }} className="relative text-center"><h2 className="font-['Chakra_Petch'] text-[clamp(2.8rem,8vw,7rem)] font-black uppercase leading-[.8]">{room.homeTeam}<span className="mx-3 text-primary">x</span>{room.awayTeam}</h2><p className="mt-7 font-['DM_Mono'] text-[10px] uppercase tracking-[.14em] text-white/40">{t("shell.returningToRoom")}</p></motion.div>
  </motion.div> : null}</AnimatePresence>;
}

function ShellSignalRail() {
  const { connection, readiness } = useShellExperience();
  const { t } = useLocale();
  const reduceMotion = useReducedMotion();
  if (readiness.kind === "integrity_failed") return <div aria-label={t("shell.signal.integrityFailed")} className="fixed inset-x-0 top-0 z-[100] h-[3px] bg-red-500" />;
  if (connection.kind === "healthy") return <div aria-label={t("shell.signal.systemConfirmed")} className="fixed inset-x-0 top-0 z-[100] h-[2px] bg-primary" />;
  if (connection.kind === "room_reconnecting" || connection.kind === "txline_reconnecting") return <div aria-label={t("shell.signal.reconnecting")} className="fixed inset-x-0 top-0 z-[100] h-[3px] overflow-hidden bg-white/10"><motion.div animate={reduceMotion ? undefined : { x: ["-100%", "300%"] }} transition={reduceMotion ? undefined : { duration: 1.4, repeat: Infinity, ease: "linear" }} className="h-full w-1/3 bg-primary" /></div>;
  return <div aria-label={t("shell.signal.unavailable")} className="fixed inset-x-0 top-0 z-[100] h-[3px] bg-amber-400" />;
}

function ShellHeader({ onOpenReview }: { onOpenReview: () => void }) {
  const { mode, route, connection, activeRoom, review } = useShellExperience();
  const { t, localizedHref } = useLocale();
  if (mode === "immersive") return null;
  const confirmedRoom = activeRoom.kind === "confirmed" ? activeRoom.room : null;
  return <header style={{ top: "var(--shell-alert-height)" }} className="sticky z-40 border-b border-white/10 bg-[#050814]/92 backdrop-blur-xl">
    <div className="mx-auto flex h-[72px] max-w-[1720px] items-center px-4 lg:px-7">
      {mode === "game" && route.backPath ? <Link to={localizedHref(route.backPath)} aria-label={t("shell.back")} className="grid size-10 place-items-center border border-white/15 hover:border-primary hover:text-primary"><ArrowLeft className="size-4" /></Link> : <Link to={localizedHref("/")} aria-label="VIRA"><img src={viraLogo} alt="VIRA" className="h-14 w-auto object-contain" /></Link>}
      <div className="ml-4 min-w-0 border-l border-white/10 pl-4"><motion.p key={`${route.id}:${route.titleKey}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="truncate font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.16em]">{t(route.titleKey)}</motion.p>{route.contextKey ? <p className="mt-1 truncate text-[10px] uppercase tracking-[.12em] text-white/40">{t(route.contextKey)}</p> : null}</div>
      <div className="ml-auto flex items-center gap-2">
        <span className={`hidden h-10 items-center gap-2 border px-3 font-['DM_Mono'] text-[9px] uppercase sm:inline-flex ${connection.kind === "healthy" ? "border-primary/25 text-primary" : "border-amber-400/30 text-amber-300"}`}><Radio className="size-3" />{connection.kind === "healthy" ? "TxLINE" : t("shell.reconnecting")}</span>
        {confirmedRoom ? <Link to={localizedHref(`/match/${confirmedRoom.roomId}`)} className="hidden h-10 items-center gap-2 border border-primary/25 px-3 md:flex"><span className="size-2 bg-primary" /><span className="max-w-36 truncate font-['DM_Mono'] text-[9px] uppercase">{t(`shell.roomPhase.${confirmedRoom.phase === "action_required" ? "actionRequired" : confirmedRoom.phase === "answer_confirmed" ? "answerConfirmed" : confirmedRoom.phase === "result_available" ? "resultAvailable" : confirmedRoom.phase}` as StaticTranslationKey)}</span></Link> : null}
        {review.kind === "available" ? <button type="button" onClick={onOpenReview} aria-label={t("shell.openReview")} className="hidden size-10 place-items-center border border-white/10 text-white/45 hover:border-primary hover:text-primary md:grid"><ShieldCheck className="size-4" /></button> : null}
        <LocaleSelector />
        <span className="hidden size-10 place-items-center border border-white/10 text-white/50 sm:grid"><UserRound className="size-4" /></span>
      </div>
    </div>
  </header>;
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
  const { t, localizedHref } = useLocale();
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
      <Link to={localizedHref(`/match/${room.roomId}`)} onClick={enter} className="grid grid-cols-[auto_1fr_auto] items-center gap-4 p-4"><span className="relative grid size-11 place-items-center border border-primary/25"><motion.span animate={room.phase === "action_required" || room.phase === "answer_confirmed" ? { opacity: [.2, .8, .2], scale: [.7, 1.2, .7] } : undefined} transition={{ duration: 1.8, repeat: Infinity }} className="absolute size-7 border border-primary" /><span className="size-2 bg-primary" /></span><div className="min-w-0"><p className="truncate font-['DM_Mono'] text-[9px] font-black uppercase tracking-[.16em] text-primary">{t(`shell.roomPhase.${room.phase === "action_required" ? "actionRequired" : room.phase === "answer_confirmed" ? "answerConfirmed" : room.phase === "result_available" ? "resultAvailable" : room.phase}` as StaticTranslationKey)}</p><p className="mt-1 truncate text-sm font-black uppercase">{room.homeTeam} x {room.awayTeam}</p>{room.answerConfirmed ? <p className="mt-1 text-[9px] uppercase tracking-[.12em] text-white/40">{t("shell.answerConfirmed")}</p> : null}</div><span aria-hidden>-&gt;</span></Link>
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
