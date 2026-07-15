/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_VIRA_PICKS_ENABLED?: string;
}

declare module "react-dom" {
  import type { ReactNode } from "react";
  export function createPortal(children: ReactNode, container: Element | DocumentFragment): ReactNode;
}

declare module "react-dom/client" {
  import type { ReactNode } from "react";
  export function createRoot(container: Element | DocumentFragment): { render(children: ReactNode): void };
}
