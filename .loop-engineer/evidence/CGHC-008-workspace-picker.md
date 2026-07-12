---
task: CGHC-008
title: "Workspace picker + server-side validate + recent list (W1/W3 MUST + W2 SHOULD)"
language: "vi"
status: DONE
created_at: "2026-07-11"
---

# CGHC-008 — Bằng chứng workspace picker + validate

## 1. Thành phần

- `service/src/workspace/validate.ts` — `validateWorkspaceSelection(input, probe)`: xếp lớp check
  lexical (`grantWorkspace`) + probe đĩa (exists/is-directory/writable). Trả discriminated union
  `{ok:true,grant}` | `{ok:false,reason,message}`. FS probe INJECT (`WorkspaceFsProbe`); `nodeFsProbe()`
  production. Mọi nhánh reject ⇒ KHÔNG grant.
- `service/src/workspace/recent.ts` — MRU recent store (một nguồn), dedupe case-fold win32, capacity-bound,
  `listWithAvailability(probe)` probe tươi + GIỮ entry unavailable (không drop), chỉ path/timestamp/id.
- `service/src/workspace/probe.ts` — `nodeExistenceProbe` production (dir tồn tại; file/missing ⇒ false,
  không throw).
- `service/src/workspace/router.ts` — `POST /v1/workspace/grant` + `GET /v1/workspace/recent`, TOKEN-GUARDED;
  validate server-side, chỉ record recent khi granted; reject không record.
- `app/ui/src/workspace-picker.ts` + `service-client.ts` — renderer là client; mở dialog CHỈ qua
  preload shell-bridge `pickWorkspaceFolder()` (không ipcRenderer, không nodeIntegration, không fs/credential
  từ UI); chỉ activate khi `granted:true`; DOM bằng `textContent`.

## 2. Acceptance

- **W1 native picker qua bridge**: đã có sẵn ở scaffold (shell-bridge `pickWorkspaceFolder` →
  `dialog.showOpenDialog({properties:["openDirectory"]})`); KHÔNG cần đổi shell.
- **W3 validate reject không session**: `workspace-validate` + `workspace-router` (real loopback):
  not_found/not_a_directory/not_writable/not_absolute/unc_path reject không grant, không vào recent;
  UI chỉ `onActivated` khi granted.
- **Spaces + Unicode**: `workspace-spaces-unicode` tạo dir thật `My Projects (tệp) — 日本語 space`, validate
  qua `nodeFsProbe`, `grant.rootPath === path.resolve(root)` (không mangle), confinement giữ; path là
  argument đơn (không shell string).
- **W2 recent unavailable**: `workspace-recent` — entry missing ⇒ available:false (giữ, không drop);
  probe throw ⇒ degrade unavailable; MRU/dedupe/capacity.

## 3. Review độc lập (code-reviewer ≠ implementer) → PASS, 0 Critical/High

Xác nhận renderer hardened (sandbox/contextIsolation/no ipcRenderer), validate reject-không-grant,
recent single-store keep-unavailable, routes token-guarded round-trip. Findings:

- **MEDIUM — ĐÃ SỬA**: body dị dạng (`{}` / `rootPath:""`) trả HTTP 500 thay vì 400 (WorkspaceRequestError
  không được dispatcher map ⇒ rơi vào internal). Sửa GENERAL: thêm `BadRequestError` ở
  `server/http-util.ts`, dispatcher `fail()` map → `bad_request`/400; `WorkspaceRequestError extends
  BadRequestError` ⇒ mọi handler có đường trả 400 an toàn (message generic, không path). Thêm test
  end-to-end (400 + `bad_request` + không record).
- **LOW — ĐÃ CHÚ THÍCH**: `isWritable(W_OK)` trên Windows không phản ánh ACL thư mục (best-effort);
  execution boundary vẫn authoritative. Thêm comment rõ.
- **LOW — ĐÃ SỬA**: thiếu test body-dị-dạng (đã thêm) + probe file thật (thêm test `nodeExistenceProbe`
  trên FILE thật ⇒ false, dir ⇒ true, missing ⇒ false-không-throw).

## 4. Kiểm chứng

- Workspace tests: **25 pass** (gồm MEDIUM 400 + LOW real-file probe). Full suite tại thời điểm land:
  354 pass / 0 skip / 0 fail; full re-verify + `tsc -b` chạy lại sau khi CGHC-022 song song land.
