---
language: "vi"
status: "active"
updated_at: "2026-07-18"
---

# Known limitations

Danh sách giới hạn sản phẩm chưa xử lý. Chi tiết kỹ thuật/forensic về runtime nằm ở
[architecture/opencode-runtime-notes](../architecture/opencode-runtime-notes.md).

- **OpenCode pin `v1.18.1`** (Wave 2 server-contract matrix PASS; fallback `1.17.20` cũng PASS).
  Nâng pin là thay đổi gated — không upgrade trên main trước khi contract matrix pass.
- **Xoá file không đáng tin:** build agent của pin không expose tool `delete`/`patch`/`apply_patch`,
  nên turn "xoá file" có thể tuyên bố thành công sai. Không bật `bash` để lách. Không phải blocker
  demo. Chi tiết + đường nâng cấp: opencode-runtime-notes.
- **OpenCode `question` tool bị deny tạm thời:** chưa có UI trả lời interrupt; câu hỏi làm rõ đi qua
  turn chat thường. Question interrupt UI deferred.
- **Model discovery ("Dò model"):** best-effort, không bao giờ chặn lưu; luôn giữ nhập Model ID thủ
  công. Metrics/token/cost chỉ hiển thị khi runtime báo số thật (không suy ra cost); chưa persist qua
  reopen hội thoại.
