# EV stream event format (per-turn streaming)

The renderer receives a turn's live activity as a stream of **EV events** over a two-hop SSE
pipeline: `OpenCode /event → service (map + fold) → renderer /v1/session/stream`. The service
maps raw OpenCode frames onto Cowork-GHC's own EV shapes (it never fabricates a terminal state)
and folds them into one authoritative `SessionView` that a resync can return.

Canonical types: [`core/contracts/src/ev.ts`](../../core/contracts/src/ev.ts). Mapper:
`service/src/execution/ev-mapper.ts` + `part-mapper.ts`. Reducer/view:
`service/src/execution/ev-reducer.ts`. Wire framing: `service/src/execution/ev-sse.ts`.

## Envelope

Every event shares:

| Field | Type | Meaning |
|---|---|---|
| `kind` | string | Discriminant (see below). |
| `seq` | number | Monotonic per session — the resync cursor. Events with `seq <= lastSeq` are ignored. |
| `sessionId` | string | The runtime session (one per turn). |
| `at` | string | ISO-8601 timestamp assigned at the service boundary. |

Wire frame (hop 2): `event: ev\ndata: <json>\n\n`.

## Event kinds

| `kind` | Payload | Notes |
|---|---|---|
| `plan` | `todos: {id,title,status}[]` | Plan/todo timeline (EV1). |
| `step` | `stepId, label, status` | Per-step transition (EV2). |
| `tool_call` | `callId, toolName, status, summary?` | One row per `callId`, upserted so `running → completed` transitions in place (EV3). `summary` is the file path (or the tool title) — non-secret. |
| `file_mutation` | `operation, path, previousPath?` | A real, completed file change (EV4); drives File Work Review. |
| `token` | `delta` | Assistant answer text delta (S2). **Only the answer's `text` field** — model "thinking"/reasoning deltas (`field: "reasoning"`) are dropped and never streamed as tokens. |
| `progress` | `label, ratio?` | Long-running "still working" hint (EV5); a liveness marker, cleared on terminal. |
| `metrics` | `metrics: TurnMetrics` | **Per-turn runtime usage (issue #4)** — see below. |
| `error` | `message, recovery?` | Recoverable failure (EV6); does not itself end the run. |
| `terminal` | `state, message?` | The honest end marker (EV7): `completed` \| `errored` \| `cancelled` \| `denied`. First terminal wins. |

## Per-turn metrics (`metrics`)

`TurnMetrics` carries **non-secret counts only** (never prompt/response content or credentials):

| Field | Meaning |
|---|---|
| `tokensInput?` | Prompt/input tokens. |
| `tokensOutput?` | Completion/output tokens. |
| `tokensTotal?` | Total tokens (may include cache/reasoning per provider). |
| `tokensReasoning?` | Reasoning tokens, when reported separately. |
| `tokensCache?` | Cached-context tokens (prompt-cache read + write). Usually most of `tokensTotal` — the runtime's reused system prompt + tool schemas. |
| `costUsd?` | Estimated cost, when reported. |

Source: OpenCode reports usage on `step-finish` parts (`properties.part.tokens` + `.cost`); the
mapper forwards it as a `metrics` event. The reducer keeps the **latest** snapshot in
`SessionView.metrics`, and it **survives the terminal fold** so a completed turn can display its
usage. The renderer shows a compact footer under the answer: `⏱ <runtime> · <total> tokens
(<in>↑ <out>↓) · $<cost>`. Runtime is measured client-side (send → terminal).

## Per-turn isolation

Live activity is reset at the start of every send (`resetLiveActivity`), so a turn's tool trace,
progress, and metrics never mix with a previous turn. Reopened conversations show persisted
per-turn records (`RuntimeTurnRecord`: `startedAt`/`completedAt`/`status`); token/cost metrics are
currently live-only (not yet persisted across reopen).
