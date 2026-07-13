import { ArrowLeft, Users } from "lucide-react";
import { motion } from "motion/react";

import { formatMatchClock } from "../../domain/contracts";
import type { ReplayState } from "../../domain/types";
import { AnimatedNumber } from "../../shared/number/AnimatedNumber";
import { TeamIcon } from "../../shared/team/team-icons";
import { useLocale } from "../../i18n/locale-context.tsx";
import { LocaleSelector } from "../../i18n/LocaleSelector.tsx";
import type { MatchState } from "../../domain/types";
import type { StaticTranslationKey } from "../../i18n/translate.ts";

const matchStatusKeys: Record<MatchState, StaticTranslationKey> = {
  scheduled: "state.match.scheduled",
  live: "state.match.live",
  paused: "state.match.paused",
  postponed: "state.match.postponed",
  cancelled: "state.match.cancelled",
  finished: "state.match.finished",
  unknown: "state.match.unavailable",
};

interface MatchHeaderProps {
  state: ReplayState;
  onBack: () => void;
}

export function MatchHeader({ state, onBack }: MatchHeaderProps) {
  const { locale, t } = useLocale();
  const match = state.snapshot.match;
  const finished = match.status === "finished";
  const scheduled = match.status === "scheduled" || match.status === "paused" || match.status === "postponed";
  const connected = state.snapshot.connectionState === "live";
  const code = (name: string) => name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-[#171817]/95 shadow-[0_14px_34px_rgba(0,0,0,.34)] backdrop-blur">
      <div className="mx-auto flex min-h-[4.5rem] w-full max-w-6xl items-center justify-between gap-2 px-3 py-2 sm:gap-3 sm:px-4 lg:px-5">
        <button
          onClick={onBack}
          className="grid size-9 shrink-0 place-items-center rounded-full border border-border bg-card transition hover:border-primary hover:text-primary"
          aria-label={t("room.backToLobby")}
        >
          <ArrowLeft className="size-4" />
        </button>
        <motion.div layoutId={`active-room-${match.id}`} className="min-w-0 flex-1 text-center">
          <div className="flex min-w-0 items-center justify-center gap-2">
            <span className="hidden sm:block"><TeamIcon name={match.homeTeam.name} side="home" size="sm" /></span>
            <p className="truncate font-['DM_Mono'] text-[10px] font-bold uppercase tracking-[.18em]">
              <span className="sm:hidden">{code(match.homeTeam.name)}</span><span className="hidden sm:inline">{match.homeTeam.name}</span>{" "}
              <span className="mx-1 text-muted-foreground">vs</span>{" "}
              <span className="sm:hidden">{code(match.awayTeam.name)}</span><span className="hidden sm:inline">{match.awayTeam.name}</span>
            </p>
            <span className="hidden sm:block"><TeamIcon name={match.awayTeam.name} side="away" size="sm" /></span>
          </div>
          <div className="mt-1 flex justify-center gap-2 overflow-hidden font-['DM_Mono'] text-[8px] uppercase text-white/45 sm:text-[10px]">
            <span className="inline-flex shrink-0 items-center gap-1">
              <span className={`size-1.5 rounded-full ${finished || scheduled ? "bg-muted-foreground" : "bg-amber-400"}`} />
              {t(matchStatusKeys[match.status])}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1">
              <Users className="size-3 text-primary" />
              {t("room.inRoom", { count: state.snapshot.roomPopulation })}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1">
              <span className={`size-1.5 rounded-full ${connected ? "bg-emerald-400" : "bg-amber-400"}`} />
              {connected ? t("room.connection.connected") : t("room.connection.reconnecting")}
            </span>
          </div>
        </motion.div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <LocaleSelector />
          <div className="text-right">
          <div className="font-['Chakra_Petch'] text-[22px] font-bold leading-none">
            <AnimatedNumber value={match.homeScore} locales={locale} />
            <span>-</span>
            <AnimatedNumber value={match.awayScore} locales={locale} />
          </div>
          <div className="mt-1 font-['DM_Mono'] text-[10px] text-muted-foreground">
            {formatMatchClock(match.matchClockSec)}
          </div>
          </div>
        </div>
      </div>
    </header>
  );
}
