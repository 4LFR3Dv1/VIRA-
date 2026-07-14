import type { MatchState } from "../../domain/types.ts";

export type ConsumerAttentionEventType =
  | "match_starting"
  | "match_live"
  | "round_open"
  | "round_locked"
  | "round_resolved"
  | "rank_changed";

interface AttentionEventBase<TType extends ConsumerAttentionEventType, TPayload> {
  version: 1;
  eventId: string;
  type: TType;
  fixtureId: string;
  roomId?: string;
  roundId?: string;
  occurredAt: string;
  expiresAt?: string;
  visibility: "public" | "participant_private";
  payload: TPayload;
}

export type ConsumerAttentionEventV1 =
  | AttentionEventBase<"match_starting", { kickoffAt: string | null; matchStatus: MatchState }>
  | AttentionEventBase<"match_live", { homeScore: number; awayScore: number; matchClockSec: number }>
  | AttentionEventBase<"round_open", { locksAt: string; roundVersion: number; sequence: number }>
  | AttentionEventBase<"round_locked", { answerConfirmed: boolean; lockReason: string | null }>
  | AttentionEventBase<"round_resolved", { correct: boolean; pointsAwarded: number; rank: number | null; winningOptionId: string }>
  | AttentionEventBase<"rank_changed", { previousRank: number; currentRank: number; points: number }>
;

export type ConsumerAttentionAudienceV1 =
  | { kind: "public" }
  | { kind: "participant"; participantId: string };

export interface ProjectedConsumerAttentionEventV1 {
  event: ConsumerAttentionEventV1;
  audience: ConsumerAttentionAudienceV1;
}

export interface ConsumerAttentionDeliveryContextV1 {
  subscriptionId: string;
  channel: "in_app" | "web_push" | "document_pip";
  locale: "en" | "pt-BR";
  timeZone: string;
  enabledTypes: ConsumerAttentionEventType[];
}
