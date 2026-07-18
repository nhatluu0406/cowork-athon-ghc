---
language: "vi"
status: "approved"
created_at: "2026-07-15"
topic: "ms365-tab-chat"
track: "D2"
phase: "P5.6"
---

# Design: MS365 tab chat — chat thật trong tab Microsoft 365 — P5.6

## Mục tiêu

Tab Microsoft 365 (hiện là khung sườn tĩnh) trở thành nơi DUY NHẤT chat với AI dùng tool MS365:
session + streaming + transcript, tự đăng ký `session-scope` (P5.5 gating), pill write-mode +
prompt block MS365 chuyển về composer của tab. Chat chính giữ nguyên trạng thái đã detach.

## Căn cứ khảo sát 2026-07-15 (file:line trong report khảo sát)

1. **Session id đồng nhất**: UI `createSession` nhận `meta.id` = id do OpenCode child cấp
   (service không mint id riêng — `session-store-adapter.ts:60-68,141-147`) = `ctx.sessionID`
   mà plugin gửi vào `/v1/ms365/tool-call`. → Đăng ký scope bằng id UI là khớp gating.
2. **Stream độc lập per-session**: `startEvStream` (`ev-stream-client.ts:139-235`) tự chứa,
   deps chỉ `{baseUrl, clientToken, sessionId, onView…}`; tab giữ handle riêng, không đụng
   `state.stream` của chat chính.
3. **Session không cần conversation record**: `POST /v1/session` chỉ cần `workspaceId` (+
   provider readiness). Ràng buộc: **session single-turn** — mỗi lượt gửi tạo session MỚI
   (khuôn `new_turn` của `runtime-turn-planner.ts:31-58`) → mỗi session mới phải đăng ký scope.
4. **Permission card toàn cục**: modal mount trên `dom.root`, poll 500ms — card `ms365_write`
   hiện bất kể đang ở tab nào. Không cần sửa gì.
5. `renderMicrosoftSurfaceBound` `replaceChildren` cả body mỗi render → transcript phải là
   **state ngoài DOM** (controller), render lại từ state.
6. `planDispatchPrompt(prior, [], prompt, undefined, [], true)` tái dùng nguyên vẹn: envelope
   transcript-context (bộ nhớ giữa các single-turn session) + `MS365_ORCHESTRATION_POLICY`.

## Kiến trúc (thuần UI — KHÔNG sửa service; route session-scope/write-mode có sẵn từ P5.5/P5)

### 1. `ms-chat-controller.ts` (mới) — state của chat tab, tách khỏi DOM

- State: `messages: ConversationMessage[]` (in-memory, **ephemeral** — không persist vào
  conversation store ở P5.6; ghi rõ hạn chế), `phase: "idle"|"running"|"error"`,
  `sessionId: string | null`, stream handle riêng, `errorMessage?`.
- `send(prompt)`: preflight (service ready + workspace + provider — tái dùng
  `assessSendPreflight`) → `planDispatchPrompt(messages, [], prompt, undefined, [], true)`
  (fail-fast budget) → `createSession({workspaceId, title: "Microsoft 365"})` →
  **`setMs365SessionScope(meta.id, true)` TRƯỚC `sendSessionMessage`** (tool call đầu có thể
  đến ngay khi prompt dispatch) → `startEvStream(meta.id)` → `sendSessionMessage(meta.id, text)`.
- `onView`: cập nhật bubble assistant (replace toàn văn — khuôn `updateAssistantBubble`);
  `view.terminal !== null` → finalize (text cuối qua helper session-finalization) + **revoke
  scope** + stop stream + phase idle.
- `cancel()`: `cancelSession` + revoke + stop stream, đánh dấu lượt bị hủy trung thực.
- Revoke thêm khi: MS365 disconnect (qua `onViewChange`), reset chat tab.
- Client seams tiêm qua deps (test không cần mạng).

### 2. `service-client.ts` — thêm `setMs365SessionScope(sessionId, enabled): Promise<{allowed: boolean}>`
POST `/v1/ms365/session-scope` (route P5.5, main token — đúng biên UI→service).

### 3. `ms-assistant-view.ts` — UI thật

- Transcript render từ controller state (user/assistant bubbles, trạng thái đang chạy, lỗi kèm
  recovery); composer textarea + send/cancel wire vào controller; **chips** click = điền +
  gửi luôn; disabled khi chưa connected (giữ hiện tại).
- **Pill write-mode chuyển về đây**: instance mới trong `ms-composer` (fetch mode khi
  connected, toggle → POST → confirm — cùng khuôn P5); **gỡ instance ở cowork composer**
  (`cowork-view.ts` + `refreshMs365WriteModePill` + wiring app-shell cũ) — hết trạng thái
  force-hidden tạm.

### 4. app-shell — sở hữu controller

Controller sống cạnh `state.msView` (không bị replaceChildren xóa); `MicrosoftSurfaceDeps`
mở rộng mang controller/handlers; `renderMicrosoftSurfaceBound` truyền xuống.

## Testing

- Controller unit (happy-dom không cần): send-flow gọi đúng THỨ TỰ (create → scope(true) →
  stream → send); terminal → revoke + idle; cancel → cancelSession + revoke; preflight fail →
  không tạo session; budget fail → lỗi hiển thị, không session; scope đăng ký đúng `meta.id`.
- View: transcript render từ state; chip gửi; pill hiện khi connected, ẩn khi không; cowork
  composer KHÔNG còn pill.
- dispatch: tab dùng `ms365Connected=true` (block có mặt), chat chính vẫn `false`.

## Acceptance criteria

1. Từ tab Microsoft (flag ON, provider cấu hình, MS365 connected): gửi prompt → session tạo,
   scope đăng ký trước send, stream về transcript, terminal finalize trung thực.
2. `sessionId` đăng ký = id session OpenCode (đúng id plugin gửi) — unit assert theo seam.
3. Revoke scope ở terminal/cancel/disconnect/reset — không rò allowlist.
4. Pill write-mode sống ở composer tab Microsoft; cowork composer không còn pill/prompt block.
5. Chat chính: hành vi không đổi (vẫn bị session-gating chặn tool MS365).
6. Typecheck + targeted tests PASS; không secret; docs (current-status/api-map) cập nhật.

## Hạn chế trung thực (ghi vào current-status)

- Transcript tab **ephemeral** (mất khi đóng app / chuyển conversation) — persist là follow-up.
- Mỗi lượt = một OpenCode session mới (ràng buộc single-turn hiện có) — bộ nhớ giữa lượt là
  transcript envelope trong prompt, có budget cắt.
- Live end-to-end với model thật cần provider key + flag ON (runbook P5.5 Step 2 áp dụng tại
  tab này).

## Ngoài phạm vi

- Persist transcript tab vào conversation store; multi-conversation trong tab.
- Todo/plan panel riêng cho tab (dùng chat text; pipeline todo chính không đổi).
- Sửa service (không cần — route đủ).
