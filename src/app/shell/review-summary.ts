import type { VerifiedRoundReplayV1 } from "../../domain/types.ts";
import type { TranslateFunction } from "../../i18n/translate.ts";

export type ReviewConclusion = { id: "input" | "processing" | "outcome"; label: string; copy: string; valid: boolean };

export function deriveReviewConclusions(t: TranslateFunction, replay: VerifiedRoundReplayV1): ReviewConclusion[] {
  const origin = replay.resolution.acquisitionOrigin;
  const inputCopy = origin === "txline_live_stream" || origin === "txline_snapshot" ? t("review.summary.liveInput") : origin === "captured_txline_test_fixture" ? t("review.summary.capturedInput") : t("review.summary.playbackInput");
  const processingValid = replay.proof.hashChainValid && replay.proof.temporalIntegrityValid && replay.proof.eligibilityValid && replay.proof.determinismValid;
  const outcomeValid = replay.proof.projectionMatches && replay.proof.rankingMatches;
  return [
    { id: "input", label: t("review.summary.input"), copy: inputCopy, valid: replay.proof.authorityValid },
    { id: "processing", label: t("review.summary.processing"), copy: t(processingValid ? "review.summary.processingValid" : "review.summary.processingPending"), valid: processingValid },
    { id: "outcome", label: t("review.summary.outcome"), copy: t(outcomeValid ? "review.summary.outcomeMatches" : "review.summary.outcomePending"), valid: outcomeValid },
  ];
}
