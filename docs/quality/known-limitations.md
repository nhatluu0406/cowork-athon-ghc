---
language: "vi"
status: "active"
updated_at: "2026-07-13"
---

# Known limitations

## P0 — cần xác nhận packaged

- Golden path file create/permission chưa được chạy trên Windows packaged app sau recovery patch.
- OpenCode vẫn có thể không chọn tool trong một số prompt; Cowork nay phải hiển thị trạng thái **chưa xác minh**, không được coi prose là mutation thành công.
- Permission hiện dùng polling 500 ms; chưa có push notification trực tiếp từ event stream tới renderer.

## Workspace Companion

- Chỉ `.txt` và `.md` nhỏ được edit.
- File text vượt 512 KiB hiển thị truncated và read-only.
- XLSX chỉ preview read-only. Direct save bị vô hiệu hóa vì implementation cũ có thể mất formula, format, merged cells và sheet khác.
- DOCX render plain text; chưa có Office-grade layout/editing.
- PDF iframe blob cần packaged verification theo CSP.
- Image/PDF/DOCX/XLSX preview giới hạn 8 MiB.
- Khi editor dirty và Agent update file, UI giữ edit hiện tại và chỉ báo conflict; chưa có merge UI.

## Agent / Permission / File Review

- File Work Review delete chưa tin cậy trên OpenCode v1.17.11.
- `file_mutation` là candidate runtime event; user-facing verified success dựa thêm trên File Work Review snapshot cùng runtime turn.
- Command policy nâng cao, allow-for-session, directory rule và enterprise policy chưa có.

## Provider

- Phase hiện tại hỗ trợ DeepSeek preset và custom OpenAI-compatible profiles, không phải universal native provider layer.
- Switching active profile trên running OpenCode child cần packaged proof với hai endpoint thật.
- D4 routing/failover/key pool/cost routing chưa merge.

## UI

- Commercial visual readiness hiện **FAIL/PARTIAL**, chưa có PO sign-off.
- Dark mode setting chưa phải dark theme hoàn chỉnh.
- Component system, tooltip, transcript, Settings, Inspector và Workspace cần một pass đồng bộ sau khi P0 golden path PASS.

## Release

- Full L9/RC chưa hoàn tất.
- Routine verification không được dựa vào live LLM determinism; cần focused deterministic seams + một manual packaged smoke.
