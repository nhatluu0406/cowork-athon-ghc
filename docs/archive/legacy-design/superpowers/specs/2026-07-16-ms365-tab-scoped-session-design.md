---
language: "vi"
status: "draft"
created_at: "2026-07-16"
topic: "MS365 tab dùng session OpenCode riêng (scoped), chung instance với Cowork"
---

# Thiết kế: Tab MS365 chat qua session OpenCode riêng, được phép dùng tool MS365

## 1. Mục tiêu & phạm vi

Cho tab **Microsoft 365** khả năng chat với Agent giống tab Cowork, nhưng **chỉ session của
tab MS365 mới THỰC THI được 25 tool MS365**; session Cowork không thực thi được tool MS365 nào.

**Mô hình đã chốt (hướng B): một OpenCode instance, hai session, chặn theo session.**
Tab MS365 KHÔNG spawn instance thứ hai — dùng chung đúng instance (`OpencodeSupervisor`) mà
Cowork đang dùng, chỉ khác ở một `sessionId` riêng được cấp `Ms365SessionScope`.

### Ràng buộc kỹ thuật đã kiểm chứng (quan trọng — định hình thiết kế)
- Child học tool MS365 qua **plugin file** `<configDir>/plugin/ms365.ts` (chạy trong Bun nhúng của
  binary pin). Plugin đăng ký tool ở **mức instance/configDir** → **cả hai session (Cowork + MS365)
  đều THẤY 25 tool** trong tool-list. Đây là bản chất của OpenCode.
