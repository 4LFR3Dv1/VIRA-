/// <reference types="vite/client" />

declare module "react-dom" {
  import type { ReactNode } from "react";
  export function createPortal(children: ReactNode, container: Element | DocumentFragment): ReactNode;
}

declare module "react-dom/client" {
  import type { ReactNode } from "react";
  export function createRoot(container: Element | DocumentFragment): { render(children: ReactNode): void };
}
