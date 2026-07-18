---
language: "en"
status: "active"
updated_at: "2026-07-18"
owner: "product"
---

# Exhibition Readiness Plan

An **ordered, mandatory implementation plan** (not a wishlist) to take Cowork GHC from "works on the
happy path" to a product that a newcomer can understand, that shows readiness/status honestly, that
survives common errors, and that is consistent enough to exhibit. Every item is evidence-based.

Priorities: **P0** build/security/data-loss · **P1** local runtime + readiness/error/recovery ·
**P2** onboarding + UI consistency · **P3** performance + polish. Complexity: **S/M/L** (no time
estimates). Status: TODO / BLOCKED / DONE.

Item fields: ID · Priority · Surface · Problem (evidence) · Proposed change · Dependencies · Risk ·
Acceptance (observable) · Verification · Complexity · Status.

## 1. Workstreams (ordered)

1. Architecture / local-first migration
2. Knowledge Base / Knowledge Graph localization
3. Runtime / process supervision
4. Data / database / migration / recovery
5. Security & privacy
6. Product readiness / status model
7. Onboarding & first-run
8. UI design-system consolidation
9. Surface-specific UI improvements
10. Error / recovery UX
11. Performance & resource usage
12. Accessibility / DPI / keyboard
13. Packaging / install / update
14. Automated functional acceptance
15. Visual regression / audit
16. Documentation & demo preparation

## 2. Backlog (key items)

