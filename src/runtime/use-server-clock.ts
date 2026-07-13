import { useEffect, useMemo, useState } from "react";

export function useServerClock(serverTime: string | null | undefined, targetTime?: string | null, intervalMs = 500) {
  const offsetMs = useMemo(() => {
    const serverMs = Date.parse(serverTime ?? "");
    return Number.isFinite(serverMs) ? serverMs - Date.now() : 0;
  }, [serverTime]);
  const [now, setNow] = useState(() => Date.now() + offsetMs);
  useEffect(() => {
    const update = () => setNow(Date.now() + offsetMs);
    update();
    const timer = window.setInterval(update, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, offsetMs, targetTime]);
  const targetMs = Date.parse(targetTime ?? "");
  const remainingMs = Number.isFinite(targetMs) ? Math.max(0, targetMs - now) : null;
  return { now, offsetMs, remainingMs };
}
