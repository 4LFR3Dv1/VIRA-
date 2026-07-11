import { formatMatchClock } from "../../domain/contracts";
import type { TimelineEntry as TimelineEntryType } from "../../domain/types";

interface TimelineProps {
  entries: TimelineEntryType[];
}

export function Timeline({ entries }: TimelineProps) {
  return (
    <section className="mt-5 rounded-[1.2rem] border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold">Eventos recentes</h2>
        <span className="text-xs text-muted-foreground">{entries.length} entradas</span>
      </div>
      <ol className="space-y-3">
        {entries.slice(0, 5).map((entry) => (
          <li key={entry.id} className="rounded-xl bg-background/80 px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold">{entry.title}</p>
              <span className="font-['DM_Mono'] text-[11px] text-primary">{formatMatchClock(entry.matchClockSec)}</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{entry.description}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

