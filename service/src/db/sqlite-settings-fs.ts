/**
 * Persist CoworkSettings document in SQLite via the SettingsFs seam.
 * Also mirrors provider profiles + verification fields into dedicated tables (ADR 0007).
 */

import type { SettingsFs } from "../diagnostics/settings-store.js";
import type { CoworkSettings, PersistedProviderProfile } from "../diagnostics/settings-types.js";
import type {
  ProviderProfileRepository,
  ProviderVerificationRepository,
  SettingsRepository,
} from "./repositories.js";

export const SETTINGS_DOCUMENT_KEY = "cowork.settings.document";

function verificationSlice(profile: PersistedProviderProfile): string | null {
  if (
    profile.lastVerifiedAt === undefined &&
    profile.lastVerifiedOk === undefined &&
    profile.verifiedTargetFingerprint === undefined
  ) {
    return null;
  }
  return JSON.stringify({
    lastVerifiedAt: profile.lastVerifiedAt ?? null,
    lastVerifiedOk: profile.lastVerifiedOk ?? null,
    verifiedTargetFingerprint: profile.verifiedTargetFingerprint ?? null,
  });
}

function syncStructuredTables(
  data: string,
  profiles: ProviderProfileRepository | undefined,
  verifications: ProviderVerificationRepository | undefined,
  updatedAt: string,
): void {
  if (profiles === undefined && verifications === undefined) return;
  let parsed: CoworkSettings;
  try {
    parsed = JSON.parse(data) as CoworkSettings;
  } catch {
    return;
  }
  const list = parsed.providerProfiles ?? [];
  if (profiles !== undefined) {
    profiles.clear();
    for (const profile of list) {
      const {
        lastVerifiedAt: _a,
        lastVerifiedOk: _b,
        verifiedTargetFingerprint: _c,
        ...document
      } = profile;
      void _a;
      void _b;
      void _c;
      profiles.upsert(profile.id, JSON.stringify(document), updatedAt);
    }
  }
  if (verifications !== undefined) {
    verifications.clear();
    for (const profile of list) {
      const slice = verificationSlice(profile);
      if (slice !== null) {
        verifications.upsert(profile.id, slice, updatedAt);
      }
    }
  }
}

export function createSqliteSettingsFs(deps: {
  readonly settings: SettingsRepository;
  readonly profiles?: ProviderProfileRepository;
  readonly verifications?: ProviderVerificationRepository;
  readonly now?: () => string;
}): SettingsFs {
  const now = deps.now ?? (() => new Date().toISOString());
  return {
    async read() {
      return deps.settings.getJson(SETTINGS_DOCUMENT_KEY) ?? undefined;
    },
    async write(data) {
      const updatedAt = now();
      deps.settings.setJson(SETTINGS_DOCUMENT_KEY, data, updatedAt);
      syncStructuredTables(data, deps.profiles, deps.verifications, updatedAt);
    },
  };
}
