import { formatMatchClock } from "../../domain/contracts";
import type { Match } from "../../domain/types";

interface MatchScoreboardProps {
  match: Match;
}

export function MatchScoreboard({ match }: MatchScoreboardProps) {
  return (
    <section className="rounded-[1.4rem] border border-border bg-card p-5 shadow-[0_18px_42px_rgba(0,0,0,.24)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-['DM_Mono'] text-[10px] uppercase tracking-[.16em] text-primary">{match.competitionLabel}</p>
          <h1 className="mt-2 font-['Chakra_Petch'] text-[2.6rem] font-bold leading-none">
            {match.homeScore}
            <span className="mx-3 text-muted-foreground">-</span>
            {match.awayScore}
          </h1>
        </div>
        <div className="text-right">
          <p className="font-['DM_Mono'] text-[11px] uppercase tracking-[.16em] text-muted-foreground">Clock</p>
          <p className="mt-2 font-['Chakra_Petch'] text-3xl font-bold text-primary">
            {formatMatchClock(match.matchClockSec)}
          </p>
        </div>
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div className="h-full w-[68%] rounded-full bg-primary" />
      </div>
    </section>
  );
}
