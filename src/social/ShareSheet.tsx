import { Check, Copy, Download, Share2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { setShellOverlayState } from "../app/shell/shell-events.ts";
import { useLocale } from "../i18n/locale-context.tsx";
import type { ShareResponse } from "./share.ts";

export function ShareSheet({ share, onClose }: { share: ShareResponse | null; onClose: () => void }) {
  const { t } = useLocale();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<"copy" | "share" | "download" | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setShellOverlayState("share-sheet", Boolean(share));
    if (!share) return;
    const previous = document.activeElement as HTMLElement | null;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button,[href],[tabindex]:not([tabindex="-1"])');
      if (!focusable?.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.body.style.overflow = "hidden"; window.addEventListener("keydown", keydown); window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", keydown); previous?.focus(); setShellOverlayState("share-sheet", false); };
  }, [onClose, share]);
  if (!share) return null;
  const imageUrl = new URL(`/share-images/${encodeURIComponent(share.share.publicCode)}.png`, share.url).toString();
  const copyLink = async () => { setBusy("copy"); try { await navigator.clipboard.writeText(share.url); setCopied(true); toast.success(t("share.sheet.copied")); } catch { toast.error(t("share.sheet.error")); } finally { setBusy(null); } };
  const nativeShare = async () => { if (!navigator.share) return void copyLink(); setBusy("share"); try { await navigator.share({ title: share.share.metadata.title, text: share.share.metadata.description, url: share.url }); } catch (error) { if ((error as Error).name !== "AbortError") toast.error(t("share.sheet.error")); } finally { setBusy(null); } };
  const download = async () => { setBusy("download"); try { const response = await fetch(imageUrl); if (!response.ok) throw new Error("share_card_download_failed"); const href = URL.createObjectURL(await response.blob()); const anchor = document.createElement("a"); anchor.href = href; anchor.download = `vira-${share.share.publicCode}.png`; anchor.click(); URL.revokeObjectURL(href); toast.success(t("share.sheet.downloaded")); } catch { toast.error(t("share.sheet.error")); } finally { setBusy(null); } };
  return createPortal(
    <div className="fixed inset-0 z-[115] grid place-items-end bg-[#050A12]/88 text-[#F5F7F2] backdrop-blur-md sm:place-items-center sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="share-sheet-title" className="w-full max-w-3xl border-y border-white/15 bg-[#08101a] p-5 text-[#F5F7F2] sm:border sm:p-7">
        <header className="flex items-start justify-between gap-5"><div><p className="font-['DM_Mono'] text-[9px] uppercase tracking-[.16em] text-primary">VIRA</p><h2 id="share-sheet-title" className="mt-2 font-['Chakra_Petch'] text-3xl font-black uppercase">{t("share.sheet.title")}</h2></div><button ref={closeRef} type="button" onClick={onClose} aria-label={t("share.sheet.close")} className="grid size-11 place-items-center border border-white/15 hover:border-primary"><X className="size-4" /></button></header>
        <img src={imageUrl} alt={t("share.sheet.previewAlt")} className="mt-6 aspect-[1200/630] w-full border border-white/15 object-cover" />
        <p className="mt-4 text-sm text-white/50">{t("share.sheet.reassurance")}</p>
        <div className="mt-6 grid gap-2 sm:grid-cols-3"><Action icon={Share2} label={t("share.sheet.native")} primary busy={busy === "share"} onClick={() => void nativeShare()} /><Action icon={copied ? Check : Copy} label={copied ? t("share.sheet.copied") : t("share.sheet.copy")} busy={busy === "copy"} onClick={() => void copyLink()} /><Action icon={Download} label={busy === "download" ? t("share.sheet.downloading") : t("share.sheet.download")} busy={busy === "download"} onClick={() => void download()} /></div>
      </div>
    </div>, document.body,
  );
}

function Action({ icon: Icon, label, onClick, primary = false, busy = false }: { icon: typeof Share2; label: string; onClick: () => void; primary?: boolean; busy?: boolean }) {
  return <button type="button" disabled={busy} onClick={onClick} className={`flex min-h-14 items-center justify-center gap-2 border px-4 font-['Chakra_Petch'] text-xs font-black uppercase ${primary ? "border-primary bg-primary text-[#050A12]" : "border-white/20 text-[#F5F7F2] hover:border-primary hover:text-primary"}`}><Icon className="size-4" />{label}</button>;
}
