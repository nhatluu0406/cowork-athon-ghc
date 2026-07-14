---
language: "vi"
status: "active"
updated_at: "2026-07-14"
---

# External Systems Integration Readiness (D1–D4)

Canonical intake document for external parallel tracks. Product Owner and integration
Agent use this file as the single source of truth during D1–D4 intake and merge
decisions.

Related docs:

- [Current Status](../product/current-status.md)
- [Product Plan](../product/product-plan.md)
- [Roadmap](../product/roadmap.md)
- [POC Acceptance](../quality/poc-acceptance.md)
- [Known Limitations](../quality/known-limitations.md)

---

## 1. Baseline

| Field | Value |
|---|---|
| **Baseline commit** | `eaeb3eb` — `chore(project): stabilize pre-integration baseline` |
| **Baseline tag** | `pre-external-integration-2026-07-14` (annotated, local; not pushed) |
| **Prior audit commit** | `2ac9099` — comprehensive project audit |
| **Packaged POC baseline** | `poc-v0.1` |

### Current acceptance state

| Area | Status | Notes |
|---|---|---|
| Core POC (service, workspace, provider, permissions, streaming) | **PASS** | Packaged evidence in `docs/quality/poc-acceptance.md` |
| Skills Foundation Phase 1 | **PASS** | |
| Provider Readiness | **PASS** | |
| Attachment Honesty | **PASS** | |
| File Work Review | **PARTIAL PASS** | Live Journey A–B PASS; Journey C blocked; D–L incomplete |
| Commercial UI Product Owner acceptance | **Pending** | V3 production shell ported; packaged screenshots in `reports/ui-shell-v3-production/` await PO review |
| D1–D4 external tracks | **UI restored, backends not merged** | Product rail + placeholder surfaces with stable mount IDs (`d1-dispatch-root`, etc.); no fake data |
| Full L9 / release-candidate regression | **Incomplete** | Deferred to combined integration milestone |
| Architecture refactor (`app-shell.ts`, snapshot/watchdog → service) | **Deferred** | After combined external integration merge |

```text
File Work Review: PARTIAL PASS
Commercial UI acceptance: Pending PO
D1–D4 backends: not merged (UI intake surfaces restored on product rail)
```

### UI intake surfaces (2026-07-13)

Product rail exposes Cowork, Dispatch, Gateway, Knowledge, Microsoft 365, and Code. Cowork and Workspace remain work modes inside the Cowork surface — Workspace is **not** a rail item.

| Track | Mount ID | Component slot | Placeholder status |
|---|---|---|---|
| D1 | `d1-dispatch-root` | `DispatchIntegrationSlot` | Chờ tích hợp D1 |
| D2 | `d2-microsoft-root` | `MicrosoftIntegrationSlot` | Chờ tích hợp D2 |
| D3 | `d3-knowledge-root` | `KnowledgeIntegrationSlot` | Chờ tích hợp D3 |
| D4 | `d4-gateway-root` | `GatewayIntegrationSlot` | Chờ tích hợp D4 |
| Code | `code-surface-root` | `CodeIntegrationSlot` | Đã lên kế hoạch |

Registry: `app/ui/src/integration-surface-adapters.ts`. Teams replace placeholder content inside the mount node without changing shell navigation.

---

## 2. Team intake checklist

Each external team must deliver a written intake report covering **all** items below.
Incomplete reports are **Ready to inspect** at best; they are **Not merge-ready** until
filled.

