import { createContext, useContext } from "react";
import type { ShellAtmosphereIntent, ShellExperience } from "./shell-experience";

export type ShellExperienceContextValue = ShellExperience & {
  registerAtmosphere: (owner: string, intent: ShellAtmosphereIntent) => void;
  releaseAtmosphere: (owner: string) => void;
};

export const ShellExperienceContext = createContext<ShellExperienceContextValue | null>(null);

export function useShellExperience() {
  const value = useContext(ShellExperienceContext);
  if (!value) throw new Error("useShellExperience must be used inside ShellStateProvider");
  return value;
}
