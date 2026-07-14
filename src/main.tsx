
  import { createRoot } from "react-dom/client";
  import App from "./app/App.tsx";
  import { initializeDocumentLocale } from "./i18n/locale.ts";
  import { registerViraServiceWorker } from "./pwa/register-service-worker.ts";
  import "./styles/index.css";

  initializeDocumentLocale();
  registerViraServiceWorker();
  createRoot(document.getElementById("root")!).render(<App />);
