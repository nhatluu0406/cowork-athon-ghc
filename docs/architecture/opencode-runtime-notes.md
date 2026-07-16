---
language: "vi"
status: "active"
updated_at: "2026-07-16"
---

# OpenCode runtime notes (forensic)

Chi tiết kỹ thuật về cách Cowork GHC vận hành trên bản OpenCode được pin. Đây là tài liệu
tham chiếu cho engineer; danh sách giới hạn sản phẩm ngắn gọn nằm ở
[known-limitations](../quality/known-limitations.md).

Pin thực tế: `runtime/src/pin.ts` → `OPENCODE_PIN = "v1.18.1"` (fallback 1.17.20 cũng PASS).

## Build agent không có tool `delete` (pin 1.18.1)

Cowork map một tool `delete` và `apply_patch` `*** Delete File:` vào File Review + quyền elevated,
nhưng **build agent của OpenCode được pin không expose các tool đó cho LLM**.

Xác minh bằng `opencode debug agent build` trên cấu hình Cowork live (2026-07-16):

| Tool | Exposed |
|---|---|
| `read` / `glob` / `grep` | yes |
| `edit` / `write` | yes |
| `todowrite` | yes |
| `bash` / `task` | no (Cowork cũng deny) |
| `question` | no (product deny — xem dưới) |
| **`delete`** | **absent from schema** |
| **`patch` / `apply_patch`** | **absent from schema** |

**Không thể "bật" trên pin này:** các config đặt `tools.delete` / `tools.patch` /
`tools.apply_patch` (kể cả dưới `agent.build.tools`) vẫn cho ra build-agent `tools` map **không có**
key `delete`/`patch`. Schema `https://opencode.ai/config.json` cũng **không** có tên tool
`delete`/`patch`; `tools` chỉ là `additionalProperties: boolean` trên các tool OpenCode thực thi.

Hệ quả: một turn "xoá file" model chỉ có `glob`/`read`/`edit`/`write`. Failure mode quan sát được:
model **đọc file rồi tuyên bố "đã xoá" mà không có tool mutation** — đĩa không đổi. UI verification
(`file-action-integrity`) đánh dấu claim create/edit/delete là chưa hoàn tất khi không có File Review
tương ứng. **Không** bật `bash` để lấy `rm` — điều đó mở lại arbitrary command execution. Chờ một pin
OpenCode thực sự liệt kê `delete`/`patch` cho build agent trên Windows, re-verify trước khi claim WORKS.

## OpenCode `question` tool (deny tạm thời)

**Triệu chứng:** sau turn chat đầu thành công, prompt thứ hai (thường "tạo file…") có thể fail với
`POST /v1/session/{id}/message` → **503** (`runtime_unavailable`), OpenCode log `asking id=que_…`.

**Nguyên nhân:** tool `question` interactive của OpenCode block turn live cho tới khi có structured
reply trên reply channel riêng. Cowork GHC hiện chỉ sở hữu UI **permission** Allow/Deny — **không** có
surface để trả lời `question`. Với `question: allow`, model stall `POST /session/.../message` tới khi
HTTP client timeout (~15s), router map thành 503 trung thực.

**Product choice (2026-07-16):** deny tool `question` trong `opencode.json` live
(`LIVE_SESSION_PERMISSION_POLICY.question = "deny"`). Câu hỏi làm rõ đi qua turn chat bình thường.
UI Question interrupt (SSE + reply port + modal) **deferred** — không re-enable `question: allow`
cho tới khi surface đó ship.

**Khác biệt:** Permission prompts (`permission.asked`) đã có bridge + UI. Mode **Tự động**
(`workspace_auto`) auto-allow file edit chuẩn; action elevated (delete/move/command) vẫn hỏi.

## Turn-perf readings (packaged, 2026-07-16)

Sau khi live đã attach: `runtime_ensure` ≈ 30–40ms, `first_token_to_paint` ≈ 1–6ms (UI không phải
bottleneck). Lần send đầu sau settings→live có thể tốn ≈ **2s** ở `runtime_ensure` (stop+start
OpenCode) — expected, không phải UI hang.

`prompt_accept` trong demo SUMMARY **gây hiểu lầm**: đó là wall time từ `RUNTIME_READY` tới
`PROMPT_ACCEPTED`, và OpenCode giữ `POST /session/.../message` tới khi turn xong (tools + model).
`prompt_accept` / `time_to_first_token` lớn trên turn nhiều tool chủ yếu là **model + tool loop**,
không phải loopback latency của Cowork. Permission auto-approve ≈ 12–15ms.

## PATCH `/v1/conversations/{id}` 500 trên File Review persist (đã fix)

**Nguyên nhân:** `file_review_refs.id` là PRIMARY KEY **global**, nhưng File Review id là
`review-${opencodeSeq}`. OpenCode `seq` restart theo session, nên hai conversation có thể trùng →
SQLite UNIQUE constraint → Internal 500 trung thực trên activity PATCH (sau FILE_VERIFIED).

**Fix (2026-07-16):** PRIMARY KEY của review ref được namespace thành `{conversationId}:{reviewId}`;
UI cũng emit `review-${runtimeSessionId}-${seq}`. Id trùng trong một lần persist bị bỏ qua.
