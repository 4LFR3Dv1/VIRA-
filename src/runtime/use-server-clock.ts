import { useEffect, useMemo, useState } from "react";

export function useServerClock(serverTime: string | null | undefined, targetTime?: string | null, intervalMs = 1_000, options?: { suspendWhenHidden?: boolean }) {
  const offsetMs = useMemo(() => {
    const serverMs = Date.parse(serverTime ?? "");
    return Number.isFinite(serverMs) ? serverMs - Date.now() : 0;
  }, [serverTime]);
  const targetMs = Date.parse(targetTime ?? "");
  const hasTarget = Number.isFinite(targetMs);
  const [now, setNow] = useState(() => Date.now() + offsetMs);
  useEffect(() => {
    if (!hasTarget) return;
    let timer: number | null = null;
    const clear = () => { if (timer !== null) window.clearInterval(timer); timer = null; };
    const update = () => {
      const nextNow = Date.now() + offsetMs;
      setNow(nextNow);
      if (targetMs <= nextNow) clear();
    };
    const start = () => {
      clear();
      if (options?.suspendWhenHidden !== false && document.hidden) return;
      update();
      if (targetMs > Date.now() + offsetMs) timer = window.setInterval(update, Math.max(1_000, intervalMs));
    };
    const onVisibilityChange = () => start();
    start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => { clear(); document.removeEventListener("visibilitychange", onVisibilityChange); };
  }, [hasTarget, intervalMs, offsetMs, options?.suspendWhenHidden, targetMs]);
  const remainingMs = hasTarget ? Math.max(0, targetMs - now) : null;
  return { now, offsetMs, remainingMs };
}