| # | Item | Required detail |
|---|---|---|
| 1 | **Track ID** | `D1`, `D2`, `D3`, or `D4` |
| 2 | **Repo / branch** | Source repository URL and branch name |
| 3 | **Commit hash** | Exact commit to integrate (not a moving branch tip without lock) |
| 4 | **Base commit** | Commit the branch was built from; must be `eaeb3eb` or a documented descendant of tag `pre-external-integration-2026-07-14` |
| 5 | **Run / build / test commands** | Exact commands that reproduce a green build on Windows 11 |
| 6 | **Environment variables** | All vars, defaults, and whether each is required for dev vs packaged |
| 7 | **Credential / auth model** | Where secrets live (keyring, OAuth, tenant token, etc.); what must never touch renderer/logs |
| 8 | **API / event contracts** | REST routes, SSE/EV kinds, TypeScript types or OpenAPI; versioning |
| 9 | **Schema migrations** | New tables/files, migration steps, rollback, backward compatibility |
| 10 | **Feature flags** | Flag names, default OFF on baseline, how UI surfaces stay hidden when OFF |
| 11 | **Dependencies** | New npm/native packages, services, ports, child processes |
| 12 | **Known limitations** | Explicit non-goals and failure modes for this delivery |
| 13 | **Demo journey** | One scripted end-to-end path the team can run without Cowork GHC core changes |
| 14 | **Conflict files** | Files expected to conflict with baseline (see §3 matrix hints) |
| 15 | **Owner** | Named engineer + escalation contact |

### Intake report template

```text
Track: D_
Owner:
Repo:
Branch:
Commit:
Base commit:
Based on tag pre-external-integration-2026-07-14: yes/no

Build:
  -
Test:
  -
Env:
  -
Credentials:
  -
Contracts:
  -
Migrations:
  -
Feature flags:
  -
Dependencies:
  -
Limitations:
  -
Demo journey:
  -
Conflict files:
  -
```

---

## 3. Integration matrix

Fill this table as teams deliver reports. **TBD** means not yet received.

| Track | Branch / commit | Based on | Runnable | Tests | Contract | Credentials | Migration | Feature flag | Conflict risk | Merge ready |
|---|---|---|---|---|---|---|---|---|---|---|
| **D1** Dispatch / fan-out | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | **High** | **No** |
| **D2** Microsoft automation | `feature/ms365-connector-sharepoint` @ `d086ecd` | `eaeb3eb` (pre-integration baseline) | Yes — `npm run typecheck` PASS, `npm run build:renderer` PASS | 54/54 MS365 unit tests PASS (10 files); ~20 pre-existing failures across 13 unrelated live/integration/streaming suites (unchanged with flag OFF) | Manual-token connect + Graph search/list/summary/upload documented in spec; loopback tool router (`ms365-tool-router`) token-guarded | Manual token works now; device-code OAuth coded but **gated** (no real Azure app registration/client ID) — no fake "connected" state | None (no new persisted schema for this slice) | `CGHC_MS365_ENABLED`, default **OFF**; with flag off, composition/child env byte-for-byte unchanged | **Medium** | **No — foundation implemented behind flag; not merge-ready as a full live integration** |
| **D3** Knowledge / RAG / graph | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | **Low / Medium** | **No** |
| **D4** Advanced LLM gateway | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | **High** | **No** |

### Expected conflict hotspots (baseline)

| Track | Likely conflict files | Risk driver |
|---|---|---|
| D1 | `app/ui/src/app-shell.ts`, `service/src/execution/*`, permission bridge, runtime turn planner | Orchestration, concurrency, permission aggregation |
| D2 | New connector modules, `app/ui/src/integration-slots.ts`, settings/auth UI, credential routers | OAuth/Graph lifecycle, audit |
| D3 | `service/src` workspace/index routes, `workspace-navigator.ts`, activity model, retrieval APIs | Indexing boundary, provenance |
| D4 | `app/ui/src/llm-settings-panel.ts`, `app/ui/src/service-client.ts`, `service/src/settings-router.ts`, provider HTTP layer | Multi-profile gateway, keyring, routing |

---

## 4. Branch strategy

### Integration branches (create from tag, not from moving `main` unless PO directs)

```text
integration/d4-gateway
integration/d3-knowledge
integration/d2-microsoft
integration/d1-dispatch
integration/external-systems-combined
```

### Base for every integration branch

```text
pre-external-integration-2026-07-14
```

### Proposed merge order (bottom-up; reduces core orchestration risk)

Per [Recovery Plan §5](../product/cowork-ghc-recovery-and-modernization-plan.md):

