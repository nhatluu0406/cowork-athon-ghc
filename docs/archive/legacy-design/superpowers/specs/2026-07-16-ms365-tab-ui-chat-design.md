---
language: "vi"
status: "draft"
created_at: "2026-07-16"
topic: "UI chat cho tab MS365 — nối composer vào máy chat Cowork, session scoped, conversation surface"
---

# Thiết kế: UI chat cho tab Microsoft 365

## 1. Mục tiêu & phạm vi

Làm cho tab **Microsoft 365** chat được với Agent: user gõ ở composer → prompt chạy qua một
session OpenCode được cấp `Ms365SessionScope` → stream lời về khung MS365; hành động MS365 gọi
qua tool bridge (đã wire ở plan runtime trước). Đây là **follow-up UI** cho slice runtime backend
đã hoàn tất (`docs/superpowers/plans/2026-07-16-ms365-tab-scoped-session.md`).

### Tiền đề (đã có sẵn — plan runtime trước)
- OpenCode child (chung với Cowork) đã học 25 tool MS365 qua plugin bridge.
- Child cầm scoped token chỉ tới `MS365_TOOL_CALL_PATH`; router gác thực thi bằng `Ms365SessionScope`.
- Route `POST /v1/ms365/session-scope {sessionId, enabled}` đã tồn tại và hoạt động.
- MS365 tools đã nhận `gate: permissionGate` + write-mode store (Task 3.5).

### Trong phạm vi
- Trường `surface: "cowork" | "ms365"` cho conversation (contract + SQLite + list filter).
- Service-client: method `setMs365SessionScope`; `createConversation`/`listConversations` nhận `surface`.
- `Ms365ChatController` mới (mỏng): điều phối chat MS365, uỷ thác cho máy chat Cowork.
- Nối composer `ms-assistant-view` vào controller + render transcript stream.

### Ngoài phạm vi (YAGNI)
- OAuth đăng nhập Microsoft (dùng connect manual-token đã có).
- Provider/model riêng cho MS365 (dùng chung provider của instance).
- Instance OpenCode thứ hai.
- Tool catalog mới, sửa MS365 router/tools/connector, sửa `Ms365SessionScope`, sửa live-launch/supervisor.
- Permission gate mới (tái dùng gate + write-mode sẵn có).

## 2. Quyết định thiết kế (đã chốt với PO)

| Chủ đề | Quyết định |
|---|---|
| Tái dùng chat | Tái dùng tối đa máy chat Cowork (createSession/startEvStream/sendSessionMessage/conversation-controller) + một controller MS365 mỏng |
| Lịch sử MS365 | Tách riêng khỏi sidebar Cowork qua trường `surface`; persist đầy đủ (khôi phục được) |
| Provider/model | Dùng chung provider profile của instance |
| Điều kiện chat | Chỉ cho chat khi `connectionState === "connected"` (như UI hiện tại) |
| Hành động ghi | Dùng permission gate + write-mode sẵn có; không gate mới |

## 3. Kiến trúc

Tab MS365 chat qua đúng máy chat Cowork, với hai điểm khác biệt: (a) gọi `session-scope allow`
sau khi tạo session, (b) conversation gắn `surface: "ms365"`.

```
Tab MS365 composer (chỉ khi connected)
        │
        ▼
  Ms365ChatController (MỎNG — mới)
        │  ├─ createConversation({ ..., surface:"ms365" })   (persist, tách sidebar Cowork)
        │  ├─ createSession(workspace)          ─┐
        │  ├─ setMs365SessionScope(sid, true)     │  ← khác biệt runtime DUY NHẤT
        │  ├─ startEvStream(sid)                  │  (uỷ thác transport Cowork)
        │  └─ sendSessionMessage(sid, text)      ─┘
        ▼
  Máy chat Cowork (transport + persistence) — DÙNG LẠI NGUYÊN
        ▼
  1 OpenCode instance (chung) → tool-call MS365 (scoped token) → router (Ms365SessionScope gác)
```

**Controller "mỏng" nghĩa là:** không tự mở stream/parse event/ghi SQLite/track phase (đó là việc
của máy Cowork); nó chỉ giữ `conversationId` + `runtimeSessionId` MS365 + cờ "đã allow scope", và
tự làm đúng 4 việc đặc thù MS365: (1) connected-gate, (2) gắn `surface:"ms365"` khi tạo
conversation, (3) `setMs365SessionScope(sid,true)` một lần, (4) `revoke` khi disconnect/reset. Mọi
thao tác tạo session / gửi / stream / ghi message / link session / phase đều uỷ thác cho
`conversation-controller` + service-client + `startEvStream` sẵn có.

**Bất biến:** vẫn 1 instance; provider/permission chung; secret trong vault/child-env; renderer
không chạm DB/secret; `Ms365SessionScope` là guard thực thi thật.

## 4. Thành phần phải sửa

### A. Contract + persistence (`surface` classifier)
- `core/contracts`: thêm `surface: "cowork" | "ms365"` vào kiểu conversation (record/summary/
  create-input). Mặc định `"cowork"`.
- `service/src/db/sqlite-conversation-store.ts`: cột `surface` (migration cộng dồn, default
  `'cowork'`); `list` nhận filter `{ surface? }`. Bản ghi cũ (thiếu cột) đọc ra `"cowork"`.
- `service/src/conversation/types.ts` + router list conversation: truyền filter surface xuống store.

### B. Service-client / preload (app/ui)
- `app/ui/src/service-client.ts`: thêm `setMs365SessionScope(sessionId, enabled):
  Promise<{ allowed: boolean }>` gọi `POST /v1/ms365/session-scope`; `createConversation` nhận
  `surface`; `listConversations` nhận filter surface (Cowork mặc định `"cowork"`).
