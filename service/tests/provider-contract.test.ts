/**
 * CGHC-024 — provider CONTRACT suite wiring (testing.md "provider contract tests").
 *
 * Runs the ONE reusable {@link runProviderContractSuite} across a built-in adapter (OpenAI)
 * and the user-defined OpenAI-compatible endpoint (the DeepSeek-behind-OpenCode shape),
 * proving the suite is provider-neutral. The taxonomy / configured-model / redaction cases
 * run for real now; connect / streaming / cancellation are gated on captured fixtures and
 * skip with the pin-gate reason until they are recorded post-token.
 */

import type { ModelRef, ResolvedAddress } from "@cowork-ghc/contracts";
import {
  createProviderPort,
  createSsrfPolicy,
  CUSTOM_OPENAI_COMPAT_ID,
  providerEnvSpec,
  type ConnectTarget,
  type ProviderConnector,
  type ProviderPort,
} from "../src/provider/index.js";
import { runProviderContractSuite } from "./support/provider-contract-suite.js";

const PUBLIC_RESOLVER = async (): Promise<readonly ResolvedAddress[]> => [
  { address: "93.184.216.34", family: 4 },
];

function fakeConnector(): ProviderConnector {
  return {
    probe: async (_id, _target: ConnectTarget | null) => ({ ok: true }),
    cancel: async () => {},
  };
}

function makePort(): ProviderPort {
  return createProviderPort({
    ssrf: createSsrfPolicy({ resolver: PUBLIC_RESOLVER }),
    connector: fakeConnector(),
  });
}

// Built-in adapter (OpenAI): env var from the confirmed CGHC-001 map.
runProviderContractSuite({
  port: makePort(),
  providerId: "openai",
  label: "openai",
  sampleModel: { providerID: "openai", modelID: "gpt-4o" } satisfies ModelRef,
  injectEnvVar: providerEnvSpec("openai").primaryEnvVar,
  streamingScenario: "simple-chat",
  cancelScenario: "cancel",
});

// Custom OpenAI-compatible endpoint (DeepSeek behind OpenCode): user-supplied env var.
runProviderContractSuite({
  port: makePort(),
  providerId: CUSTOM_OPENAI_COMPAT_ID,
  label: "custom-openai-compat",
  sampleModel: { providerID: CUSTOM_OPENAI_COMPAT_ID, modelID: "deepseek-chat" } satisfies ModelRef,
  injectEnvVar: providerEnvSpec(CUSTOM_OPENAI_COMPAT_ID, "DEEPSEEK_API_KEY").primaryEnvVar,
  streamingScenario: "simple-chat",
  cancelScenario: "cancel",
});