1. **D4** → `integration/d4-gateway`
2. **D3** → `integration/d3-knowledge` (branch from updated D4 integration branch or rebase policy decided at intake)
3. **D2** → `integration/d2-microsoft`
4. **D1** → `integration/d1-dispatch` (last — highest orchestration risk)
5. **Combined** → `integration/external-systems-combined` only after per-track acceptance

Product Owner may reorder if intake evidence shows a hard dependency; document the
decision in this file before merging.

---

## 5. Track-specific acceptance

Focused acceptance for each track. Full combined milestone tests are in §8.

### D1 — Dispatch / fan-out agent

| Criterion | Acceptance |
|---|---|
| Surface | `dispatch` moves from `awaiting_integration` to `available` only when backend exists |
| Single-agent fallback | Baseline sequential OpenCode flow still works with D1 **OFF** |
| Child tasks | UI shows child task list, status, and provenance without fake data |
| Cancellation | User can cancel parent and children; no orphan OpenCode processes |
| Permissions | Child tool calls still use Cowork permission modal; no bypass |
| Concurrency limits | Configurable cap; over-limit requests fail closed with clear error |
| Packaged journey | Scripted flow: dispatch → 2 child tasks → one deny → recovery → clean stop |

### D2 — Microsoft automation (Teams, SharePoint, OneDrive, Graph)

| Criterion | Acceptance |
|---|---|
| Surface | `microsoft` tab enabled only with real connector |
| Auth | OAuth/consent flow documented; test tenant credentials isolated |
| Scopes | Least-privilege; scope list in intake report |
| Actions | At least one read-only Graph action + one bounded write with permission |
| Revocation | Token revoke clears UI state; no stale "connected" badge |
| Audit | Connector events appear in activity or dedicated audit surface (no secrets) |
| Packaged journey | Connect → list one drive item → disconnect → relaunch state honest |

**Bằng chứng D2 (2026-07-14, branch `feature/ms365-connector-sharepoint` @ `d086ecd`):**

| Tiêu chí | Bằng chứng |
|---|---|
| Auth | Đăng nhập bằng **manual token hoạt động được** (dán token, xác thực qua Graph client); **device-code OAuth đã viết code nhưng bị gate** — chưa có Azure app registration/client ID thật, chưa thể hoàn tất kết nối thật; không hiển thị trạng thái "đã kết nối" giả |
| Scopes (least-privilege) | `Sites.Read.All`, `Files.ReadWrite.All` |
| Actions | Một hành động Graph chỉ đọc (search/list/summary trên SharePoint) và một hành động ghi có giới hạn (upload), cả hai đi qua tool dispatch |
| Permission trên upload | Xác minh ở mức unit: Deny chặn thực sự; upload chỉ chạy sau một quyết định Allow đã ghi nhận. **Chưa xác minh qua một lượt chạy end-to-end thật** |
| Connector events | Có (qua router/dispatch); chưa thấy trong một phiên chạy live thật |
| Feature flag | `CGHC_MS365_ENABLED`, **OFF theo mặc định**; flag off → composition và child env không đổi (byte-for-byte, đã review) |
| Tool advertisement vs. consumption | Service quảng bá endpoint MS365 cho OpenCode child qua `CGHC_MS365_TOOL_ENDPOINT` / `CGHC_MS365_TOKEN` khi flag ON. Việc OpenCode runtime thật có tiêu thụ (consume) các biến này để đăng ký MS365 tool thành tool model-callable **chưa được xác minh end-to-end với một child đang chạy** — hạng mục xác minh còn mở |
| Packaged / live tenant run | **CHƯA CHẠY** — toàn bộ bằng chứng ở mức unit test; không có lưu lượng Microsoft Graph/SharePoint thật nào được thực thi |
| Regression | `npm run typecheck` PASS; `npm run build:renderer` PASS; 54/54 MS365 unit test PASS (10 file); ~20 lỗi có sẵn không liên quan trên 13 suite khác (live/integration/streaming), không đổi khi tắt flag |
| Merge ready | **Không** — đây là nền tảng (foundation) được triển khai phía sau flag, không phải một tích hợp live hoàn chỉnh; chưa sẵn sàng merge vào `integration/d2-microsoft` cho tới khi có xác minh packaged/live và xác minh tool-consumption end-to-end |

