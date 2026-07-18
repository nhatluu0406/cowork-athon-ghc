---
language: "vi"
status: "approved"
created_at: "2026-07-14"
topic: "ms365-outlook-read"
track: "D2"
phase: "P1"
---

# Design: MS365 Outlook (chỉ đọc) — P1

## Mục tiêu

AI tìm kiếm và tóm tắt/giải thích nội dung mail của user theo yêu cầu, **chỉ đọc**
(không gửi, không reply). Là slice P1 trong
[MS365 Task Suite Roadmap](./2026-07-14-ms365-task-suite-roadmap-design.md),
tái dùng `Ms365Connector` sẵn có, không sửa core.

## Quyết định thiết kế (đã chốt)

- **Scope**: chỉ mailbox của chính user đã connect — Graph `/me/messages`. Scope tối thiểu
  `Mail.Read`. Không hỗ trợ shared/delegated mailbox ở P1.
- **2 bước (bounded)**: `outlook_search_messages` trả **metadata + snippet** (subject, from,
  receivedDateTime, id, bodyPreview) — nhẹ, tiết kiệm token. Muốn chi tiết thì model gọi tiếp
  `outlook_get_message` theo id; `outlook_summarize_message` tải body bounded để model tóm tắt.
- **Auto-gen query**: model tự dựng Graph `$search`/`$filter` từ prompt user (người gửi, khoảng
  thời gian, từ khóa). Service validate + cap. **Không** có cơ chế allowlist folder ở P1.
- **Read-only → KHÔNG PermissionGate**: mọi tool P1 là read, chạy trực tiếp sau guard
  `not_connected` (giống các read tool SharePoint hiện có).

## Kiến trúc & boundary

Đúng khuôn P0.5/SharePoint — thêm một service module + tool set, cắm vào `ms365-tool-router`:

```text
ms365-tool-router
   └─ OutlookService (mới) ── Graph /me/messages  (read-only)
          └── Ms365Connector.graph()  (đã có — không chạm token/keyring trực tiếp)
```

## Tool model

| Tool | Kind | Graph | Permission |
|---|---|---|---|
| `outlook_search_messages` | read | `GET /me/messages?$search=...` (hoặc `$filter`) | không |
| `outlook_get_message` | read | `GET /me/messages/{id}` | không |
| `outlook_summarize_message` | read | tải body bounded từ `/me/messages/{id}` cho model tóm tắt | không |

### `OutlookService` (port shape dự kiến)

```ts
interface OutlookMessageHit {
  id: string;
  subject: string;
  from: string;              // from.emailAddress.address, "" nếu thiếu
  receivedDateTime: string;
  bodyPreview: string;       // snippet ngắn Graph trả sẵn
}

interface OutlookService {
  // query: chuỗi model tự dựng; service bọc vào $search hoặc $filter an toàn
  searchMessages(query: string, limit?: number): Promise<OutlookMessageHit[]>;
  getMessage(id: string): Promise<OutlookMessageHit & { body: string }>;
  getMessageSummaryText(id: string): Promise<string>;  // body bounded để tóm tắt
}
```

## Bounded / safe defaults

- Search results cap (mặc định 25, như SharePoint).
- Body download cap theo byte (tái dùng limit 64 KiB của File Review / SharePoint summary).
- Query truyền vào Graph phải được service kiểm soát: chỉ cho `$search`/`$filter` hợp lệ; không
  cho model tự chèn path/segment tùy ý (chống injection vào URL Graph).
- GraphClient timeout + typed error mapping sẵn có: `auth_expired`, `rate_limited`, `not_found`,
  `graph_error`.

## State & error handling

- `not_connected` khi chưa connect (fail closed, không throw) — giống các read tool hiện có.
- 429 tôn trọng `Retry-After`; không infinite retry.
- Token/secret **không bao giờ** ở view/log/envelope (tái dùng redaction hiện có). Nội dung mail
  chỉ đi qua tool result về model, không persist ra ngoài turn.

## Testing (khuôn chung tái dùng)

- **Unit (service)** với fake Graph:
  - `searchMessages`: dựng query đúng, cap results, defensive mapping (drop entry thiếu
    id/subject; from thiếu → ""), path đúng `/me/messages`.
  - `getMessage`: map body; `not_found` → typed error.
  - `getMessageSummaryText`: truncate ở maxSummaryBytes.
- **Tool router / dispatch**: `not_connected` khi chưa connect; 3 read tool chạy thẳng, KHÔNG
  qua PermissionGate.
- **Redaction**: token không xuất hiện trong bất kỳ output nào.
- **Focused run**: `npm run typecheck`, `cd service && node --import tsx --test tests/ms365-outlook*.test.ts`.

## Acceptance criteria

1. `outlook_search_messages` tìm trong `/me/messages`, model tự dựng query, trả metadata +
   snippet, cap kết quả.
2. `outlook_get_message` trả chi tiết theo id; `outlook_summarize_message` tải body bounded để
   model tóm tắt/giải thích.
3. Tất cả read-only — KHÔNG PermissionGate; `not_connected` fail closed khi chưa connect.
4. Không secret trong log/state/envelope; service không chạm Graph/token/keyring trực tiếp
   (chỉ qua `Ms365Connector`).
5. Query bị kiểm soát — model không chèn được path Graph tùy ý.
6. Feature flag D2 OFF mặc định; typecheck + targeted tests + (nếu chạm renderer) build PASS.

## Ngoài phạm vi (out of scope)

- Gửi/reply/forward mail (write) — không thuộc P1.
- Shared/delegated mailbox, folder allowlist — slice sau nếu cần.
- Attachment của mail — chưa xử lý ở P1.
- UI Settings riêng cho Outlook — P1 chỉ là tool cho AI gọi, chưa cần surface renderer mới.
