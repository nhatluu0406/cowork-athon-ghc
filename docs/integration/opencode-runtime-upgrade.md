---
status: accepted
updated_at: 2026-07-16
---

# OpenCode runtime upgrade gate

## Current pin (Wave 2)

- Package pin: `1.18.1`
- Runtime pin: `v1.18.1`
- Previous pin: `1.17.11` / `v1.17.11`
- Fallback candidate (also probed, contracts PASS): `1.17.20`

## Decision

Isolated probes of exact `1.18.1` against the required **server contracts** (below) **PASS** on Windows x64. Cowork GHC therefore upgrades the exact pin to `1.18.1`. No floating range.

Live create/modify/deny/tool-latency stages still need a provider key and are tracked separately from the pin gate; they did not block this upgrade because the server HTTP/SSE/permission surfaces Cowork consumes are intact.

## Required compatibility matrix

Probed with `tools/verify/opencode-server-probe.mjs` against installed `opencode-ai@<version>` Windows binaries.

| Contract | 1.17.11 | 1.17.20 | 1.18.1 |
|---|:---:|:---:|:---:|
| health/version (`GET /global/health`) | PASS | PASS | PASS |
| session create (`POST /session`) | PASS | PASS | PASS |
| session get/list | PASS | PASS | PASS |
| prompt send route (`POST /session/{id}/message`) | PASS | PASS | PASS |
| permission reply route (`POST /permission/{id}/reply`) | PASS | PASS | PASS |
| cancel (`POST /session/{id}/abort`) | PASS | PASS | PASS |
| event SSE (`GET /event`) | PASS | PASS | PASS |
| first token streaming (live LLM) | baseline | deferred | deferred |
| terminal/final response (live LLM) | baseline | deferred | deferred |
| create/modify/deny file (live LLM + tools) | baseline | deferred | deferred |
| stop/no orphan (supervisor tests) | PASS (unit) | PASS (unit) | PASS (unit) |
| native Skill discovery | Wave 2B | Wave 2B | Wave 2B |
| MCP local/remote config | Wave 2B | Wave 2B | Wave 2B |

## Timing comparison (server ready)

Single-sample `GET /global/health` latency after `opencode serve` became healthy (probe process, not packaged Electron chat):

| Version | healthLatencyMs |
|---|---:|
| 1.17.11 (baseline) | 163 |
| 1.17.20 | 29 |
| **1.18.1 (new pin)** | **61** |

Interpretation: candidate ready-time is not worse than baseline under this probe. Packaged prompt→first-token comparison remains Wave 1 timing work (`tools/verify/chat-timing-packaged.mjs`) once a provider key is available.

## Upgrade checklist executed

1. Exact `1.18.1` package available on npm.
2. Platform binary installed (`opencode-windows-x64`).
3. Server-contract probe PASS.
4. Fallback `1.17.20` also PASS (kept documented).
5. Pin + package updated together; unit tests use `OPENCODE_PIN`.
