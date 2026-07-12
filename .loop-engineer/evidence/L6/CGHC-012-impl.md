---
task: "CGHC-012"
loop: "L6"
title: "EV event contract + OpenCode SSE → EV mapping + EV reducer/state machine"
language: "vi"
status: "implemented"
adr_refs: ["0001", "0003", "0008"]
---

# CGHC-012 — EV event contract + OpenCode SSE → EV mapping

## 1. Đã xây dựng cái gì

Module `service/src/execution/` (barrel riêng `service/src/execution/index.ts`, KHÔNG chạm
`service/src/index.ts` / `service/package.json`). Nhiệm vụ: nhận frame SSE thô từ OpenCode
`/event` và **map** sang model EV của Cowork GHC (định nghĩa sẵn ở `core/contracts`), cộng một
**reducer / state machine** fold chuỗi EV thành view session có thẩm quyền (S6). Không thêm
dependency runtime nào (chỉ dùng contracts + Node core). Không đụng `core/contracts` — model EV
của CGHC-003 đã đủ, chỉ **consume**.

Cấu trúc:

```
service/src/execution/
  opencode-events.ts   # RawOpencodeEvent envelope { type, properties } + type guard + accessor
  sse-decode.ts        # decode SSE wire-text → RawOpencodeEvent (seam replay CGHC-024)
  todo-mapper.ts       # todo.updated → EV1 PlanTodo[]
  part-mapper.ts       # message.part.updated (tool/step) → EV2/EV3/EV4
  ev-mapper.ts         # createEvMapper(): frame thô → EvEvent[]; seq đơn điệu; onUnmapped
  ev-reducer.ts        # initialSessionView/reduceEv/foldEv → SessionView (S6)
  index.ts             # barrel cục bộ
service/tests/
  execution-ev-reducer.test.ts             # reducer/state machine (yêu cầu)
  execution-sse-mapper.test.ts             # SSE→EV mapping cho mọi loại frame
  execution-no-fabricated-completed.test.ts# guarantee EV7 (yêu cầu)
```

## 2. Acceptance criteria → nơi thỏa mãn (code mapping)

**AC1 — Model EV + terminal-state set được consume từ `core/contracts` (không copy divergent):**
- `ev-mapper.ts` / `ev-reducer.ts` `import type { EvEvent, TerminalEvent, TerminalState, ... }`
  và giá trị `sessionStatusForTerminal` từ `@cowork-ghc/contracts`. KHÔNG định nghĩa lại union EV,
  KHÔNG định nghĩa lại `TerminalState`. Reducer suy ra `SessionStatus` **chỉ** qua
  `sessionStatusForTerminal` (một nguồn ánh xạ duy nhất, đã có exhaustiveness guard trong
  `session.ts`).

**AC2 — OpenCode SSE → EV; forwarded, không fabricate; frame lạ xử lý tường minh:**
- `ev-mapper.ts::createEvMapper().map(frame)` dispatch theo `frame.type`. Frame không nhận dạng →
  gọi `onUnmapped(frame)` rồi **drop** (log-and-drop), không ném, không bịa. Frame thuộc session
  khác (stream `/event` ghép nhiều session) → drop im lặng qua `frameSessionId()`.
- Terminal `completed` **chỉ** phát từ frame thật `session.idle`. Không có code path nào khác tạo
  ra terminal `completed`.
- **MEDIUM-2 (review fix): quy kết session chính xác cho frame terminal.** Frame sinh terminal
  (`session.idle`, `session.error`) **bắt buộc** `frameSessionId(frame) === boundSessionId` mới được
  consume; owner `undefined` (không phân giải được) hoặc lệch → **drop, không tiêu seq, không phát**
  (`isTerminalProducingType()`). Tránh lỗ hổng: một `session.idle`/`session.error` không rõ session
  trên stream ghép sẽ bịa `completed`/terminal cho session đang bind. Frame non-terminal giữ hành vi
  cũ (chỉ drop khi owner mismatch dương; owner `undefined` được tha để activity trên stream 1-session
  vẫn chảy).

