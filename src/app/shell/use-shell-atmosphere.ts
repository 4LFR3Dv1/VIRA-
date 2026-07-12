import { useEffect } from "react";

import type { ShellAtmosphereIntent } from "./shell-experience";
import { useShellExperience } from "./ShellContext";

export function useShellAtmosphere(owner: string, intent: ShellAtmosphereIntent | null) {
  const { registerAtmosphere, releaseAtmosphere } = useShellExperience();
  const signature = intent ? JSON.stringify(intent) : "";
  useEffect(() => {
    if (!intent) {
      releaseAtmosphere(owner);
      return undefined;
    }
    registerAtmosphere(owner, intent);
    return () => releaseAtmosphere(owner);
  }, [owner, registerAtmosphere, releaseAtmosphere, signature]);
}

export function fixtureAccent(name: string, side: "home" | "away") {
  const palettes = side === "home"
    ? ["#c7ff18", "#63d79b", "#f1d65c", "#7dd3fc"]
    : ["#719fbd", "#7aa7ff", "#f08aa7", "#b59cff"];
  const hash = [...name].reduce((total, character) => (total * 31 + character.charCodeAt(0)) >>> 0, 7);
  return palettes[hash % palettes.length];
}
