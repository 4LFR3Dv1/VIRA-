import { RotateCcw, Trophy } from "lucide-react";

import type { ScoreEntry } from "../../domain/types";
import { AnimatedNumber } from "../../shared/number/AnimatedNumber";
import { participantAccent } from "./participant-accent";
import { useLocale } from "../../i18n/locale-context.tsx";

interface ReplayFinishedPanelProps {
  open: boolean;
  leaderboard: ScoreEntry[];
  onRestart: () => void;
}

export function ReplayFinishedPanel({ open, leaderboard, onRestart }: ReplayFinishedPanelProps) {
  const { locale, t } = useLocale();
  if (!open) {
    return null;
  }

  const winner = leaderboard[0];
  const currentUser = leaderboard.find((entry) => entry.isCurrentUser);

  return (
    <section className="mt-5 overflow-hidden rounded-[1.3rem] border border-primary/40 bg-primary/10 shadow-[0_18px_42px_rgba(0,0,0,.28)]">
      <div className="border-b border-primary/20 px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-full bg-primary text-primary-foreground">
            <Trophy className="size-5" />
          </div>
          <div>
            <p className="font-['DM_Mono'] text-[10px] uppercase tracking-[.16em] text-primary">{t("leaderboard.matchFinished")}</p>
            <h2 className="font-['Chakra_Petch'] text-2xl font-bold">{t("leaderboard.finalTitle")}</h2>
          </div>
        </div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {winner ? `${t("leaderboard.winner", { name: winner.displayName })} ` : ""}
          {currentUser ? t("leaderboard.finalCurrentUser", { name: currentUser.displayName, rank: currentUser.rank, points: currentUser.points }) : ""}
        </p>
      </div>

      <ol className="space-y-2 p-4">
        {leaderboard.slice(0, 5).map((entry) => (
          <li
            key={entry.participantId}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${entry.isCurrentUser ? "bg-primary text-primary-foreground" : "bg-background/80"}`}
          >
            <span className="w-5 font-['DM_Mono'] text-xs">
              <AnimatedNumber value={entry.rank} locales={locale} />
            </span>
            <span className={`grid size-7 place-items-center rounded-full text-[10px] font-bold text-[#11120f] ${participantAccent(entry.participantId)}`}>
              {entry.displayName.slice(0, 1)}
            </span>
            <span className="flex-1 text-sm font-semibold">{entry.displayName}</span>
            <span className="font-['DM_Mono'] text-xs">
              <AnimatedNumber value={entry.points} locales={locale} />
            </span>
          </li>
        ))}
      </ol>

      <div className="px-4 pb-4">
        <button
          onClick={onRestart}
          className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3 text-sm font-bold text-primary-foreground"
        >
          <RotateCcw className="size-4" />
          {t("leaderboard.refreshRoom")}
        </button>
      </div>
    </section>
  );
}