**AC3 — Plan/todo (EV1), per-step (EV2), tool call (EV3) là event runtime thật:**
- EV1: `todo.updated` → `todo-mapper.ts::mapTodos()` (đọc `properties.todos`).
- EV2: part `step-start`/`step-finish` → `part-mapper.ts::mapStepPart()`.
- EV3: part `type:"tool"` → `part-mapper.ts::mapToolPart()` (dùng `part.callID`, `part.tool`,
  `part.state.status`). EV4 file_mutation chỉ phát khi tool file **đã completed** với path cụ thể
  (không claim mutation trước khi runtime thực sự ghi). S2 token: `message.part.delta` →
  `TokenEvent`.

**AC4 — EV reducer/state machine → view có thẩm quyền cho resync (CGHC-014):**
- `ev-reducer.ts::SessionView` = `{ status, terminal, lastSeq, todos, steps, toolCalls,
  fileMutations, text, error }`. `reduceEv` áp dụng theo thứ tự `seq` (bỏ event `seq <= lastSeq`
  → idempotent khi replay tail lúc resync). `foldEv` fold cả chuỗi. `status` là nguồn S6 để endpoint
  resync trả về (`lastSeq` = cursor).

## 3. Reference SSE frame-shape citations (read-only, không import/không build-dep)

Frame envelope `{ type, properties }` + tập tên event, đọc từ nguồn tham chiếu READ-ONLY:
- Envelope + tên event (`session.idle`, `session.error`, `todo.updated`, `message.part.updated`,
  `message.part.delta`, …):
  `.loop-engineer/source/openwork/apps/app/src/react-app/domains/session/sync/session-sync.ts:591-905`.
- Tool part `{ type:"tool", id, sessionID, messageID, callID, tool, state:{ status ∈
  pending|running|completed|error, input, title, error } }`:
  `.loop-engineer/source/openwork/apps/app/tests/session-sync-tool-parts.test.ts:26-84`.
- Part `step-start`/`step-finish`:
  `.loop-engineer/source/openwork/apps/app/src/app/utils/index.ts:1082-1089`.
- Delta `{ sessionID, messageID, partID, field, delta }`: `session-sync.ts:859-885`.
- `session.idle { sessionID }` (một run kết thúc → completed): `session-sync.ts:887-904`.
- `todo.updated { sessionID, todos: Todo[] }`, Todo status có `in_progress`:
  `session-sync.ts:675-681` + `.../surface/session-surface.tsx:283`.
- Tên lỗi `session.error`: `MessageAbortedError` (interrupt → cancelled), `ProviderAuthError`
  (→ recovery reconfigure_credential), `ContextOverflowError`/`MessageOutputLengthError`:
  `.loop-engineer/source/openwork/apps/app/src/react-app/domains/session/sync/usechat-adapter.ts:39-46`.

Các citation này được ghi ngay trong docstring `opencode-events.ts` / `todo-mapper.ts` để review
đối chiếu nhanh.

## 4. Proof "no-fabricated-completed" (EV7)

`execution-no-fabricated-completed.test.ts` chứng minh mapper + reducer không bao giờ ra
`completed`/terminal nếu thiếu frame terminal thật:
- Một run bận rộn (plan + tool running/completed + delta) **không** có `session.idle`: mapper phát
  0 event `kind:"terminal"`; `foldEv` → `terminal=null`, `status="running"` (khác `"completed"`).
- Session rỗng (0 event) → `status="idle"`, `terminal=null`.
- Inject `session.error(ProviderAuthError)` → `errored` (khác completed).
- Inject `session.error(MessageAbortedError)` → `cancelled` (khác errored, khác completed).
- Chỉ khi có `session.idle` thật → `completed`.

Bổ trợ ở reducer test: "first terminal wins" (errored rồi completed muộn → giữ errored) và
"post-terminal activity không lật status về running".

