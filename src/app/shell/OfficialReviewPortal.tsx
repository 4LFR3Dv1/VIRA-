import { ArrowLeft, Check, CheckCircle2, Clock3, Loader2, LockKeyhole, Radio, ShieldCheck, Trophy, Users, X, XCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { PublicDomainEvent, RoundCommitmentStatus, RoomSnapshot, RoomVerification, VerifiedRoundReplayV1 } from "../../domain/types.ts";
import { useLocale } from "../../i18n/locale-context.tsx";
import { replayQuestion, replayResolutionLabel } from "../../i18n/replay-copy.ts";
import { stableOptionLabel } from "../../i18n/round-copy.ts";
import type { TranslateFunction } from "../../i18n/translate.ts";
import { fetchPublicRoomEvents, fetchPublicRoomProjection, fetchRoomVerification, fetchRoundCommitment, fetchVerifiedRoundReplay } from "../../runtime/api.ts";
import { deriveReviewConclusions } from "./review-summary.ts";

interface Props { open: boolean; roomId: string | null; onClose: () => void }
type Verdict = { kind: "verified" | "pending" | "failed"; title: string; reason: string };

function deriveVerdict(t: TranslateFunction, verification: RoomVerification | null, replay: VerifiedRoundReplayV1 | null, failed: boolean): Verdict {
  if (failed) return { kind: "failed", title: t("review.verdict.failed.title"), reason: t("review.verdict.failed.reason") };
  if (!verification || !replay) return { kind: "pending", title: t("review.verdict.pending.title"), reason: t("review.verdict.pending.noReplay") };
  const proof = replay.proof;
  if (proof.hashChainValid && proof.projectionMatches && proof.rankingMatches && proof.authorityValid && proof.temporalIntegrityValid && proof.eligibilityValid && proof.determinismValid) return { kind: "verified", title: t("review.verdict.verified.title"), reason: t("review.verdict.verified.reason") };
  return { kind: "pending", title: t("review.verdict.pending.title"), reason: t("review.verdict.pending.mismatch") };
}

function latestResolvedRoundId(events: PublicDomainEvent[]) {
  return events.filter((event) => event.type === "round.resolved").sort((a, b) => b.streamVersion - a.streamVersion)[0]?.payload?.roundId as string | undefined;
}

function shortHash(value: string | null | undefined) {
  if (!value) return "--";
  return value.length > 25 ? `${value.slice(0, 14)}...${value.slice(-8)}` : value;
}

export function OfficialReviewPortal({ open, roomId, onClose }: Props) {
  const { formatPercent, t } = useLocale();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [verification, setVerification] = useState<RoomVerification | null>(null);
  const [projection, setProjection] = useState<RoomSnapshot | null>(null);
  const [events, setEvents] = useState<PublicDomainEvent[]>([]);
  const [replay, setReplay] = useState<VerifiedRoundReplayV1 | null>(null);
  const [commitment, setCommitment] = useState<RoundCommitmentStatus | null>(null);

  useEffect(() => {
    if (!open || !roomId) return;
    let cancelled = false;
    setState("loading"); setReplay(null); setCommitment(null);
    Promise.all([fetchRoomVerification(roomId), fetchPublicRoomProjection(roomId), fetchPublicRoomEvents(roomId)]).then(async ([nextVerification, nextProjection, nextEvents]) => {
      const roundId = latestResolvedRoundId(nextEvents.events);
      const [nextReplay, nextCommitment] = roundId ? await Promise.all([fetchVerifiedRoundReplay(roomId, roundId), fetchRoundCommitment(roomId, roundId)]) : [null, null];
      if (cancelled) return;
      setVerification(nextVerification); setProjection(nextProjection); setEvents(nextEvents.events); setReplay(nextReplay); setCommitment(nextCommitment); setState("ready");
    }).catch(() => !cancelled && setState("error"));
    return () => { cancelled = true; };
  }, [open, roomId]);

  useEffect(() => {
    if (!open || !roomId || !replay || !commitment || !["pending", "confirming"].includes(commitment.status)) return;
    const timer = window.setTimeout(() => void fetchRoundCommitment(roomId, replay.roundId).then(setCommitment).catch(() => undefined), 2_000);
    return () => window.clearTimeout(timer);
  }, [commitment, open, replay, roomId]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button,[href],[tabindex]:not([tabindex="-1"])');
      if (!focusable?.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.body.style.overflow = "hidden"; window.addEventListener("keydown", keydown); window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", keydown); previous?.focus(); };
  }, [onClose, open]);

  if (!open || !roomId) return null;
  const verdict = deriveVerdict(t, verification, replay, state === "error");
  const verified = verdict.kind === "verified";
  return createPortal(<AnimatePresence><motion.div className="fixed inset-0 z-[110] bg-[#050814]/80 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <motion.aside ref={dialogRef} role="dialog" aria-modal="true" aria-label={t("review.ariaLabel")} initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", stiffness: 320, damping: 34 }} className="ml-auto h-dvh w-full max-w-[760px] overflow-y-auto border-l border-white/10 bg-[#080d19] p-5 md:p-7">
      <header className="flex items-start justify-between gap-5 border-b border-white/15 pb-5"><div><p className="font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.18em] text-primary">{t("review.kicker")} {replay?.schemaVersion ? `V${replay.schemaVersion}` : ""}</p><h2 className="mt-2 font-['Chakra_Petch'] text-3xl font-black uppercase">{t("review.title")}</h2><p className="mt-2 text-sm text-white/45">{t("review.subtitle")}</p></div><button ref={closeRef} onClick={onClose} aria-label={t("review.close")} className="grid size-10 shrink-0 place-items-center border border-white/15 hover:border-primary hover:text-primary"><ArrowLeft className="size-4" /></button></header>
      {state === "loading" ? <div className="grid min-h-80 place-items-center"><Loader2 className="size-6 animate-spin text-primary" /></div> : null}
      {state === "error" ? <div role="alert" className="mt-6 border border-red-400/30 bg-red-400/10 p-5"><p className="font-black uppercase text-red-300">{t("review.unavailable")}</p><p className="mt-2 text-sm text-white/45">{t("review.apiUnavailable")}</p></div> : null}
      {state === "ready" ? <>
        <section className={`mt-6 border p-5 ${verified ? "border-primary/35 bg-primary/[.05]" : "border-amber-400/35 bg-amber-400/[.05]"}`}><div className="flex items-start gap-3">{verified ? <CheckCircle2 className="mt-1 size-6 shrink-0 text-primary" /> : <XCircle className="mt-1 size-6 shrink-0 text-amber-300" />}<div><p className="font-['DM_Mono'] text-[9px] uppercase text-white/40">{t("review.statusLabel")}</p><h3 className="font-['Chakra_Petch'] text-2xl font-black uppercase">{verdict.title}</h3><p className="mt-2 text-sm text-white/50">{verdict.reason}</p></div></div>{replay ? <div className="mt-5 grid gap-px bg-white/10 md:grid-cols-3">{deriveReviewConclusions(t, replay).map((item) => <Conclusion key={item.id} {...item} />)}</div> : null}</section>
        <section className="mt-6"><p className="font-['DM_Mono'] text-[10px] uppercase tracking-[.16em] text-primary">{t("review.matchReviewed")}</p><div className="mt-3 flex items-center justify-between border-y border-white/15 py-5"><strong className="font-['Chakra_Petch'] text-xl font-black uppercase">{projection?.match.homeTeam.name} x {projection?.match.awayTeam.name}</strong><strong className="font-['Chakra_Petch'] text-3xl font-black">{projection?.match.homeScore}:{projection?.match.awayScore}</strong></div></section>
        {replay ? <details className="mt-7 border border-white/10"><summary className="cursor-pointer px-5 py-4 font-['Chakra_Petch'] text-lg font-black uppercase text-primary">{t("review.details")}</summary><div className="border-t border-white/10 px-5 pb-6"><ReplayEvidence replay={replay} projection={projection} events={events} commitment={commitment} t={t} formatPercent={formatPercent} /></div></details> : <section className="mt-7 border border-white/10 p-5"><p className="font-['Chakra_Petch'] text-xl font-black uppercase">{t("review.noResolvedRound")}</p><p className="mt-2 text-sm text-white/45">{t("review.noResolvedRoundDescription")}</p></section>}
        <details className="mt-5 border border-white/10"><summary className="cursor-pointer px-4 py-3 font-['DM_Mono'] text-[9px] uppercase tracking-[.12em] text-white/35">{t("review.publicLedger", { count: events.length })}</summary><ol className="max-h-72 overflow-y-auto border-t border-white/10 px-4">{events.slice().reverse().map((event) => <li key={event.eventId} className="border-b border-white/10 py-3"><p className="font-['DM_Mono'] text-[9px] uppercase text-white/60">{event.type}</p><p className="mt-1 break-all font-['DM_Mono'] text-[9px] text-white/25">{event.eventId}</p></li>)}</ol></details>
      </> : null}
    </motion.aside></motion.div></AnimatePresence>, document.body);
}

