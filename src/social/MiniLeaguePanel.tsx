import { Users } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchMiniLeague, fetchShare } from "./share";
import { useLocale } from "../i18n/locale-context.tsx";

export function MiniLeaguePanel({ inviteCode }: { inviteCode: string | null }) {
  const { formatNumber, t } = useLocale();
  const [league, setLeague] = useState<Awaited<ReturnType<typeof fetchMiniLeague>> | null>(null);
  useEffect(() => {
    if (!inviteCode) return;
    let cancelled = false;
    const load = async () => { try { const share = await fetchShare(inviteCode); if (share.miniLeagueId) { const result = await fetchMiniLeague(share.miniLeagueId); if (!cancelled) setLeague(result); } } catch { if (!cancelled) setLeague(null); } };
    void load(); const timer = window.setInterval(() => void load(), 12_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [inviteCode]);
  if (!league) return null;
  return <section className="mt-5 border-y border-white/15 bg-[#090d18] p-5"><div className="flex items-center justify-between"><div><p className="font-['DM_Mono'] text-[9px] uppercase text-primary">{t("miniLeague.kicker")}</p><h2 className="mt-1 font-['Chakra_Petch'] text-xl font-black uppercase">{t("miniLeague.yourGroup")}</h2></div><Users className="size-4 text-primary" /></div><ol className="mt-4 border-t border-white/10">{league.members.map((member) => <li key={member.publicId} className="grid grid-cols-[32px_1fr_auto] gap-3 border-b border-white/10 py-3"><span className="font-['DM_Mono'] text-xs text-white/35">{String(member.rank).padStart(2, "0")}</span><strong className="truncate text-sm uppercase">{member.displayName}</strong><span className="font-['DM_Mono'] text-xs text-primary">{t("miniLeague.points", { points: formatNumber(member.points) })}</span></li>)}</ol></section>;
}