### D3 — Knowledge system (RAG, vector, graph)

| Criterion | Acceptance |
|---|---|
| Surface | `knowledge` / `knowledge-graph` enabled only with indexer backend |
| Opt-in | No silent full-workspace scan; explicit user/workspace opt-in |
| Provenance | Answers cite source paths/ids; stale index surfaced |
| Deletion | Index cleanup when source removed or user disables |
| Replaceability | Vector/graph backend swappable without UI rewrite |
| Packaged journey | Opt-in folder → index → query with citation → disable → index quiesced |

### D4 — Advanced LLM gateway

| Criterion | Acceptance |
|---|---|
| Surface | `gateway` settings enabled only with gateway adapter |
| Direct fallback | Single-profile direct provider still works when gateway **OFF** |
| Multi-profile | Multiple named profiles; per-profile keyring storage |
| Routing | Health, failover, and error semantics documented and testable |
| Secrets | No API keys in renderer, transcripts, logs, or screenshots |
| Packaged journey | Profile A fail → failover to B → settings persist → relaunch restore |

See §9 for extended D4 multi-provider review checklist.

---

## 6. Protected boundaries

External code **must not** weaken these without explicit Product Owner + security review.

| Boundary | Location / policy | Integration rule |
|---|---|---|
| **Keyring** | Windows Credential Manager via `@napi-rs/keyring`; service-only write | No renderer key storage; D4 profiles use per-profile keyring entries |
| **Workspace guards** | Path confinement, traversal rejection, symlink policy | D2/D3 cloud paths must not bypass local workspace guards |
| **Permissions** | Cowork modal + `permission-bridge`; OpenCode `permission.asked` not trusted alone | D1 child tasks cannot auto-approve; D2/D3 connectors cannot skip modal |
| **Conversation store** | `service/src/conversation-store`; atomic PATCH; no credential fields | D1/D3 provenance extends schema; no breaking migration without rollback |
| **File Review** | Service-owned snapshots; UI coordinates but does not own `pendingBeforeSnapshots` long-term | No change to secret redaction or diff limits without quality doc update |
| **OpenCode runtime** | Child process; one active execution per conversation (baseline) | D1 must not spawn unbounded processes; lifecycle scripts must still pass |
| **Process lifecycle** | `tools/app/cli.mjs`, `start.bat` / `stop.bat` / `clean.bat` | No orphan `Cowork GHC.exe` after integration tests |
| **Secret policy** | `.env`, `*.pem`, `credentials.json`, attachment/review redaction | D2 tokens and D4 keys follow same non-leak rules |

---

## 7. Merge decision rules

| State | Meaning | Gate |
|---|---|---|
| **Ready to inspect** | Intake report received; commit builds on reporter machine | PO assigns inspector |
| **Ready to merge into track branch** | Inspect PASS: contracts documented, feature OFF default, focused tests green, conflicts understood | Merge into `integration/d*-…` only |
| **Ready to merge into combined branch** | Track branch acceptance (§5) PASS; `verify:release` PASS on track branch; no regression in protected boundaries | Merge toward `integration/external-systems-combined` |
| **Not merge-ready** | Missing intake fields, failing tests, boundary violation, or unresolved conflict | Do not merge |

**Hard stops (always Not merge-ready):**

- Secrets in diff, logs, or UI state
- Permission bypass or workspace escape in demo journey
- Feature ON by default without PO approval
- Base commit not descended from `pre-external-integration-2026-07-14`

---

## 8. Test levels

### Per commit (every merge commit on integration branches)

```text
npm run typecheck
focused unit tests (track-touched packages)
npm run build:renderer
service build (if service touched)
```

### Per integration track (before track branch sign-off)

```text
feature OFF smoke — baseline journeys still PASS
feature ON focused journey — track demo journey PASS
contract tests — API/event schemas match @cowork-ghc/contracts extensions
```

