# Migrate Cowork Local từ PySide6 (Qt) sang Electron — Design

**Ngày:** 2026-07-11
**Phạm vi tài liệu này:** roadmap toàn dự án migration + spec chi tiết cho sub-project đầu tiên (Tab Cowork chat end-to-end).

## Bối cảnh

`OldVersion/` chứa toàn bộ codebase hiện tại: **Cowork Local**, một app desktop PySide6 (Python) mô phỏng Microsoft Cowork, chạy 100% offline/local. Tính năng chính:

- **Tab Cowork** — chat với AI agent, sinh file thật (.md/.txt/.csv/.json trực tiếp; .docx/.xlsx/.pptx/.pdf qua script tự viết & tự cài thư viện), đính kèm tệp/ảnh, history, queue đa tin nhắn song song, nén hội thoại khi vượt context, tự retry khi rate-limit.
- **Tab Code** — coding agent kiểu Claude CLI: file tree, editor nhúng, `read_file`/`write_file`/`edit_file`/`run_command`/`install_package` có sandbox, chế độ Plan/Act và Auto/Confirm, Flow Req→Demo nhiều bước.
- **Tab Structure (RAG)** — trực quan hoá code/tài liệu thành knowledge graph (D3 force-directed), tích hợp tuỳ chọn với `codebase-memory-mcp`, Graph-RAG Q&A.
- **MS365 integration** — Outlook, SharePoint, Teams, Planner, OneDrive, Power Automate qua Microsoft Graph API.
- **Skills** — chỉ dẫn tái sử dụng cho agent, lệnh `/skill` trong ô chat, quản lý CRUD + import `.skill`.
- **Teams webhook** — gửi thông báo hoàn thành tác vụ sang kênh Teams.
- **LibreOffice embedding** — xem/sửa tài liệu Office trực tiếp trong tab Code (Windows).
- 2 AI provider: Anthropic Claude, OpenAI-compatible (gateway nội bộ).

Ở thư mục gốc đã có một scaffold Electron mới (`main.js`, `preload.js`, `renderer/`) implement UI tĩnh (HTML/CSS/JS, chưa nối logic thật) cho riêng tab Cowork, theo thiết kế "1a Airy" (brand FPT Software). Đây sẽ là base cho toàn bộ frontend mới.

## Quyết định nền tảng (áp dụng cho mọi sub-project)

- **Backend logic chạy trong Electron main process bằng Node.js/TypeScript thuần** — port lại toàn bộ logic Python (provider abstraction, tool execution, config, history...) sang TS, không embed Python runtime, không spawn Python subprocess.
- **Build:** esbuild bundler, biên dịch `src/main`, `src/preload`, `src/renderer` (TypeScript) ra `dist/`. `npm run build` (one-shot) và `npm run dev` (watch mode).
- **Provider AI:** giữ nguyên 2 backend như bản cũ — Anthropic Claude (`@anthropic-ai/sdk`) và OpenAI-compatible (`openai` npm package hoặc fetch thủ công) cho gateway nội bộ.
- **Frontend base:** `renderer/` hiện có (index.html/style.css/app.js/assets) là điểm khởi đầu bắt buộc cho mọi UI mới — không thiết kế lại từ đầu, chỉ mở rộng.

## Roadmap — chia theo sub-project độc lập

Mỗi mục dưới đây là một sub-project riêng, sẽ được brainstorm/spec/plan riêng khi đến lượt. Roadmap này đã được rà soát lại (2026-07-12) bằng cách đọc kỹ toàn bộ `OldVersion/src/cowork_local` để đảm bảo không thiếu tính năng — xem "Ghi chú rà soát" bên dưới.

