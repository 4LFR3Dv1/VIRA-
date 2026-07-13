
  import { createRoot } from "react-dom/client";
  import App from "./app/App.tsx";
  import { initializeDocumentLocale } from "./i18n/locale.ts";
  import "./styles/index.css";

  initializeDocumentLocale();
  createRoot(document.getElementById("root")!).render(<App />);
