import type { RoomSnapshot } from "../../domain/types.ts";
import { projectConsumerAttentionEvents as projectSharedEvents, projectRankChangedEvent as projectSharedRankChangedEvent, selectAttentionForParticipant as selectSharedEvents } from "../../../shared/consumer-attention.mjs";
import type { ConsumerAttentionEventV1, ProjectedConsumerAttentionEventV1 } from "./contracts.ts";

export function projectConsumerAttentionEvents(snapshot: RoomSnapshot, participantId: string | null): ProjectedConsumerAttentionEventV1[] {
  return projectSharedEvents(snapshot, participantId) as ProjectedConsumerAttentionEventV1[];
}

export function selectAttentionForParticipant(events: ProjectedConsumerAttentionEventV1[], participantId: string | null): ConsumerAttentionEventV1[] {
  return selectSharedEvents(events, participantId) as ConsumerAttentionEventV1[];
}

export function projectRankChangedEvent(snapshot: RoomSnapshot, participantId: string | null, previousRank: number | null): ProjectedConsumerAttentionEventV1 | null {
  return projectSharedRankChangedEvent(snapshot, participantId, previousRank) as ProjectedConsumerAttentionEventV1 | null;
}
