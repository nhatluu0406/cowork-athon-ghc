---
task: CGHC-024
title: "Live capture khung /event OpenCode → fixture EV (đã cấp token, bounded)"
language: "vi"
status: DONE
opencode_pin: "v1.17.11"
provider_path: "custom OpenAI-compatible (DeepSeek behind OpenCode) — provider-neutral, không hard-code"
created_at: "2026-07-11"
---

# CGHC-024 — Bằng chứng live capture (bounded, sau credential gate)

## 1. Phạm vi & ràng buộc đã tuân thủ

- DeepSeek chỉ đóng vai **endpoint inference thay thế được**, đứng **sau OpenCode**, đi qua
  đường **custom OpenAI-compatible** (`provider = custom-openai-compat`). Không hard-code
  DeepSeek vào Cowork GHC: base URL + model được ghi vào `opencode.json` của workspace fixture,
  không nằm trong source sản phẩm.
- **Token không bao giờ** xuất hiện trong chat, source, `.env`, command line, log hay evidence.
  Token đọc từ **Windows Credential Manager** (CGHC-009), account `provider:custom-openai-compat`,
  và chỉ được inject vào **env của tiến trình con** `opencode serve` (runtime `buildLaunchSpec`).
  `opencode.json` chỉ chứa tham chiếu `{env:DEEPSEEK_API_KEY}` (đã xác minh pin 1.17.11 tự resolve
  từ `process.env`), **không** chứa giá trị key.
- **Ngân sách live**: 2 request thành công (`simple-chat`, `tool-call`) + 1 request lỗi provider
  400 (`error`, không tính là thành công) + 1 request bị abort giữa chừng (`cancel`, không tính là
  thành công). Tổng **thành công = 2 ≤ 3**. Không retry nào cần dùng.
- Live API **không** chạy trong default test suite (capture opt-in qua `CGHC_CAPTURE_LIVE=1`).
- Workspace fixture riêng, không dữ liệu nhạy cảm.

## 2. Đường đi đã lắp ráp (được xác minh không tốn request inference)

Trước khi tiêu bất kỳ request nào, đã probe OpenCode 1.17.11 (chỉ liệt kê route/provider, **0**
inference) để chốt:

- Route thật (khớp default của capture tool — giải quyết CGHC-024 MEDIUM-2):
  `POST /session`, `POST /session/{id}/message`, `GET /event`, `POST /session/{id}/abort`.
- Shape config custom provider hợp lệ: OpenCode đăng ký `custom-openai-compat` + model
  `deepseek-chat`, `source: "config"`, và **resolve `{env:DEEPSEEK_API_KEY}` từ env** (giá trị dummy
  hiện ra ⇒ template hoạt động ⇒ chỉ cần inject env, không ghi key ra file).

Một lỗi thật đã lộ ra và được sửa: `launch.ts` tính `dataHome`/`configDir` nhưng **không tạo thư
mục**, khiến OpenCode mở SQLite thất bại → `POST /session` trả 500. Đã thêm `mkdirSync(...,{recursive})`
cho cả hai thư mục trước khi spawn (supervisor sở hữu I/O; `buildLaunchSpec` vẫn thuần).

## 3. Bốn scenario đã capture (frame THẬT, không bịa)

| scenario    | frames | terminal thật     | nguồn terminal (frame thật)                       |
|-------------|--------|-------------------|---------------------------------------------------|
| simple-chat | 98     | completed         | `session.idle`                                    |
| tool-call   | 116    | completed         | tool `write` COMPLETED (ghi `notes.txt`) + `session.idle` |
| error       | 90     | errored           | `session.error` `APIError` 400 (đứng TRƯỚC mọi `session.idle`) |
| cancel      | 90     | cancelled         | `session.error` `MessageAbortedError` (đứng TRƯỚC `session.idle`) |

- `tool-call`: part `tool:write` đạt `state.status="completed"` với `input.filePath=…/notes.txt`
  ⇒ mapper phát `tool_call` + `file_mutation` (EV3/EV4). File `notes.txt` thật đã được tạo trên đĩa.
- `error`/`cancel`: nhờ "first terminal wins", `session.error` đứng trước `session.idle` nên view
  fold về `errored`/`cancelled`, chứng minh bất biến EV7 (không bịa `completed`) trên byte THẬT.

## 4. Mapper: bổ sung từ vựng housekeeping (refine CGHC-012, KHÔNG invalidate)

Stream `/event` thật đa hợp nhiều frame housekeeping (`plugin.added`×45, `catalog.updated`×20,
`server.heartbeat`, `session.updated/status/diff`, `message.updated`, `session.next.*`,
`integration.updated`, `reference.updated`, `file.edited`, `file.watcher.updated`). Trước đây mapper
coi tất cả là `unmapped`, làm hỏng bất biến "capture sạch ⇒ `unmapped===0`".

