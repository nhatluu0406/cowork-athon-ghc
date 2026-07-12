---
title: "L5 Master Plan — dispositions review độc lập"
document_type: "evidence"
language: "vi"
status: "informational"
---

# L5 — Master Plan: Dispositions & Freeze Record

Loop: L5 (Master Plan). Run: RUN-0006. Ngày: 2026-07-11.
Reviewer ≠ implementer: plan do **product-architect** soạn; hai reviewer độc lập (**test-engineer**,
**security-reviewer**) phê bình; fix do author áp dụng theo yêu cầu reviewer; Lead xác minh bằng
controller.

## Panel review (evidence dưới `.loop-engineer/evidence/L5/`)

| Lens | Role | Verdict ban đầu | Crit | High | Med | Low | Evidence |
|---|---|---|---|---|---|---|---|
| Test strategy | test-engineer | CHANGES_REQUIRED → resolved | 0 | 3 | 6 | 2 | review-test.md |
| Security/boundary | security-reviewer | PASS_WITH_FINDINGS | 0 | 0 | 4 | 3 | review-security.md |

**Sau fix: 0 Critical, 0 unresolved High.** Định-nghĩa-Hoàn-thành của gate đạt.

## 3 HIGH (test) — đã đóng trước freeze

- **H1 — CGHC-028 (release verify) thiếu dependency closure.** RESOLVED: thêm deps
  `CGHC-011,015,017,019,025`; thêm acceptance + test cho provider-error E2E leg + packaged smoke chạy
  full critical path (provider-error + template + resume). → release-verify không thể READY trước khi
  test-connection/streaming-UI/permission-UI/model-pick/renderer-hardening tồn tại.
- **H2 — CGHC-016 (permission) acceptance có P6 fail-closed + P4 approval-level nhưng thiếu test.**
  RESOLVED: thêm test "fail-closed on timeout", "approval-level enforcement (P4)", "audit event per
  Allow/Deny (P5)".
- **H3 — CGHC-025 (renderer hardening) thiếu test.** RESOLVED: thêm test assertion CSP/sandbox/
  nodeIntegration:false/contextIsolation/nav-lockdown/no-generic-IPC.

## MEDIUM/LOW đã fold vào plan

- **M5 / SEC-2:** CGHC-021 thêm test "export diagnostics bundle → grep secret value → 0 hit"
  (diagnostics bundle + execution-metadata record).
- **Reviewer appropriateness (SEC MED-3):** CGHC-011 reviewer → `security-reviewer` (credential
  no-echo là thuộc tính security-dominant). CGHC-015 & CGHC-020 giữ domain reviewer + thêm acceptance
  "security-reviewer co-signs the secret-non-leak property".
- **SSRF (SEC MED-2):** CGHC-010 acceptance liệt kê đầy đủ policy ADR 0005 (https; chặn RFC-1918/
  link-local/loopback/metadata; enforce ở service; DNS-rebinding guard) + 6 guardrail của test-mode escape.
- **Runtime-tool confinement (SEC MED-1):** CGHC-007 & CGHC-018 thêm acceptance "OpenCode child rooted
  tại workspace + re-validate resolved real-path trên mỗi proxied tool-permission event".
- **Audit P5 (SEC MED-4):** CGHC-016 (Allow/Deny) + CGHC-019 (provider/model change) thêm acceptance
  audit-event.
- **LOW:** CGHC-023 thêm acceptance/test "reject manifest entry absolute/UNC/bare-drive-letter".

## Kết quả kiểm tra (controller)

- `verify: PASS` (project-state / loops / tasks OK).
- 28 executable task; `CGHC-WEB-001` giữ ở backlog (DEFERRED, không phải executable task).
- reviewer ≠ owner cho TẤT CẢ 28 task; priority ∈ {LOW,MEDIUM,HIGH,CRITICAL}; không dangling dep.
- READY (critical-path root): CGHC-001, CGHC-002, CGHC-003.
- 15 vertical slice (VS-01..VS-15); toàn bộ 41 MUST requirement được ≥1 task phủ (traceability §8).

## Freeze

Master Plan + task graph được chốt cho L6. Web = DEFERRED (ADR 0007) giữ nguyên; `CGHC-DOC-001`
(→ CGHC-027) và `CGHC-ARCH-001` (→ CGHC-003) đã được đưa vào graph như task thực thi. L6 chỉ thực thi
từng task/slice (`/loop-engineer task <id>` hoặc `slice <id>`), reviewer ≠ implementer mỗi task.
