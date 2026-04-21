export const STORAGE_SCHEMA_VERSION = 2;

export type StoredProfile = {
  id: string;
  name: string;
  vlessUrl: string;
  createdAt: number;
};

export type StorageShape = {
  schemaVersion: number;
  profiles: StoredProfile[];
  activeProfileId: string | null;
};

type NormalizedStorage = {
  state: StorageShape;
  needsWrite: boolean;
  removeLegacyVless: boolean;
};

type LegacyRawStorage = {
  schemaVersion?: unknown;
  profiles?: unknown;
  activeProfileId?: unknown;
  vlessUrl?: unknown;
};

function isStoredProfile(value: unknown): value is StoredProfile {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.vlessUrl === "string" &&
    typeof v.createdAt === "number"
  );
}

export function normalizeStorage(
  raw: LegacyRawStorage,
  createFromLegacyVless: (vlessUrl: string) => StoredProfile
): NormalizedStorage {
  const parsedSchemaVersion = typeof raw.schemaVersion === "number" ? raw.schemaVersion : 0;
  let profiles = Array.isArray(raw.profiles) ? raw.profiles.filter(isStoredProfile) : [];
  let activeProfileId = typeof raw.activeProfileId === "string" ? raw.activeProfileId : null;
  let removeLegacyVless = false;
  let needsWrite = parsedSchemaVersion !== STORAGE_SCHEMA_VERSION;

  if (profiles.length === 0 && typeof raw.vlessUrl === "string" && raw.vlessUrl.trim()) {
    profiles = [createFromLegacyVless(raw.vlessUrl)];
    activeProfileId = profiles[0].id;
    removeLegacyVless = true;
    needsWrite = true;
  }

  if (profiles.length > 0 && (!activeProfileId || !profiles.some((p) => p.id === activeProfileId))) {
    activeProfileId = profiles[0].id;
    needsWrite = true;
  }

  return {
    state: {
      schemaVersion: STORAGE_SCHEMA_VERSION,
      profiles,
      activeProfileId
    },
    needsWrite,
    removeLegacyVless
  };
}
