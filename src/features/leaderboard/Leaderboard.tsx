import { ArrowUp, Trophy } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import type { ScoreEntry } from "../../domain/types";
import { AnimatedNumber } from "../../shared/number/AnimatedNumber";
import { participantAccent } from "../match-room/participant-accent";

interface LeaderboardProps {
  entries: ScoreEntry[];
}

export function Leaderboard({ entries }: LeaderboardProps) {
  const reduceMotion = useReducedMotion();
  const topThree = entries.slice(0, 3);
  const currentUser = entries.find((entry) => entry.isCurrentUser);
  const layoutTransition = reduceMotion
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 420, damping: 34, mass: 0.72 };

  return (
    <section className="border-y border-white/15 bg-card px-4 py-5">
      <div className="mb-3 flex items-center justify-between border-b border-border pb-3">
        <h2 className="flex items-center gap-2 font-['Chakra_Petch'] text-xl font-black uppercase leading-none">
          <Trophy className="size-4 text-primary" />
          Ranking
        </h2>
        <span className="font-['DM_Mono'] text-[10px] text-muted-foreground">TOP 3</span>
      </div>
      <ol>
        <AnimatePresence initial={false} mode="popLayout">
          {topThree.map((entry) => (
            <motion.li
              key={entry.participantId}
              layout
              initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.98 }}
              animate={{
                opacity: 1,
                y: 0,
                scale: 1,
                boxShadow: entry.delta > 0 && !reduceMotion
                  ? [
                      "0 0 0 rgba(202,255,40,0)",
                      "0 0 0 1px rgba(202,255,40,.45), 0 0 24px rgba(202,255,40,.18)",
                      "0 0 0 rgba(202,255,40,0)",
                    ]
                  : "0 0 0 rgba(202,255,40,0)",
              }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
              transition={{
                layout: layoutTransition,
                opacity: { duration: reduceMotion ? 0 : 0.18 },
                y: { duration: reduceMotion ? 0 : 0.18 },
                scale: { duration: reduceMotion ? 0 : 0.18 },
                boxShadow: { duration: 0.9, ease: "easeOut" },
              }}
              className={`relative flex items-center gap-3 border-b border-white/15 py-4 ${
                entry.isCurrentUser ? "text-primary" : "text-foreground"
              }`}
            >
              <span className="w-7 font-['Chakra_Petch'] text-2xl font-black text-white/25">
                <AnimatedNumber value={entry.rank} format={{ minimumIntegerDigits: 2 }} />
              </span>
              <span className={`grid size-7 place-items-center rounded-full text-[10px] font-bold text-[#11120f] ${participantAccent(entry.participantId)}`}>
                {entry.displayName.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{entry.displayName}</span>
              {entry.delta > 0 ? (
                <motion.span
                  initial={reduceMotion ? false : { opacity: 0, x: 8, scale: 0.92 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0, x: 4, scale: 0.96 }}
                  transition={{ type: "spring", stiffness: 520, damping: 32 }}
                  className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-1 font-['DM_Mono'] text-[10px] text-emerald-300"
                >
                  <ArrowUp className="size-3" />
                  <AnimatedNumber value={entry.delta} prefix="+" />
                </motion.span>
              ) : null}
              <span className="font-['DM_Mono'] text-xs">
                <AnimatedNumber value={entry.points} suffix=" pts" />
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
      {currentUser && currentUser.rank > 3 ? (
        <div className="mt-3 rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-primary">
          Voce agora aparece em{" "}
          <AnimatedNumber value={currentUser.rank} suffix="o" /> lugar com{" "}
          <AnimatedNumber value={currentUser.points} suffix=" pts" />.
        </div>
      ) : null}
    </section>
  );
}
