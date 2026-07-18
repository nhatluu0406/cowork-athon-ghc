---
language: "vi"
status: "approved"
created_at: "2026-07-13"
topic: "microsoft-claudecode-surfaces"
source_handoff: "Microsoft và ClaudeCode tabs/design_handoff_ms365_claudecode/README.md"
---

# Design: Surface Microsoft 365 & Claude Code (UI đầy đủ, không mock)

## Mục tiêu

Tái hiện hai surface trong design handoff `Microsoft và ClaudeCode tabs/` vào shell V3 của
`app/ui`, theo quyết định đã duyệt:

- **Chế độ data**: UI đầy đủ, **không mock**. Mọi dữ liệu đến từ local service thật hoặc hiện
  empty state honest. Không keyword-routing giả, không dữ liệu Planner/Outlook/diff giả.
- **Scope**: cả hai surface trong một slice.
- **Approach**: module TypeScript thuần theo pattern `ui-shell/` hiện có (Approach A). Không
  framework mới. Bỏ nút "Chấp nhận tệp / Từ chối" trên diff (chưa có execution path thật);
  editor là read-only preview.

## Ngoài phạm vi (out of scope)

- Backend D2 / Microsoft Graph, OAuth, token store — không implement.
- Editor ghi được, terminal, accept/reject file change.
- Chip nhánh git / `↑2 ↓0` ở header Claude Code (chưa có nguồn git thật từ service).
- Thay đổi topbar / rail / statusbar hiện có ngoài việc định tuyến surface.

## Kiến trúc & vị trí code

Hai surface là view trong shell V3, render qua định tuyến surface trong `app-shell.ts`
(thay cho `renderIntegrationSurface` placeholder đối với `microsoft` và `code`):

```text
app/ui/src/ui-shell/microsoft/
  microsoft-view.ts       — mount/render + segmented "Trợ lý AI / Kết nối"
  ms-assistant-view.ts    — transcript + composer (disabled khi disconnected)
  ms-connect-view.ts      — card đăng nhập (chưa kết nối) / card tài khoản + grid dịch vụ + scopes
  microsoft.css
app/ui/src/ui-shell/code/
  code-view.ts            — layout 3 cột `explorer | editor | claude-panel` + segmented
  code-explorer.ts        — cây workspace + mục SOURCE CONTROL (từ File Review)
  code-editor.ts          — thanh tab file + màn chào + read-only viewer + diff viewer
  claude-panel.ts         — panel chat phải (transcript + composer, nối session thật)
  code-onboarding.ts      — màn "Cách hoạt động" 4 bước
  code.css
```

Mỗi file production giữ dưới ~250 dòng; tách thêm module con nếu vượt.

### surface-registry

- `code`: `planned` → `available`, label "Claude Code", component `ClaudeCodeSurface`.
- `microsoft`: **giữ `availability: "awaiting_integration"`** (backend D2 chưa merge) nhưng
  component trỏ sang `MicrosoftSurfaceView`. Rail giữ chấm "chờ tích hợp".

## Nguồn dữ liệu

| Thành phần | Nguồn |
|---|---|
| Explorer tree | `mountWorkspaceNavigator` / `workspace.list` hiện có (read-only, lazy, bounded) |
| Mở file (tab thường) | `openWorkspaceFileInView` qua preview boundary hiện có — pill "Chỉ đọc" |
| SOURCE CONTROL + diff | `fileReviews` từ `ActivitySnapshot` / persisted activity của conversation đang active; không có review → mục rỗng với copy honest |
| Panel Claude Code chat | Cùng `ConversationManager` / session store với surface Cowork — một source of truth, không tạo cơ chế session song song. Prompt gửi thật qua runtime OpenCode; permission card map vào permission flow thật |
| Chip repo ở header Code | Tên workspace từ service |
| Microsoft 365 | Contract `MicrosoftIntegrationView` có sẵn, state cố định `disconnected` trong slice này |