function ReplayEvidence({ replay, projection, events, commitment, t, formatPercent }: { replay: VerifiedRoundReplayV1; projection: RoomSnapshot | null; events: PublicDomainEvent[]; commitment: RoundCommitmentStatus | null; t: TranslateFunction; formatPercent: (value: number, options?: Intl.NumberFormatOptions) => string }) {
  const option = stableOptionLabel(t, replay.resolution.winningOptionId);
  return <><section className="mt-8"><div className="flex items-end justify-between gap-4"><div><p className="font-['DM_Mono'] text-[10px] uppercase tracking-[.16em] text-primary">{t("review.timeline")}</p><h3 className="mt-1 font-['Chakra_Petch'] text-2xl font-black uppercase">{t("review.timelineTitle")}</h3></div><ShieldCheck className="size-5 text-primary" /></div><ol className="mt-5 border-t border-white/15">
    <TimelineItem icon={Clock3} label={t("review.roundOpened")} title={replayQuestion(t, replay, projection)} description={t("review.signalLock")} />
    <TimelineItem icon={Users} label={t("review.answersConfirmed", { count: replay.participation.confirmedAnswers })} title={t("review.choicesPrivate")} description={t("review.choicesPrivateDescription")} />
    <TimelineItem icon={LockKeyhole} label={t("review.roundLocked")} title={t("review.noMoreAnswers")} description={t(replay.lock.reason === "deadline" ? "review.deadlineLock" : "review.signalLock")} />
    <TimelineItem icon={Radio} label={t(replay.resolutionDomain === "football" ? "review.officialObservation" : "review.newSignal")} title={replayResolutionLabel(t, replay, formatPercent)} description={t("review.providerSequence", { sequence: String(replay.resolution.providerSequence ?? "--") })} />
    <TimelineItem icon={Check} label={t("review.ruleApplied")} title={t("review.optionWon", { option })} description={t("review.invariant.determinismDescription")} />
    <TimelineItem icon={Trophy} label={t("review.rankingUpdated")} title={t("review.answersEvaluated", { evaluated: replay.scoring.answersEvaluated, correct: replay.scoring.answersCorrect })} description={t("review.pointsApplied", { points: replay.scoring.totalPointsApplied })} />
  </ol></section>
  <section className="mt-8"><p className="font-['DM_Mono'] text-[10px] uppercase tracking-[.16em] text-primary">{t("review.invariants")}</p><h3 className="mt-1 font-['Chakra_Petch'] text-2xl font-black uppercase">{t("review.guarantees")}</h3><div className="mt-4 grid gap-px bg-white/10 sm:grid-cols-2"><Invariant label={t("review.invariant.authority")} valid={replay.proof.authorityValid} description={t("review.invariant.authorityDescription", { origin: replay.resolution.acquisitionOrigin })} t={t} /><Invariant label={t("review.invariant.temporality")} valid={replay.proof.temporalIntegrityValid} description={t("review.invariant.temporalityDescription")} t={t} /><Invariant label={t("review.invariant.eligibility")} valid={replay.proof.eligibilityValid} description={t("review.invariant.eligibilityDescription")} t={t} /><Invariant label={t("review.invariant.determinism")} valid={replay.proof.determinismValid} description={t("review.invariant.determinismDescription")} t={t} /><Invariant label={t("review.invariant.reproducibility")} valid={replay.proof.hashChainValid && replay.proof.projectionMatches && replay.proof.rankingMatches} description={t("review.invariant.reproducibilityDescription")} t={t} /></div></section>
  <SolanaCommitment commitment={commitment} replayHash={replay.replayHash} t={t} />
  <details className="mt-8 border border-white/10"><summary className="cursor-pointer px-4 py-4 font-['DM_Mono'] text-[9px] uppercase tracking-[.12em] text-white/50">{t("review.technicalDetails", { version: replay.roundVersion })}</summary><dl className="grid border-t border-white/10 sm:grid-cols-2"><Technical label={t("review.technical.roundId")} value={replay.roundId} /><Technical label={t("review.technical.streamRange")} value={`${replay.proof.firstStreamVersion} → ${replay.proof.lastStreamVersion}`} /><Technical label={t("review.technical.marketSignature")} value={replay.prompt.marketSignature} /><Technical label={t("review.technical.providerSequence")} value={String(replay.resolution.providerSequence ?? "--")} /><Technical label={t("review.technical.lock")} value={replay.lock.lockedAt} /><Technical label={t("review.technical.causation")} value={replay.technical.causationId ?? "--"} /><Technical label={t("review.technical.correlation")} value={replay.technical.correlationId ?? "--"} /><Technical label={t("review.technical.roundRangeHash")} value={shortHash(replay.proof.roundEventRangeHash)} /><Technical label={t("review.technical.leaderboardBefore")} value={shortHash(replay.scoring.leaderboardBeforeHash)} /><Technical label={t("review.technical.leaderboardAfter")} value={shortHash(replay.scoring.leaderboardAfterHash)} /><Technical label={t("review.technical.publicEvents")} value={String(events.length)} /></dl></details></>;
}

