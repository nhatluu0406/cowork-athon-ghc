# Cowork GHC — Status (human view)

> Generated view. Source of truth is the `.yaml` files in this directory.
> Read via: `node tools/loop-engineer/cli.mjs status`

**Phase:** L6 — Implementation (RUNNING, gate PARTIAL — FROZEN for Codex handoff)
**Run:** RUN-0007 (IN_PROGRESS)
**Updated:** 2026-07-12
**Chế độ mặc định:** `LEAN` (một Agent Lead tuần tự; xem `.agent-workflow/workflow.yaml`)

## ⚠️ Freeze & Handoff (product owner, 2026-07-12)

Repository được **đóng băng để tạo Git baseline và bàn giao cho Codex**. Không phát triển tính năng
mới, không sửa GUI, không chạy L7, không gọi live LLM trong pass này. Đọc `.loop-engineer/HANDOFF.md` trước.

**Trạng thái sản phẩm trung thực (on-disk):**
- Packaged `.exe` đã build (NSIS setup + portable + win-unpacked); GUI mở được (đã sửa lỗi launch-crash `require is not defined`).
- **CHƯA có usable packaged user journey.** Local service chưa tự khởi động/kết nối thành công từ packaged app.
- **UNVERIFIED trong packaged app:** folder/workspace picker, provider/model/credential settings, luồng nhập
  DeepSeek token an toàn, live OpenCode session. Chất lượng GUI/UX so với Claude Cowork / OpenWork = `UNVERIFIED`.
- **L6 = RUNNING, gate = `PARTIAL`.** Không bắt đầu L7.
- **Task reopen → `STALE`** (unit evidence vẫn hợp lệ, cần re-verify end-to-end trong package): `CGHC-008`
  (workspace picker), `CGHC-011` (secure add-credential + test-connection), `CGHC-019` (provider/model settings).
  Không reopen task infra/security đã có evidence hợp lệ. `CGHC-028` (release-verify) giữ `IN_PROGRESS` làm anchor.
- OpenWork reference source (`.loop-engineer/source/openwork`) đã **được gỡ bỏ**; provenance ở
  `docs/references/openwork-reference.md`.

## Loops
| Loop | Name | Status | Gate |
|------|------|--------|------|
| L0 | Bootstrap | COMPLETED | PASS |
| L1 | Requirement Baseline | COMPLETED | PASS (VALID_WITH_GAPS) |
| L2 | Discovery | COMPLETED | PASS |
| L3 | Architecture Candidates | COMPLETED | PASS |
| L4 | Architecture Review | COMPLETED | PASS (FROZEN) |
| L5 | Master Plan | COMPLETED | PASS |
| L6 | Implementation | RUNNING | **PARTIAL** (frozen; packaged journey UNVERIFIED) |
| L7 | Integration | NOT_READY | — |
| L8 | Hardening | NOT_READY | — |
| L9 | Release Verification | NOT_READY | — |
| L10 | Retrospective & Integration Readiness | NOT_READY | — |

## Tasks
L5 tạo **28 executable task** (`CGHC-001`..`CGHC-028`) + backlog `CGHC-WEB-001` (DEFERRED). Nguồn sự
thật: `tasks.yaml`; bản xem: `TASKS.md`. Trạng thái hiện tại (2026-07-12): **24 DONE**, **3 STALE**
(reopen: `CGHC-008` / `CGHC-011` / `CGHC-019` — packaged journey cần re-verify), **1 IN_PROGRESS**
(`CGHC-028` release-verify anchor, gate PARTIAL). Xem chi tiết + lý do reopen trong `TASKS.md` và
`.loop-engineer/HANDOFF.md`. Thực thi qua `/loop-engineer task <id>` (reviewer ≠ implementer mỗi task).

## Notes
- Reference source `.loop-engineer/source/openwork/` đã **được gỡ bỏ** (2026-07-12); provenance ở
  `docs/references/openwork-reference.md`. Lịch sử bên dưới giữ nguyên làm provenance.
