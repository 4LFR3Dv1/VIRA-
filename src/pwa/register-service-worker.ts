export function canRegisterServiceWorker(location: Pick<Location, "protocol" | "hostname">, navigatorValue: Pick<Navigator, "serviceWorker">) {
  const secure = location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
  return secure && Boolean(navigatorValue.serviceWorker);
}

export function registerViraServiceWorker() {
  if (!canRegisterServiceWorker(window.location, navigator)) return;
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => undefined);
  }, { once: true });
}