- Thêm `KNOWN_IGNORED_TYPES` (tập CHÍNH XÁC, không match prefix) để giữ **drift detection**: một
  frame type MỚI thật sự vẫn đi qua `onUnmapped`.
- `file.edited`/`file.watcher.updated` bị bỏ qua CÓ CHỦ Ý: `file_mutation` (EV4) lấy từ tool part
  `write/edit` đã COMPLETED (part-mapper) ⇒ tránh đếm trùng mutation.
- Thay đổi là **cộng thêm**: mọi type đã dispatch trước đó vẫn map y hệt. Test CGHC-012 cũ dùng
  `session.status` làm ví dụ "unknown" đã được sửa (dùng type bịa `cghc.brand.new.frame.type`) vì
  dữ liệu thật cho thấy `session.status` là housekeeping hợp lệ, không phải drift. Thêm test khẳng
  định toàn bộ `KNOWN_IGNORED_FRAME_TYPES` bị bỏ qua mà KHÔNG bị báo unmapped.

## 5. Vệ sinh bí mật

- Capture tool quét-khi-ghi (`serialized.includes(key)` → refuse) cho cả 4 fixture ⇒ đã ghi thành
  công nghĩa là **key không nằm trong byte**.
- Quét lại độc lập 4 fixture theo mẫu `Bearer/sk-/authorization/x-api-key/api_key<value>`:
  **CLEAN**. `responseHeaders` trong frame `error` là header PHẢN HỒI của DeepSeek, không chứa
  credential.
- Ghi nhận (LOW, không phải secret): `input.filePath` trong `tool-call` nhúng đường dẫn tạm chứa
  username Windows cục bộ — chấp nhận cho fixture test; giữ nguyên byte capture THẬT thay vì reshape.

## 6. Kết quả kiểm chứng

- Full suite: **236 pass / 0 skip / 0 fail** (10 test gated trước đây đã lật sang PASS thật;
  +1 test public-hostname cho fix Low-2).
- `tsc -b`: sạch. `tsc -p tools/capture-frames`: sạch.
- Test mới: 7 test `provider-config` + 2 test mapper (drift + housekeeping-ignored).

## 6b. Review độc lập (reviewer ≠ implementer) — cả hai PASS, 0 Critical/High

- **security-reviewer → PASS (0 Crit/High).** Xác nhận key chỉ đi qua child env; `opencode.json`
  chỉ chứa `{env:...}`; guard secret-scan khi ghi fixture đúng; `assertSafeBaseUrl` https+private
  hợp lệ; 4 fixture + quét repo: không có vật liệu dạng bí mật; `responseHeaders` trong `error` là
  header phản hồi DeepSeek (CloudFront/trace), không phải credential. LOW: username trong path
  fixture (không phải secret, chấp nhận cho local-first).
- **code-reviewer → PASS (0 Crit/High).** Xác nhận drift detection còn nguyên (type lạ vẫn tới
  `onUnmapped`); không có type dispatched nào lọt vào ignore set; không double-count file_mutation;
  "first terminal wins" đúng cho error/errored & cancel/cancelled (đọc trực tiếp byte fixture).
  4 LOW (không blocking).

**Đã áp dụng sau review:**

- Low-4: thêm guard `key.length > 0` cho secret-scan khi ghi (đồng nhất với `writeOpencodeConfig`).
- Low-2: `assertSafeBaseUrl` chỉ áp dụng range-check cho **IP literal** (không còn false-reject
  hostname công khai như `10.example.com`/`fcbank.com`), và chặn thêm IPv6 ULA `fc00::/7` +
  link-local `fe80::` (strip brackets `[::1]`). Thêm test khoá hành vi.

**Chấp nhận (không blocking):**

- Low-3: `recording` promise treo khi prompt lỗi ngoài `--expect-error` — cosmetic, tiến trình
  exit ngay sau đó.
- Low-1: mutation qua tool ngoài whitelist (bash `echo > f`, `mv`, `rm`) không phát EV4 —
  **carry-forward sang CGHC-018** (file-mutation-audit) để quyết định surface/audit.

## 7. Lệnh tái lập (opt-in, cần token trong store)

```
CGHC_CAPTURE_LIVE=1 node --import tsx tools/capture-frames/capture.ts <scenario> \
  --provider custom-openai-compat --env-var DEEPSEEK_API_KEY \
  --provider-base-url https://api.deepseek.com/v1 \
  --bin node_modules/opencode-ai/bin/opencode.exe --workspace <fixture-ws> \
  --port <p> --model custom-openai-compat:deepseek-chat [--expect-error|--cancel-after-ms N]
```