- Preload capability nếu route mới cần khai báo — qua typed preload; renderer không chạm secret.

### C. Controller MS365 (mới, mỏng)
- `app/ui/src/ms365-chat-controller.ts` (mới): một trách nhiệm — điều phối chat MS365. Giữ
  `conversationId` + `runtimeSessionId` MS365 + cờ đã-allow; connected-gate; allow/revoke scope;
  uỷ thác tạo/gửi/stream/persist cho máy Cowork. Mẫu: `conversation-controller.ts`, cách
  `session-panel.ts` dùng `startEvStream`.

### D. View (app/ui)
- `app/ui/src/ui-shell/microsoft/ms-assistant-view.ts`: composer (đang disabled) nối handler gửi →
  controller; render transcript stream + phase; giữ gate "chỉ bật khi connected" + card "Chưa kết nối".

### Không đụng tới
MS365 router routes/tools/connector, `Ms365SessionScope`, supervisor, live-launch, transport
`createSession`/`startEvStream`/`sendSessionMessage`, permission gate.

## 5. Data flow

```
1. Gate: connectionState !== "connected" → composer khoá, send() return sớm (không tạo session/scope).
2. Lần gửi đầu (chưa có session MS365):
   a. createConversation({ workspacePath, surface:"ms365", provider... })  → conversationId
   b. createSession(workspacePath)                                          → runtimeSessionId
   c. setMs365SessionScope(runtimeSessionId, true)   ← chỉ tab MS365 gọi; Cowork không bao giờ
   d. linkRuntimeSession(runtimeSessionId)           (persist qua conversation-controller)
   e. startEvStream(runtimeSessionId)                (SSE, như Cowork)
3. recordUserMessage(text) → sendSessionMessage(runtimeSessionId, text)
4. Stream view.text → render khung MS365; tool-call MS365 → /v1/ms365/tool-call (scoped token) →
   router gác Ms365SessionScope.isAllowed → chạy tool.
5. Kết thúc turn: recordAssistantMessage + completeRuntimeTurn (persist).
6. Prompt kế tiếp cùng phiên: tái dùng runtimeSessionId đã allow (KHÔNG gọi lại scope).
```

**Vòng đời scope:** `allow(sid)` một lần khi tạo session (idempotent). `revoke(sid)` khi disconnect
MS365 / đóng-reset conversation MS365 / bắt đầu conversation MS365 mới. `Ms365SessionScope` in-memory
(không persist) → sau restart, conversation MS365 khôi phục từ SQLite; turn mới tạo session mới +
allow lại (giống "continuation" của Cowork).

**Định danh:** conversationId (SQLite, `surface:"ms365"`) độc lập runtimeSessionId (ephemeral). Hai
tab = hai conversation + hai runtime session; transcript không lẫn.

## 6. Error handling

| Tình huống | Xử lý |
|---|---|
| Chưa connected | Composer khoá; `send()` return sớm; không tạo session/scope. Card "Chưa kết nối" + CTA. |
| Disconnect giữa phiên | `revoke(sid)` + khoá composer; conversation MS365 đã persist còn nguyên; connect lại → session mới + allow lại. |
| createSession/sendSessionMessage lỗi (instance chưa ready) | Fail-closed `RuntimeNotReadyError`; phase `failed`; hiện lỗi; không kẹt "running". |
| setMs365SessionScope lỗi | Không gửi prompt (tool sẽ bị router từ chối); hiện lỗi "không cấp được quyền MS365 cho phiên". |
| Restore conversation MS365 sau restart | Session cũ đã mất (scope in-memory) → turn mới tạo session mới + allow lại. |
| Hành động ghi (mail/Teams/Planner) | Qua permission gate + write-mode → thẻ phê duyệt; từ chối → tool trả lỗi hiện trong transcript. Không bypass. |
| Migration `surface` | Cột default `'cowork'`; bản ghi cũ = `cowork`; không vỡ, không lẫn MS365. |

## 7. Testing

1. **Persistence `surface`** — tạo conversation `ms365` + `cowork`; `list({surface:"cowork"})` không
   trả cái MS365 và ngược lại; migration: bản ghi cũ đọc ra `"cowork"`.
2. **Service-client** — `setMs365SessionScope(id,true/false)` POST đúng route+body;
   `createConversation` truyền `surface`; Cowork `listConversations` mặc định lọc `cowork`.
3. **Ms365ChatController (quan trọng nhất)** — fake client: (a) chưa connected → `send` không tạo
   session/scope; (b) gửi đầu → tạo conversation `ms365` + createSession + allow MỘT lần + send;
   (c) prompt thứ 2 tái dùng session, KHÔNG allow lại; (d) disconnect → revoke.
4. **Isolation** — session Cowork không được allow (controller Cowork không gọi scope) → khẳng định
   hàng rào; MS365 transcript không lẫn Cowork.
5. **Regression** — `npm run typecheck`, `npm test` (đối chiếu baseline: chỉ pre-existing fail),
   `scripts\verify-fast.bat`. **Packaged acceptance** (thích hợp ở milestone này): PO quan sát tab
   MS365 chat thật, gọi được tool, hành động ghi hiện thẻ phê duyệt, conversation MS365 KHÔNG hiện
   trong sidebar Cowork.

## 8. Bảo mật & review

- `setMs365SessionScope` chỉ được tab MS365 gọi; Cowork không bao giờ gọi → session Cowork không
  bao giờ được allow. `Ms365SessionScope` vẫn là hàng rào thực thi thật (fail-closed).
- Renderer không chạm DB/secret; scope qua typed preload.
- Chạm persistence (SQLite migration) + boundary conversation → nên có independent review theo CLAUDE.md.
