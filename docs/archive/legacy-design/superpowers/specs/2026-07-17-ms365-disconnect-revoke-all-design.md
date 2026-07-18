---
language: "vi"
status: "draft"
created_at: "2026-07-17"
topic: "MS365 follow-up #2 — /disconnect revoke-all session scope (defense-in-depth)"
---

# Thiết kế: MS365 follow-up #2 — `/disconnect` revoke-all (defense-in-depth)

## 1. Mục tiêu & phạm vi

Khi ngắt kết nối MS365, quét sạch `Ms365SessionScope` ở backend để KHÔNG session nào còn quyền gọi
tool MS365 — không phụ thuộc UI revoke đúng từng session. Phòng thủ theo lớp cho trường hợp một
session id còn sót trong scope (orphaned qua reset/adopt edge, hoặc UI revoke hụt).

### Phát hiện định hình scope (đã xác minh trong code)
- Handler `MS365_DISCONNECT_PATH` (`service/src/ms365/ms365-tool-router.ts:202-205`) chỉ gọi
  `deps.connector.disconnect()` (bỏ kết nối Graph), **KHÔNG đụng `deps.sessionScope`**.
- `Ms365SessionScope` (`service/src/ms365/ms365-session-scope.ts`) là `Set<sessionId>` in-memory với
  `allow`/`revoke`/`isAllowed`. Chưa có `revokeAll`.
- Router đã có sẵn `deps.sessionScope` → thêm quét sạch tại disconnect là tự-chứa, không dây chuyền.
- Lớp phòng thủ hiện có: UI `ms365Chat.disconnect()` revoke **session hiện tại**
  (`setMs365SessionScope(sid, false)`). #2 là belt-and-suspenders ở backend.
- Mẫu tham chiếu sẵn có: `pairing.revokeAll()` + `REMOTE_REVOKE_ALL_PATH`
  (`service/src/remote-gateway/`) — cùng khuôn "revoke-all in-memory".

### Trong phạm vi
- Thêm `revokeAll(): void` vào interface + factory `Ms365SessionScope` (`allowed.clear()`).
- Gọi `deps.sessionScope.revokeAll()` trong handler disconnect, TRƯỚC `connector.disconnect()`.

### Ngoài phạm vi (YAGNI / ràng buộc)
- Đổi contract / endpoint (đường dẫn `/v1/ms365/disconnect` đã tồn tại; chỉ đổi hành vi bên trong).
- Đổi renderer / controller (UI revoke session hiện tại giữ nguyên — #2 chỉ thêm lớp backend).
- Persist scope (đúng bản chất in-memory, ephemeral per app-run — không có gì để lưu).
- Revoke-all ở nơi khác ngoài disconnect (ví dụ trên lock/logout) — không thuộc phase này.

## 2. Quyết định thiết kế (đã chốt với PO)

| Chủ đề | Quyết định |
|---|---|
| Vị trí | Handler `MS365_DISCONNECT_PATH` trong `ms365-tool-router.ts` |
| API scope | Thêm `revokeAll(): void` vào `Ms365SessionScope` |
| Thứ tự | `revokeAll()` TRƯỚC `connector.disconnect()` (thu quyền tool trước khi bỏ kết nối) |
| Contract | KHÔNG đổi (endpoint đã có; đổi hành vi bên trong) |
| Renderer/controller | KHÔNG đổi (UI revoke session hiện tại giữ nguyên) |
| Review | Chạm security boundary → cần independent review ở whole-branch |

## 3. Kiến trúc

```
POST /v1/ms365/disconnect:
  deps.sessionScope.revokeAll()      // quét sạch Set<sessionId> → không session nào isAllowed
  await deps.connector.disconnect()  // bỏ kết nối Graph (như hiện tại)
  return buildMs365View(...)         // như hiện tại
```

**Thành phần chạm (đều service):**
- `service/src/ms365/ms365-session-scope.ts`:
  ```ts
  export interface Ms365SessionScope {
    allow(sessionId: string): void;
    revoke(sessionId: string): void;
    revokeAll(): void;              // MỚI
    isAllowed(sessionId: string): boolean;
  }
  // factory: revokeAll() { allowed.clear(); }
  ```
- `service/src/ms365/ms365-tool-router.ts`: handler disconnect gọi `deps.sessionScope.revokeAll()`
  trước `await deps.connector.disconnect()`.

**Không đụng:** contract, renderer, controller, connector, gate, các router khác.

## 4. Data flow

```
Trước:  disconnect → connector.disconnect()                    (scope có thể còn id sót → vẫn isAllowed)
Sau:    disconnect → sessionScope.revokeAll() → connector.disconnect()
                     └ mọi session id bị xoá → sessionAllowed(sid)=false cho tới khi tab re-register
```
Sau disconnect, dù có session mồ côi, `handleToolCall` kiểm `sessionAllowed` FIRST → fail-closed.

## 5. Error handling

| Tình huống | Xử lý |
|---|---|
| `revokeAll()` | Chỉ `Set.clear()` — không throw. |
| `connector.disconnect()` throw sau revokeAll | Fail-safe: scope ĐÃ bị quét trước → quyền tool đã thu dù disconnect lỗi. Lỗi propagate như hành vi hiện tại. |
| Gọi disconnect khi scope rỗng | `clear()` no-op — an toàn, idempotent. |

## 6. Testing

1. **revokeAll đơn vị** (`ms365-session-scope.test.ts`): `allow("a"); allow("b"); revokeAll()` →
   `isAllowed("a")===false && isAllowed("b")===false`; gọi lại `revokeAll()` khi rỗng → no-op.
2. **disconnect quét scope** (`ms365-tool-router` test): allow một session → gọi route disconnect →
   `sessionScope.isAllowed(sid)===false`; `connector.disconnect` được gọi; view trả về đúng.
3. **Thứ tự** (nếu test dễ khẳng định): revokeAll chạy trước connector.disconnect (ví dụ connector giả
   ghi lại scope tại thời điểm disconnect thấy đã rỗng). Nếu khó, tối thiểu kiểm cả hai đã xảy ra.
4. **Regression**: `npm run typecheck`, focused ms365 tests, `scripts\verify-fast.bat`.

## 7. Bảo mật & review

- Chạm security boundary (session scope + disconnect) → theo CLAUDE.md **cần independent review**
  (whole-branch, opus).
- Không lộ secret: `revokeAll` chỉ xóa id in-memory; không log id.
- Fail-closed giữ nguyên: `sessionAllowed` vẫn là guard thật ở `handleToolCall`; #2 chỉ đảm bảo scope
  rỗng sau disconnect.
