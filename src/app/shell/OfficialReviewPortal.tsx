import { ArrowLeft, Check, CheckCircle2, Clock3, Loader2, LockKeyhole, Radio, ShieldCheck, Trophy, Users, X, XCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { PublicDomainEvent, RoundCommitmentStatus, RoomSnapshot, RoomVerification, VerifiedRoundReplayV1 } from "../../domain/types";
import { fetchPublicRoomEvents, fetchPublicRoomProjection, fetchRoomVerification, fetchRoundCommitment, fetchVerifiedRoundReplay } from "../../runtime/api";

interface Props { open: boolean; roomId: string | null; onClose: () => void }
type VerificationVerdict = { kind: "verified" | "pending" | "failed"; title: string; reason: string };

function deriveVerdict(verification: RoomVerification | null, replay: VerifiedRoundReplayV1 | null, loadFailed = false): VerificationVerdict {
  if (loadFailed) return { kind: "failed", title: "Verificação falhou", reason: "As APIs públicas não responderam e o resultado não pôde ser conferido." };
  if (!verification || !replay) return { kind: "pending", title: "Verificação pendente", reason: "Uma rodada resolvida ainda não foi materializada como replay público." };
  const proof = replay.proof;
  if (proof.hashChainValid && proof.projectionMatches && proof.rankingMatches && proof.authorityValid && proof.temporalIntegrityValid && proof.eligibilityValid && proof.determinismValid) {
    return { kind: "verified", title: "Resultado reproduzível", reason: "Origem, janela competitiva, regra, ledger, projeção e ranking correspondem ao replay público." };
  }
  return { kind: "pending", title: "Verificação pendente", reason: "Um ou mais invariantes ainda não correspondem integralmente ao replay público." };
}

function latestResolvedRoundId(events: PublicDomainEvent[]) {
  return events.filter((event) => event.type === "round.resolved").sort((a, b) => b.streamVersion - a.streamVersion)[0]?.payload?.roundId as string | undefined;
}

function pct(value: number | null) {
  return value === null ? "--" : `${value.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function shortHash(value: string | null | undefined) {
  if (!value) return "--";
  return value.length > 25 ? `${value.slice(0, 14)}...${value.slice(-8)}` : value;
}

export function OfficialReviewPortal({ open, roomId, onClose }: Props) {
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
    setState("loading");
    setReplay(null);
    setCommitment(null);
    Promise.all([fetchRoomVerification(roomId), fetchPublicRoomProjection(roomId), fetchPublicRoomEvents(roomId)])
      .then(async ([nextVerification, nextProjection, nextEvents]) => {
        const roundId = latestResolvedRoundId(nextEvents.events);
        const [nextReplay, nextCommitment] = roundId
          ? await Promise.all([fetchVerifiedRoundReplay(roomId, roundId), fetchRoundCommitment(roomId, roundId)])
          : [null, null];
        if (cancelled) return;
        setVerification(nextVerification);
        setProjection(nextProjection);
        setEvents(nextEvents.events);
        setReplay(nextReplay);
        setCommitment(nextCommitment);
        setState("ready");
      })
      .catch(() => !cancelled && setState("error"));
    return () => { cancelled = true; };
  }, [open, roomId]);

  useEffect(() => {
    if (!open || !roomId || !replay || !commitment || !["pending", "confirming"].includes(commitment.status)) return;
    const timer = window.setTimeout(() => {
      void fetchRoundCommitment(roomId, replay.roundId).then(setCommitment).catch(() => undefined);
    }, 2_000);
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
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", keydown);
    window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", keydown); previous?.focus(); };
  }, [onClose, open]);

  if (!open || !roomId) return null;
  const verdict = deriveVerdict(verification, replay, state === "error");
  const verified = verdict.kind === "verified";

  return createPortal(
    <AnimatePresence>
      <motion.div className="fixed inset-0 z-[110] bg-[#050814]/80 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <motion.aside ref={dialogRef} role="dialog" aria-modal="true" aria-label="Revisão Oficial VIRA" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", stiffness: 320, damping: 34 }} className="ml-auto h-dvh w-full max-w-[760px] overflow-y-auto border-l border-white/10 bg-[#080d19] p-5 md:p-7">
          <header className="flex items-start justify-between gap-5 border-b border-white/15 pb-5">
            <div><p className="font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.18em] text-primary">Replay verificável {replay?.schemaVersion ? `V${replay.schemaVersion}` : ""}</p><h2 className="mt-2 font-['Chakra_Petch'] text-3xl font-black uppercase">Revisão Oficial VIRA</h2><p className="mt-2 text-sm text-white/45">A causalidade primeiro. Os hashes e sequências permanecem disponíveis para auditoria.</p></div>
            <button ref={closeRef} onClick={onClose} aria-label="Fechar revisão" className="grid size-10 shrink-0 place-items-center border border-white/15 hover:border-primary hover:text-primary"><ArrowLeft className="size-4" /></button>
          </header>

          {state === "loading" ? <div className="grid min-h-80 place-items-center"><Loader2 className="size-6 animate-spin text-primary" /></div> : null}
          {state === "error" ? <div role="alert" className="mt-6 border border-red-400/30 bg-red-400/10 p-5"><p className="font-black uppercase text-red-300">Revisão indisponível</p><p className="mt-2 text-sm text-white/45">As APIs públicas não responderam agora.</p></div> : null}

          {state === "ready" ? <>
            <section className={`mt-6 border p-5 ${verified ? "border-primary/35 bg-primary/[.05]" : "border-amber-400/35 bg-amber-400/[.05]"}`}>
              <div className="flex items-start gap-3">{verified ? <CheckCircle2 className="mt-1 size-6 shrink-0 text-primary" /> : <XCircle className="mt-1 size-6 shrink-0 text-amber-300" />}<div><p className="font-['DM_Mono'] text-[9px] uppercase text-white/40">Veredito</p><h3 className="font-['Chakra_Petch'] text-2xl font-black uppercase">{verdict.title}</h3><p className="mt-2 text-sm text-white/50">{verdict.reason}</p>{replay ? <p className="mt-3 break-all font-['DM_Mono'] text-[9px] text-white/30">REPLAY {replay.replayHash}</p> : null}</div></div>
            </section>

            <section className="mt-6"><p className="font-['DM_Mono'] text-[10px] uppercase tracking-[.16em] text-primary">Partida revisada</p><div className="mt-3 flex items-center justify-between border-y border-white/15 py-5"><strong className="font-['Chakra_Petch'] text-xl font-black uppercase">{projection?.match.homeTeam.name} x {projection?.match.awayTeam.name}</strong><strong className="font-['Chakra_Petch'] text-3xl font-black">{projection?.match.homeScore}:{projection?.match.awayScore}</strong></div></section>

            {replay ? <>
              <section className="mt-8"><div className="flex items-end justify-between gap-4"><div><p className="font-['DM_Mono'] text-[10px] uppercase tracking-[.16em] text-primary">Timeline Consumer</p><h3 className="mt-1 font-['Chakra_Petch'] text-2xl font-black uppercase">Como o resultado foi formado</h3></div><ShieldCheck className="size-5 shrink-0 text-primary" /></div>
                <ol className="mt-5 border-t border-white/15">
                  <TimelineItem icon={Clock3} label="Rodada aberta" title={replay.prompt.text} description={replay.resolutionDomain === "football" ? `Placar de referência ${replay.opening.score?.home ?? 0}-${replay.opening.score?.away ?? 0} · janela inicia após o lock` : `${pct(replay.opening.value)} de abertura · alvo ${pct(replay.prompt.targetValue)}`} />
                  <TimelineItem icon={Users} label={`${replay.participation.confirmedAnswers} respostas confirmadas`} title="As escolhas permaneceram privadas" description="Somente a contagem foi pública durante a janela competitiva." />
                  <TimelineItem icon={LockKeyhole} label="Rodada fechada" title="Nenhuma nova resposta pôde ser aceita" description={replay.lock.reason === "deadline" ? "A janela terminou no horário definido pelo servidor." : "O próximo sinal elegível fechou a janela."} />
                  <TimelineItem icon={Radio} label={replay.resolutionDomain === "football" ? "Observação oficial TxLINE" : "Novo sinal TxLINE"} title={replay.resolutionDomain === "football" ? `Placar ${replay.resolution.score?.home ?? 0}-${replay.resolution.score?.away ?? 0} aos ${Math.floor((replay.resolution.matchClockSec ?? 0) / 60)} minutos` : `${replay.prompt.priceName} chegou a ${pct(replay.resolution.observedValue)}`} description={`Sequência do provedor: ${replay.resolution.providerSequence ?? "não informada"}`} />
                  <TimelineItem icon={Check} label="Regra aplicada" title={replay.resolution.expression} description={`A opção ${replay.resolution.winningOptionId.toUpperCase()} venceu.`} />
                  <TimelineItem icon={Trophy} label="Ranking atualizado" title={`${replay.scoring.answersEvaluated} respostas avaliadas · ${replay.scoring.answersCorrect} corretas`} description={`${replay.scoring.totalPointsApplied} pontos aplicados de forma determinística.`} />
                </ol>
              </section>

              <section className="mt-8"><p className="font-['DM_Mono'] text-[10px] uppercase tracking-[.16em] text-primary">Cinco invariantes</p><h3 className="mt-1 font-['Chakra_Petch'] text-2xl font-black uppercase">O que esta prova garante</h3><div className="mt-4 grid gap-px bg-white/10 sm:grid-cols-2">
                <Invariant label="Autoridade" valid={replay.proof.authorityValid} description={`Origem ${replay.resolution.acquisitionOrigin}.`} />
                <Invariant label="Temporalidade" valid={replay.proof.temporalIntegrityValid} description="Respostas válidas precedem o lock." />
                <Invariant label="Elegibilidade" valid={replay.proof.eligibilityValid} description="Mercado, período, linha e sequência correspondem." />
                <Invariant label="Determinismo" valid={replay.proof.determinismValid} description={`${replay.resolution.expression} produz o mesmo vencedor.`} />
                <Invariant label="Reprodutibilidade" valid={replay.proof.hashChainValid && replay.proof.projectionMatches && replay.proof.rankingMatches} description="Ledger, projeção e ranking coincidem." />
              </div></section>

              <SolanaCommitment commitment={commitment} replayHash={replay.replayHash} />

              <details className="mt-8 border border-white/10"><summary className="cursor-pointer px-4 py-4 font-['DM_Mono'] text-[9px] uppercase tracking-[.12em] text-white/50">Detalhes técnicos · rodada {replay.roundVersion}</summary><dl className="grid border-t border-white/10 sm:grid-cols-2">
                <Technical label="Round ID" value={replay.roundId} /><Technical label="Stream range" value={`${replay.proof.firstStreamVersion} → ${replay.proof.lastStreamVersion}`} /><Technical label="Market signature" value={replay.prompt.marketSignature} /><Technical label="Provider sequence" value={String(replay.resolution.providerSequence ?? "--")} /><Technical label="Lock" value={replay.lock.lockedAt} /><Technical label="Causation" value={replay.technical.causationId ?? "--"} /><Technical label="Correlation" value={replay.technical.correlationId ?? "--"} /><Technical label="Round range hash" value={shortHash(replay.proof.roundEventRangeHash)} /><Technical label="Leaderboard before" value={shortHash(replay.scoring.leaderboardBeforeHash)} /><Technical label="Leaderboard after" value={shortHash(replay.scoring.leaderboardAfterHash)} />
              </dl></details>
            </> : <section className="mt-7 border border-white/10 p-5"><p className="font-['Chakra_Petch'] text-xl font-black uppercase">Nenhuma rodada resolvida</p><p className="mt-2 text-sm text-white/45">O replay será publicado assim que a primeira rodada for fechada e calculada.</p></section>}

            <details className="mt-5 border border-white/10"><summary className="cursor-pointer px-4 py-3 font-['DM_Mono'] text-[9px] uppercase tracking-[.12em] text-white/35">Ledger público redigido · {events.length} eventos</summary><ol className="max-h-72 overflow-y-auto border-t border-white/10 px-4">{events.slice().reverse().map((event) => <li key={event.eventId} className="border-b border-white/10 py-3"><p className="font-['DM_Mono'] text-[9px] uppercase text-white/60">{event.type}</p><p className="mt-1 break-all font-['DM_Mono'] text-[9px] text-white/25">{event.eventId}</p></li>)}</ol></details>
          </> : null}
        </motion.aside>
      </motion.div>
    </AnimatePresence>, document.body,
  );
}

function TimelineItem({ icon: Icon, label, title, description }: { icon: typeof Clock3; label: string; title: string; description: string }) { return <li className="grid grid-cols-[40px_1fr] gap-4 border-b border-white/15 py-5"><span className="grid size-10 place-items-center border border-primary/30 text-primary"><Icon className="size-4" /></span><div><p className="font-['DM_Mono'] text-[9px] font-black uppercase tracking-[.14em] text-primary">{label}</p><strong className="mt-1 block text-sm uppercase">{title}</strong><p className="mt-1 text-xs leading-relaxed text-white/40">{description}</p></div></li>; }
function Invariant({ label, valid, description }: { label: string; valid: boolean; description: string }) { return <article className="bg-[#080d19] p-4"><div className="flex items-center gap-2">{valid ? <Check className="size-4 text-primary" /> : <X className="size-4 text-red-300" />}<strong className="text-xs uppercase">{label}</strong></div><p className="mt-2 text-xs leading-relaxed text-white/40">{description}</p><p className={`mt-3 font-['DM_Mono'] text-[9px] uppercase ${valid ? "text-primary" : "text-red-300"}`}>{valid ? "VALID" : "PENDING"}</p></article>; }
function Technical({ label, value }: { label: string; value: string }) { return <div className="min-w-0 border-b border-white/10 p-4 sm:border-r"><dt className="font-['DM_Mono'] text-[9px] uppercase text-white/30">{label}</dt><dd className="mt-1 break-all font-['DM_Mono'] text-[10px] text-white/65">{value}</dd></div>; }
function ReviewMetric({ label, value }: { label: string; value: string }) { return <div className="bg-[#080d19] p-3"><span className="block font-['DM_Mono'] text-[9px] uppercase text-white/35">{label}</span><strong className="mt-1 block text-xs text-primary">{value}</strong></div>; }

function SolanaCommitment({ commitment, replayHash }: { commitment: RoundCommitmentStatus | null; replayHash: string }) {
  const confirmed = commitment?.status === "confirmed";
  const matched = confirmed && commitment.replayHash === replayHash && commitment.onChainMatches !== false;
  const labels: Record<string, string> = { unsupported: "Não habilitado", pending: "Pendente", confirming: "Confirmando", confirmed: "Confirmado", failed: "Falhou" };
  return <section className="mt-8 border border-white/10 p-5"><div className="flex items-start justify-between gap-4"><div><p className="font-['DM_Mono'] text-[10px] uppercase tracking-[.16em] text-primary">Solana commitment</p><h3 className="mt-1 font-['Chakra_Petch'] text-2xl font-black uppercase">{labels[commitment?.status ?? "unsupported"]}</h3></div><span className={`border px-3 py-1 font-['DM_Mono'] text-[9px] uppercase ${matched ? "border-primary/35 text-primary" : "border-white/15 text-white/40"}`}>{matched ? "ON-CHAIN MATCH" : commitment?.network ?? "DEVNET"}</span></div><p className="mt-3 text-sm text-white/45">{confirmed ? "O hash do replay exibido foi ancorado depois da resolução, sem bloquear o resultado competitivo." : commitment?.status === "failed" ? "O resultado local permanece verificável; a publicação poderá ser repetida." : commitment?.status === "unsupported" ? "Este ambiente mantém a prova local, mas não publica commitments on-chain." : "A resolução já está finalizada e a âncora está sendo processada de forma assíncrona."}</p>{commitment?.commitmentHash ? <p className="mt-4 break-all font-['DM_Mono'] text-[9px] text-white/30">COMMITMENT {commitment.commitmentHash}</p> : null}{confirmed ? <div className="mt-4 grid gap-px bg-white/10 sm:grid-cols-2"><ReviewMetric label="Local" value={matched ? "MATCH" : "DIVERGED"} /><ReviewMetric label="On-chain" value={matched ? "MATCH" : "PENDING"} /></div> : null}{commitment?.explorerUrl ? <a href={commitment.explorerUrl} target="_blank" rel="noreferrer" className="mt-5 inline-flex min-h-11 items-center border border-primary/35 px-4 font-['DM_Mono'] text-[9px] font-black uppercase tracking-[.12em] text-primary hover:bg-primary hover:text-[#050814]">Abrir no Solana Explorer</a> : null}</section>;
}
