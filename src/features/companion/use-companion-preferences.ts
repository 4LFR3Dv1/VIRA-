import { useCallback, useState } from "react";

import { readCompanionPreferences, writeCompanionPreferences } from "./preferences.ts";

export function useCompanionPreferences(fixtureId: string) {
  const [preferences, setPreferences] = useState(() => readCompanionPreferences(window.localStorage, fixtureId));
  const setEnabled = useCallback((enabled: boolean) => {
    setPreferences(writeCompanionPreferences(window.localStorage, fixtureId, enabled));
  }, [fixtureId]);
  return { preferences, setEnabled };
}
