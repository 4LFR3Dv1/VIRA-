import { useEffect, useState, type CSSProperties } from "react";

import { useShellExperience } from "./ShellContext";

function safeAccent(value: string | undefined, fallback: string) {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

export function ViraShellBackground({ paused = false }: { paused?: boolean }) {
  const { atmosphere } = useShellExperience();
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const style = {
    "--shell-home-accent": safeAccent(atmosphere.homeAccent, "#c7ff18"),
    "--shell-away-accent": safeAccent(atmosphere.awayAccent, "#719fbd"),
    "--shell-fixture-focus": atmosphere.fixtureFocus,
  } as CSSProperties;
  return <div aria-hidden className="vira-shell-background" data-atmosphere={atmosphere.atmosphere} data-context={atmosphere.context} data-paused={paused || !visible ? "true" : "false"} style={style}>
    <div className="vira-shell-background__light" />
    <div className="vira-shell-background__pitch" />
    <div className="vira-shell-background__grain" />
    <div className="vira-shell-background__vignette" />
  </div>;
}
