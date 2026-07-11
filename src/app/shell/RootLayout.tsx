import { ShellStateProvider } from "./ShellStateProvider";
import { ViraAppShell } from "./ViraAppShell";

export function RootLayout() {
  return <ShellStateProvider><ViraAppShell /></ShellStateProvider>;
}
