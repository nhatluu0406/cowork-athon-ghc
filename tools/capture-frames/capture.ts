/**
 * CGHC-024 capture CLI (OPT-IN, post-token). Records RAW OpenCode `/event` frames from a
 * live PINNED run into `service/src/execution/fixtures/data/<scenario>.ndjson`.
 *
 * HARD RULES enforced here:
 *  - OPT-IN ONLY: refuses to run unless `CGHC_CAPTURE_LIVE=1`; it is never in the default suite.
 *  - Key comes from the OS CREDENTIAL STORE (Windows Credential Manager), never argv/env-persisted.
 *  - The key is injected into the `opencode serve` child env ONLY (via runtime buildLaunchSpec);
 *    this tool never writes auth.json/env.json and never logs the key.
 *  - Provider-neutral: works with the custom OpenAI-compatible endpoint (DeepSeek) the same way.
 *
 * Run (example): CGHC_CAPTURE_LIVE=1 node --import tsx tools/capture-frames/capture.ts \
 *   simple-chat --provider custom-openai-compat --env-var DEEPSEEK_API_KEY \
 *   --bin C:/opencode/opencode.exe --workspace C:/tmp/cap-ws --port 51733 \
 *   --model custom-openai-compat:deepseek-chat
 */

import { writeFileSync, existsSync } from "node:fs";
import { createKeyringStore } from "../../service/src/credential/index.js";
import { credentialAccountFor } from "../../service/src/credential/store.js";
import { providerEnvSpec } from "../../service/src/provider/index.js";
import {
  fixturePath,
  recordFrames,
  requiredScenario,
  serializeCapturedFrameFile,
  CAPTURE_PIN,
} from "../../service/src/execution/fixtures/index.js";
import { launchPinnedOpencode } from "./launch.js";
import { writeOpencodeConfig } from "./provider-config.js";
import { abortSession, createSession, openEventStream, sendPrompt } from "./opencode-http.js";

interface Args {
  readonly scenario: string;
  readonly provider: string;
  readonly envVar: string | undefined;
  readonly account: string | undefined;
  readonly baseUrl: string | undefined;
  /** Custom OpenAI-compatible provider base URL (e.g. DeepSeek); written to opencode.json. */
  readonly providerBaseUrl: string | undefined;
  readonly bin: string | undefined;
  readonly workspace: string | undefined;
  readonly port: number;
  readonly model: { providerID: string; modelID: string } | undefined;
  readonly prompt: string | undefined;
  readonly sessionPath: string;
  readonly promptPathTemplate: string;
  readonly runMs: number;
  /** When set, abort the session this many ms after the prompt (the `cancel` scenario). */
  readonly cancelAfterMs: number | undefined;
  /** Treat a prompt-send failure as expected (the `error` scenario), keep recording frames. */
  readonly expectError: boolean;
}

function flag(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 ? argv[i + 1] : undefined;
}

function parseArgs(argv: readonly string[]): Args {
  const scenario = argv[0];
  if (scenario === undefined || scenario.startsWith("--")) {
    throw new Error("usage: capture.ts <scenario> --provider <id> [--env-var NAME] ...");
  }
  const modelRaw = flag(argv, "model");
  const model = modelRaw?.includes(":")
    ? { providerID: modelRaw.split(":")[0] ?? "", modelID: modelRaw.split(":").slice(1).join(":") }
    : undefined;
  return {
    scenario,
    provider: flag(argv, "provider") ?? "custom-openai-compat",
    envVar: flag(argv, "env-var"),
    account: flag(argv, "account"),
    baseUrl: flag(argv, "base-url"),
    providerBaseUrl: flag(argv, "provider-base-url"),
    bin: flag(argv, "bin"),
    workspace: flag(argv, "workspace"),
    port: Number(flag(argv, "port") ?? "51733"),
    model,
    prompt: flag(argv, "prompt"),
    sessionPath: flag(argv, "session-path") ?? "/session",
    promptPathTemplate: flag(argv, "prompt-path") ?? "/session/{id}/message",
    runMs: Number(flag(argv, "run-ms") ?? "60000"),
    cancelAfterMs: flag(argv, "cancel-after-ms") ? Number(flag(argv, "cancel-after-ms")) : undefined,
    expectError: argv.includes("--expect-error"),
  };
}

/** Wrap the SSE stream so an intentional abort ends the capture cleanly (not as an error). */
async function* untilAbort(baseUrl: string, signal: AbortSignal): AsyncIterable<string> {
  try {
    yield* openEventStream(baseUrl, signal);
  } catch (err) {
    if (signal.aborted) return; // planned end-of-capture window
    throw err;
  }
}

