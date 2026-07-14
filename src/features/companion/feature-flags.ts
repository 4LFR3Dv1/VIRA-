function enabled(value: string | undefined) {
  return value === "true";
}

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;

// Kept for controlled certification builds, absent from the public UI by default.
export const VIRA_VISUAL_COMPANION_ENABLED = enabled(env?.VITE_VIRA_VISUAL_COMPANION_ENABLED);
