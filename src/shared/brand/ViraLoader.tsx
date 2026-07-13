import { motion, useReducedMotion } from "motion/react";

interface ViraLoaderProps {
  size?: number;
  label?: string;
  className?: string;
}

export function ViraLoader({ size = 180, label = "Carregando", className = "" }: ViraLoaderProps) {
  const reduceMotion = useReducedMotion();
  return <div role="status" aria-live="polite" aria-label={label} className={`inline-flex flex-col items-center gap-5 ${className}`}>
    <motion.div
      className="relative overflow-hidden border-y border-white/10 bg-[#050A12]"
      style={{ width: size, aspectRatio: "1 / 1" }}
      animate={reduceMotion ? undefined : { scale: [0.985, 1, 1, 0.985] }}
      transition={reduceMotion ? undefined : { duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
    >
      <motion.img
        src="/vira-symbol.png"
        alt=""
        className="size-full object-contain p-[12%]"
        initial={false}
        animate={reduceMotion ? { opacity: 1 } : { opacity: [0.55, 1, 1, 0.55] }}
        transition={reduceMotion ? undefined : { duration: 2.8, repeat: Infinity, ease: "easeInOut", times: [0, .3, .78, 1] }}
      />
      {!reduceMotion ? <>
        <motion.span aria-hidden className="absolute inset-y-0 w-px bg-primary/55" animate={{ left: ["18%", "82%", "18%"] }} transition={{ duration: 2.3, repeat: Infinity, ease: "easeInOut" }} />
        <motion.span aria-hidden className="absolute inset-3 border border-primary/25" animate={{ opacity: [0, .65, 0], scale: [.98, 1.02, 1.04] }} transition={{ duration: 2.8, repeat: Infinity, ease: "easeOut", times: [0, .72, 1] }} />
      </> : null}
    </motion.div>
    <motion.span animate={reduceMotion ? undefined : { opacity: [.38, 1, .38] }} transition={reduceMotion ? undefined : { duration: 1.8, repeat: Infinity, ease: "easeInOut" }} className="font-['DM_Mono'] text-[10px] font-bold uppercase tracking-[.18em] text-white/50">{label}</motion.span>
  </div>;
}

export function ViraMiniSpinner({ size = 20 }: { size?: number }) {
  const reduceMotion = useReducedMotion();
  return <motion.span aria-hidden className="inline-block rounded-full border-2 border-current border-r-transparent" style={{ width: size, height: size }} animate={reduceMotion ? undefined : { rotate: 360 }} transition={reduceMotion ? undefined : { duration: 1, repeat: Infinity, ease: "linear" }} />;
}
