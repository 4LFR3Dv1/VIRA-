export interface DocumentPictureInPictureController {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
}

export function documentPictureInPictureController(value: Window): DocumentPictureInPictureController | null {
  const controller = (value as Window & { documentPictureInPicture?: DocumentPictureInPictureController }).documentPictureInPicture;
  return controller && typeof controller.requestWindow === "function" ? controller : null;
}

export function installCompanionStyles(target: Document, cssText: string) {
  const style = target.createElement("style");
  style.dataset.viraCompanionPip = "true";
  style.textContent = cssText;
  target.head.append(style);
}