function TimelineItem({ icon: Icon, label, title, description }: { icon: typeof Clock3; label: string; title: string; description: string }) { return <li className="grid grid-cols-[40px_1fr] gap-4 border-b border-white/15 py-5"><span className="grid size-10 place-items-center border border-primary/30 text-primary"><Icon className="size-4" /></span><div><p className="font-['DM_Mono'] text-[9px] font-black uppercase tracking-[.14em] text-primary">{label}</p><strong className="mt-1 block text-sm uppercase">{title}</strong><p className="mt-1 text-xs leading-relaxed text-white/40">{description}</p></div></li>; }
function Conclusion({ label, copy, valid }: { label: string; copy: string; valid: boolean }) { return <article className="bg-[#080d19] p-4"><p className="font-['DM_Mono'] text-[9px] uppercase tracking-[.12em] text-white/35">{label}</p><p className="mt-2 text-xs leading-5 text-white/65">{copy}</p><span className={`mt-3 block h-1 w-8 ${valid ? "bg-primary" : "bg-amber-300"}`} /></article>; }
function Invariant({ label, valid, description, t }: { label: string; valid: boolean; description: string; t: TranslateFunction }) { return <article className="bg-[#080d19] p-4"><div className="flex items-center gap-2">{valid ? <Check className="size-4 text-primary" /> : <X className="size-4 text-red-300" />}<strong className="text-xs uppercase">{label}</strong></div><p className="mt-2 text-xs leading-relaxed text-white/40">{description}</p><p className={`mt-3 font-['DM_Mono'] text-[9px] uppercase ${valid ? "text-primary" : "text-red-300"}`}>{t(valid ? "review.valid" : "review.pending")}</p></article>; }
function Technical({ label, value }: { label: string; value: string }) { return <div className="min-w-0 border-b border-white/10 p-4 sm:border-r"><dt className="font-['DM_Mono'] text-[9px] uppercase text-white/30">{label}</dt><dd className="mt-1 break-all font-['DM_Mono'] text-[10px] text-white/65">{value}</dd></div>; }

