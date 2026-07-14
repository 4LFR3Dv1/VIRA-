import { useCallback, useEffect, useState } from "react";

import { copyCompanionStyles, documentPictureInPictureController } from "./document-pip.ts";

export function useDocumentPictureInPicture() {
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const supported = documentPictureInPictureController(window) !== null;

  const close = useCallback(() => {
    pipWindow?.close();
    setPipWindow(null);
  }, [pipWindow]);

  const open = useCallback(async () => {
    const controller = documentPictureInPictureController(window);
    if (!controller) return null;
    if (pipWindow && !pipWindow.closed) {
      pipWindow.focus();
      return pipWindow;
    }
    const nextWindow = await controller.requestWindow({ width: 420, height: 560 });
    nextWindow.document.title = "VIRA Companion";
    copyCompanionStyles(document, nextWindow.document);
    const root = nextWindow.document.createElement("div");
    root.id = "vira-companion-pip-root";
    nextWindow.document.body.append(root);
    nextWindow.addEventListener("pagehide", () => setPipWindow(null), { once: true });
    setPipWindow(nextWindow);
    return nextWindow;
  }, [pipWindow]);

  useEffect(() => () => pipWindow?.close(), [pipWindow]);
  return { supported, pipWindow, open, close };
}
