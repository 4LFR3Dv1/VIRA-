import { createContext, useContext } from "react";
import type { ShellExperience } from "./shell-experience";

export const ShellExperienceContext = createContext<ShellExperience | null>(null);

export function useShellExperience() {
  const value = useContext(ShellExperienceContext);
  if (!value) throw new Error("useShellExperience must be used inside ShellStateProvider");
  return value;
}
