# Cowork GHC — Tasks (bản xem cho con người)

> Bản xem đồng bộ tay từ nguồn sự thật `tasks.yaml` (2026-07-12). Nếu lệch, `tasks.yaml` thắng.
> Đọc trạng thái máy: `node tools/loop-engineer/cli.mjs status`.

L5 (Master Plan) tạo **28 executable task** (`CGHC-001`..`CGHC-028`). Một task chỉ `DONE` khi có
acceptance + tests pass + review độc lập (reviewer ≠ owner) + evidence + không còn finding Critical/High.

**Tổng hợp (2026-07-12, freeze cho Codex handoff):** 24 `DONE` · 3 `STALE` (reopen) · 1 `IN_PROGRESS`.

## Executable tasks

| ID | Capability | Status | Owner → Reviewer |
|---|---|---|---|
| `CGHC-001` | opencode-runtime-pin | `DONE` | runtime-llm → code-reviewer |
| `CGHC-002` | loopback-service-boundary | `DONE` | runtime-llm → security |
| `CGHC-003` | web-seam-core-contracts | `DONE` | product-architect → code-reviewer |
| `CGHC-004` | runtime-supervision-identity | `DONE` | runtime-llm → code-reviewer |
| `CGHC-005` | windows-orphan-reaper | `DONE` | runtime-llm → security |
| `CGHC-006` | lifecycle-scripts | `DONE` | runtime-llm → code-reviewer |
| `CGHC-007` | workspace-boundary-enforcement | `DONE` | runtime-llm → security |
| `CGHC-008` | workspace-picker-validate | **`STALE`** (reopen) | frontend-desktop → code-reviewer |
| `CGHC-009` | credential-store | `DONE` | runtime-llm → security |
| `CGHC-010` | provider-port | `DONE` | runtime-llm → security |
| `CGHC-011` | add-credential-test-connection | **`STALE`** (reopen) | runtime-llm → security |
| `CGHC-012` | ev-event-contract | `DONE` | runtime-llm → test-engineer |
| `CGHC-013` | session-orchestration | `DONE` | runtime-llm → code-reviewer |
| `CGHC-014` | two-hop-sse-streaming | `DONE` | runtime-llm → ux-perf |
| `CGHC-015` | ev-timeline-ui | `DONE` | frontend-desktop → ux-perf |
| `CGHC-016` | permission-enforcement | `DONE` | runtime-llm → security |
| `CGHC-017` | permission-ui | `DONE` | frontend-desktop → ux-perf + security |
| `CGHC-018` | file-mutation-audit | `DONE` | runtime-llm → security |
| `CGHC-019` | model-config-switch | **`STALE`** (reopen) | runtime-llm → code-reviewer |
| `CGHC-020` | provider-error-mapping | `DONE` | runtime-llm → test + security |
| `CGHC-021` | redaction-diagnostics | `DONE` | runtime-llm → security |
| `CGHC-022` | settings-store | `DONE` | frontend-desktop → code-reviewer |
| `CGHC-023` | clean-bat-allowlist | `DONE` | runtime-llm → security |
| `CGHC-024` | captured-frame-test-harness | `DONE` | test-engineer → security + code-reviewer |
| `CGHC-025` | coldstart-crash-hardening | `DONE` | frontend-desktop → security |
| `CGHC-026` | runtime-extensions | `DONE` | runtime-llm → code-reviewer |
| `CGHC-027` | documentation-normalization | `DONE` | product-architect → code-reviewer |
| `CGHC-028` | release-verification | **`IN_PROGRESS`** (gate PARTIAL) | test-engineer → release-verifier |

## Task được reopen (2026-07-12) — lý do

Freeze cho Codex handoff phản ánh trung thực rằng **packaged user journey chưa verify được**. Ba task
sau bị reopen về `STALE`: unit acceptance + evidence **vẫn hợp lệ**, nhưng cần **re-verify end-to-end
trong packaged app**. Không reopen task infra/security đã có evidence hợp lệ.

- `CGHC-008` (workspace-picker-validate): folder picker chưa verify usable trong packaged app (renderer
  chỉ mount feature view khi local service đã kết nối; packaged auto-connect chưa chứng minh).
- `CGHC-011` (add-credential-test-connection): connector SSRF-hardened vẫn hợp lệ, nhưng **luồng nhập
  DeepSeek token an toàn từ GUI chưa có** trong packaged app.
- `CGHC-019` (model-config-switch): backend switch-without-restart vẫn hợp lệ, nhưng **UI provider/model
  settings chưa verify usable** từ packaged GUI.

`CGHC-028` (release-verify) giữ `IN_PROGRESS` làm **anchor**: L6 gate = `PARTIAL` cho tới khi mọi task
`DONE` và packaged E2E PASS. Không bắt đầu L7.

## Backlog (deferred — chưa phải executable task)

| ID | Tên | Status | Priority | Kích hoạt |
|---|---|---|---|---|
| `CGHC-WEB-001` | Next.js Web Application Discovery | `BACKLOG` | `DEFERRED` | Desktop POC đạt L9 `PASS`, hoặc product owner kích hoạt. Không tự động `READY`. |
| `CGHC-ARCH-001` | web-seam-core-package | `BACKLOG` (đã hiện thực trong `CGHC-003`) | `SHOULD` | Từ web-readiness delta; chỉ định nghĩa boundary. |
| `CGHC-DOC-001` | Normalize human-facing docs → Vietnamese | `BACKLOG` | `SHOULD` | Chia nhỏ; không tạo loop riêng để dịch; `LANGUAGE_ONLY_CHANGE` không invalidate L1–L4. |

- `CGHC-WEB-001` gắn với [ADR 0007](../../docs/architecture/decisions/0007-web-application-deferral.md)
  (web = `DEFERRED`): không tạo `apps/web`, không cài Next.js, không thêm active web loop trước khi kích hoạt.
