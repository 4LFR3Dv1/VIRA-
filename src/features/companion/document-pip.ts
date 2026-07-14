export interface DocumentPictureInPictureController {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
}

export function documentPictureInPictureController(value: Window): DocumentPictureInPictureController | null {
  const controller = (value as Window & { documentPictureInPicture?: DocumentPictureInPictureController }).documentPictureInPicture;
  return controller && typeof controller.requestWindow === "function" ? controller : null;
}

export function copyCompanionStyles(source: Document, target: Document) {
  for (const styleSheet of Array.from(source.styleSheets)) {
    if (styleSheet.href) {
      const link = target.createElement("link");
      link.rel = "stylesheet";
      link.href = styleSheet.href;
      target.head.append(link);
      continue;
    }
    try {
      const style = target.createElement("style");
      style.textContent = Array.from(styleSheet.cssRules).map((rule) => rule.cssText).join("\n");
      target.head.append(style);
    } catch { /* cross-origin styles stay in their original document */ }
  }
  const base = target.createElement("style");
  base.textContent = "html,body,#vira-companion-pip-root{margin:0;min-height:100%;background:#050A12;color:#F5F7F2}body{font-family:Arial,sans-serif}";
  target.head.append(base);
}
