import type { ReactNode } from "react";

interface AppShellProps {
  children: ReactNode;
  roomPopulation?: number;
}

export function AppShell({ children, roomPopulation }: AppShellProps) {
  void roomPopulation;
  return <>{children}</>;
}