## 5. Seam re-capture cho CGHC-024 (test HIGH-1)

- Mapper **transport-agnostic**: nhận object `{ type, properties }` đã parse (đường SDK live,
  CGHC-014) HOẶC object decode từ **wire-text SSE đã capture** qua `sse-decode.ts::decodeSseChunk`
  → mapping y hệt. Test `captured raw SSE wire text decodes ... maps identically` khoá seam này.
- Frame-shape được ghim theo nguồn tham chiếu (citations §3), KHÔNG hard-code wire shape hư cấu.
  Khi CGHC-024 có frame thật capture được, chỉ cần nạp vào cùng mapper/`decodeSseChunk` để re-test;
  không phải sửa API. Các status/tên-lỗi bất thường ngoài tập đã biết được normalize an toàn
  (không terminal) trong `part-mapper.ts::toolStatus` / `todo-mapper.ts::todoStatus`.

### Handoff gating cho CGHC-024 (khoá bằng REAL captured frames — KHÔNG đoán wire shape bây giờ)

Các finding từ independent test-engineer review (PASS_WITH_FINDINGS, 0 Crit/High). Đúng
frame-shape-dependent nên thuộc CGHC-024:

- **MEDIUM-1 — reasoning-vs-text delta:** `message.part.delta` phát `field:"text"` cho **cả** reasoning
  lẫn text; phân biệt nằm ở `part.type` (thấy qua `message.part.updated`), xác nhận ở
  `session-sync.ts:870-882`. Hiện toàn bộ delta đổ vào `SessionView.text`. CGHC-024 phải xác nhận
  part-type reasoning thật và loại delta reasoning ra khỏi `SessionView.text` (hoặc gắn cờ). Chừa seam
  sạch: track `partID → partType` từ `message.part.updated` rồi phân loại delta lúc apply — KHÔNG
  hard-code chuỗi reasoning-type hư cấu.
- **MEDIUM/LOW — file ops:** `FILE_TOOL_OPS` hiện chỉ `write→create`, `edit/patch/multiedit→edit`.
  Op `delete`/`move` và `previousPath` (rename) chưa map/chưa test. CGHC-024 xác nhận tên file-tool
  OpenCode thật rồi mở rộng `FILE_TOOL_OPS` + trích `previousPath`.
- **LOW — EV5 progress:** chưa wire frame nào (SHOULD). CGHC-024 xác định frame progress thật (nếu có).
- **LOW — session.error parsing hẹp hơn reference:** `describeOpencodeSessionError`
  (`usechat-adapter.ts:57-79`) còn soi `cause`/`causeData` và key `reason`/`error`; `readSessionError`
  hiện chỉ soi `error`/`data` + key `name`/`type`/`message`/`detail`. CGHC-024 khoá lại bằng frame thật.
- **Docstring `foldEv`:** đã sửa từ "order-independent by seq" → "monotonic-forward, drops stale/duplicate
  seq" (`ev-reducer.ts::foldEv`) để phản ánh đúng hành vi drop `seq <= lastSeq`.

## 6. Test — lệnh chính xác + PASS thật

Lệnh (chạy trong `service/`):

```
node --import tsx --test "tests/execution-*.test.ts"
```

Kết quả (tail thật):

```
✔ folds a representative EV run into the authoritative view + completed status
✔ every terminal EV state maps to its exact SessionStatus
✔ the first terminal wins — a later terminal cannot overwrite it
✔ apply is idempotent + ordered — seq <= lastSeq is ignored
✔ without a terminal frame, the mapper emits NO terminal event
✔ without a terminal frame, the folded view is running — never completed
✔ a fresh session with no events at all stays idle (not completed)
✔ an error frame yields errored — NOT completed
✔ a cancel frame yields cancelled — NOT errored and NOT completed
✔ only a real session.idle frame produces the completed status
✔ session.error(MessageAbortedError) → terminal cancelled (not errored, not completed)
✔ MEDIUM-2: session.idle needs exact session attribution — unresolvable owner is dropped
✔ MEDIUM-2: session.error with an unresolvable sessionID emits no error/terminal
✔ captured raw SSE wire text decodes to the same frame and maps identically
ℹ tests 26
ℹ pass 26
ℹ fail 0
```

