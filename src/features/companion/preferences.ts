export interface ViraCompanionPreferencesV1 {
  version: 1;
  fixtureId: string;
  enabled: boolean;
  updatedAt: string;
}

export function companionPreferenceKey(fixtureId: string) {
  return `vira:companion:v1:${fixtureId}`;
}

export function readCompanionPreferences(storage: Pick<Storage, "getItem">, fixtureId: string): ViraCompanionPreferencesV1 {
  try {
    const parsed = JSON.parse(storage.getItem(companionPreferenceKey(fixtureId)) ?? "null") as Partial<ViraCompanionPreferencesV1> | null;
    if (parsed?.version === 1 && parsed.fixtureId === fixtureId && typeof parsed.enabled === "boolean") return parsed as ViraCompanionPreferencesV1;
  } catch { /* fail closed to disabled */ }
  return { version: 1, fixtureId, enabled: false, updatedAt: new Date(0).toISOString() };
}

export function writeCompanionPreferences(storage: Pick<Storage, "setItem">, fixtureId: string, enabled: boolean, now = new Date()): ViraCompanionPreferencesV1 {
  const value: ViraCompanionPreferencesV1 = { version: 1, fixtureId, enabled, updatedAt: now.toISOString() };
  storage.setItem(companionPreferenceKey(fixtureId), JSON.stringify(value));
  return value;
}
