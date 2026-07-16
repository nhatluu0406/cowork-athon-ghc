---
language: "vi"
status: "active"
updated_at: "2026-07-16"
---

# Known limitations — redesign period

- OpenCode pin: **1.18.1** (Wave 2 server-contract matrix PASS; fallback **1.17.20** also PASS). Live create/modify/delete latency still needs packaging + provider-key follow-up.
- PDF/live Workspace refresh, Inspector Phase 1, and full diagnostics remain pending.
- MCP OAuth is deferred (OpenCode-managed tokens would live outside Cowork's encrypted vault).
- MCP Phase 1 does not expose tool catalogs (`toolCount` stays 0); reachability-only for now.
- Web / Next.js remains deferred.

## OpenCode has no dedicated `delete` tool (pin 1.18.1)

**Why “Xoá file” often fails / lies:** Cowork maps a `delete` tool and `apply_patch` `*** Delete File:`
into File Review + elevated permission — but the **pinned OpenCode build agent does not expose
those tools to the LLM**.

Verified with `opencode debug agent build` against the live Cowork config (2026-07-16), agent
`tools` booleans included:

| Tool | Exposed |
|---|---|
| `read` / `glob` / `grep` | yes |
| `edit` / `write` | yes |
| `todowrite` | yes |
| `bash` / `task` | no (Cowork also denies) |
| `question` | no (product deny — see below) |
| **`delete`** | **absent from schema** |
| **`patch` / `apply_patch`** | **absent from schema** |

**Can Cowork “turn it on”?** No — not on this pin. Probed configs that set
`tools.delete` / `tools.patch` / `tools.apply_patch` (and the same under `agent.build.tools`)
still yield a build-agent `tools` map **without** `delete` or `patch` keys. The public
`https://opencode.ai/config.json` schema also has **no** `delete`/`patch` tool names; `tools` is
only `additionalProperties: boolean` over the tools OpenCode actually implements. Upstream docs
still describe an `apply_patch` delete format, but that tool is not listed for the Windows
**1.18.1** build agent we ship.

So on a “xoá file” turn the model can only `glob`/`read`/`edit`/`write`. Observed live failure
mode: it **reads the file then claims “đã xoá” with no mutation tool** — disk unchanged. Emptying
via `edit` is another failure mode (file remains).

**Product consequence:** live Journey C / demo “delete” must not rely on LLM honesty. Prefer
deterministic packaged product-path proofs; keep UI verification (`file-action-integrity`) so
unverified create/edit/delete claims are marked incomplete when no matching File Review exists.
Do **not** enable `bash` just to get `rm` — that reopens arbitrary command execution.

**Upstream path:** wait for an OpenCode pin that actually lists `delete` or `patch`/`apply_patch`
for the build agent on Windows, then re-verify `opencode debug agent build` before claiming
delete WORKS.

## Turn-perf readings (packaged, 2026-07-16)

Typical after live is already attached: `runtime_ensure` ≈ 30–40ms, `first_token_to_paint` ≈ 1–6ms
(UI not the bottleneck). First send after settings→live can spend ≈ **2s** in `runtime_ensure`
(stop+start OpenCode) — expected, not a UI hang.

`prompt_accept` in the demo SUMMARY is **misleading**: it is wall time from `RUNTIME_READY` until
`PROMPT_ACCEPTED`, and OpenCode holds `POST /session/.../message` until the turn finishes (tools +
model). Large `prompt_accept` / `time_to_first_token` on tool-heavy turns are mostly **model +
tool loops**, not Cowork loopback latency. Permission auto-approve in these samples was ≈ 12–15ms.

## PATCH `/v1/conversations/{id}` 500 on File Review persist

**Cause:** `file_review_refs.id` is a **global** PRIMARY KEY, but File Review ids were
`review-${opencodeSeq}`. OpenCode `seq` restarts per session, so two conversations can collide →
SQLite UNIQUE constraint → honest Internal 500 on activity PATCH (after FILE_VERIFIED).

**Fix (2026-07-16):** review ref PRIMARY KEY is namespaced as `{conversationId}:{reviewId}`;
UI also emits `review-${runtimeSessionId}-${seq}`. Duplicate ids within one persist are skipped.

## OpenCode `question` tool (temporary deny)

**Symptom:** After a successful first chat turn, a second prompt (often “tạo file…”) can fail with
`POST /v1/session/{id}/message` → **503** (`runtime_unavailable`), while OpenCode logs
`asking id=que_… questions=1`.

**Cause:** OpenCode's interactive `question` tool blocks the live turn until a structured reply is
posted on a dedicated reply channel. Cowork GHC currently owns **permission** Allow/Deny UI only —
there is **no** product surface to answer `question` interrupts. With `question: allow`, the model
can stall the `POST /session/.../message` call until the Opencode HTTP client times out (~15s),
which the session router maps to a honest 503.

**Temporary product choice (2026-07-16):** deny the OpenCode `question` tool in live
`opencode.json` (`LIVE_SESSION_PERMISSION_POLICY.question = "deny"`). Clarifying questions must go
through normal chat turns instead. A dedicated Question interrupt UI (SSE + reply port + modal) is
**deferred** — do not re-enable `question: allow` until that surface ships.

**Related (not the same):** Permission prompts (`permission.asked`) already have a Cowork bridge +
UI. Modes like **Tự động** (`workspace_auto`) auto-allow standard file edits; elevated actions
(delete/move/command) still ask. That path is separate from the `question` tool.