function SolanaCommitment({ commitment, replayHash, t }: { commitment: RoundCommitmentStatus | null; replayHash: string; t: TranslateFunction }) {
  const confirmed = commitment?.status === "confirmed"; const matched = confirmed && commitment.replayHash === replayHash && commitment.onChainMatches !== false;
  const statusKey = `review.solana.${commitment?.status ?? "unsupported"}` as "review.solana.unsupported";
  const description = confirmed ? t("review.solana.confirmedDescription") : commitment?.status === "failed" ? t("review.solana.failedDescription") : commitment?.status === "unsupported" ? t("review.solana.unsupportedDescription") : t("review.solana.processingDescription");
  return <section className="mt-8 border border-white/10 p-5"><div className="flex items-start justify-between gap-4"><div><p className="font-['DM_Mono'] text-[10px] uppercase tracking-[.16em] text-primary">{t("review.solana.title")}</p><h3 className="mt-1 font-['Chakra_Petch'] text-2xl font-black uppercase">{t(statusKey)}</h3></div><span className={`border px-3 py-1 font-['DM_Mono'] text-[9px] uppercase ${matched ? "border-primary/35 text-primary" : "border-white/15 text-white/40"}`}>{matched ? t("review.solana.match") : commitment?.network ?? "DEVNET"}</span></div><p className="mt-3 text-sm text-white/45">{description}</p>{commitment?.commitmentHash ? <p className="mt-4 break-all font-['DM_Mono'] text-[9px] text-white/30">COMMITMENT {commitment.commitmentHash}</p> : null}{confirmed ? <div className="mt-4 grid gap-px bg-white/10 sm:grid-cols-2"><Metric label={t("review.solana.local")} value={matched ? "MATCH" : t("review.solana.diverged")} /><Metric label={t("review.solana.onChain")} value={matched ? "MATCH" : t("review.pending")} /></div> : null}{commitment?.explorerUrl ? <a href={commitment.explorerUrl} target="_blank" rel="noreferrer" className="mt-5 inline-flex min-h-11 items-center border border-primary/35 px-4 font-['DM_Mono'] text-[9px] font-black uppercase tracking-[.12em] text-primary">{t("review.solana.explorer")}</a> : null}</section>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div className="bg-[#080d19] p-3"><span className="block font-['DM_Mono'] text-[9px] uppercase text-white/35">{label}</span><strong className="mt-1 block text-xs text-primary">{value}</strong></div>; }
