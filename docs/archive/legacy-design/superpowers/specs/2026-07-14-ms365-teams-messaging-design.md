---
language: "vi"
status: "approved"
created_at: "2026-07-14"
topic: "ms365-teams-messaging"
track: "D2"
phase: "P4"
---

# Design: MS365 Teams messaging (search + post + @mentions) — P4

## Mục tiêu

AI đọc/tìm tin nhắn Teams và **post message** tới user (chat 1-1/group) và **Channels**, có
**@mentions**. Slice P4 trong [MS365 Task Suite Roadmap](./2026-07-14-ms365-task-suite-roadmap-design.md).

## Quyết định thiết kế (kèm ràng buộc Graph thực tế)

- **"Search tin nhắn" = get recent + model lọc (honest)**: Graph v1.0 **không hỗ trợ `$search`/
  `$filter` nội dung** trên `/chats/{id}/messages` và `/channels/{id}/messages`. Tool
  `teams_get_messages` trả N tin nhắn gần nhất (cap 50, `$top`), model tự lọc/tóm tắt theo yêu
  cầu — không giả vờ có full-text search.
- **Gộp tool chat/channel (YAGNI)**: `teams_get_messages` và `teams_post_message` nhận
  **hoặc** `chatId` **hoặc** `teamId`+`channelId` (đúng một trong hai dạng — validate chặt).
  Giảm 8 tool xuống 6.
- **@mentions qua placeholder tường minh**: model cung cấp `content` (plain text, có thể chứa
  placeholder `@{0}`, `@{1}`…) + `mentions: [{ userId, displayName }]`. Service:
  1) HTML-escape toàn bộ content (chống HTML injection vào Teams),
  2) thay `@{i}` bằng `<at id="i">displayName</at>` (displayName cũng được escape),
  3) build body `contentType: "html"` + `mentions[]` đúng shape Graph
     (`{ id: i, mentionText, mentioned: { user: { id: userId, displayName } } }`).
  Deterministic, test được, model không tự viết HTML.
- **Resolve mention target**: `teams_list_members` (chatId hoặc teamId) trả `{ userId,
  displayName }` — model dùng để dựng mentions. Tool này cũng là nền resolve-user cho P5.
- **Post là write duy nhất → PermissionGate** (mô tả rõ đích gửi); mọi read chạy thẳng.

## Tool model (6 tool)

| Tool | Kind | Graph | Permission |
|---|---|---|---|
| `teams_list_chats` | read | `GET /me/chats?$expand=members` (cap) | không |
| `teams_list_teams` | read | `GET /me/joinedTeams` | không |
| `teams_list_channels` | read | `GET /teams/{teamId}/channels` | không |
| `teams_list_members` | read | `GET /chats/{id}/members` hoặc `GET /teams/{id}/members` | không |
| `teams_get_messages` | read | `GET /chats/{id}/messages` hoặc `GET /teams/{tid}/channels/{cid}/messages` (`$top`) | không |
| `teams_post_message` | **write** | `POST .../messages` body html + mentions | **PermissionGate** |

### `TeamsService` (port shape)

```ts
interface TeamsChat { id: string; topic: string; memberNames: string[] }
interface TeamsTeam { id: string; displayName: string }
interface TeamsChannel { id: string; displayName: string }
interface TeamsMember { userId: string; displayName: string }
interface TeamsMessage { id: string; from: string; createdDateTime: string; text: string } // text = body.content bounded, strip theo cap byte
type MessageTarget = { chatId: string } | { teamId: string; channelId: string };

interface TeamsService {
  listChats(): Promise<TeamsChat[]>;
  listTeams(): Promise<TeamsTeam[]>;
  listChannels(teamId: string): Promise<TeamsChannel[]>;
  listMembers(target: { chatId: string } | { teamId: string }): Promise<TeamsMember[]>;
  getMessages(target: MessageTarget): Promise<TeamsMessage[]>;
  postMessage(input: {
    target: MessageTarget;
    content: string;                                  // plain text + @{i} placeholders
    mentions?: Array<{ userId: string; displayName: string }>;
  }): Promise<{ id: string }>;
}
```

## Bounded / safe defaults

- Cap 50 mọi list/messages (`$top` khi Graph hỗ trợ). Message `text` bounded (4 KiB/message —
  tin nhắn chat ngắn; tổng đã bị cap số message).
- id (chat/team/channel) `encodeURIComponent` trong path; content/mentions chỉ vào JSON body.
- **HTML-escape content trước khi chèn `<at>`** — model text không bao giờ thành HTML thô.
- Placeholder `@{i}` không có mention tương ứng → `invalid_input` (không gửi placeholder sống).

## Permission flow

`teams_post_message` đúng khuôn write hiện có: mô tả
`Gửi tin nhắn Teams tới ${chat topic | team/channel}` (+ ` (mention N người)` nếu có),
`kind: "ms365_write"`; Allow mới POST; Deny chặn (spy-verified).

## Scope (thêm vào `MS365_SCOPES`)

`Chat.ReadWrite` (list/read/send chat + members), `Team.ReadBasic.All` (joinedTeams),
`Channel.ReadBasic.All` (list channels), `ChannelMessage.Read.All` (đọc channel messages),
`ChannelMessage.Send` (post channel). Least-privilege: không `Chat.ReadWrite.All` (chỉ chat của
user), không `Group.ReadWrite.All`.

## Testing

- **Unit TeamsService** (fake Graph): map defensive từng shape (chat topic null → "", from user
  displayName thiếu → ""); cap; target union → đúng path; **postMessage: escape HTML, thay
  placeholder đúng, mentions shape Graph đúng, placeholder thiếu mention → throw invalid**;
  bounded text.
- **Tool dispatch**: 5 read thẳng; post — Allow chạy/Deny chặn spy=0; validate target union
  (đúng một dạng); `not_connected`.
- Focused: typecheck; `ms365-teams-service`, `ms365-teams-tool`, `ms365-flag-off`.

## Acceptance criteria

1. Model tìm được chat/channel theo tên (list tools) và đọc/tóm tắt tin nhắn gần nhất (honest:
   không full-text search).
2. `teams_post_message` gửi được tới chat và channel; **mentions render đúng** (`<at>` + mentions
   array khớp id); content được HTML-escape — không HTML injection.
3. Post chỉ chạy sau Allow; Deny chặn thật.
4. Target union validate chặt (`chatId` XOR `teamId`+`channelId`).
5. Scope đúng danh sách trên; flag OFF; không secret; typecheck + targeted tests PASS; api-map
   cập nhật sau slice.

## Ngoài phạm vi

- Reply vào thread/message cụ thể; edit/delete message; reactions; attachments/adaptive cards.
- Channel mention (`<at>` team/channel) — chỉ user mention ở P4.
- Full-text search server-side (Graph không hỗ trợ trên messages).