Full suite regression (`node --import tsx --test "tests/**/*.test.ts"`): **tests 83 / pass 83 /
fail 0** — không hồi quy. (Trước fix MEDIUM-2: 24 / 81; sau: 26 / 83, +2 test attribution.)

Typecheck strict: `tsc -b service/tsconfig.json` → `No errors found` (EXIT 0). Ba file test cũng
typecheck sạch dưới strict + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`
(`tsc --noEmit ...` các file test → EXIT 0).

## 7. Downstream consume

- **CGHC-013 (session):** dùng `createEvMapper` + `foldEv`/`reduceEv` để sở hữu `SessionView` có
  thẩm quyền và suy ra `SessionStatus` (S6). Một mapper cho mỗi session được track.
- **CGHC-014 (two-hop SSE + resync):** một mapper / session, `startSeq` để resume `seq` sau reconnect;
  endpoint resync trả `SessionView` (`lastSeq` làm cursor, `status` làm trạng thái thật). Có thể replay
  wire-text bằng `decodeSseChunk`. **Giữ token guard**, KHÔNG dùng `publicUnauthenticated` cho route SSE;
  gửi heartbeat < 120s (SOCKET_IDLE_TIMEOUT_MS của CGHC-002).
- **CGHC-015 (timeline UI):** render `SessionView` (todos/steps/toolCalls/fileMutations/text/error/status),
  không bao giờ dựng `completed` giả.
- **CGHC-024 (real-frame fixtures):** nạp frame thật capture vào cùng mapper/`decodeSseChunk` (§5).

## 8. Assumptions

- Terminal `completed` map **1–1** từ `session.idle` (một run kết thúc). `session.error` name
  `MessageAbortedError` → `cancelled`; các name khác → `errored` + EV6 error(recovery). Đây là ánh xạ
  suy ra từ nguồn tham chiếu; CGHC-024 xác nhận lại bằng frame thật.
- Terminal `denied` KHÔNG do mapper phát từ frame runtime — nó thuộc boundary permission (CGHC-007):
  khi Deny chặn tại execution boundary, task đó inject `TerminalEvent{state:"denied"}` vào cùng reducer.
  Reducer đã xử lý đủ 4 terminal state (test "every terminal EV state maps to its exact SessionStatus").
- Không chạy OpenCode binary / LLM thật (đúng ràng buộc). Toàn bộ frame là representative theo shape
  nguồn tham chiếu, không bịa wire shape.
- Chưa mount route SSE lên boundary trong task này (đó là CGHC-014). Task này chỉ cung cấp mapper +
  reducer + decode seam để CGHC-014 wire.

## 9. Risks

- **Text-part vs delta double-count:** để tránh, S2 token **chỉ** lấy từ `message.part.delta`; part
  `text`/`reasoning` trả `[]` (không tokenize lại). Nếu upstream đổi sang chỉ phát cumulative text
  (không delta), CGHC-024 sẽ phát hiện và cần bổ sung nhánh — seam đã sẵn.
- **Redaction:** mapper forward `error.message` của runtime nguyên trạng vào `ErrorEvent`. Scrubber
  value-based (SEC-2) là của CGHC-021; trước khi log/gửi client, error path PHẢI đi qua scrubber đó
  (carry-forward CGHC-002 §9). Ở đây không log secret, nhưng không tự redact.
- **Todo/tool status vocabulary drift:** status lạ được normalize về non-terminal (`pending`) —
  an toàn (không bao giờ bịa completed) nhưng có thể mất sắc thái; CGHC-024 khoá lại bằng frame thật.