### Combined milestone (before `integration/external-systems-combined` sign-off)

```text
npm run verify:release
npm run package:win
packaged UI smoke (layout + surfaces)
D1–D4 journeys (each track demo journey, feature ON)
provider / runtime (direct fallback + gateway if D4 merged)
permissions (approve / deny / recovery)
attachments (Phase 1 honesty)
Skills (Foundation A–J regression subset)
File Review (deterministic mode; live optional)
cleanup (stop.bat / no orphans)
```

File Work Review remains **PARTIAL PASS** on baseline; combined milestone may accept
partial status but must not regress Journey A–B.

---

## 9. D4 multi-provider review checklist

Inspectors must verify each item before D4 is **Ready to merge into track branch**.

| # | Check | Pass criteria |
|---|---|---|
| 1 | **Multiple profiles** | ≥2 named profiles; add/rename/delete without corrupting others |
| 2 | **Custom endpoint** | Base URL validation matches baseline rules (loopback pin / SSRF policy) |
| 3 | **Per-profile keyring** | Each profile key stored separately; delete profile removes key |
| 4 | **Model ID** | Model field per profile; invalid model surfaces `model_invalid` recovery |
| 5 | **Active profile** | Exactly one active profile for new turns; switch does not break in-flight turn |
| 6 | **Conversation snapshot** | Provider metadata on conversation/activity does not store raw keys |
| 7 | **Direct-provider fallback** | Gateway OFF → existing single-provider path unchanged |
| 8 | **Routing / failover boundary** | Failover documented; user-visible error when all routes fail; no silent wrong provider |

---

## 10. Tomorrow intake procedure

Sequential checklist for integration Agent (do not skip steps).

- [ ] **1. Receive report and commit** — Team delivers §2 checklist; lock commit hash.
- [ ] **2. Fill matrix** — Update §3 row for that track (branch, based on, runnable, …).
- [ ] **3. Inspect diff** — `git diff pre-external-integration-2026-07-14..<commit>`; list boundary touches.
- [ ] **4. Decide branch order** — Confirm §4 order or document PO exception in this file.
- [ ] **5. Create branch from tag** — `git checkout -b integration/d4-gateway pre-external-integration-2026-07-14` (example).
- [ ] **6. Merge or cherry-pick** — Prefer cherry-pick of track commits; no drive-by refactors.
- [ ] **7. Resolve conflicts per boundary** — Protected areas (§6) win over feature convenience.
- [ ] **8. Run focused tests** — §8 per-commit + per-track for the active track only.
- [ ] **9. Record limitations** — Update track row + `docs/quality/known-limitations.md` if product-visible.
- [ ] **10. Combined merge decision** — Only after all required tracks reach track-branch acceptance; then §8 combined milestone.

**Do not** merge into `integration/external-systems-combined` on day one of intake.

---

## Open decisions (Product Owner)

| ID | Question | Default if silent |
|---|---|---|
| OD-1 | Rebase vs merge between track branches (D4→D3→D2→D1) | Sequential branch chain; each branches from previous integration branch |
| OD-2 | D4 before D3 if D3 depends on gateway routing | Keep D4 first per recovery plan unless intake proves hard dependency |
| OD-3 | File Review Journey C–L during integration | Do not block D1–D4 on live Journey C; require deterministic verifier progress separately |
| OD-4 | Commercial UI PO acceptance gate | Does not block track-branch merge; blocks release candidate |
| OD-5 | Remote push of integration branches | Local only until PO requests push |

---

## Revision log

| Date | Change |
|---|---|
| 2026-07-13 | Initial canonical intake doc at baseline `eaeb3eb` / tag `pre-external-integration-2026-07-14` |
| 2026-07-14 | Filled D2 matrix row and §5 D2 acceptance evidence for `feature/ms365-connector-sharepoint` @ `d086ecd` — foundation implemented behind `CGHC_MS365_ENABLED` (OFF default); manual token works, device-code gated, tool consumption by live OpenCode child unverified, no packaged/live tenant run; **Not merge-ready** |
