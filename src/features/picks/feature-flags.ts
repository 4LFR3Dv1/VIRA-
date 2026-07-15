function enabled(value: unknown) { return String(value ?? "true").toLowerCase() === "true"; }
export const VIRA_PICKS_ENABLED = enabled(import.meta.env.VITE_VIRA_PICKS_ENABLED);
