---
task: CGHC-026
title: "Runtime extensions — skill registry (RE1), MCP lifecycle (RE2), workflow templates (RE4), failure isolation (RE5)"
language: "vi"
status: DONE
created_at: "2026-07-11"
---

# CGHC-026 — Bằng chứng runtime extensions

Lớp extension seam-based trong `service/src/extensions/`. Thực thi live skill/MCP là Tier 2 (default
not-attached trung thực). Tất cả RE là SHOULD/POC.

## 1. Thành phần + seam (default trung thực)

- `SkillRunner` (RE1): `run(skill,input)` → ok/unavailable hoặc reject; default `notAttachedSkillRunner`
  trả `unavailable` (không bịa output). Có sample skill Cowork-GHC-defined.
- `McpAdapter` (RE2): connect/disconnect/health; default `notAttachedMcpAdapter` trả `unavailable`
  (không bịa connected). Endpoint URL validate SSRF qua CÙNG `SsrfPolicy` của provider port TRƯỚC khi
  lưu (từ chối `endpoint_blocked`; từ chối cả khi không có policy).
- `TemplateStore` (RE4): save/get/list/delete; default in-memory. Nguồn chân lý cho NỘI DUNG template
  (khác state type với status).
- `ExtensionState`: MỘT map `status ∈ enabled|disabled|failed` + một mảng `ExtensionDiagnostic` — cả 3
  registry đọc/ghi cùng store (không map status song song). `ExtensionDiagnostic{kind,name,reason,at}`,
  reason luôn redact.

## 2. RE5 isolation (thuộc tính an toàn chịu tải)

`runIsolated`/`runIsolatedSync` bọc MỌI op có thể lỗi (skill run, MCP connect/disconnect/health,
template save/resolve): try → bắt throw/reject tại biên (không lan lên) → rút gọn 1 dòng non-secret qua
redactor inject (default `sanitizeErrorMessage`; composition inject value-scrub-then-shape) → `state.fail`
(append diagnostic + status `failed` = quarantine) → trả `ExtOutcome.err`. Registry method KHÔNG BAO GIỜ
throw → session gọi và kiểm tra value, tự quyết tiếp tục. Extension `failed` short-circuit `quarantined`
khi gọi lại (không retry/crash loop).

## 3. Review độc lập (code-reviewer ≠ implementer) → CHANGES_REQUIRED (1 HIGH+1 MED+2 LOW) → ĐÃ SỬA

- **HIGH (ĐÃ SỬA)**: `disable()` xoá status `failed` → có thể `enable()` lại extension hỏng (bỏ qua bất
  biến RE5). Sửa: quarantine STICKY — `disable()` trả `quarantined` khi đang failed; thêm đường
  un-quarantine TƯỜNG MINH duy nhất mỗi kind (skill: `clearQuarantine(id)` → về `disabled`; mcp:
  `remove`+`add`; template: `save` lại). Có test disable→enable KHÔNG hồi sinh.
- **MEDIUM (ĐÃ SỬA)**: `remove()` bỏ xoá khi live `disconnect` reject → entry orphan. Sửa: best-effort —
  disconnect isolated (reject → diagnostic) rồi LUÔN `delete` + `state.remove`. Test adapter
  disconnect-reject → entry vẫn biến mất + có diagnostic.
- **LOW (ĐÃ SỬA)**: thân catch `runIsolated` chưa bảo vệ (redact/state.fail throw thoát). Sửa:
  `captureFailure` phòng thủ — redact throw → fallback `[redacted]`; state.fail throw → swallow, vẫn trả
  typed error. Test redactor-throw + state.fail-throw không thoát.
- **LOW (ĐÃ SỬA)**: template `store.save/get` ngoài isolation → store throw thoát. Sửa: qua
  `runIsolatedSync`/`runIsolated`. Test throwing store → typed error + diagnostic.
- **INFO (ĐÃ SỬA)**: tài liệu 1 quy tắc un-quarantine trên `ExtensionState`.

Reviewer xác nhận PASS: `runIsolated` là choke point mọi op; sync-throw bị bắt; default không bịa;
SSRF trước persist (cả khi không policy); một state map; composition tái dùng MỘT redactor + MỘT SsrfPolicy.

## 4. Composition

`deps.extensions: ExtensionRegistry` wired qua `createExtensionRegistry({now, redact: redactError, ssrf})`
— tái dùng redactor composed + SsrfPolicy của provider port. KHÔNG mount HTTP router (chủ ý cho POC).

## 5. Kiểm chứng

- Full suite: **530 pass / 0 fail / 0 skip** (ổn định 2 lần). `tsc -b` sạch. Source < 250 (max
  `mcp-registry.ts` 217). Extension tests 30 pass.

## 6. Tier-2 / CGHC-028 (không build ở đây)

- Live skill execution qua OpenCode (real `SkillRunner`); live MCP process/connection (real `McpAdapter`,
  không spawn ở đây); mount extensions HTTP router + UI; surface `plugin.added`/`integration.updated`
  frame thành EV. `command` chưa validate vì không thực thi ở đây (host live = Tier 2).
