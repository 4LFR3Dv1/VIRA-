import { ArrowRight, Check, Clock3, LockKeyhole, RefreshCw, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { setShellOverlayState } from "../../app/shell/shell-events";
import { useLocale } from "../../i18n/locale-context.tsx";

interface JoinRoomDialogProps {
  name: string;
  subtitle?: string;
  open: boolean;
  onClose: () => void;
  onChangeName: (nextName: string) => void;
  onConfirm: () => void;
}

export function JoinRoomDialog({ name, subtitle = "VIRA", open, onClose, onChangeName, onConfirm }: JoinRoomDialogProps) {
  const { t } = useLocale();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setShellOverlayState("admission", open);
    if (!open) return undefined;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),[href],[tabindex]:not([tabindex="-1"])');
      if (!focusable?.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
      setShellOverlayState("admission", false);
    };
  }, [onClose, open]);
  if (!open) {
    return null;
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={t("join.dialogLabel")} className="fixed inset-0 z-[109] grid place-items-end bg-[#050814]/88 backdrop-blur-md sm:place-items-center sm:p-5">
      <div ref={dialogRef} className="relative w-full max-w-2xl overflow-hidden border-y border-white/15 bg-[#080d19] p-6 shadow-2xl sm:border sm:p-8">
        <div aria-hidden className="absolute inset-y-0 right-0 w-1/2 bg-[linear-gradient(135deg,transparent,rgba(202,255,40,.07))] [clip-path:polygon(45%_0,100%_0,100%_100%,0_100%)]" />
        <div className="relative flex items-start justify-between">
          <div>
            <p className="font-['DM_Mono'] text-[10px] uppercase tracking-[.17em] text-primary">{t("join.roomLabel", { subtitle })}</p>
            <h2 className="mt-5 font-['Chakra_Petch'] text-[clamp(2.7rem,7vw,5rem)] font-black uppercase leading-[.8]">{t("join.title")}</h2>
          </div>
          <button ref={closeRef} onClick={onClose} className="grid size-10 place-items-center border border-white/15 text-white/50 hover:border-primary hover:text-primary" aria-label={t("join.close")}>
            <X className="size-4" />
          </button>
        </div>

        <label className="relative mt-9 block font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.12em] text-white/55">
          {t("join.nameQuestion")}
          <input
            value={name}
            onChange={(event) => onChangeName(event.target.value)}
            autoFocus
            className="mt-3 min-h-14 w-full border border-white/15 bg-[#050814] px-4 font-sans text-base normal-case tracking-normal text-white outline-none transition placeholder:text-white/25 focus:border-primary"
            placeholder={t("join.namePlaceholder")}
          />
        </label>
        <p className="relative mt-3 text-xs text-white/40">{t("join.identityPreserved")}</p>
        <ol className="relative mt-6 grid gap-px bg-white/10 sm:grid-cols-3">
          <JoinStep icon={Clock3} number="01" copy={t("join.stepDeadline")} />
          <JoinStep icon={LockKeyhole} number="02" copy={t("join.stepPrivate")} />
          <JoinStep icon={RefreshCw} number="03" copy={t("join.stepSync")} />
        </ol>
        <div className="relative mt-4 flex items-center gap-2 font-['DM_Mono'] text-[9px] uppercase tracking-[.1em] text-primary"><Check className="size-3" />{t("join.nextAction")}</div>
        <button
          disabled={!name.trim()}
          onClick={onConfirm}
          className="relative mt-6 flex min-h-14 w-full items-center justify-between bg-primary px-5 font-['Chakra_Petch'] text-sm font-black uppercase text-primary-foreground disabled:opacity-40"
        >
          {t("join.confirm")} <ArrowRight className="size-5" />
        </button>
      </div>
    </div>
  );
}

function JoinStep({ icon: Icon, number, copy }: { icon: typeof Clock3; number: string; copy: string }) {
  return <li className="bg-[#080d19] p-4"><span className="flex items-center justify-between text-primary"><Icon className="size-4" /><span className="font-['DM_Mono'] text-[9px]">{number}</span></span><p className="mt-4 text-xs font-semibold leading-5 text-white/70">{copy}</p></li>;
}
