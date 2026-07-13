import { Check, ChevronRight, Circle, Database, Gauge, ShieldCheck, Trophy, UserCheck } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";

import type { PresentationEvent, ReplayState, RoomVerification } from "../../domain/types";
import { AnimatedNumber } from "../../shared/number/AnimatedNumber";
import { useLocale } from "../../i18n/locale-context.tsx";
import { stableOptionLabel } from "../../i18n/round-copy.ts";
import type { TranslateFunction } from "../../i18n/translate.ts";

interface CausalityRailProps {
  state: ReplayState;
  latestPresentationEvent?: PresentationEvent | null;
  verification?: RoomVerification | null;
}

type StepId = "answer" | "txline" | "rule" | "ranking" | "proof";

interface StepModel {
  id: StepId;
  title: string;
  complete: boolean;
  active: boolean;
  icon: typeof UserCheck;
  summary: string;
  detail: React.ReactNode;
}

function compactHash(hash: string | null | undefined, t: TranslateFunction) {
  if (!hash) return t("causality.noHash");
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
}

function pct(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? (
    <AnimatedNumber value={value} suffix="%" format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} />
  ) : "--";
}

function buildSteps(t: TranslateFunction, state: ReplayState, latestPresentationEvent?: PresentationEvent | null, verification?: RoomVerification | null): StepModel[] {
  const evidence = state.snapshot.latestEvidence ?? null;
  const currentParticipant = state.snapshot.currentParticipant;
  const currentAnswer = state.snapshot.currentParticipantAnswer ?? (currentParticipant ? state.snapshot.answers[currentParticipant.id] : null);
  const resolutionEvent = latestPresentationEvent?.kind === "round_resolved" ? latestPresentationEvent : null;
  const txlineEvent = latestPresentationEvent?.kind === "txline_update" ? latestPresentationEvent : null;
  const resolved = Boolean(evidence?.resolution || resolutionEvent);
  const verified = Boolean(verification?.hashChainValid && verification.projectionMatches && verification.rankingMatches);

  return [
    {
      id: "answer",
      title: t("causality.answer"),
      complete: Boolean(currentAnswer || latestPresentationEvent?.kind === "answer_registered" || resolved),
      active: state.currentAnswerState === "submitted",
      icon: UserCheck,
      summary: currentAnswer ? t("causality.answerSummary", { option: stableOptionLabel(t, currentAnswer.optionId) }) : t("causality.awaitingChoice"),
      detail: currentAnswer ? (
        <span>
          {t("causality.answerDetail", { option: stableOptionLabel(t, currentAnswer.optionId) })}
        </span>
      ) : t("causality.chooseOption"),
    },
    {
      id: "txline",
      title: "TxLINE",
      complete: Boolean(evidence?.input || txlineEvent || resolutionEvent),
      active: latestPresentationEvent?.kind === "txline_update",
      icon: Database,
      summary: evidence?.normalization.type === "odds_shift" ? t("causality.marketUpdate") : t("causality.awaitingSignal"),
      detail: (
        <div className="space-y-1">
          <p>{evidence?.input.excerpt.market ?? t("causality.marketPending")}</p>
          {txlineEvent ? (
            <p className="font-['DM_Mono'] text-primary">
              {pct(txlineEvent.previousValue)} <span className="text-muted-foreground">→</span> {pct(txlineEvent.currentValue)}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      id: "rule",
      title: t("causality.rule"),
      complete: Boolean(evidence?.ruleEvaluation && (evidence.status === "resolved" || evidence.status === "matched" || evidence.status === "ignored")),
      active: Boolean(evidence?.ruleEvaluation && !resolved),
      icon: Gauge,
      summary: evidence?.ruleEvaluation?.predicateResult ? t("causality.conditionMet") : evidence?.ruleEvaluation?.ignoredReason ? t("causality.eventIgnored") : t("causality.ruleWaiting"),
      detail: evidence?.ruleEvaluation ? (
        <span>
          {evidence.ruleEvaluation.expression}{" "}
          <b className={evidence.ruleEvaluation.predicateResult ? "text-primary" : "text-muted-foreground"}>
            {evidence.ruleEvaluation.predicateResult ? t("causality.true") : t("causality.false")}
          </b>
        </span>
      ) : t("causality.ruleDetailPending"),
    },
    {
      id: "ranking",
      title: t("causality.ranking"),
      complete: resolved,
      active: latestPresentationEvent?.kind === "round_resolved",
      icon: Trophy,
      summary: resolved ? t("causality.pointsApplied") : t("causality.unresolved"),
      detail: resolutionEvent ? (
        <span>
          {resolutionEvent.correct ? t("causality.youScored") : t("causality.rankingSynced")}
          <b><AnimatedNumber value={resolutionEvent.pointsAwarded} prefix={resolutionEvent.pointsAwarded > 0 ? "+" : ""} suffix=" pts" /></b>
          {resolutionEvent.currentRank ? <> · {t("causality.position", { rank: resolutionEvent.currentRank })}</> : null}
        </span>
      ) : t("causality.rankingPending"),
    },
    {
      id: "proof",
      title: t("causality.proof"),
      complete: verified,
      active: Boolean(verification && !verified),
      icon: ShieldCheck,
      summary: verified ? t("causality.replayVerified") : t("causality.verificationPending"),
      detail: verification ? (
        <div className="space-y-1">
          <p>{t("causality.hashChain")}: <b className={verification.hashChainValid ? "text-primary" : "text-destructive"}>{verification.hashChainValid ? "VALID" : "INVALID"}</b></p>
          <p>{t("causality.projectionReplay")}: <b className={verification.projectionMatches ? "text-primary" : "text-destructive"}>{verification.projectionMatches ? "MATCH" : "DIVERGED"}</b></p>
          <p className="truncate">{t("causality.head")}: {compactHash(verification.ledgerHeadHash, t)}</p>
        </div>
      ) : state.snapshot.ledger ? (
        <span>
          Ledger v<AnimatedNumber value={state.snapshot.ledger.streamVersion} /> · {compactHash(state.snapshot.ledger.headHash, t)}
        </span>
      ) : t("causality.reviewPending"),
    },
  ];
}

export function CausalityRail({ state, latestPresentationEvent, verification }: CausalityRailProps) {
  const { t } = useLocale();
  const reduceMotion = useReducedMotion();
  const steps = useMemo(() => buildSteps(t, state, latestPresentationEvent, verification), [latestPresentationEvent, state, t, verification]);
  const defaultStep = steps.find((step) => step.active)?.id ?? steps.findLast((step) => step.complete)?.id ?? "answer";
  const [selectedStepId, setSelectedStepId] = useState<StepId>(defaultStep);
  const selectedStep = steps.find((step) => step.id === selectedStepId) ?? steps[0];

  return (
    <section className="mt-8 overflow-hidden border-y border-white/15 bg-card px-4 py-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-['Chakra_Petch'] text-xl font-black uppercase">{t("causality.title")}</h2>
        <span className="font-['DM_Mono'] text-[10px] uppercase tracking-[.14em] text-muted-foreground">
          {t("causality.live")}
        </span>
      </div>

      <div className="scrollbar-none -mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-1 md:flex-wrap md:overflow-visible">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const selected = step.id === selectedStep.id;
          return (
            <button
              key={step.id}
              onClick={() => setSelectedStepId(step.id)}
              className={`flex shrink-0 items-center gap-2 rounded-full border px-2.5 py-2 text-left transition ${
                selected
                  ? "border-primary bg-primary/12 text-primary"
                  : step.complete
                    ? "border-primary/25 bg-primary/5 text-foreground"
                    : "border-border bg-background/70 text-muted-foreground"
              }`}
            >
              {step.complete ? <Check className="size-3.5" /> : <Circle className="size-3.5" />}
              <Icon className="size-3.5" />
              <span className="font-['DM_Mono'] text-[10px] uppercase tracking-[.1em]">{step.title}</span>
              {index < steps.length - 1 ? <ChevronRight className="size-3 text-muted-foreground" /> : null}
            </button>
          );
        })}
      </div>

      <motion.div
        key={selectedStep.id}
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.18 }}
        className="mt-3 rounded-xl border border-border bg-background/70 p-3"
      >
        <p className="font-['DM_Mono'] text-[10px] uppercase tracking-[.14em] text-primary">{selectedStep.summary}</p>
        <div className="mt-2 text-sm leading-6 text-muted-foreground">{selectedStep.detail}</div>
      </motion.div>
    </section>
  );
}
