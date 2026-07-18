/**
 * Local OneDrive folder detection (PHASE 3 — OneDrive fallback).
 *
 * When Microsoft 365 cloud access is not available (no OAuth app registration, or manual-token
 * only), the Windows OneDrive client still syncs files to a LOCAL folder. This detects that folder
 * from the standard environment variables the OneDrive client sets, so the UI can offer "Dùng thư
 * mục OneDrive trên máy" — opening it as a normal LOCAL workspace (indexed by the existing local
 * Workspace Knowledge). This is deliberately NOT Graph/cloud access: it is plain local filesystem,
 * labelled as such, and never claims to reach the cloud.
 */

import { existsSync } from "node:fs";

/** Env var names the OneDrive client sets, most-specific first (commercial > consumer > generic). */
const ONEDRIVE_ENV_VARS = ["OneDriveCommercial", "OneDriveConsumer", "OneDrive"] as const;

export interface LocalOneDrive {
  readonly path: string;
  /** "commercial" (work/school), "consumer" (personal), or "generic" (the plain OneDrive var). */
  readonly kind: "commercial" | "consumer" | "generic";
}

function kindFor(envVar: string): LocalOneDrive["kind"] {
  if (envVar === "OneDriveCommercial") return "commercial";
  if (envVar === "OneDriveConsumer") return "consumer";
  return "generic";
}

/**
 * Detect the local OneDrive sync folder, or `null` when none exists. `exists` is injected for
 * testability (defaults to `fs.existsSync`); `env` defaults to `process.env`.
 */
export function detectLocalOneDrive(
  env: Record<string, string | undefined> = process.env,
  exists: (path: string) => boolean = existsSync,
): LocalOneDrive | null {
  for (const name of ONEDRIVE_ENV_VARS) {
    const value = env[name];
    if (typeof value === "string" && value.trim().length > 0) {
      const path = value.trim();
      if (exists(path)) return { path, kind: kindFor(name) };
    }
  }
  return null;
}
