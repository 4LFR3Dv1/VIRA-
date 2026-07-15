import { ArrowLeft, Eye, ShieldCheck, Trophy } from "lucide-react";

import type { Match, RoomVerification, ScoreEntry } from "../../domain/types";
import { AnimatedNumber } from "../../shared/number/AnimatedNumber";
import { TeamIcon } from "../../shared/team/team-icons";
import { participantAccent } from "./participant-accent";
import { useLocale } from "../../i18n/locale-context.tsx";

interface ReplayFinishedPanelProps {
  open: boolean;
  match: Match;
  leaderboard: ScoreEntry[];
  verification: RoomVerification | null;
  onBack: () => void;
  onReview: () => void;
  shareAction?: React.ReactNode;
}

export function ReplayFinishedPanel({ open, match, leaderboard, verification, onBack, onReview, shareAction }: ReplayFinishedPanelProps) {
  const { locale, t } = useLocale();
  if (!open) return null;

  const winner = leaderboard[0];
  const currentUser = leaderboard.find((entry) => entry.isCurrentUser);
  const verified = Boolean(verification?.hashChainValid && verification.projectionMatches && verification.rankingMatches);

  return (
    <section className="mt-5 overflow-hidden border-y border-white/15 bg-[#090d18]">
      <div className="grid gap-8 border-b border-white/15 px-5 py-10 md:px-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <div className="flex items-center gap-3 text-primary"><Trophy className="size-5" /><p className="font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.18em]">{t("postMatch.eyebrow")}</p></div>
          <h1 className="mt-6 max-w-4xl font-['Chakra_Petch'] text-[clamp(2.8rem,6vw,6.4rem)] font-black uppercase leading-[.8]">{t("postMatch.title")}</h1>
          <p className="mt-6 max-w-2xl text-sm leading-6 text-white/50">{currentUser ? t("leaderboard.finalCurrentUser", { name: currentUser.displayName, rank: currentUser.rank, points: currentUser.points }) : winner ? t("leaderboard.winner", { name: winner.displayName }) : t("postMatch.noParticipants")}</p>
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 border-y border-white/15 py-5 sm:min-w-[29rem]">
          <div className="min-w-0 text-right"><span className="mb-3 flex justify-end"><TeamIcon name={match.homeTeam.name} side="home" size="sm" /></span><strong className="block truncate font-['Chakra_Petch'] text-xl font-black uppercase">{match.homeTeam.name}</strong></div>
          <div className="px-3 text-center"><p className="font-['DM_Mono'] text-[9px] uppercase text-primary">{t("postMatch.finalScore")}</p><strong className="mt-2 flex items-center justify-center gap-2 font-['Chakra_Petch'] text-5xl font-black"><AnimatedNumber value={match.homeScore} locales={locale} /><span>-</span><AnimatedNumber value={match.awayScore} locales={locale} /></strong></div>
          <div className="min-w-0"><span className="mb-3 flex"><TeamIcon name={match.awayTeam.name} side="away" size="sm" /></span><strong className="block truncate font-['Chakra_Petch'] text-xl font-black uppercase">{match.awayTeam.name}</strong></div>
        </div>
      </div>

      <div className="grid gap-8 px-5 py-8 md:px-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div>
          <div className="flex items-center justify-between gap-4"><h2 className="font-['Chakra_Petch'] text-2xl font-black uppercase">{t("leaderboard.finalTitle")}</h2><span className="font-['DM_Mono'] text-[9px] uppercase text-white/35">{t("room.participants", { count: leaderboard.length })}</span></div>
          <ol className="mt-5 divide-y divide-white/10 border-y border-white/15">
            {leaderboard.slice(0, 5).map((entry) => (
              <li key={entry.participantId} className={`flex items-center gap-3 px-3 py-3 ${entry.isCurrentUser ? "bg-primary text-[#070a13]" : "bg-white/[.02]"}`}>
                <span className="w-6 font-['DM_Mono'] text-xs"><AnimatedNumber value={entry.rank} locales={locale} /></span>
                <span className={`grid size-7 place-items-center rounded-full text-[10px] font-bold text-[#11120f] ${participantAccent(entry.participantId)}`}>{entry.displayName.slice(0, 1)}</span>
                <span className="flex-1 text-sm font-semibold">{entry.displayName}</span>
                <span className="font-['DM_Mono'] text-xs"><AnimatedNumber value={entry.points} locales={locale} />{t("leaderboard.pointsShort")}</span>
              </li>
            ))}
          </ol>
        </div>

        <aside className="border-l border-white/15 pl-6">
          <div className="flex items-start gap-3"><ShieldCheck className={`mt-0.5 size-5 ${verified ? "text-primary" : "text-white/35"}`} /><div><p className="font-['DM_Mono'] text-[9px] uppercase text-white/35">{t("postMatch.integrity")}</p><strong className="mt-2 block font-['Chakra_Petch'] text-xl font-black uppercase">{verified ? t("postMatch.verified") : t("postMatch.verifying")}</strong><p className="mt-3 text-xs leading-5 text-white/40">{t("postMatch.integrityDescription")}</p></div></div>
          <div className="mt-7 grid gap-2">
            {shareAction}
            <button type="button" onClick={onReview} className="inline-flex min-h-12 items-center justify-center gap-2 border border-white/20 px-4 font-['Chakra_Petch'] text-xs font-black uppercase hover:border-primary hover:text-primary"><Eye className="size-4" />{t("postMatch.openReview")}</button>
            <button type="button" onClick={onBack} className="inline-flex min-h-12 items-center justify-center gap-2 px-4 font-['Chakra_Petch'] text-xs font-black uppercase text-white/55 hover:text-white"><ArrowLeft className="size-4" />{t("postMatch.backToMatches")}</button>
          </div>
        </aside>
      </div>
    </section>
  );
}
