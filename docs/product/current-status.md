---
language: "vi"
status: "active"
updated_at: "2026-07-15"
---

# Trạng thái hiện tại

Cowork GHC đang ở giai đoạn **POC demo candidate** với Commercial UI V3 đã tích hợp. GUI đã có light/dark theme và ngôn ngữ thiết kế thống nhất; vẫn còn các slice chức năng và polish hữu hạn trước funding demo.

## Capability inventory

| Năng lực | Trạng thái | Ghi chú hiện tại |
|---|---|---|
| Startup / lifecycle | **WORKS** | Start/stop/build scripts và New Chat startup. |
| Cowork chat / streaming | **WORKS** | Streaming, history, bounded context và transcript persistence. |
| Conversation management | **PARTIAL** | Search/rename/delete có nền tảng; cần PO regression check cho thao tác delete và menu. |
| Permission modes | **PARTIAL** | Hỏi trước / Tự động / Chỉ đọc đã có; repeated prompt và policy behavior cần packaged happy-path verification. |
| Verified file create/modify | **PARTIAL** | False-success guard và file evidence đã bổ sung; golden path phải tiếp tục được kiểm tra trên packaged app. |
| Provider profiles | **PARTIAL** | DeepSeek preset + custom OpenAI-compatible, keyring, active profile; model discovery và reliable readiness persistence chưa hoàn tất. |
| Credentials | **WORKS** | Windows Credential Manager; không persist plaintext key trong profile JSON/UI state. |
| Workspace navigator | **WORKS — BASIC** | Guarded file tree, open folder, refresh, selection. |
| Workspace preview/edit | **PARTIAL** | Text/Markdown edit; binary preview theo giới hạn; PDF packaged behavior và live Agent refresh còn cần hardening. |
| Skills CRUD | **WORKS — BASIC** | User Skill create/edit/delete/enable; built-in read-only. |
| Inspector | **PARTIAL** | Shell/tabs có sẵn; cần product definition và data contract rõ cho Plan/Activity/File Review. |
| Settings / theme | **WORKS — BASIC** | Full-screen Settings; System/Light/Dark; cần giảm scroll/nút và polish các form state. |
| Detailed logging | **PARTIAL / NEEDS CLARIFICATION** | Setting tồn tại; cần tài liệu và xác nhận output/retention/redaction. |
| Local telemetry | **PARTIAL / NEEDS CLARIFICATION** | Setting tồn tại; cần contract local-only, event list, retention và export behavior. |
| Local user authentication | **NOT IMPLEMENTED** | Chưa có local sign-in/lock gate. |
| File Work Review delete | **DEFERRED** | OpenCode v1.17.11 tool surface chưa cho deterministic delete acceptance. |
| D1–D4 backend | **WAITING** | Integration surfaces có sẵn; team backend chưa merge. |
| Full RC / release signing | **DEFERRED** | Chưa phải release candidate. |

## Demo truth

Demo hiện nên tập trung vào:

```text
Launch → select provider → select workspace → chat → ask permission → create/modify file → preview/review → reopen history
```

Không trình bày D1–D4 placeholder như capability đã hoàn thành.
