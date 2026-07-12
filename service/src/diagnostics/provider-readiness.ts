/**
 * Provider configuration readiness (service boundary).
 */

import type { ModelRef } from "@cowork-ghc/contracts";
import type { SettingsStore } from "./settings-store.js";

export type ProviderReadinessBlockReason =
  | "provider_missing"
  | "model_missing"
  | "credential_missing"
  | "base_url_invalid";

export interface ProviderReadinessFailure {
  readonly ok: false;
  readonly reason: ProviderReadinessBlockReason;
  readonly message: string;
}

export interface ProviderReadinessSuccess {
  readonly ok: true;
}

export type ProviderReadinessResult = ProviderReadinessSuccess | ProviderReadinessFailure;

function isBaseUrlLocallyValid(baseUrl: string | undefined): boolean {
  if (baseUrl === undefined || baseUrl.trim().length === 0) return true;
  try {
    const url = new URL(baseUrl.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Assess whether a runtime session may be created for the given model. */
export function assessProviderReadiness(
  store: Pick<SettingsStore, "defaultModel" | "listProviderSettings">,
  model?: ModelRef,
): ProviderReadinessResult {
  const resolved = model ?? store.defaultModel();
  if (resolved === undefined) {
    return {
      ok: false,
      reason: "model_missing",
      message: "Chọn nhà cung cấp và mô hình trước khi bắt đầu.",
    };
  }
  if (resolved.modelID.trim().length === 0) {
    return {
      ok: false,
      reason: "model_missing",
      message: "Mô hình không được để trống.",
    };
  }
  const row = store.listProviderSettings().find((p) => p.providerId === resolved.providerID);
  if (row === undefined) {
    return {
      ok: false,
      reason: "provider_missing",
      message: "Nhà cung cấp chưa được cấu hình.",
    };
  }
  if (!isBaseUrlLocallyValid(row.baseUrl)) {
    return {
      ok: false,
      reason: "base_url_invalid",
      message: "Base URL không hợp lệ.",
    };
  }
  if (row.credentialRef === undefined) {
    return {
      ok: false,
      reason: "credential_missing",
      message: "Cần cấu hình khoá API trước khi bắt đầu.",
    };
  }
  return { ok: true };
}