async function main(argv: readonly string[]): Promise<number> {
  if (process.env["CGHC_CAPTURE_LIVE"] !== "1") {
    process.stderr.write(
      "capture is OPT-IN: set CGHC_CAPTURE_LIVE=1 to record live frames (post-token only).\n",
    );
    return 2;
  }
  const args = parseArgs(argv);
  const scenario = requiredScenario(args.scenario);
  if (scenario === undefined) {
    throw new Error(`Unknown scenario "${args.scenario}" (see fixtures/manifest.ts).`);
  }

  // Key from the OS credential store — never from argv/env.
  const store = await createKeyringStore();
  const account = credentialAccountFor(args.provider, args.account);
  const key = await store.get(account);
  if (key === null) {
    throw new Error(`No credential in the store for account "${account}". Add it first.`);
  }
  const envVar = providerEnvSpec(args.provider, args.envVar).primaryEnvVar;

  // Connect to an already-running loopback serve, or launch a pinned one with the key injected.
  let baseUrl = args.baseUrl;
  let stop: (() => void) | undefined;
  if (baseUrl === undefined) {
    if (!args.bin || !args.workspace) {
      throw new Error("Provide --base-url of a running serve, or --bin and --workspace to launch.");
    }
    // LOW-3 (review): fail with a clear message if the pinned binary path is wrong, rather
    // than surfacing an opaque spawn error later.
    if (!existsSync(args.bin)) {
      throw new Error(`--bin does not exist: ${args.bin} (install the pinned OpenCode ${CAPTURE_PIN} first).`);
    }
    // Write the NON-SECRET provider definition into the fixture workspace so OpenCode can
    // reach the custom endpoint. The key is written only as `{env:NAME}` (resolved from the
    // injected child env); `key` is passed as a forbidden-substring guard, never persisted.
    if (args.providerBaseUrl && args.model) {
      writeOpencodeConfig(
        args.workspace,
        {
          providerId: args.provider,
          baseUrl: args.providerBaseUrl,
          envVar,
          models: [args.model.modelID],
        },
        key,
      );
    }
    const launched = await launchPinnedOpencode({
      binPath: args.bin,
      cwd: args.workspace,
      port: args.port,
      providerKeys: [{ envVar, value: key }],
    });
    baseUrl = launched.baseUrl;
    stop = launched.stop;
  }

  try {
    const sessionId = await createSession({
      baseUrl,
      sessionPath: args.sessionPath,
      title: `capture:${args.scenario}`,
    });
    const prompt = args.prompt ?? scenario.promptHint;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), args.runMs);
    const recording = recordFrames({
      meta: {
        scenario: args.scenario,
        opencodePin: CAPTURE_PIN,
        capturedAt: new Date().toISOString(),
        sessionId,
        prompt,
        providerId: args.provider,
      },
      chunks: untilAbort(baseUrl, controller.signal),
      sessionFilter: sessionId,
    });
    // The `cancel` scenario aborts the session mid-flight so the terminal is a REAL cancel.
    let cancelTimer: NodeJS.Timeout | undefined;
    if (args.cancelAfterMs !== undefined) {
      cancelTimer = setTimeout(() => {
        void abortSession({ baseUrl, sessionId });
      }, args.cancelAfterMs);
    }
    try {
      await sendPrompt({
        baseUrl,
        promptPathTemplate: args.promptPathTemplate,
        sessionId,
        prompt,
        ...(args.model ? { model: args.model } : {}),
      });
    } catch (err) {
      // The `error` scenario may fail the prompt POST itself; keep recording so the real
      // error frame (if any) still lands, then let the run-window close the stream.
      if (!args.expectError) throw err;
      process.stderr.write(
        `prompt failed (expected for the error scenario): ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
    const file = await recording;
    clearTimeout(timer);
    if (cancelTimer) clearTimeout(cancelTimer);

    const out = fixturePath(args.scenario);
    const serialized = serializeCapturedFrameFile(file);
    // MEDIUM-1 (review): defense in depth — NEVER persist a fixture whose bytes contain the
    // resolved provider key value. Frames are raw provider wire data and meta.prompt is free
    // text, so a provider that echoed the key in an error frame (or a prompt embedding a
    // secret) could otherwise land the key on disk. This is a value substring check (the
    // content is free-form NDJSON, not an env map). Refuse to write on any hit.
    if (key.length > 0 && serialized.includes(key)) {
      throw new Error(
        `Refusing to write ${out}: the captured content contains the provider key value. ` +
          "Fixture NOT written (secret hygiene) — investigate the frame/prompt that echoed it.",
      );
    }
    writeFileSync(out, serialized, "utf8");
    process.stdout.write(`captured ${file.frames.length} frames → ${out}\n`);
    return file.frames.length > 0 ? 0 : 1; // an empty capture is a failure, not a pass.
  } finally {
    stop?.();
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`capture failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
