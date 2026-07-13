import { Share2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { ShareResponse } from "./share";
import { useLocale } from "../i18n/locale-context.tsx";
import { ShareSheet } from "./ShareSheet.tsx";

export function ViraShareButton({ create, label }: { create: () => Promise<ShareResponse>; label?: string }) {
  const { t } = useLocale();
  const [loading, setLoading] = useState(false);
  const [share, setShare] = useState<ShareResponse | null>(null);
  const run = async () => {
    if (loading) return;
    setLoading(true);
    try {
      setShare(await create());
    } catch (error) {
      if ((error as Error).name !== "AbortError") toast.error(t("share.failed"));
    } finally { setLoading(false); }
  };
  return <><button type="button" onClick={() => void run()} disabled={loading} className="inline-flex min-h-11 items-center justify-center gap-2 border border-primary/35 px-4 font-['Chakra_Petch'] text-xs font-black uppercase text-primary hover:bg-primary hover:text-[#050A12] disabled:opacity-40"><Share2 className="size-4" />{loading ? t("share.creatingInvite") : label ?? t("share.action")}</button><ShareSheet share={share} onClose={() => setShare(null)} /></>;
}
