import { describe, expect, it } from "vitest";
import { STORAGE_SCHEMA_VERSION, normalizeStorage, type StoredProfile } from "./profile-storage.js";

function makeProfile(id: string, vlessUrl = "vless://id@host:443"): StoredProfile {
  return {
    id,
    name: `profile-${id}`,
    vlessUrl,
    createdAt: 1700000000000
  };
}

describe("normalizeStorage", () => {
  it("migrates legacy vlessUrl into profiles and sets active profile", () => {
    const result = normalizeStorage(
      {
        schemaVersion: 0,
        vlessUrl: "vless://legacy"
      },
      (legacy) => makeProfile("migrated", legacy)
    );

    expect(result.removeLegacyVless).toBe(true);
    expect(result.needsWrite).toBe(true);
    expect(result.state.schemaVersion).toBe(STORAGE_SCHEMA_VERSION);
    expect(result.state.profiles).toHaveLength(1);
    expect(result.state.profiles[0].id).toBe("migrated");
    expect(result.state.activeProfileId).toBe("migrated");
  });

  it("repairs missing active profile reference", () => {
    const result = normalizeStorage(
      {
        schemaVersion: STORAGE_SCHEMA_VERSION,
        profiles: [makeProfile("a"), makeProfile("b")],
        activeProfileId: "missing"
      },
      () => makeProfile("legacy")
    );

    expect(result.needsWrite).toBe(true);
    expect(result.state.activeProfileId).toBe("a");
    expect(result.removeLegacyVless).toBe(false);
  });

  it("keeps stable storage untouched when already valid", () => {
    const result = normalizeStorage(
      {
        schemaVersion: STORAGE_SCHEMA_VERSION,
        profiles: [makeProfile("a")],
        activeProfileId: "a"
      },
      () => makeProfile("legacy")
    );

    expect(result.needsWrite).toBe(false);
    expect(result.removeLegacyVless).toBe(false);
    expect(result.state.activeProfileId).toBe("a");
    expect(result.state.profiles).toHaveLength(1);
  });
});
