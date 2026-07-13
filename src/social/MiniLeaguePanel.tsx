import { Loader2, RefreshCw, Share2, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { fetchHome, fetchMiniLeague, fetchShare } from "./share";
import { useLocale } from "../i18n/locale-context.tsx";

type League = Awaited<ReturnType<typeof fetchMiniLeague>>;

export function MiniLeaguePanel({ inviteCode }: { inviteCode: string | null }) {
  const { formatNumber, locale, t, timeZone } = useLocale();
  const [league, setLeague] = useState<League | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const load = useCallback(async () => {
    if (!inviteCode) return;
    try {
      const [share, home] = await Promise.all([fetchShare(inviteCode), fetchHome({ locale, timeZone })]);
      const next = share.miniLeagueId ? await fetchMiniLeague(share.miniLeagueId) : { id: "", members: [] };
      setLeague(next); setCurrentId(home.player?.publicId ?? null); setStatus("ready");
    } catch { setStatus("error"); }
  }, [inviteCode, locale, timeZone]);
  useEffect(() => { if (!inviteCode) return; void load(); const timer = window.setInterval(() => void load(), 12_000); return () => window.clearInterval(timer); }, [inviteCode, load]);
  if (!inviteCode) return null;
  const shareLeague = async () => { try { if (navigator.share) await navigator.share({ title: t("miniLeague.yourGroup"), text: t("miniLeague.howFormed"), url: window.location.href }); else { await navigator.clipboard.writeText(window.location.href); toast.success(t("share.sheet.copied")); } } catch (error) { if ((error as Error).name !== "AbortError") toast.error(t("share.sheet.error")); } };
  return <section aria-labelledby="mini-league-title" className="mt-5 border-y border-white/15 bg-[#090d18] p-5">
    <header className="flex items-start justify-between gap-5"><div><p className="font-['DM_Mono'] text-[9px] uppercase text-primary">{t("miniLeague.kicker")}</p><h2 id="mini-league-title" className="mt-1 font-['Chakra_Petch'] text-2xl font-black uppercase">{t("miniLeague.yourGroup")}</h2><p className="mt-2 max-w-xl text-xs leading-5 text-white/40">{t("miniLeague.howFormed")}</p></div><Users className="size-5 text-primary" /></header>
    {status === "loading" ? <div role="status" className="mt-5 flex min-h-24 items-center justify-center gap-3 text-xs text-white/45"><Loader2 className="size-4 animate-spin text-primary" />{t("miniLeague.loading")}</div> : null}
    {status === "error" ? <div role="alert" className="mt-5 border border-amber-300/25 p-4"><p className="text-sm text-amber-200">{t("miniLeague.error")}</p><button type="button" onClick={() => void load()} className="mt-3 inline-flex min-h-11 items-center gap-2 border border-white/15 px-4 text-xs font-bold uppercase"><RefreshCw className="size-4" />{t("miniLeague.retry")}</button></div> : null}
    {status === "ready" && !league?.members.length ? <p className="mt-5 border-y border-white/10 py-6 text-sm text-white/45">{t("miniLeague.empty")}</p> : null}
    {status === "ready" && league?.members.length ? <ol className="mt-5 border-t border-white/10">{league.members.map((member) => { const current = member.publicId === currentId; return <li key={member.publicId} className={`grid grid-cols-[42px_1fr_auto] items-center gap-3 border-b py-3 ${current ? "border-primary/30 bg-primary/[.06] px-3" : "border-white/10"}`}><span className="font-['Chakra_Petch'] text-lg font-black text-white/40">#{member.rank}</span><div className="min-w-0"><strong className="truncate text-sm uppercase">{member.displayName}</strong>{current ? <span className="ml-2 font-['DM_Mono'] text-[9px] uppercase text-primary">{t("miniLeague.you")}</span> : null}</div><span className="font-['DM_Mono'] text-xs text-primary">{t("miniLeague.points", { points: formatNumber(member.points) })}</span></li>; })}</ol> : null}
    <footer className="mt-5 flex flex-wrap items-center justify-between gap-4"><p className="text-xs text-white/35">{t("miniLeague.returnReason")}</p><button type="button" onClick={() => void shareLeague()} className="inline-flex min-h-11 items-center gap-2 border border-primary/35 px-4 text-xs font-black uppercase text-primary hover:bg-primary hover:text-[#050A12]"><Share2 className="size-4" />{t("miniLeague.invite")}</button></footer>
  </section>;
}