- OpenCode plugin API **KHÔNG có hook ẩn/lọc tool theo session** (chỉ có `tool.execute.before/after`,
  là hook thực thi — kiểm chứng tại https://opencode.ai/docs/plugins/). Do đó, với MỘT instance,
  **không thể làm Cowork "không thấy" tool**; chỉ có thể chặn **thực thi**.
- Quyết định của PO: chấp nhận Cowork THẤY tool (nhiễu nhẹ về token/UX, KHÔNG phải rủi ro bảo mật),
  đổi lại không phải nhân đôi instance. Chặn thực thi bằng **hai lớp** (mục 4).

### Trong phạm vi
- Khôi phục runtime advertisement dạng **plugin-file** + scoped child token (tái dùng code đã có ở
  nhánh `Merge/`, commit `d086ecd`, đã bị gỡ ở `40ba57e`).
- Thêm chốt **`tool.execute.before`** trong plugin để chặn sớm session không được phép, kèm thông
  điệp thân thiện.
- Tab MS365 tạo session riêng + `allow` `Ms365SessionScope`, chat qua đúng luồng send/stream Cowork.
- Composer MS365 chỉ bật khi đã kết nối MS365.

### Ngoài phạm vi (YAGNI)
- OAuth đăng nhập Microsoft (giữ nút disabled; dùng lại luồng connect manual-token đã có).
- Provider/model riêng cho MS365 (dùng chung provider profile của instance).
- Instance OpenCode thứ hai (hướng A) — bị loại: chỉ cần thiết nếu muốn Cowork *tuyệt đối không
  thấy* tool, hoặc provider khác, hoặc cách ly hiệu năng/crash cứng — không phải yêu cầu hiện tại.
- Tool catalog mới, sửa MS365 router/connector/tools.

## 2. Quyết định thiết kế (đã chốt với PO)

| Chủ đề | Quyết định |
|---|---|
| Mức cô lập | Chung 1 instance, session riêng (hướng B) |
| Provider/model | Dùng chung provider profile hiện tại của instance |
| Visibility tool | Cowork THẤY tool MS365 (không thể ẩn với 1 instance) — chấp nhận |
| Execution tool | Chỉ session MS365 thực thi được; chặn 2 lớp |
| Kết nối | Dùng lại connect manual-token; KHÔNG làm OAuth |
| Điều kiện chat | **Chỉ cho chat khi `connectionState === "connected"`** (khớp UI hiện tại) |

## 3. Kiến trúc

```
        ┌──────── 1 OpenCode instance (OpencodeSupervisor) ─────────┐
 Cowork │ session Cowork ──prompt──► reply   (THẤY tool, KHÔNG chạy)│
 MS365  │ session MS365  ──prompt──► reply   (THẤY tool, ĐƯỢC chạy) │
        │        plugin/ms365.ts (25 tool) — mức instance           │
        │        tool.execute.before: chặn nếu sessionID ∉ allowed  │
        └──────────────────────┼───────────────────────────────────┘
                               ▼  (cầm scoped token, chỉ tool-call path)
              MS365 router  POST /v1/ms365/tool-call
              Lớp 2: Ms365SessionScope.isAllowed(sessionId) — fail-closed
```

Bất biến giữ nguyên: instance vẫn là MỘT (supervisor từ chối start thứ hai); provider + permission
policy chung; secret (scoped token, manual token) không rời vault/child-env; renderer không chạm
DB/secret; scoped token chỉ mở `MS365_TOOL_CALL_PATH`.

## 4. Hai lớp chặn execution

1. **Lớp 1 — `tool.execute.before` trong plugin (mới, ~10 dòng):** trước khi mỗi tool MS365 chạy,
   kiểm tra `ctx.sessionID` có thuộc tập được phép không. Nếu không → trả lỗi thân thiện
   ("Tool MS365 chỉ dùng ở tab Microsoft 365") ngay trong child, agent Cowork hiểu và không lặp lại.
   Đây là lớp UX/giảm nhiễu, KHÔNG phải hàng rào bảo mật.
   - Nguồn "được phép": plugin đọc qua boundary (một route đọc scope) HOẶC đơn giản dựa vào việc
     child chỉ có scoped token → mọi call từ child đều tới tool-call path và router mới là nơi
     phán quyết thật. (Chi tiết chốt ở giai đoạn plan; ưu tiên KHÔNG nhân bản trạng thái scope.)
2. **Lớp 2 — `Ms365SessionScope` ở router (đã có, không sửa):** `handleToolCall` chỉ chạy nếu
   `isAllowed(sessionId)`. Fail-closed cho mọi session khác. Đây là **hàng rào bảo mật thật**.

## 5. Ba mảnh phải nối lại

### A. Runtime advertisement dạng plugin-file (service)
- Khôi phục vào `service/src/composition/live-launch.ts` (chỗ gỡ ở `40ba57e`, dòng ~177): mint
  **scoped tool token** (`generateClientToken`, không persist), bơm `CGHC_MS365_TOOL_ENDPOINT` +
  `CGHC_MS365_TOKEN` vào `baseEnv`, đăng ký token chỉ cho `MS365_TOOL_CALL_PATH`
  (`pathScopedTokens`), và thêm token vào `extraSecretValues` để `redactedEnvSnapshot` che.
- Tái dùng `ms365-plugin-file.ts` (bản `Merge/service/src/runtime/`): `writeMs365Plugin(configDir)`
  ghi `plugin/ms365.ts`; `seedMs365PluginDeps` copy `@opencode-ai/plugin` để import offline.
- **Thêm** block `tool.execute.before` vào `MS365_PLUGIN_SOURCE` (Lớp 1).
- Bỏ cổng cờ `CGHC_MS365_ENABLED` (đã gỡ ở main) — advertisement bật theo mặc định, khớp việc
  router đã mount unconditionally.

### B. Session-scope (đã có — không sửa)
- `Ms365SessionScope` + route `POST /v1/ms365/session-scope` giữ nguyên. UI gọi `{sessionId,
  enabled:true}` khi connected; `enabled:false` khi disconnect/reset.

### C. UI (app/ui)
- `app/ui/src/ui-shell/microsoft/ms-assistant-view.ts`: composer disabled → nối handler gửi prompt +
  render transcript stream (tái dùng transcript component của Cowork nếu có).
- Controller mới cho tab MS365 (nhỏ, một trách nhiệm): giữ `sessionId` MS365; gọi session-scope
  allow/revoke; đẩy prompt vào luồng send/stream. Mẫu: `app/ui/src/conversation-controller.ts`.
- Preload/service-client: capability (typed preload) để UI gửi prompt cho session MS365 + gọi
  session-scope. Renderer KHÔNG chạm secret.

### Không đụng tới
MS365 router routes/connector/tools, vault, supervisor lifecycle, provider selection,
send-prompt/stream/reply adapter (dùng lại nguyên trạng, chỉ truyền session id khác).

## 6. Data flow (gửi prompt ở tab MS365)

```
1. Điều kiện: connectionState === "connected"; nếu không → composer khoá, hiện card "Chưa kết nối".
2. Lần gửi đầu sau khi connected: tạo sessionId MS365 (lazy) →
   POST /v1/ms365/session-scope {sessionId, enabled:true}  (idempotent).
3. UI gửi prompt vào session MS365 qua đúng đường Cowork dùng (send-prompt → stream).
4. Child sinh lời; khi cần dữ liệu MS365, plugin ms365.ts gọi
   POST /v1/ms365/tool-call {name,args,sessionId:ctx.sessionID,requestId} (cầm scoped token).
   - Lớp 1 (tool.execute.before) đã chặn sớm nếu session không được phép.
5. Lớp 2 — Router gác: Ms365SessionScope.isAllowed(sessionId)?
      - sessionId MS365  → allowed → handleToolCall chạy tool thật
      - sessionId Cowork → KHÔNG allowed → từ chối (fail-closed)
6. Kết quả tool → child tiếp tục sinh lời → stream về tab MS365.
```

**Định danh session:** Cowork và MS365 mỗi tab một conversation/session id độc lập; conversation
identity (SQLite của Cowork GHC) độc lập với session id ephemeral của OpenCode. Prompt/transcript
hai tab không lẫn nhau. **Lưu ý mô hình chung-instance:** hai session chia sẻ một child-process nên
có thể cạnh tranh hiệu năng khi chạy song song, và cùng chung vòng đời (một restart/crash ảnh hưởng
cả hai) — chấp nhận được cho POC.

## 7. Error handling

| Tình huống | Xử lý |
|---|---|
| Chưa connected | Composer **khoá hoàn toàn** (như hiện tại). Không tạo session, không allow scope. Hiện card "Chưa kết nối" + CTA mở trang Kết nối. |
| Vừa connected | Tạo session MS365 (lazy, lần gửi đầu) + `allow(sessionId)`. Composer mở. |
| Disconnect giữa chừng | `revoke(sessionId)` + khoá lại composer. |
| Cowork session gọi tool-call | Lớp 1 chặn sớm (thông điệp thân thiện); Lớp 2 router từ chối (fail-closed). |
| Instance chưa ready / vừa stop | Send-prompt fail-closed `RuntimeNotReadyError` như Cowork. |
| Scoped token dùng cho route khác | Token scoped chỉ tool-call → route khác từ chối. |
| Plugin deps thiếu (offline) | `seedMs365PluginDeps` chỉ log cảnh báo, không throw; OpenCode tự install là fallback. |

## 8. Testing

1. **Runtime advertisement** — `live-launch` bơm đúng endpoint + scoped token vào child-env; ghi
   `plugin/ms365.ts`; token đăng ký `pathScopedTokens` chỉ cho tool-call path; **redaction test**
   xác nhận token không lọt `redactedEnvSnapshot`/log/plugin file.
2. **Plugin ↔ router không lệch** — 25 tool trong `MS365_PLUGIN_SOURCE` khớp `TOOL_NAMES`
   (tái dùng `ms365-plugin-file.test.ts` của `Merge/`).
3. **Lớp 1 (tool.execute.before)** — session không được phép → tool bị chặn sớm với thông điệp đúng.
4. **Lớp 2 (scope gating, quan trọng nhất)** — session MS365 allowed → tool-call 200; session
   Cowork → từ chối.
5. **Session isolation** — 2 session id, prompt/transcript không lẫn; revoke MS365 → tool-call sau bị chặn.
6. **UI controller** — composer chỉ bật khi connected; gửi prompt vào đúng sessionId MS365; allow
   gọi một lần idempotent; disconnect → revoke + khoá.
7. **Regression** — `npm run typecheck`, `npm test`, `scripts\verify-fast.bat`. Packaged acceptance:
   PO quan sát tab MS365 chat thật + gọi được tool (happy path), và Cowork gọi tool MS365 bị từ chối.

## 9. Bảo mật & review

- Scoped token & manual token KHÔNG vào log/DB/UI/screenshot/plugin file; chỉ child-env + vault.
- Thuộc nhóm credential/security + runtime/process → **cần independent review** theo CLAUDE.md
  trước khi merge.

## 10. Ghi chú về `Merge/`

Nhánh `Merge/` (untracked) chứa bản triển khai advertisement cũ (`ms365-plugin-file.ts`,
`live-launch.ts` có nhánh MS365, các test `ms365-plugin-file.test.ts` / `ms365-child-env.test.ts`).
Đây là NGUỒN THAM CHIẾU/TÁI DÙNG chính, không phải code đang chạy. Khi implement, port có chọn lọc
(bỏ cổng cờ `CGHC_MS365_ENABLED` vì main đã mount router unconditionally), không bulk-copy.
