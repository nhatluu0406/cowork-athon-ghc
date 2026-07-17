---
language: "vi"
status: "active"
updated_at: "2026-07-17"
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