| ID | P | Surface | Problem (evidence) | Proposed change | Deps | Risk | Acceptance | Verify | Cx | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ER-001 | P0 | Packaging | Exe rename config landed but not packaged-verified (audit scoped out packaging) | Run `package:win`, confirm `dist-app\win-unpacked\coworkghc.exe`, icon + display name | — | low | Packaged exe = coworkghc.exe; titlebar/installer show "Cowork GHC" | package + launch | S | DONE (2026-07-18): `coworkghc.exe` + `Cowork GHC` setup/portable; icon embedded via afterPack |
| ER-002 | P0 | Onboarding | Packaged first-run cannot pick a workspace / set LLM before the service that needs config to start (memory: onboarding-first-run-gap) | First-run wizard that can configure provider + workspace before full service start | ER-001 | data | New user reaches a usable chat without editing files | packaged manual | M | TODO |
| ER-003 | P0 | Security | One shared SSRF policy serves provider/MCP/MS365/Power-Automate; loosening one loosens all (known-limitations) | Scope-split SSRF per consumer + independent review | — | security | Provider opt-in cannot loosen MS365/MCP | tests + review | M | TODO |
| ER-004 | P1 | Runtime | Rust `llm-svc` (local embeddings) is dormant/unbundled | Build in CI → bundle → loopback supervise (LF-3) | — | med | Packaged app starts llm-svc; health OK; graceful stop; no orphan | packaged + process check | M | TODO |
| ER-005 | P1 | Knowledge | D3 not wired/bundled; KB/KG unusable offline (dependencies-and-services §5) | KB on embedded SQLite (FTS5) + local workspace index (LF-4) | — | med | Index a folder offline; search returns results; data under data root | packaged | M | DONE (2026-07-18, code+tests+build; **data-rich packaged acceptance PASS**, UI audit 21/21 / 33 shots via isolated seed workspace — status=ready 7 docs/10 nodes/15 edges, list, detail+provenance, FTS snippet, prune 7→6, safe clear keeps files): **unified store theo active Workspace** (2 tab, no source tabs) + provenance badge/bộ lọc nguồn; migration id:4 + `service/src/knowledge-local` + `/v1/knowledge-local`; FTS5 keyword search. Microsoft 365 = nguồn tương lai, readiness trung thực (no fake/network). **No vector/embeddings** (deferred). |
| ER-006 | P2 | Knowledge | No graph offline | Graph on node/edge tables + visualization (LF-5) | ER-005 | med | Graph builds/renders/rebuild/clear/recovery | packaged | M | DONE (2026-07-18, code+tests+build; **data-rich graph packaged acceptance PASS** via UI audit — real node/edge graph, node select + provenance aside, fit/zoom): deterministic contains/links_to graph → real SVG renderer (fit/refit/zoom/pan/node-detail + provenance); init/sync/rebuild/clear/cancel states; single unified graph (no per-source tabs). |
| ER-007 | P1 | Readiness | Users can't tell if a feature is ready vs external-dep-missing | Uniform readiness/status model (ready/blocked/error/needs-config) per surface | — | ux | Every surface shows an honest status chip; no fake ready | audit screenshots | M | TODO |
| ER-008 | P1 | Error/recovery | Happy-path only; DB-locked/provider-offline/OpenCode-crash not surfaced | Error/recovery states (see §8.3 matrix) | ER-007 | ux | Common failures show recover options, no crash/data loss | negative tests | L | TODO |
| ER-009 | P2 | Onboarding | No guided "what first" | First-run checklist + empty-state guidance on each surface | ER-002 | ux | New user completes provider→workspace→first chat guided | manual | M | TODO |
| ER-010 | P2 | UI system | Tokens exist but consistency unaudited across surfaces | Consolidate design tokens/components; keep Cowork+Workspace as bar | ER-013 (audit) | ux | Cross-surface consistency findings resolved | ui-ux-audit | L | TODO |
| ER-011 | P1 | MS365 (D2) | Not live-verified; OAuth gated | Decide device-code vs manual for demo; honest disconnected states | — | ext | Demo path documented; no fake connected state | manual | M | TODO |
| ER-012 | P1 | Dispatch (D1) | No packaged/live fan-out (Checkpoint 5) | Packaged golden-path fan-out with mock or real LLM | ER-001 | med | One packaged fan-out with one permission gate, verified results | packaged | L | TODO |
| ER-013 | P1 | Visual audit | No automated packaged UI capture exists | Build the UI-capture tool + run it (see §4) | ER-001 | med | Screenshots for all surfaces/states; checks pass | audit run | M | DONE (2026-07-18): `tools/ui-audit` + `npm run audit:ui`; **38 shots, 41/41 checks** incl. **data-rich Knowledge** (isolated seed workspace: index/list/detail/search/graph/node-select/prune/clear) **and the Code runtime panels** (Xem trước/Web + Kết quả/Vấn đề drawer, Ứng dụng/desktop, collapsed Explorer+Agent — shots 32–35). Re-audit `audit/exhibition-live-states` confirmed exhibition-clean; F2/F3/F4 resolved in shipped build, F10 (Code English labels) fixed. Findings in ui-ux-audit.md. Live provider / error / DPI states remain PO-manual (see that doc's Gaps) |
| ER-014 | P1 | Acceptance | Release acceptance is happy-path (demo-acceptance) | Author `release-acceptance.md` with negative/recovery coverage (§8.3) | ER-008 | — | Negative scenarios enumerated + owned | doc + tests | M | TODO |
| ER-015 | P2 | Data/recovery | DB corruption/migration failure behavior unspecified | Define backup/restore/migration-failure handling | — | data | Corrupt/locked DB → recoverable, no silent loss | tests | M | TODO |
| ER-016 | P3 | Performance | Startup/streaming/large-file cost unmeasured | Measure + bound startup, streaming, large preview | — | perf | Documented budgets; no UI stall on large files | manual | M | TODO |
| ER-017 | P3 | A11y/DPI | Keyboard/focus/DPI unaudited | Keyboard nav, focus order, Windows DPI scaling pass | ER-013 | ux | No clipping/overflow at 125/150% DPI; keyboard reachable | audit | M | TODO |

Items map onto the workstreams (1–16) and the `local-first-strategy.md` LF-1…LF-8 steps. Additional
lower-severity items are added as the UI audit (ER-013) produces evidence.

## 3. Negative / recovery coverage (§8.3) — no more happy-case-only

Release acceptance MUST cover (tracked even if not yet implemented):

- app/service startup failure; local DB locked/corrupt/migration failure
- invalid provider credential; provider offline/timeout/rate-limit
- OpenCode crash/restart; permission denied/cancelled/expired
- file changed/deleted externally; dirty-edit conflict
- unsupported/large/malformed document; Knowledge import interrupted
- graph/index service unavailable; MS365 disconnected/token expired
- Dispatch/mobile offline; remote pairing revoked; MCP unhealthy
- disk full/write failure; export failure; app relaunch/recovery
- child-process orphan prevention; no-Internet behavior; DPI/window resize
- empty/loading/error states on every surface

## 4. Next slice — Automated packaged UI capture (Phases 6–7, designed here)

This audit deliberately deferred building/running the UI-capture tool and packaging. Design + build
it as the **immediate next slice**:

**Scope.** `tools/ui-audit/` + `npm run audit:ui`. Drive the packaged `coworkghc.exe` and capture
every surface/state; then a human UI/UX review against `ui-ux-audit.md`.

**Approach (built 2026-07-18).** In-process `webContents.capturePage` + `executeJavaScript`, gated by
`COWORK_GHC_UI_AUDIT=1` (`app/shell/src/audit/ui-capture.ts`). CDP/Playwright was rejected: this
Electron build refuses `--remote-debugging-port` ("bad option") and `app.commandLine.appendSwitch`
does not open the endpoint. Navigation uses semantic selectors (`data-surface-id`, `.topbar__settings`).

**Safety (audit mode).** Enabled ONLY with `COWORK_GHC_UI_AUDIT=1` + `COWORK_GHC_RUNTIME_ROOT=<isolated>`;
default OFF; not reachable from normal production; no real credentials; no user workspace; no cloud
egress; synthetic seeded data; no permission bypass in production; no secrets saved; cleanup-able.

**Run.** verify `coworkghc.exe` exists → isolated `.runtime/ui-audit/<run-id>/` → seed fake
account/profile/workspace → launch → wait for readiness (timeout) → navigate by stable selectors →
screenshot (1440×900 + 1920×1080 for key surfaces; light+dark) → manifest → stop app + all children →
assert no orphan.

**Coverage.** Auth, Cowork (incl. permission/readiness/inspector/error), Workspace (all file types +
collapsed/dirty/unsupported), Kỹ năng & MCP, Dispatch, MS365, Knowledge (honest empty/not-wired),
Gateway (honest not-integrated), Code/Web/Desktop, Settings (each section), plus dialogs/empty/
loading/error states.

**Output (git-ignored).** `reports/ui-audit/<run-id>/` with `manifest.json`, `environment.json`,
`screenshots/`, `contact-sheet.html`, `audit-log.txt`. Only PO-accepted images copied to
`docs/demo/screenshots/`.

**Automated checks.** white screen, 0-byte image, unexpected duplicate, missing selector, crash,
timeout, horizontal overflow, orphan process, wrong viewport.

**Acceptance.** Tool launches packaged app, captures the coverage set, stops cleanly with no orphan,
and produces a manifest + contact sheet; findings flow into `ui-ux-audit.md`.

## 5. Sequencing

1. P0 build/security/data-loss (ER-001, ER-002, ER-003)
2. Local runtime + dependency removal (ER-004, ER-005; LF-3/LF-4)
3. Readiness/error/recovery (ER-007, ER-008, ER-014)
4. Onboarding & usability (ER-009)
5. UI consistency (ER-010, informed by ER-013)
6. Performance (ER-016)
7. Exhibition polish (ER-017)
8. Full packaged acceptance (release-acceptance.md)

Do not open many workstreams at once during implementation — one bounded slice at a time.

**Next smallest executable slice:** ER-001 (package + verify `coworkghc.exe`) → then ER-013 (build +
run the UI-capture tool) to generate the evidence base for the UI/UX audit.
