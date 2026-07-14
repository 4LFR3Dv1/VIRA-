import { useCallback, useEffect, useRef, useState } from "react";

import companionPipCss from "./companion-pip.css?inline";
import { documentPictureInPictureController, installCompanionStyles } from "./document-pip.ts";

function recordLifecycle(event: string) { (globalThis as typeof globalThis & { __VIRA_COMPANION_LIFECYCLE_PROBE__?: (event: string) => void }).__VIRA_COMPANION_LIFECYCLE_PROBE__?.(event); }

export function useDocumentPictureInPicture() {
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const pipWindowRef = useRef<Window | null>(null);
  const removeWindowListenerRef = useRef<(() => void) | null>(null);
  const supported = documentPictureInPictureController(window) !== null;

  const close = useCallback(() => {
    const current = pipWindowRef.current;
    removeWindowListenerRef.current?.(); removeWindowListenerRef.current = null;
    pipWindowRef.current = null;
    setPipWindow(null);
    if (current && !current.closed) current.close();
  }, []);

  const open = useCallback(async () => {
    const controller = documentPictureInPictureController(window);
    if (!controller) return null;
    const current = pipWindowRef.current;
    if (current && !current.closed) {
      current.focus();
      return current;
    }
    const nextWindow = await controller.requestWindow({ width: 420, height: 560 });
    nextWindow.document.title = "VIRA Companion";
    installCompanionStyles(nextWindow.document, companionPipCss);
    const root = nextWindow.document.createElement("div");
    root.id = "vira-companion-pip-root";
    nextWindow.document.body.append(root);
    nextWindow.scrollTo(0, 0);
    recordLifecycle("root_created");
    const handlePageHide = () => {
      if (pipWindowRef.current !== nextWindow) return;
      removeWindowListenerRef.current?.(); removeWindowListenerRef.current = null;
      pipWindowRef.current = null; setPipWindow(null);
    };
    nextWindow.addEventListener("pagehide", handlePageHide, { once: true });
    recordLifecycle("pip_pagehide_added");
    removeWindowListenerRef.current = () => { nextWindow.removeEventListener("pagehide", handlePageHide); root.remove(); recordLifecycle("pip_pagehide_removed"); recordLifecycle("root_removed"); };
    pipWindowRef.current = nextWindow;
    setPipWindow(nextWindow);
    return nextWindow;
  }, []);

  useEffect(() => { window.addEventListener("pagehide", close); recordLifecycle("origin_pagehide_added"); return () => { window.removeEventListener("pagehide", close); recordLifecycle("origin_pagehide_removed"); close(); }; }, [close]);
  return { supported, pipWindow, open, close };
}
