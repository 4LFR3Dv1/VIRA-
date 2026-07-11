import { ArrowLeft, CheckCircle2, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { PublicDomainEvent, RoomSnapshot, RoomVerification } from "../../domain/types";
import { fetchPublicRoomEvents, fetchPublicRoomProjection, fetchRoomVerification } from "../../runtime/api";

interface Props { open: boolean; roomId: string | null; onClose: () => void }

type VerificationVerdict = { kind: "verified" | "pending" | "failed"; title: string; reason: string };

function deriveVerdict(verification: RoomVerification | null, loadFailed = false): VerificationVerdict {
  if (loadFailed) return { kind: "failed", title: "Verificação falhou", reason: "As APIs públicas não responderam e o resultado não pôde ser conferido." };
  if (!verification) return { kind: "pending", title: "Verificação pendente", reason: "A prova pública ainda está sendo materializada." };
  if (verification.hashChainValid && verification.projectionMatches && verification.rankingMatches) return { kind: "verified", title: "Resultado reproduzível", reason: "Hash chain, projeção e ranking correspondem ao replay público." };
  const divergent = [!verification.hashChainValid ? "hash chain" : null, !verification.projectionMatches ? "projeção" : null, !verification.rankingMatches ? "ranking" : null].filter(Boolean).join(", ");
  return { kind: "pending", title: "Verificação pendente", reason: `${divergent || "A prova"} ainda não corresponde integralmente ao replay público.` };
}

export function OfficialReviewPortal({ open, roomId, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [verification, setVerification] = useState<RoomVerification | null>(null);
  const [projection, setProjection] = useState<RoomSnapshot | null>(null);
  const [events, setEvents] = useState<PublicDomainEvent[]>([]);

  useEffect(() => {
    if (!open || !roomId) return;
    let cancelled = false;
    setState("loading");
    Promise.all([fetchRoomVerification(roomId), fetchPublicRoomProjection(roomId), fetchPublicRoomEvents(roomId)])
      .then(([nextVerification, nextProjection, nextEvents]) => {
        if (cancelled) return;
        setVerification(nextVerification); setProjection(nextProjection); setEvents(nextEvents.events); setState("ready");
      })
      .catch(() => !cancelled && setState("error"));
    return () => { cancelled = true; };
  }, [open, roomId]);

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
  const verdict = deriveVerdict(verification, state === "error");
  const verified = verdict.kind === "verified";
  const consumerTypes = ["participant.joined", "answer.submitted", "txline.event.received", "txline.event.accepted", "round.resolved", "round.opened", "match.finished"];
  const causal = events.filter((event) => consumerTypes.includes(event.type)).slice(-8).reverse();

  return createPortal(<AnimatePresence><motion.div className="fixed inset-0 z-[110] bg-[#050814]/80 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <motion.aside ref={dialogRef} role="dialog" aria-modal="true" aria-label="Revisao Oficial VIRA" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", stiffness: 320, damping: 34 }} className="ml-auto h-dvh w-full max-w-[680px] overflow-y-auto border-l border-white/10 bg-[#080d19] p-5 md:p-7">
      <header className="flex items-start justify-between gap-5 border-b border-white/15 pb-5"><div><p className="font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.18em] text-primary">Auditoria pública</p><h2 className="mt-2 font-['Chakra_Petch'] text-3xl font-black uppercase">Revisão Oficial VIRA</h2><p className="mt-2 text-sm text-white/45">Ledger, projeção e ranking consultados pelas APIs públicas.</p></div><button ref={closeRef} onClick={onClose} aria-label="Fechar revisao" className="grid size-10 shrink-0 place-items-center border border-white/15 hover:border-primary hover:text-primary"><ArrowLeft className="size-4" /></button></header>
      {state === "loading" ? <div className="grid min-h-80 place-items-center"><Loader2 className="size-6 animate-spin text-primary" /></div> : null}
      {state === "error" ? <div role="alert" className="mt-6 border border-red-400/30 bg-red-400/10 p-5"><p className="font-black uppercase text-red-300">Revisao indisponivel</p><p className="mt-2 text-sm text-white/45">As APIs publicas nao responderam agora.</p></div> : null}
      {state === "ready" ? <>
        <section className={`mt-6 border p-5 ${verified ? "border-primary/35 bg-primary/[.05]" : "border-amber-400/35 bg-amber-400/[.05]"}`}><div className="flex items-center gap-3">{verified ? <CheckCircle2 className="size-6 text-primary" /> : <XCircle className="size-6 text-amber-300" />}<div><p className="font-['DM_Mono'] text-[9px] uppercase text-white/40">Veredito</p><h3 className="font-['Chakra_Petch'] text-2xl font-black uppercase">{verdict.title}</h3><p className="mt-2 text-sm text-white/50">{verdict.reason}</p></div></div><div className="mt-5 grid grid-cols-3 gap-px bg-white/10"><ReviewMetric label="Hash chain" value={verification?.hashChainValid ? "VALID" : "PENDING"} /><ReviewMetric label="Projeção" value={verification?.projectionMatches ? "MATCH" : "DIVERGED"} /><ReviewMetric label="Ranking" value={verification?.rankingMatches ? "MATCH" : "DIVERGED"} /></div></section>
        <section className="mt-6"><p className="font-['DM_Mono'] text-[10px] uppercase tracking-[.16em] text-primary">Partida revisada</p><div className="mt-3 flex items-center justify-between border-y border-white/15 py-5"><strong className="font-['Chakra_Petch'] text-xl font-black uppercase">{projection?.match.homeTeam.name} x {projection?.match.awayTeam.name}</strong><strong className="font-['Chakra_Petch'] text-3xl font-black">{projection?.match.homeScore}:{projection?.match.awayScore}</strong></div></section>
        <section className="mt-7"><div className="flex items-end justify-between"><div><p className="font-['DM_Mono'] text-[10px] uppercase tracking-[.16em] text-primary">Causalidade pública</p><h3 className="mt-1 font-['Chakra_Petch'] text-2xl font-black uppercase">Como o resultado foi formado</h3></div><ShieldCheck className="size-5 text-primary" /></div><ol className="mt-4 border-t border-white/15">{causal.map((event) => <li key={event.eventId} className="grid grid-cols-[auto_1fr_auto] gap-4 border-b border-white/15 py-4"><span className="font-['DM_Mono'] text-[10px] text-white/30">{String(event.streamVersion).padStart(3, "0")}</span><strong className="text-sm uppercase">{reviewEventTitle(event.type)}</strong><span className="font-['DM_Mono'] text-[9px] uppercase text-primary">confirmado</span></li>)}</ol><details className="mt-5 border border-white/10"><summary className="cursor-pointer px-4 py-3 font-['DM_Mono'] text-[9px] uppercase tracking-[.12em] text-white/40">Detalhes avançados · {events.length} eventos</summary><ol className="max-h-72 overflow-y-auto border-t border-white/10 px-4">{events.slice().reverse().map((event) => <li key={event.eventId} className="border-b border-white/10 py-3"><p className="font-['DM_Mono'] text-[9px] uppercase text-white/60">{event.type}</p><p className="mt-1 break-all font-['DM_Mono'] text-[9px] text-white/25">{event.eventId}</p></li>)}</ol></details></section>
      </> : null}
    </motion.aside>
  </motion.div></AnimatePresence>, document.body);
}

function ReviewMetric({ label, value }: { label: string; value: string }) { return <div className="bg-[#080d19] p-3"><span className="block font-['DM_Mono'] text-[9px] uppercase text-white/35">{label}</span><strong className="mt-1 block text-xs text-primary">{value}</strong></div>; }
function reviewEventTitle(type: string) { return ({ "participant.joined": "Participante entrou", "answer.submitted": "Resposta confirmada", "txline.event.received": "Sinal TxLINE recebido", "txline.event.accepted": "Sinal TxLINE aceito", "round.opened": "Rodada aberta", "round.resolved": "Resultado calculado e ranking atualizado", "match.finished": "Partida encerrada" } as Record<string, string>)[type] ?? type; }
