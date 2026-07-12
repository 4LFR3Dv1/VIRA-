import { Share2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { ShareResponse } from "./share";
import { presentShare } from "./share";

export function ViraShareButton({ create, label = "Compartilhar" }: { create: () => Promise<ShareResponse>; label?: string }) {
  const [loading, setLoading] = useState(false);
  const run = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const share = await create();
      const result = await presentShare(share);
      if (result === "copied") toast.success("Link copiado", { description: "Envie para seus amigos entrarem no VIRA." });
    } catch (error) {
      if ((error as Error).name !== "AbortError") toast.error("Não foi possível compartilhar");
    } finally { setLoading(false); }
  };
  return <button type="button" onClick={() => void run()} disabled={loading} className="inline-flex min-h-11 items-center justify-center gap-2 border border-primary/35 px-4 font-['Chakra_Petch'] text-xs font-black uppercase text-primary hover:bg-primary hover:text-[#050814] disabled:opacity-40"><Share2 className="size-4" />{loading ? "Criando convite" : label}</button>;
}
