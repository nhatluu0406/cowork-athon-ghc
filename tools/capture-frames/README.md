# capture-frames — live OpenCode frame capture (CGHC-024, OPT-IN)

Records **real** raw OpenCode `/event` SSE frames from a live PINNED `opencode serve` into
`service/src/execution/fixtures/data/<scenario>.ndjson`, so the captured-frame harness can
replay them through the production mapper + reducer.

> **Opt-in only.** Refuses to run without `CGHC_CAPTURE_LIVE=1`. It is never part of the
> default test suite (`node --import tsx --test`) — no network / no LLM runs by default.
> This runs **after** the product-owner token gate, once a real provider key exists.

## What it guarantees

- Key read from the **OS credential store** (Windows Credential Manager), never argv/env.
- Key injected into the `opencode serve` **child env only** (runtime `buildLaunchSpec`); the
  tool never writes `auth.json`/`env.json` and never logs the key.
- Health-gated to `OPENCODE_PIN` (`v1.17.11`) before any frame is recorded (ADR 0001).
- Provider-neutral: the custom OpenAI-compatible endpoint (e.g. DeepSeek) works identically.
- An **empty** capture exits non-zero — it never writes a hollow "green" fixture.

## Prerequisites

1. A provider key stored under the credential account (e.g. `provider:custom-openai-compat`)
   via the app / credential CLI — this tool only *reads* it.
2. The pinned `opencode` binary path, and a scratch workspace directory.
3. Confirm the server routes for session-create / prompt against the pinned server's OpenAPI
   and pass `--session-path` / `--prompt-path` if they differ from the defaults.

## Run

```bash
CGHC_CAPTURE_LIVE=1 node --import tsx tools/capture-frames/capture.ts simple-chat \
  --provider custom-openai-compat --env-var DEEPSEEK_API_KEY \
  --bin C:/opencode/opencode.exe --workspace C:/tmp/cap-ws --port 51733 \
  --model custom-openai-compat:deepseek-chat --run-ms 60000
```

Or capture against an already-running loopback serve (key already injected by the launcher):

```bash
CGHC_CAPTURE_LIVE=1 node --import tsx tools/capture-frames/capture.ts error \
  --provider custom-openai-compat --base-url http://127.0.0.1:51733
```

## Scenarios to capture (MANIFEST)

`simple-chat`, `tool-call`, `error`, `cancel` — see
`service/src/execution/fixtures/manifest.ts`. After capture, the harness tests
(`service/tests/execution-captured-frames.test.ts`) flip from *skipped (needs capture)* to
*real assertions* against the pinned frames.