1. **Tab Cowork (chat) end-to-end** — ✅ đã hoàn thành. Spec chi tiết ở dưới. Còn 1 follow-up nhỏ cần làm: nút "🗜 Nén" thủ công (khác với auto-compress khi vượt context đã có), crash-resilient session restore (`config.last_session`, tự mở lại hội thoại đang dở khi khởi động lại app), và xác nhận Thinking/reasoning streaming UI đã đủ (đã có `StreamEvent.reasoning` + UI cơ bản, cần soát lại cho khớp mức độ chi tiết bản cũ).
2. Attachments (đính kèm tệp/ảnh, đọc nội dung docx/xlsx/pptx/pdf vào context, gửi ảnh thật qua vision API)
3. Office document generation (.docx/.xlsx/.pptx/.pdf qua script sinh + `.scratch/` sandbox + tự cài thư viện; bao gồm **HTML Document Builder** — skill built-in luôn bật, sinh tài liệu dạng `.html` tự chứa)
4. Skills system (lệnh `/skill`, quản lý skill CRUD/import, AI-assisted skill authoring; tham chiếu HTML Document Builder từ mục #3 như một built-in skill luôn bật)
5. Tab Code (file tree, editor, `run_command`/`edit_file`/`write_file` sandbox, Plan/Act, Auto/Confirm, Flow Req→Demo, auto-plan checklist; bao gồm **text-fallback tool-calling protocol** `@@TOOL name {json}` cho model/gateway không hỗ trợ native tool-calling; dùng chung `codebase-memory-mcp` CLI bridge với mục #6)
6. Tab Structure/RAG (structure graph D3, Graph-RAG Q&A, tuỳ chọn codebase-memory-mcp — dùng chung CLI bridge với mục #5)
7. MS365 integration (Outlook/SharePoint/Teams/Planner/OneDrive/Power Automate qua MS Graph, cả 2 auth mode: manual token và OAuth interactive/device-code; bao gồm **`ask_user` interactive question tool** — agent tạm dừng hỏi user chọn giữa các lựa chọn giữa lượt chat, chỉ áp dụng riêng cho MS365 tab)
8. Teams webhook notifications (gửi kết quả tác vụ hoàn thành sang kênh Teams, dual-format Adaptive Card/MessageCard, xử lý redirect POST thủ công)
9. LibreOffice document embedding (xem/sửa tài liệu Office trong tab Code, Windows-only reparenting, graceful fallback)
10. Packaging & distribution (electron-builder cho Windows/macOS/Linux)
11. **App shell: system tray, minimize-to-background, notifications** — thu nhỏ xuống khay hệ thống khi đóng cửa sổ (task vẫn chạy nền), toast + tray-balloon notification khi tác vụ hoàn thành, right-click tray menu Open/Quit. Ưu tiên **thấp nhất** trong roadmap — làm sau cùng.

### Ghi chú rà soát (2026-07-12)

**Không port (dead code / không phù hợp với thiết kế mới):**
- `auth.enabled` (Company SSO qua Entra ID) — cấu hình còn sót lại trong `DEFAULT_CONFIG` nhưng đã bị gỡ khỏi UI ở bản Python, không có màn hình nào đọc tới. Không port.
- Theme system (Dark/Light/Auto-System, live OS-theme-follow) — bản Electron dùng thiết kế UI cố định "1a Airy" (sáng, brand FPT cam #F36F21), không cần theme switching.

**Tính năng dùng chung nhiều sub-project (xây 1 lần, không lặp lại):**
- Per-tab model/agent selection + resolve-default logic (dùng chung bởi #1, #5, #7).
- Per-conversation queue + global parallel cap (dùng chung bởi #1, #5, #7 — đã xây ở #1, tái sử dụng cho #5/#7).
- `codebase-memory-mcp` CLI bridge (dùng chung bởi #5 và #6).
- Collapsible-panel UX pattern (dùng ở nhiều panel: History, Files, Preview, Agent — đã có sẵn dạng CSS/JS trong renderer, chỉ cần áp dụng nhất quán).

**Runtime dependency auto-install** (`core/deps.py` — tự pip-install khi thiếu thư viện Python) không có tương đương trực tiếp ở Node.js, vì dependency được khai báo cố định qua `package.json` từ lúc build/npm-install, không cần "tự cài khi thiếu" lúc runtime. Sẽ xử lý cụ thể (nếu cần) khi viết spec cho #3 (Office doc generation) — có thể chỉ cần đảm bảo các thư viện sinh tài liệu (`docx`, `exceljs`, `pptxgenjs`, v.v.) đã có sẵn trong `package.json`.

---

## Sub-project #1: Tab Cowork (chat) end-to-end

### Phạm vi

**Trong phạm vi:**
- Chat streaming thật với Anthropic Claude và OpenAI-compatible gateway.
- Sinh file text thật: `.md`/`.txt`/`.csv`/`.json` qua tool `save_file`.
- Plan panel (checklist các bước, cập nhật qua tool `update_plan`).
- History: lưu/liệt kê/mở lại/đổi tên/ghim/xoá hội thoại (chỉ kind `"cowork"`).
- Đa tin nhắn song song trong một conversation, giới hạn `max_parallel` (mặc định 5), vượt giới hạn thì xếp hàng (Queue) và tự chạy khi có chỗ trống.
- Settings đơn giản: chọn provider đang dùng, nhập API key/base URL/model cho từng provider.
- Xử lý lỗi: tự động retry khi rate-limit (429, đợi theo `Retry-After` hoặc gợi ý trong body), tự nén bớt lịch sử khi vượt context (400 "maximum context length").
- Nút Stop để huỷ generation đang chạy.

**Ngoài phạm vi (để sub-project sau):**
- Đính kèm tệp/ảnh vào tin nhắn.
- Sinh file Office (.docx/.xlsx/.pptx/.pdf) qua script.
- Hệ thống Skills / lệnh `/skill`.
- Teams webhook.
- Mọi thứ thuộc tab Code, Structure, MS365, LibreOffice.

### Kiến trúc thư mục

```
src/
├── main/
│   ├── index.ts           # entry, tạo BrowserWindow (port từ main.js hiện tại)
│   ├── ipc.ts              # đăng ký toàn bộ ipcMain handlers
│   ├── config.ts           # AppConfig: load/save ~/.cowork_local/config.json, env override
│   ├── history.ts           # save/load/list/delete/rename/pin conversation JSON
│   └── agent/
│       ├── types.ts         # canonical Message, ToolCall, ToolSpec
│       ├── provider-base.ts # abstract Provider: streaming, retry 429, context-overflow trim
│       ├── provider-anthropic.ts
│       ├── provider-openai-compat.ts
│       ├── tools.ts          # save_file tool (chỉ text), sandbox path resolve, update_plan
│       └── run-cowork.ts     # vòng lặp chat: gọi provider, xử lý tool_calls, emit events
├── preload/
│   └── index.ts             # contextBridge: expose coworkAPI (chat, history, settings, window controls)
└── renderer/                # renderer/ hiện có, chuyển sang TS, giữ nguyên HTML/CSS
    ├── index.ts
    └── (index.html, style.css, assets/ không đổi)
```

### Canonical message & tool model

Port nguyên schema từ `OldVersion/src/cowork_local/providers/base.py` và `core/tools.py`:

```ts
type Message =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; name: string; content: string };

type ToolCall = { id: string; name: string; arguments: Record<string, any> };

type ToolSpec = { name: string; description: string; parameters: object }; // JSON Schema
```

Provider interface: `chat(messages, tools, onText, onReasoning, cancel) => Promise<Message>` (streaming qua callback, trả về assistant message hoàn chỉnh khi xong).

### Streaming events (main → renderer)

Gửi qua `webContents.send('cowork:event', ev)`, renderer subscribe qua `window.coworkAPI.onEvent`:

- `{type:'text', delta}` — đoạn text trả lời, append vào bubble hiện tại.
- `{type:'reasoning', delta}` — đoạn "thinking" (model suy luận), hiện trong khung Thinking thu gọn được.
- `{type:'assistant_done', content}` — kết thúc lượt trả lời.
- `{type:'plan_set', steps}` — cập nhật Plan panel.
- `{type:'tool_proposed', id, name, args, preview}` — hiện bước tool sắp chạy (vd "Save report.md") trong chat kiểu CLI.
- `{type:'tool_result', id, name, ok, output, path?}` — kết quả tool.
- `{type:'outputs_added'|'outputs_removed', paths}` — cập nhật Output panel bên phải.

### IPC surface (preload → main)

- `cowork:send(conversationId, text)` — gửi tin nhắn (invoke, trả về ngay khi đã enqueue; kết quả stream qua event).
- `cowork:cancel(conversationId, messageId)` — dừng generation.
- `history:list()`, `history:load(sessionId)`, `history:new()`, `history:rename(sessionId, title)`, `history:pin(sessionId, pinned)`, `history:delete(sessionId)`.
- `settings:get()`, `settings:save(partialConfig)`.
- `shell:openPath(path)` — mở thư mục chứa file output (dùng `shell.showItemInFolder`).

### Config & History persistence (tương thích ngược với dữ liệu cũ)

- Config: `~/.cowork_local/config.json`, deep-merge với default, override bởi env vars (`ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `COWORK_ACTIVE_PROVIDER`). Giữ đúng shape JSON để một user chuyển từ bản Python cũ sang vẫn đọc được config hiện có.
- History: `~/.cowork_local/history/cowork__<session_id>.json`, format `{kind, session_id, title, created, pinned, inputs, outputs, messages}` — giữ đúng format cũ để đọc được lịch sử hội thoại đã lưu từ bản Python.
- `save_file` ghi vào `cowork.output_dir` (config) hoặc mặc định `~/.cowork_local/output/cowork` (bỏ auto-detect OneDrive ở sub-project này — có thể bổ sung sau nếu cần).

### Đa tin nhắn song song & Queue

Mỗi conversation có tối đa `config.cowork.max_parallel` (mặc định 5) tin nhắn xử lý đồng thời — mỗi tin có `messageId`, thread xử lý và output riêng (không đè nhau). Tin vượt giới hạn xếp vào queue trong bộ nhớ của main process, tự chạy khi có message khác hoàn thành. Các conversation khác nhau chạy hoàn toàn độc lập/song song.

### Renderer UI changes (trên nền `renderer/` hiện có)

- `app.js` → `src/renderer/index.ts`: thay `sendMessage()` stub bằng gọi `window.coworkAPI.send()` thật; lắng nghe `cowork:event` để append text delta theo đúng `messageId`, hiện/ẩn Thinking indicator, cập nhật Plan panel trực tiếp.
- Thêm nút Settings (⚙) vào titlebar (chưa tồn tại) → mở modal chọn provider + nhập API key/base URL/model → gọi `settings:save`.
- Sidebar history: bind vào `history:list/load/new/rename/pin/delete` thay vì các `.history-item` tĩnh trong HTML.
- Composer: thêm nút Stop gọi `cowork:cancel`.
- Output panel: render danh sách file từ `outputs_added`/`outputs_removed` event; click mở thư mục qua `shell:openPath`.
- Giữ nguyên toàn bộ style.css / design tokens / assets — chỉ nối logic, không đổi UI.

### Error handling

Port nguyên logic từ `providers/base.py`:
- 429 rate-limit: đọc `Retry-After` header hoặc regex "in Ns" trong response body, đợi (chia nhỏ để Stop vẫn hoạt động được), retry tối đa 6 lần.
- Context overflow (400 "maximum context length" và các biến thể message lỗi tương tự): tự bỏ lượt hội thoại cũ nhất (giữ system message + lượt gần nhất), thử lại.

### Testing / Verification

App UI nên được kiểm tra bằng cách chạy thật (`npm start`) và thao tác tay:
- Gửi 1 tin nhắn → kiểm tra streaming text hiện đúng, Thinking indicator hoạt động.
- Yêu cầu xuất file `.md` → kiểm tra file xuất hiện đúng chỗ, Output panel cập nhật.
- Gửi liên tiếp nhiều tin trong 1 conversation → kiểm tra queue hoạt động đúng (chạy tới max_parallel, phần dư xếp hàng).
- Mở lại một conversation cũ từ sidebar → kiểm tra transcript dựng lại đúng.
- Đổi provider trong Settings → kiểm tra tin nhắn tiếp theo dùng đúng provider mới.
- Bấm Stop giữa lúc đang generate → kiểm tra dừng đúng, không để lại state treo.