### Microsoft 365 khi disconnected

- Tab **Kết nối**: card sign-in đúng design; nút "Đăng nhập với Microsoft" **disabled** kèm
  ghi chú "Backend D2 (Microsoft Graph) chưa được tích hợp". Danh sách scope sẽ-xin render
  tĩnh từ contract (mô tả năng lực, không phải dữ liệu giả).
- Tab **Trợ lý AI**: card giữa màn "Chưa kết nối Microsoft 365" + nút "Mở trang kết nối"
  (chuyển sang tab Kết nối). Composer render đủ nhưng disabled.
- View render được đủ các `MicrosoftConnectionState` để backend D2 cắm vào sau mà UI không đổi.

## Fidelity hình ảnh

- Tokens của handoff (accent cam `#e85d1a`/`#d1500f`, nền `#f7f8fa`, hairline `#eceff3`,
  radius card 14 / control 8–10 / pill 999, shadow card, diff add/del/context, tint theo dịch
  vụ MS365, mono Cascadia) map vào `design-tokens.ts` trung tâm; token thiếu thì bổ sung vào
  tokens trung tâm, không hard-code trong CSS component.
- Icon dùng `product-icons.ts`; bổ sung icon còn thiếu: logo Microsoft 4 ô (fill), sparkle,
  chip read/edit/run/git, split editor.
- Motion: `cghc-pulse` cho dot "đang chạy"; hover xám nhạt / cam nhạt theo handoff.
- Bỏ khỏi design vì không có hành động thật: nút Chấp nhận/Từ chối diff, keyword-routing,
  dữ liệu mẫu MS365, chip nhánh git.

## State & error handling

- Code view: `openFiles[]`, `activeFile` (null = màn chào), `explorerOpen` — state cục bộ của
  component. Conversation / permission / activity state đọc từ controller hiện có, không
  duplicate server state.
- Microsoft view: `msTab` ('assistant' | 'connect') cục bộ; `msConnected` đọc từ contract.
- Lỗi load tree/preview/diff dùng error mapping + recovery action hiện có. Secret-path
  redaction của File Review giữ nguyên (không hiện nội dung file secret-like).
- Enter gửi, Shift+Enter xuống dòng; transcript auto-scroll; toàn bộ control có label cho
  screen reader và điều hướng được bằng bàn phím.

## Testing

- **Unit**: render Microsoft view theo từng `MicrosoftConnectionState`; mở/đóng tab editor và
  fallback về màn chào; map `fileReviews` → SOURCE CONTROL rows + diff lines (add/del/ctx,
  số dòng cũ/mới); composer disabled khi disconnected; explorer collapse/expand.
- **Focused run**: `npm run typecheck`, targeted UI tests, `npm run build:renderer`.
- **Packaged verification** (user-facing acceptance): build + screenshot verifier theo pattern
  `tools/verify/ui-shell-v3-production-screenshots.mjs`, mở rộng cho 2 surface mới; cập nhật
  `docs/product/current-status.md` sau khi có evidence.

## Acceptance criteria

1. Rail mở được surface Claude Code (available) và Microsoft 365 (awaiting_integration nhưng
   có UI shell thật thay vì placeholder chung).
2. Claude Code: Explorer hiện cây workspace thật; bấm file mở tab read-only; file có review
   trong conversation active hiện trong SOURCE CONTROL và mở được diff 3 cột; panel phải chat
   được bằng session thật (cùng store với Cowork), permission Allow/Deny hoạt động thật.
3. Microsoft 365: cả 2 tab render đúng design ở trạng thái disconnected; không có dữ liệu giả;
   không có nút bấm nào tạo cảm giác hành động thành công giả.
4. Không secret trong log/state/DOM; UI không truy cập filesystem trực tiếp.
5. Typecheck + targeted tests + build renderer PASS; packaged screenshot evidence được tạo.
