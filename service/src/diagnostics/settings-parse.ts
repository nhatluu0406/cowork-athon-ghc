/**
 * Settings router body parsing (CGHC-022). Server-side validation helpers for the loopback
 * settings routes, split out of `settings-router.ts` to keep each file cohesive and small.
 *
 * Every helper rejects malformed client input with {@link SettingsRequestError} (an HTTP 400
 * via {@link BadRequestError}) rather than letting a bad body reach the store. Secret
 * discipline: a credential is accepted as a HANDLE only (`store` + `account`) — a raw key
 * value never crosses this boundary. The `envVar` name and workspace `rootPath` are
 * NON-SECRET and validated as plain non-empty strings.
 */

import type { CredentialRef, ModelRef } from "@cowork-ghc/contracts";
import { BadRequestError } from "../server/http-util.js";
import type { GeneralSettings } from "./settings-types.js";

/**
 * Malformed / policy-refused settings request (bad client input: a malformed body or an
 * SSRF-refused base_url routed through the provider port). Extends {@link BadRequestError} so the
 * boundary dispatcher maps it to HTTP 400 (not a misleading 500). Message never carries a secret.
 */
export class SettingsRequestError extends BadRequestError {
  constructor(message: string) {
    super(message);
    this.name = "SettingsRequestError";
  }
}

export function asRecord(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null) {
    throw new SettingsRequestError("Request body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

export function requireProviderId(record: Record<string, unknown>): string {
  const id = record.providerId;
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new SettingsRequestError("providerId is required.");
  }
  return id;
}

/** Require a non-empty string field (used for base_url, envVar name, workspace rootPath). */
export function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SettingsRequestError(`${field} is required.`);
  }
  return value;
}

export function parseCredentialRef(record: Record<string, unknown>): CredentialRef {
  const ref = record.ref;
  if (typeof ref !== "object" || ref === null) {
    throw new SettingsRequestError("ref (credential handle) is required.");
  }
  const r = ref as Record<string, unknown>;
  if (r.store !== "os" || typeof r.account !== "string" || r.account.trim().length === 0) {
    throw new SettingsRequestError("ref must be an OS credential handle { store: 'os', account }.");
  }
  // A raw key value is never accepted here — only the handle crosses the boundary.
  return { store: "os", account: r.account };
}

export function parseModelRef(value: unknown): ModelRef {
  if (typeof value !== "object" || value === null) {
    throw new SettingsRequestError("model must be an object { providerID, modelID }.");
  }
  const m = value as Record<string, unknown>;
  if (typeof m.providerID !== "string" || m.providerID.length === 0) {
    throw new SettingsRequestError("model.providerID is required.");
  }
  if (typeof m.modelID !== "string" || m.modelID.length === 0) {
    throw new SettingsRequestError("model.modelID is required.");
  }
  return { providerID: m.providerID, modelID: m.modelID };
}

export function parseGeneralPatch(record: Record<string, unknown>): Partial<GeneralSettings> {
  const patch: { -readonly [K in keyof GeneralSettings]?: GeneralSettings[K] } = {};
  if (record.theme !== undefined) {
    if (record.theme !== "system" && record.theme !== "light" && record.theme !== "dark") {
      throw new SettingsRequestError("theme must be one of system|light|dark.");
    }
    patch.theme = record.theme;
  }
  if (record.verboseLogging !== undefined) {
    if (typeof record.verboseLogging !== "boolean") {
      throw new SettingsRequestError("verboseLogging must be a boolean.");
    }
    patch.verboseLogging = record.verboseLogging;
  }
  if (record.telemetryEnabled !== undefined) {
    if (typeof record.telemetryEnabled !== "boolean") {
      throw new SettingsRequestError("telemetryEnabled must be a boolean.");
    }
    patch.telemetryEnabled = record.telemetryEnabled;
  }
  if (record.devtoolsEnabled !== undefined) {
    if (typeof record.devtoolsEnabled !== "boolean") {
      throw new SettingsRequestError("devtoolsEnabled must be a boolean.");
    }
    patch.devtoolsEnabled = record.devtoolsEnabled;
  }
  if (record.requireLoginOnStartup !== undefined) {
    if (typeof record.requireLoginOnStartup !== "boolean") {
      throw new SettingsRequestError("requireLoginOnStartup must be a boolean.");
    }
    patch.requireLoginOnStartup = record.requireLoginOnStartup;
  }
  return patch;
}
