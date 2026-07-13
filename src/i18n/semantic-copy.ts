import type { FixtureConsumerProjection, MatchSummary } from "../runtime/api.ts";
import type { TranslateFunction } from "./translate.ts";

type FixtureNames = { homeTeam: string; awayTeam: string };

const headlineKeys = {
  who_wins_today: "fixture.headline.whoWinsToday",
  who_wins_tomorrow: "fixture.headline.whoWinsTomorrow",
  fixture_unavailable: "fixture.headline.unavailable",
} as const;

export function fixtureHeadline(
  t: TranslateFunction,
  projection: FixtureConsumerProjection,
  names: FixtureNames,
): string {
  const intent = projection.editorial.headlineIntent;
  if (intent === "who_wins_fixture") return t("fixture.headline.whoWinsFixture", names);
  if (intent === "match_live") return t("fixture.headline.matchLive", names);
  if (intent === "match_finished") return t("fixture.headline.matchFinished", names);
  const key = headlineKeys[intent as keyof typeof headlineKeys];
  return key ? t(key) : t("fixture.headline.unavailable");
}

const scheduleKeys = {
  live: "fixture.schedule.live",
  today: "fixture.schedule.today",
  tomorrow: "fixture.schedule.tomorrow",
  finished: "fixture.schedule.finished",
  to_be_confirmed: "fixture.schedule.toBeConfirmed",
} as const;

export function fixtureSchedule(
  t: TranslateFunction,
  projection: FixtureConsumerProjection,
  formattedKickoff: string | null,
): string {
  if (projection.editorial.scheduleIntent === "scheduled_date") {
    return formattedKickoff
      ? t("fixture.schedule.scheduledDate", { dateTime: formattedKickoff })
      : t("fixture.schedule.toBeConfirmed");
  }
  const key = scheduleKeys[projection.editorial.scheduleIntent as keyof typeof scheduleKeys];
  return key ? t(key) : t("fixture.schedule.toBeConfirmed");
}

export function fixtureMarketStatement(
  t: TranslateFunction,
  projection: FixtureConsumerProjection,
  leadingSelection: string | null,
): string {
  const intent = projection.editorial.marketStatementIntent;
  if (intent === "directional_current" && leadingSelection) {
    return t("fixture.market.directionalCurrent", { selection: leadingSelection });
  }
  if (intent === "last_observed") return t("fixture.market.lastObserved");
  return t("fixture.market.unavailable");
}

export function competitionDisplayName(t: TranslateFunction, fixture: Pick<MatchSummary, "competition" | "competitionLabel">): string {
  return fixture.competition?.kind === "world_cup" ? t("competition.worldCup") : fixture.competitionLabel;
}
