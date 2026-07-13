import { ShellStateProvider } from "./ShellStateProvider";
import { ViraAppShell } from "./ViraAppShell";
import { LocaleProvider } from "../../i18n/locale-context.tsx";

export function RootLayout() {
  return <LocaleProvider><ShellStateProvider><ViraAppShell /></ShellStateProvider></LocaleProvider>;
}
