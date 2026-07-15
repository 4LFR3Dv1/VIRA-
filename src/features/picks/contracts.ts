export type ViraPickSelectionV1 =
  | { kind: "match_result"; period: "regular_time"; selection: "home" | "draw" | "away"; resolverVersion: 1 }
  | { kind: "total_goals"; period: "regular_time"; line: 2.5; selection: "over" | "under"; resolverVersion: 1 }
  | { kind: "both_teams_score"; period: "regular_time"; selection: "yes" | "no"; resolverVersion: 1 };

export interface ViraPickResultV1 {
  readonly selection: ViraPickSelectionV1;
  readonly status: "pending" | "correct" | "missed" | "void";
  readonly resolvedAt?: string;
  readonly resolutionSnapshotRef?: string;
  readonly reason?: string;
}

export interface ViraPicksCardV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly publicCode: string;
  readonly fixtureId: string;
  readonly publicId: string;
  readonly displayName: string;
  readonly selections: readonly ViraPickSelectionV1[];
  readonly status: "confirmed" | "locked" | "partially_resolved" | "resolved" | "void";
  readonly confirmedAt: string;
  readonly locksAt: string;
  readonly resolvedAt?: string;
  readonly locale: "en" | "pt-BR";
  readonly timeZone: string;
  readonly marketSnapshotRefs: readonly string[];
  readonly resolutionPolicyVersion: 1;
  readonly results?: readonly ViraPickResultV1[];
}

export interface ViraMarketSnapshotV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly fixtureId: string;
  readonly providerMarketId: string;
  readonly marketSignature: string;
  readonly marketType: string;
  readonly period: "regular_time";
  readonly line?: number;
  readonly options: readonly { readonly optionId: string; readonly canonicalSelection: string; readonly price?: number; readonly normalizedProbability?: number }[];
  readonly observedAt: string;
  readonly receivedAt: string;
  readonly providerSequence?: string | number;
  readonly acquisitionOrigin: string;
  readonly freshness: "fresh" | "stale" | "unknown";
  readonly canonicalHash: string;
}

export interface RegularTimeScoreAuthorityV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly authority: "txline_regular_time_score";
  readonly fixtureId: string;
  readonly status: "final";
  readonly path: "finished_in_regular_time" | "historical_before_extra_time" | "historical_before_penalties";
  readonly regularTimeScore: { readonly home: number; readonly away: number };
  readonly terminalStatusId: 5 | 10 | 13;
  readonly scoreEventSequence: number;
  readonly boundaryEventSequence: number;
  readonly providerSequence: number;
  readonly observedAt: string;
  readonly receivedAt: string;
  readonly acquisitionOrigin: string;
  readonly freshness: "fresh";
  readonly historyComplete: true;
  readonly canonicalHash: string;
}

export type ViraPicksCatalogQuestionV1 = {
  readonly kind: ViraPickSelectionV1["kind"];
  readonly available: boolean;
  readonly unavailableReason?: string;
  readonly options: readonly { id: string; consensus?: number }[];
  readonly observedAt?: string;
};

export interface ViraPicksCatalogV1 {
  readonly schemaVersion: 1;
  readonly enabled: boolean;
  readonly fixture: { readonly fixtureId: string; readonly homeTeam: string; readonly awayTeam: string; readonly kickoffAt: string; readonly status: string };
  readonly questions: readonly ViraPicksCatalogQuestionV1[];
}