- Project root is not a git repository. No history at risk.
- L3 Architecture Candidates DECIDED the four (coupled) decisions as 6 ADRs (Status: **Proposed**;
  L4 freezes) + an implementation design (`docs/architecture/`): ADR 0001 reuse OpenCode (+ own
  session/settings split); 0002 shell=Electron (closest call, reversible); 0003 standalone loopback
  HTTP+SSE service (P7 test); 0004 Windows identity-verified supervision + tree-kill (LC3); 0005 thin
  ProviderPort over the runtime; 0006 @napi-rs/keyring single OS store (inject-at-launch, never the
  runtime's own key store). Grounded in L2; requirements→component traceability included.
- Focused independent review (security-reviewer ≠ author) PASS_WITH_FINDINGS; 0 Critical/High.
  SEC-1/SEC-2 confirmed closed (PR9 gap not recreated). 2 Low resolved in L3; 2 Medium carried to the
  L4 threat model (identity-vs-boundary token distinction; custom `base_url` SSRF policy) and captured
  in-ADR. See `.loop-engineer/evidence/L3/review-dispositions.md`.
- L4 Architecture Review FROZE the architecture. Five independent lenses (runtime, frontend, test,
  security, UX) + a STRIDE threat model + a reference-verification pass critiqued the L3 candidates.
  The panel raised 7 HIGH findings; ALL were resolved by surgical document corrections before freeze
  (no decision reversed). The two scariest runtime HIGHs were settled on verified reference facts:
  (H1) OpenCode reads provider keys from process env, so keyring→child-spawn-env injection needs no
  `auth.json`; (H2) child identity = known-port+PID+start-time+exePath (no argv-env readback or pid
  endpoint exists). An independent security re-confirm returned SEC-1/SEC-2 CLOSED, SAFE-TO-FREEZE.
- The 3 flagged overrides were **RATIFIED**: standalone placement (0003); user-defined 5th provider
  (0005, conditioned on the now-specified SSRF policy + custom-key ENV path); Electron (0002,
  conditioned on the now-added renderer-hardening checklist). All six ADRs + the implementation
  design are now **Status: Accepted (Frozen)**; changing one requires a superseding ADR.
- Carried to L5/L6 (with criteria, not blockers): L6 keyless env-name spike (pin-gated); build the
  Windows orphan reaper (reference sweep is Unix-only); shape the EV event/terminal-state contract +
  SSE snapshot/resync; workspace confinement for runtime tools; cold-start/streaming/crash-recovery
  UX contracts. See `.loop-engineer/evidence/L4/review-dispositions.md`.
- L5 Master Plan COMPLETED (gate PASS): 15 vertical slice (`VS-01`..`VS-15`), 28 executable task,
  reviewer ≠ owner mọi task, 41/41 MUST requirement được phủ. Perf budget + release plan + risk
  register + script task. Hai review độc lập (test-engineer CHANGES_REQUIRED→resolved; security-reviewer
  PASS_WITH_FINDINGS); 3 test HIGH đã đóng trước freeze; 0 unresolved Critical/High. Web giữ DEFERRED
  (ADR 0007). Carried L4 items đã thành task rõ ràng (keyless spike `CGHC-001`, Windows reaper
  `CGHC-005`, EV/resync VS-05, real-frame fixtures `CGHC-024`, SSRF `CGHC-010`, redaction `CGHC-021`,
  renderer hardening `CGHC-025`, credential env-injection `CGHC-009`). Bằng chứng:
  `.loop-engineer/evidence/L5/`.
- Bootstrap/run policy honored: stopped after L5 per `run L5` + `stop-on=gate`. L6 is READY but is
  **not** auto-run (execute per task/slice).
- **L6 mở (RUN-0007, RUNNING) theo `run L6`.** Foundation scaffold: `package.json` (npm workspaces
  `core/* service runtime app/*`) + `tsconfig.base.json` (TypeScript strict) + [ADR 0008](../../docs/architecture/decisions/0008-build-and-workspace-toolchain.md)
  (additive; L4 giữ COMPLETED). 28 task chia 8 wave phụ thuộc (max 3 đồng thời, reviewer ≠ owner).
- **Wave 1 DONE** (checkpoint `.loop-engineer/checkpoints/L6-wave-1.yaml`): `CGHC-001` runtime pin
  (23/23 test), `CGHC-002` loopback service boundary (18/18), `CGHC-003` core/contracts web-seam
  (6/6). Tổng 47 test pass, tsc strict clean cả 3 package. Review độc lập từng task (code-reviewer /
  security-reviewer ≠ owner): CGHC-001/002 PASS_WITH_FINDINGS (0 Crit/High), CGHC-003 CHANGES_REQUIRED
  → 2 High + 1 Med đã đóng trước DONE (RedactPattern rời khỏi barrel UI-importable; lint bắt được
  multi-line import; SessionStatus/TerminalState hợp nhất). **0 unresolved Critical/High.** Carry-forward
  gating: M2 startTime = Win32 CreationDate → CGHC-004; M4 live no-`auth.json` verify → CGHC-009; mọi
  route nhạy cảm giữ token guard; token handshake non-persistent; scrubber bọc error path (CGHC-021).
- **Wave 2 DONE** (checkpoint `.loop-engineer/checkpoints/L6-wave-2.yaml`): `CGHC-007` workspace
  boundary (10/10), `CGHC-009` credential store (13/13 + real `@napi-rs/keyring` round-trip), `CGHC-021`
  redaction (16/16), `CGHC-004` supervision identity (44 controller test, real Win32 CreationDate),
  `CGHC-012` EV contract (26 exec / 83 full suite). Review độc lập từng task (reviewer ≠ owner): 2 High
  của CGHC-003, 1 High của CGHC-007, MED-2 attribution của CGHC-012 đều đóng trước DONE; hai scrubber
  hợp nhất về một `SecretScrubber` chuẩn; top-level `service/` barrel đã nối (workspace/credential/
  diagnostics/execution). **0 unresolved Critical/High.** CGHC-004: owner subagent stall → orchestrator
  hoàn tất + code-review độc lập.
- **Wave 3A DONE** (checkpoint `.loop-engineer/checkpoints/L6-wave-3a.yaml`): `CGHC-005` Windows reaper
  (identity-gated kill, never `/IM`; MED TOCTOU fixed), `CGHC-010` provider port + SSRF (F1 IPv6
  fail-open fixed; F2 HIGH socket-IP-pin + F3 redirect gates → `CGHC-011/012`), `CGHC-027` docs batch 1
  (LANGUAGE_ONLY_CHANGE, L1–L4 valid). Cả 3 owner subagent đều bị **API stream stall** giữa chừng
  (hạ tầng, không phải logic); orchestrator xác minh trên đĩa + hoàn tất/harden, review độc lập luôn giữ.
  service suite **124** + controller **55** pass.
- **Wave 3B DONE** (checkpoint `.loop-engineer/checkpoints/L6-wave-3b.yaml`, parallelism hạ còn 2 theo
  chỉ đạo giảm stall): `CGHC-011` connector test-connection SSRF-hardened (F2 socket-IP-pin + F3
  re-validate mỗi redirect hop + cross-host không resend credential; MED-1 test-gap đóng), `CGHC-023`
  clean.bat allowlist. `CGHC-023` security review **CHANGES_REQUIRED** → HIGH-1 (preserve so-sánh
  case-sensitive trên fs Windows case-insensitive → biến thể hoa/thường xóa nhầm protected path) +
  MEDIUM-1 (junction in-root trỏ lên protected path) **đã fix trước DONE** + regression test. `CGHC-011`
  owner stall ở bước cuối (check file-size); recover verify-on-disk. Review độc lập giữ cả hai. service
  **138** + controller **77** pass. Product owner cho phép **bounded DeepSeek live test** (CGHC-024/028)
  chạy sau OpenCode (endpoint thay-thế-được, token chỉ trong Windows keyring, ≤3 request/task, không vào
  default suite).
- **Wave 3B-2 DONE** (checkpoint `.loop-engineer/checkpoints/L6-wave-3b2.yaml`): `CGHC-006` lifecycle
  scripts (thin `%~dp0` → lifecycle.mjs; exit code trung thực 0/2/3/5/9; start NOT_READY=3 không fake),
  `CGHC-013` session orchestration (one mechanism = OpenCode store SSOT; S3 cancel-freeze; S6 status
  trung thực; S4 rebuild-from-store). `CGHC-013` review 2 MEDIUM **đã fix**: MED-1 rò mutation sau
  terminal non-cancel → freeze-on-any-terminal + reducer defense-in-depth (gia cố additive CGHC-012, KHÔNG
  invalidate); MED-2 reopen làm orphan stream handle đang chạy. service **156** + controller **84** pass.
- **15/28 task DONE** (CGHC-001/002/003/004/005/006/007/009/010/011/012/013/021/023/027). **0 unresolved
  Critical/High.** READY: `CGHC-008` (workspace picker/UI), `CGHC-014` (two-hop SSE), `CGHC-016`
  (permission enforcement, CRITICAL), `CGHC-019` (model switch), `CGHC-020` (provider-error-map),
  `CGHC-022` (settings UI), `CGHC-024` (harness). Electron scaffold (app/shell+ui+Vite+electron-builder)
  đang chạy — unblock nhóm UI. Kế: scaffold → secure DeepSeek credential-ingestion + CGHC-024 offline
  harness → **credential gate** (một lệnh nhập token an toàn, dừng). Live test CGHC-024/028 đã được
  product owner cho phép (DeepSeek sau OpenCode, bounded).
- **READY**: `CGHC-008` (workspace picker/UI), `CGHC-011` (add-credential+test-connection, mang gate
  F2/F3 SSRF), `CGHC-013` (session), `CGHC-022` (settings), `CGHC-023` (clean.bat), `CGHC-024` (harness).
  `CGHC-008/022` cần app/ Electron scaffold trước. `CGHC-024` (real-frame capture) + `CGHC-028` (packaged
  E2E) cần một live opt-in OpenCode run + provider key → **hỏi product owner khi tới bước đó**.
- **Wave 3 READY**: `CGHC-005` (reaper), `CGHC-008` (workspace picker/UI), `CGHC-010` (provider port +
  SSRF), `CGHC-022` (settings store), `CGHC-023` (clean.bat allowlist), `CGHC-024` (captured-frame
  harness), `CGHC-027` (docs normalization). L6 giữ RUNNING tới khi cả 28 task DONE và cổng release-verify
  `CGHC-028` PASS. Web giữ DEFERRED (ADR 0007). Lưu ý: `CGHC-024` real-frame capture + `CGHC-028` packaged
  E2E cần một live opt-in run của OpenCode (secret/paid) — sẽ hỏi product owner khi tới bước đó.

### Quyết định phạm vi & ngôn ngữ (product owner, 2026-07-11)

- **Web = `DEFERRED`** ([ADR 0007](../../docs/architecture/decisions/0007-web-application-deferral.md)):
  release target là Windows desktop app; không cài Next.js, không tạo `apps/web`, không thêm active
  web loop. Web epic `CGHC-WEB-001` ở backlog, chỉ kích hoạt sau khi desktop POC đạt L9 `PASS` hoặc
  product owner yêu cầu. W0–W6 chỉ là deferred proposal.
- **Web-readiness delta review** (read-only, KHÔNG chạy lại L4): 11/12 invariant HOLDS, 1 PARTIAL
  (thiếu package `core/contracts` tường minh + rule import-direction). **L4 giữ `COMPLETED`**, không
  STALE. Gap nhỏ → task hardening `CGHC-ARCH-001` (plan trong L5). Bằng chứng:
  `.loop-engineer/evidence/L4/web-readiness-delta.md`.
- **Chính sách ngôn ngữ tài liệu**: `docs/` dành cho con người viết tiếng Việt; identifier kỹ thuật và
  file máy-đọc giữ tiếng Anh (xem `.claude/rules/documentation.md`). Kiểm kê:
  `.loop-engineer/reports/docs-language-audit.md` (11 tài liệu; 10 English; 8 canonical-critical ưu
  tiên dịch trước L6). Chuẩn hóa = task `CGHC-DOC-001` (plan trong L5). Thay đổi chỉ-ngôn-ngữ =
  `LANGUAGE_ONLY_CHANGE`, **không** invalidate L1–L4.
- **Không loop nào bị invalidate**; L0–L4 giữ nguyên `COMPLETED`.
- Next valid command: `/loop-engineer status`, then `/loop-engineer task CGHC-001` (READY critical-path
  root) or `/loop-engineer run L6` when you choose to proceed. L6 is not auto-run.
