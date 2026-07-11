import { ArrowLeft, Users } from "lucide-react";
import { motion } from "motion/react";

import { formatMatchClock } from "../../domain/contracts";
import type { ReplayState } from "../../domain/types";
import { AnimatedNumber } from "../../shared/number/AnimatedNumber";
import { TeamIcon } from "../../shared/team/team-icons";

interface MatchHeaderProps {
  state: ReplayState;
  onBack: () => void;
}

export function MatchHeader({ state, onBack }: MatchHeaderProps) {
  const match = state.snapshot.match;
  const finished = match.status === "finished";
  const scheduled = match.status === "scheduled" || match.status === "paused" || match.status === "postponed";
  const connected = state.snapshot.connectionState === "live";

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-[#171817]/95 shadow-[0_14px_34px_rgba(0,0,0,.34)] backdrop-blur">
      <div className="mx-auto flex h-[4.25rem] w-full max-w-6xl items-center justify-between gap-3 px-4 lg:px-5">
        <button
          onClick={onBack}
          className="grid size-9 shrink-0 place-items-center rounded-full border border-border bg-card transition hover:border-primary hover:text-primary"
          aria-label="Voltar ao lobby"
        >
          <ArrowLeft className="size-4" />
        </button>
        <motion.div layoutId={`active-room-${match.id}`} className="min-w-0 flex-1 text-center">
          <div className="flex min-w-0 items-center justify-center gap-2">
            <TeamIcon name={match.homeTeam.name} side="home" size="sm" />
            <p className="truncate font-['DM_Mono'] text-[10px] font-bold uppercase tracking-[.18em]">
              <span>{match.homeTeam.name}</span>{" "}
              <span className="mx-1 text-muted-foreground">vs</span>{" "}
              <span>{match.awayTeam.name}</span>
            </p>
            <TeamIcon name={match.awayTeam.name} side="away" size="sm" />
          </div>
          <div className="mt-1 flex flex-wrap justify-center gap-1.5 text-[10px]">
            <span className="inline-flex items-center gap-1 rounded-full bg-background/80 px-1.5 py-0.5">
              <span className={`size-1.5 rounded-full ${finished || scheduled ? "bg-muted-foreground" : "bg-amber-400"}`} />
              {finished ? "ENCERRADO" : scheduled ? "PRE-JOGO" : "AO VIVO"}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-background/80 px-1.5 py-0.5">
              <Users className="size-3 text-primary" />
              <AnimatedNumber value={state.snapshot.roomPopulation} /> na sala
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-background/80 px-1.5 py-0.5">
              <span className={`size-1.5 rounded-full ${connected ? "bg-emerald-400" : "bg-amber-400"}`} />
              {connected ? "conectado" : "reconectando"}
            </span>
          </div>
        </motion.div>
        <div className="shrink-0 text-right">
          <div className="font-['Chakra_Petch'] text-[22px] font-bold leading-none">
            <AnimatedNumber value={match.homeScore} />
            <span>-</span>
            <AnimatedNumber value={match.awayScore} />
          </div>
          <div className="mt-1 font-['DM_Mono'] text-[10px] text-muted-foreground">
            {formatMatchClock(match.matchClockSec)}
          </div>
        </div>
      </div>
    </header>
  );
}
