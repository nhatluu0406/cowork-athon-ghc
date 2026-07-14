---
language: "vi"
status: "active"
updated_at: "2026-07-13"
---

# Kế hoạch sản phẩm Cowork GHC

## 1. Tầm nhìn

Cowork GHC là ứng dụng desktop Windows local-first: người dùng chọn workspace trên máy,
cấu hình LLM endpoint, trò chuyện với agent, và phê duyệt thao tác file khi cần. Giá trị
cốt lõi là vòng làm việc rõ ràng, có kiểm soát, và trung thực về trạng thái runtime.

## 2. Nguyên tắc

- Local-first; Windows packaged app là acceptance surface hiện tại.
- Provider thay thế được; credential trong Windows keyring.
- Permission trước mutation; UI không claim ready khi chưa verify.
- Packaged acceptance ưu tiên hơn dev server.
- Phát triển LEAN: một slice, test tập trung, commit có ý nghĩa.

## 3. Kiến trúc (tóm tắt)

```text
Electron renderer → preload/shell bridge → local service → OpenCode runtime → LLM endpoint
```

Cowork conversation là identity dài hạn (transcript, workspace, provider snapshot, activity,
file-change history). Một conversation có thể span nhiều OpenCode runtime turns.

## 4. Năng lực trong phạm vi POC

| Vùng | Mô tả |
|---|---|
| Lifecycle | init/start/stop/clean qua scripts Windows |
| Workspace | Chọn thư mục, navigator read-only bounded |
| Provider | Profiles Phase 1, keyring, readiness preflight |
| Chat | Streaming, multi-turn context envelope |
| Attachments | Text files, secret blocking, budget |
| Skills | Local SKILL.md discovery, enable/disable |
| Permissions | Allow/Deny trước tool/file mutation |
| File Work Review | Before/after diff, activity persistence |
| Conversations | Sidebar, search, rename, delete, relaunch |
| Settings | Full-screen: Nhà cung cấp + Chung |

## 5. Ngoài phạm vi hiện tại

- D1–D4 external integrations (Dispatch, Microsoft, Knowledge, Gateway)
- Skill marketplace / MCP / cloud catalog
- Full workspace IDE explorer
- Universal Preview tab / direct editor
- Web / Next.js, cloud sync, multi-user
- D4 advanced gateway (routing, failover, key pool)

## 6. Acceptance

- Demo journey: [demo-acceptance.md](../quality/demo-acceptance.md)
- Giới hạn: [known-limitations.md](../quality/known-limitations.md)
- Trạng thái: [current-status.md](./current-status.md)