- **Workspace (Wave 4 đã land, còn giới hạn):** PDF preview packaged + live refresh đã hoạt động
  (PO quan sát 2026-07-16). Phạm vi/giới hạn còn lại:
  - **PDF** dùng viewer built-in của Chromium (PDFium), mặc định ẩn toolbar + fit-to-width. Cần
    `plugins:true`, `style-src 'unsafe-inline'` (chỉ style; `script-src` vẫn strict) và **miễn
    `chrome-extension://` khỏi CSP header stamp** để viewer giữ policy riêng. **Không đảm bảo mọi
    PDF**: file **malformed / bảo vệ mật khẩu / dạng chưa hỗ trợ** chưa kiểm chứng, có thể không mở.
    PDF > 8 MiB bị coi là `unsupported` (không preview).
  - **Auto-open** tối đa **1 safe file mỗi turn**; không auto-open file ngoài workspace/secret/
    unsupported hoặc khi buffer đang có sửa chưa lưu.
  - **Dirty edits** được bảo vệ bằng conflict banner (giữ bản đang sửa + cảnh báo ghi đè bền vững;
    "Tải lại từ đĩa" nói rõ sẽ bỏ thay đổi chưa lưu). Không có editor Office đầy đủ.
  - **Verified-delete** của file đang mở clear preview + chặn recreate — chỉ khi delete đã verified
    (xem giới hạn "xoá file" ở trên: Agent thực tế **không** tạo được verified-delete do runtime pin
    thiếu tool `delete`).
  - **Code files** (.py/.css/.cpp/.js/.ts/.json…) xem read-only có syntax highlight (highlight.js)
    kèm số dòng; bấm "Sửa" để chỉnh rồi Lưu. Text **cắt ở 512 KiB** (khoá sửa phần vượt); highlight
    **bỏ qua khi nội dung > 256 KiB** (vẫn hiện plain + số dòng) để giữ mượt. Chỉ nhận theo đuôi
    file/basename đã allowlist; **secret** (`.env*`, `.pem`, `.key`) cố ý loại trừ khỏi preview text.
  - **Office preview (read-only, local-only):**
    - **XLSX đa sheet:** đọc toàn bộ workbook, hiện tab chọn sheet (mặc định sheet đầu), đổi sheet
      không reload Workspace; **sheet hidden/very-hidden bị lọc** không hiện. Vẫn **chỉ xem** —
      chỉnh sửa XLSX bị vô hiệu hoá để không mất công thức/định dạng/merged cell/chart/metadata.
    - **PPTX** xem trước **high-fidelity, chỉ đọc**: dựng từng slide (chữ theo vị trí/kích thước/
      màu tương đối, **ảnh, shape/fill/border, bảng, biểu đồ, nền/theme cơ bản**) thành HTML/SVG bằng
      engine cục bộ `@aiden0z/pptx-renderer` (Apache-2.0). Điều hướng trước/sau + "Slide X / Y",
      fit-to-panel. Chạy **hoàn toàn cục bộ** dưới CSP `script-src 'self'` (không eval trên nhánh chạy
      thực; engine self-contained, JSZip + ECharts đóng gói sẵn): không upload cloud, không URL remote,
      không LibreOffice/server, không chạy macro/OLE/active content. **Không hiển thị đúng 100%** như
      Microsoft PowerPoint. **Chưa hỗ trợ:** animation/transition, phát media (video/audio), macro/OLE
      nhúng, và ảnh EMF (pdf.js fallback tắt để không cần `worker-src blob:` trong CSP). Giới hạn ZIP
      (RECOMMENDED_ZIP_LIMITS) để chặn DoS; lỗi runtime của engine sẽ **degrade về xem text từng slide**.
      Ảnh nhúng cần `img-src ... blob:` trong CSP (engine tạo blob URL cùng-origin từ ppt/media/*);
      `script-src` vẫn strict. *(PO quan sát packaged 2026-07-17: slide + ảnh + bảng/biểu đồ hiển thị.)*
    - **`.ppt` legacy** (OLE nhị phân) **không hỗ trợ** — hiện trạng thái unsupported.
    - **Malformed / mã hoá mật khẩu / vượt 8 MiB** ở mọi loại Office → trạng thái unsupported rõ
      ràng, không crash renderer. Không có **editor Office** đầy đủ.
- **Inspector Phase 1** (Wave 5, PO-observed 2026-07-17): Cowork-only pane Kế hoạch/Hoạt động/Tệp từ
  EV events đã chuẩn hoá (không lộ SSE/token/tool payload thô), tái dùng File Work Review. Token/cost
  metrics vẫn **live-only, chưa persist qua reopen** (giới hạn cũ).
- **Logging/telemetry cục bộ** (Wave 6, PO-observed 2026-07-17): log JSON-lines xoay vòng trong
  `data/logs` (đã ẩn secret trước khi ghi); telemetry **chỉ đếm tổng hợp trên máy**, không network,
  gated bởi toggle. **Bộ đếm telemetry là danh sách cố định** (launches, chat turn completed/failed,
  permission approved/denied, file created/modified/deleted, errors); các bộ đếm khác (provider
  connect, preview kind) là mở rộng tương lai (bảng đếm là name→value dạng generic, không cần migration
  mới). Export/Clear đi qua `/v1/diagnostics` + save-dialog của shell (renderer không tự chọn đường dẫn).
- **MCP:** Phase 1 reachability-only (`toolCount` = 0, chưa expose tool catalog); OAuth deferred
  (token do OpenCode quản sẽ nằm ngoài vault mã hoá của Cowork).
- **Surface `Code` (Hybrid, ADR 0013 — Phase 1):** **renderer surface dùng chung backend Cowork**
  (cùng active workspace/`WorkspaceGuard`/`PermissionGate`/OpenCode session — không backend/session/
  runtime riêng). Code Phase 1 đã có editor nhiều tab **sửa + lưu** (Ctrl+S, `PUT /v1/workspace/
  file-content` guard-confined), dirty + hộp thoại đóng-khi-chưa-lưu, syntax highlight, verified-
  mutation refresh/xung đột/deleted, handoff "Mở trong Code" ↔ "Xem trong Workspace"; label đã đổi
  "Claude Code" → "Code" và đã gỡ chip giả. Giới hạn còn lại:
  - **Runtime web preview (Slice 1, ADR 0014)** đã có: xem trước dự án **tĩnh** (máy chủ loopback
    bounded) và **dev server** frontend. Giới hạn trung thực:
    - Nhúng bằng **WebContentsView** nổi trên DOM ⇒ được **ẩn chủ động** khi có Settings/permission
      dialog hoặc rời chế độ Preview; **không tự clip** theo bo góc/scroll như iframe (đánh đổi để
      giữ CSP renderer). Chỉ nạp **loopback**; remote-nav/popup/download/webview bị chặn.
    - **Dev server**: chỉ chạy `<pm> run <script>` (pm ∈ npm/pnpm/yarn) đã allowlist + **người dùng
      phê duyệt lệnh**; không chạy lệnh tự do từ model/file. Dò port là **heuristic** (đọc URL
      localhost từ output / dò `PORT`); framework in URL khác thường có thể không phát hiện được →
      `failed` trung thực, không giả "running". Không đảm bảo HMR/websocket; không proxy remote/CDN.
    - **Đổi workspace / tắt app** dừng preview bằng **tree-kill trên cây còn sống**
      (`taskkill /PID <pid> /T /F`) — không graceful-kill riêng `cmd.exe` trước (sẽ bỏ mồ côi
      `pm→node→…`); **không orphan** (được test tiến trình thật kiểm chứng). Output đã redact +
      giới hạn kích thước.
    PDF/Office/ảnh trong Code hiển thị chỉ đọc + "Xem trong Workspace" (không dựng lại viewer).
  - **Desktop app launch (Slice 2, ADR 0015)** đã có: **Build / Chạy / Dừng / Khởi động lại** một
    ứng dụng **Electron** của workspace như **tiến trình/cửa sổ riêng** (selector **Web / Ứng dụng**).
    Tái dùng nguyên runner Slice 1 (permission mỗi Build/Run, cwd confined, env curated không secret,
    output redact/bounded, **tree-kill không mồ côi**). Giới hạn trung thực:
    - **Chỉ Electron**: nhận app khi có dependency `electron` **và** script chạy (start/app/electron/
      dev/serve). App Node trần / executable đóng gói **không** tự đoán → `unsupported` rõ ràng
      (tránh chạy executable tuỳ ý). Chỉ chạy `<pm> run <script>` đã allowlist + **người dùng phê
      duyệt**; không chạy lệnh tự do từ model/file.
    - **`running` là heuristic**: tiến trình đã spawn còn sống qua cửa sổ readiness ngắn (không
      introspect được cửa sổ app). App tự thoát ngay mã 0 → `stopped`; mã ≠ 0 / lỗi spawn → `failed`.
      Không bao giờ giả "running".
    - **Không nhúng** app vào Cowork (chạy cửa sổ riêng); **không** mở "thư mục đầu ra" (chưa có safe
      shell contract). Vẫn không terminal/PTY, Git client, debugger, LSP.
  - **Chỉ sửa được tệp văn bản/mã** (kind `text`); spreadsheet/tài liệu vẫn xem/sửa ở Workspace.
  - **Đổi active workspace khi còn tab Code chưa lưu sẽ reset** (bỏ thay đổi chưa lưu) — giống
    companion Workspace hiện tại; hộp thoại xác nhận trước khi đổi workspace là việc sau (không nằm
    trong Phase 1). Hộp thoại xác nhận **đã có** cho thao tác đóng tab.
  - **Packaged PO observation chưa chạy**: focused UI tests + `build:app` PASS nhưng chưa claim WORKS
    cho tới khi PO quan sát trên packaged app (xem `demo-acceptance.md`).
- **Web / Next.js** vẫn deferred.
- **OpenCode nạp `AGENTS.md` ngoài ranh giới workspace:** OpenCode đi ngược cây thư mục từ
  workspace root và nạp mọi `AGENTS.md` gặp được (kể cả ở thư mục **cha**, ngoài workspace đã chọn)
  làm instruction/system prompt. Hệ quả quan sát được (2026-07-16): một `AGENTS.md` ở thư mục cha
  đã âm thầm đổi danh tính agent từ "Cowork GHC" thành một persona khác cho mọi workspace con.
  Đây là hành vi của OpenCode, không phải file-mutation, nên không vi phạm ranh giới ghi file —
  nhưng instruction ngoài workspace có thể đổi hành vi/danh tính agent mà người dùng không biết.
  Cách né: đặt `AGENTS.md` riêng trong workspace để ghi đè, hoặc chọn workspace không có `AGENTS.md`
  cha. Cảnh báo/hiển thị instruction kế thừa là việc cân nhắc sau.

## Local Knowledge Base/Graph MVP (D3 local, 2026-07-18) — giới hạn

Đây là hệ Knowledge **local mới** (`service/src/knowledge-local` + `/v1/knowledge-local` + surface
Knowledge thật), **tách biệt** với Go backend/M365KG bên dưới. Đây là **một kho tri thức thống nhất
theo active Workspace** — chỉ hai tab `Kho tri thức` / `Đồ thị`, **không** có tab nguồn tách biệt.
Code+tests+build PASS; **data-rich packaged acceptance PASS** (UI audit 21/21, 33 ảnh) qua seed
workspace cô lập trong audit mode (không dùng workspace thật, không fake data): index status=ready,
document list, chi tiết + provenance, FTS search có snippet, đồ thị nút/cạnh + chọn nút, đồng bộ lại
prune, xóa chỉ mục an toàn giữ file gốc. Giới hạn có chủ ý của MVP:

- **Chỉ keyword FTS5 — không semantic/vector/embedding.** Không gọi LLM để index; `llm-svc` (LF-3)
  chưa bundle. Không bịa "semantic similarity". Tìm kiếm là prefix AND trên token.
- **Microsoft 365 là nguồn bổ sung tương lai, chưa kết nối.** Provenance có mặt hôm nay (mỗi tài
  liệu/kết quả/node mang badge nguồn = **Workspace**); bộ lọc nguồn hiện `Microsoft 365` dạng option
  **disabled** + tóm tắt readiness trung thực ("Chưa kết nối"). **Không fake count/data MS365**, không
  gọi backend, không phát network request từ Knowledge khi MS365 chưa bật (có test proxy khẳng định
  renderer chỉ gọi route `knowledgeLocal*`). Contracts (`KnowledgeSourceRef`) sẵn sàng ingest MS365
  vào cùng kho sau này, không cần migration lớn. M365 KG backend nâng cao vẫn bảo tồn off-main (dưới).
- **Không trích text PDF.** PDF được Workspace hiển thị dạng bytes; indexer **không** đọc text PDF nên
  PDF không vào chỉ mục (md/text/code/docx/xlsx/pptx thì có).
- **Đồ thị chỉ deterministic:** workspace→folder→file (`contains`) + link Markdown đã resolve
  (`links_to`). Không suy diễn quan hệ bằng LLM.
- **Bounded:** mặc định ≤1500 file, ≤2 MiB/file, depth ≤12, ≤400 chunk/tài liệu; vượt thì bỏ qua
  (skip đếm được). Mỗi lần sync **đọc lại** mọi file để hash (incremental chỉ tiết kiệm re-chunk/FTS,
  không tiết kiệm I/O đọc); enumerate + read re-validate workspace mỗi thư mục/tệp (chi phí chấp nhận
  được cho MVP).
- **Không watch file real-time:** thay đổi trên đĩa cần bấm "Đồng bộ" lại.

## Tích hợp gần đây — giới hạn còn tồn (PR #11 MS365, PR #12 Local import)

Ghi lại các phần **đã merge nhưng còn giới hạn/POC** sau khi tích hợp PR #11 (MS365) và PR #12
(Local folder import → Knowledge Graph, Go backend). Đây là ghi nhận trung thực, không phải blocker
demo, nhưng KHÔNG được coi là "chạy đầy đủ".

- **Local folder import → Knowledge Graph (D3, Go backend `app/backend`):**
  - **Embedding local chunk là best-effort, cần llm-svc:** chunk local được embed inline dưới đúng
    model retrieval dùng, nhưng chỉ khi `llm-svc` (gRPC embeddings) chạy; thiếu dịch vụ → chunk vẫn
    lưu **text-only** (không semantic search). Pipeline job source-agnostic
    (`embedding.BatchProcessor.QueueJob/ProcessJob`) **tồn tại nhưng chưa được caller nào gọi** —
    khoảng trống POC, chưa nối vào luồng import.
  - **Cần dịch vụ ngoài để chạy/kiểm thử thật:** import + Neo4j graph cần **Postgres + Neo4j +
    llm-svc**. Ở máy dev không dựng được nên **integration test import/neo4j chưa chạy**; chỉ verify
    unit (91 pass) + 4 test auth mới. 5 unit `now()` fail là **môi trường** (store SQL nhắm Postgres,
    chạy trên sqlite thiếu hàm `now()`), không phải lỗi logic.
  - **Đã cứng hoá (landed):** endpoint bắt buộc **JWT** (fail-closed 401), cap đọc file **25 MiB**,
    chặn escape qua **symlink/junction** (EvalSymlinks + confine trong root), **job timeout 30′**,
    unique index chống job trùng (→ 409). Chính sách hiển thị chunk: local chunk theo **local-first
    ownership tường minh** (không fail-open như M365 scope). Log đã **redact** absolute path.
- **MS365 (PR #11):**
  - **Power Automate flow store chỉ in-memory:** đường persist ra JSON plaintext đã bị **gỡ** (URL
    flow là bearer SAS — không lưu plaintext). Seam `setFlows` **chưa nối** nguồn bền vững nào, nên
    flow phải **đăng ký lại sau mỗi lần khởi động service**. Trigger đã cứng hoá: **IP-pin qua dialer**,
    **host-allowlist** Logic Apps (`.logic.azure.com/.us/.cn/.de`), timeout 15s, redact `sig` khỏi
    permission card.
  - **SSRF private-provider opt-in (`CGHC_SSRF_ALLOW_PRIVATE_PROVIDER`) chưa wire:** policy `ssrf`
    hiện **dùng chung** cho provider + MCP + MS365 + Power Automate. Wire opt-in ở điểm dùng chung sẽ
    **nới lỏng SSRF cho cả MS365/MCP** (regression bảo mật), nên cố ý **không tự ý wire** — cần tách
    scope riêng + **independent review** theo CLAUDE.md. Hệ quả: **2 test private-provider opt-in vẫn
    đỏ** (chưa có wiring ở cả hai nhánh) — đây là giới hạn đã biết, không phải hồi quy do merge.
- **Môi trường dev (không phải giới hạn sản phẩm):** pin OpenCode local hiện là `v1.17.11`; **2 test
  config** khẳng định `v1.18.1` sẽ **đỏ tại máy dev** cho tới khi cài đúng build pin (xem mục
  "OpenCode pin" ở trên). Không ảnh hưởng logic.

## M365 Knowledge Graph (PR #13) — optional subsystem preserved off-main

Full implementation của **M365 Knowledge Graph** (PR #13) được đánh giá runtime rồi **bảo tồn
nguyên vẹn** ở branch `experimental/m365-knowledge-graph` (checkpoint tag
`m365-kg-pr13-integration-2026-07`), **không merge vào `main`**. Branch compile sạch trên nền main
(typecheck + verify:fast 54/54 + build:app PASS).

**Stack:** Go backend (`app/backend`, `github.com/rad-system/m365-knowledge-graph`) + PostgreSQL 16 +
Neo4j 5.26 (Bolt, JRE Temurin 21) + Rust/Python `llm-svc` (gRPC) + supervisors/provisioning + M365
Graph ingestion/query + graph routes + citations.

**Vì sao optional/không chạy end-to-end trong thời gian bounded:**
- **Source `llm-svc` VẮNG MẶT trong repo** — docs mô tả nó là microservice riêng; provisioning không
  fetch nó. Không có `llm-svc` ⇒ không embeddings, không câu trả lời sinh ra. Đây là thành phần bắt
  buộc mà **source không tồn tại**, không giải quyết được bằng provisioning.
- Không có orchestration/compose; chưa có toolchain (Go 1.25 / Neo4j / PostgreSQL / JRE) cài sẵn.
- Chưa có packaged verification.

**Trạng thái trên `main`:** default **OFF**. Packaged app **không** khởi động Go/PostgreSQL/Neo4j/JRE
(TS stack supervisor là dormant, không nằm trong composition root). **Không fake WORKS.** Exhibition
Knowledge dùng **SQLite Workspace Knowledge** (local, offline); M365 KG là subsystem tương lai với
readiness rõ. Muốn đánh giá tiếp: checkout `experimental/m365-knowledge-graph`.

## MS365 OpenCode plugin `tool.execute.before` hook (intentional no-op seam)

The MS365 OpenCode plugin (`service/src/runtime/ms365-plugin-file.ts`) includes a
`tool.execute.before` hook that is deliberately a **no-op passthrough** — it does not gate any tool
calls. This is **not** a missing security gate; it is a reserved seam.

**Why no-op?** The child process (OpenCode's sandboxed runtime) cannot read its own session's
MS365 scope, so any authorization decision made inside the hook would be a guess. The real,
fail-closed authorization boundary is `Ms365SessionScope` in the router
(`service/src/ms365/ms365-tool-router.ts`): only sessions explicitly registered by the **Microsoft
365** tab are allowed to call any MS365 tool. Every other session is rejected at the router level.

**Design choice:** The hook is kept as a **RESERVED SEAM** (documented in the source). If OpenCode
ever exposes a way for the child to learn its own session scope, the hook could become an early,
in-process friendly block (fail fast before round-tripping to the router). Until then, it is a
no-op for all sessions — no action needed, and adding a gate here today would be security theater.

**Related:** Session gating is enforced in `service/src/ms365/ms365-tools.ts:handleToolCall`, which
checks `deps.sessionAllowed(sessionId)` first, before any tool-specific logic. This is the
production authorization boundary.
