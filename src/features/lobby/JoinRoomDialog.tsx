import { ArrowRight, X } from "lucide-react";
import { useEffect } from "react";
import { setShellOverlayState } from "../../app/shell/shell-events";

interface JoinRoomDialogProps {
  name: string;
  subtitle?: string;
  open: boolean;
  onClose: () => void;
  onChangeName: (nextName: string) => void;
  onConfirm: () => void;
}

export function JoinRoomDialog({ name, subtitle = "Sala VIRA", open, onClose, onChangeName, onConfirm }: JoinRoomDialogProps) {
  useEffect(() => {
    setShellOverlayState("admission", open);
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      setShellOverlayState("admission", false);
    };
  }, [open]);
  if (!open) {
    return null;
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Entrar na sala" className="fixed inset-0 z-[109] grid place-items-end bg-[#050814]/88 backdrop-blur-md sm:place-items-center sm:p-5">
      <div className="relative w-full max-w-2xl overflow-hidden border-y border-white/15 bg-[#080d19] p-6 shadow-2xl sm:border sm:p-8">
        <div aria-hidden className="absolute inset-y-0 right-0 w-1/2 bg-[linear-gradient(135deg,transparent,rgba(202,255,40,.07))] [clip-path:polygon(45%_0,100%_0,100%_100%,0_100%)]" />
        <div className="relative flex items-start justify-between">
          <div>
            <p className="font-['DM_Mono'] text-[10px] uppercase tracking-[.17em] text-primary">Sala VIRA · {subtitle}</p>
            <h2 className="mt-5 font-['Chakra_Petch'] text-[clamp(2.7rem,7vw,5rem)] font-black uppercase leading-[.8]">Entre na<span className="block text-primary">partida</span></h2>
          </div>
          <button onClick={onClose} className="grid size-10 place-items-center border border-white/15 text-white/50 hover:border-primary hover:text-primary" aria-label="Fechar">
            <X className="size-4" />
          </button>
        </div>

        <label className="relative mt-9 block font-['DM_Mono'] text-[10px] font-black uppercase tracking-[.12em] text-white/55">
          Como você quer ser chamado na sala?
          <input
            value={name}
            onChange={(event) => onChangeName(event.target.value)}
            autoFocus
            className="mt-3 min-h-14 w-full border border-white/15 bg-[#050814] px-4 font-sans text-base normal-case tracking-normal text-white outline-none transition placeholder:text-white/25 focus:border-primary"
            placeholder="Nome na sala"
          />
        </label>
        <div className="relative mt-5 grid gap-2 border-y border-white/10 py-4 font-['DM_Mono'] text-[9px] uppercase tracking-[.12em] text-white/40 sm:grid-cols-2"><span>Uma identidade por sessão</span><span>Uma resposta por rodada</span></div>
        <button
          disabled={!name.trim()}
          onClick={onConfirm}
          className="relative mt-6 flex min-h-14 w-full items-center justify-between bg-primary px-5 font-['Chakra_Petch'] text-sm font-black uppercase text-primary-foreground disabled:opacity-40"
        >
          Entrar na sala <ArrowRight className="size-5" />
        </button>
      </div>
    </div>
  );
}
