---
language: "en"
status: "active"
updated_at: "2026-07-18"
owner: "quality"
---

# Release Acceptance

Release-grade acceptance for the **packaged** app (`coworkghc.exe`). Unlike
[`demo-acceptance.md`](./demo-acceptance.md) (happy path for a demo), release acceptance must include
**negative and recovery paths**. Passing unit/build tests is necessary but **not sufficient** —
final acceptance is packaged behaviour + Product-Owner observation.

## A. Happy path (must all pass on the packaged app)

- First run → configure provider + pick workspace → send a chat → streamed answer.
- Conversation persist/switch/rename/delete/relaunch-restore.
- Workspace preview/edit for text/code/PDF/Office within documented limits.
- Permission modes enforce at the execution boundary; File Work Review shows verified evidence.
- Skills + MCP list/enable; Inspector shows plan/activity/files.
- Clean start/stop with no orphan process (`coworkghc.exe`, `opencode.exe`).

## B. Negative / recovery paths (must be handled, not crash or lose data)

| # | Scenario | Expected behaviour |
| --- | --- | --- |
| N1 | App/service startup failure | Clear error surface; retry path; no silent blank UI |
| N2 | Local DB locked / corrupt / migration failure | Detected; recoverable; no silent data loss |
| N3 | Invalid provider credential | Typed error + fix path; no crash |
| N4 | Provider offline / timeout / rate-limit | Honest status; turn fails gracefully; ret/cancel |
| N5 | OpenCode crash / restart | Supervised restart; session state honest |
| N6 | Permission denied / cancelled / expired | Action blocked at boundary; no fake success |
| N7 | File changed / deleted externally | Detected; stale banner; no corrupt write |
| N8 | Dirty-edit conflict | Preserve in-progress edit; explicit overwrite/reload |
| N9 | Unsupported / large / malformed document | Graceful fallback; no hang/crash |
| N10 | Knowledge import interrupted (when D3 active) | Resumable/clean state; data root consistent |
| N11 | Graph / index service unavailable | Honest "unavailable"; app still usable |
| N12 | MS365 disconnected / token expired | Honest disconnected; re-auth path; no fake connected |
| N13 | Dispatch / mobile offline; remote pairing revoked | Blocked; no stale control |
| N14 | MCP server unhealthy | Honest unhealthy state; no fake tool catalog |
| N15 | Disk full / write failure | Error surfaced; no partial-write corruption |
| N16 | Export failure | Error surfaced; nothing half-written |
| N17 | App relaunch / recovery | State restored; no orphan children |
| N18 | No Internet | All local features work; external features show dependency |
| N19 | DPI / window resize (125/150%) | No clipping/overflow; layout holds |
| N20 | Empty / loading / error states | Present and honest on every surface |

## C. Process & security invariants

- No orphan `coworkghc.exe` / `opencode.exe` / child processes after stop.
- No plaintext secret in DB / logs / screenshots / command-line args.
- Renderer never touches DB or secret bytes.
- Filesystem actions confined to the active workspace.

## D. Verification sources

- Focused tests: `npm run verify:fast`; full: `npm test`.
- Packaged regression: `npm run verify:release`.
- Automated packaged UI capture: `npm run audit:ui` (ER-013) → screenshots + orphan/white-screen checks.
- Manual Product-Owner observation for each negative path above.

> Coverage status: the negative/recovery matrix (B) is **tracked** in
> `../product/exhibition-readiness-plan.md §8.3`; most items are TODO. Do not claim release PASS until
> B and C are observed on the packaged app.
