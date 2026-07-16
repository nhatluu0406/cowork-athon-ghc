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
    - **PPTX** xem trước **text-first** từng slide (điều hướng trước/sau, đếm "Slide X / Y"). Parse
      **cục bộ trong bộ nhớ** bằng JSZip (PPTX là ZIP container): không giải nén ra đĩa, không mở URL
      remote, không chạy macro/active content, không upload cloud/không dùng M365 conversion. **Không
      render đúng 100%**: chưa hiển thị layout/ảnh/biểu đồ/animation — chỉ trích text theo thứ tự
      slide (giới hạn 500 slide, 50 KiB text/slide). Slide chỉ có ảnh sẽ hiện trạng thái "không có
      nội dung văn bản".
    - **`.ppt` legacy** (OLE nhị phân) **không hỗ trợ** — hiện trạng thái unsupported.
    - **Malformed / mã hoá mật khẩu / vượt 8 MiB** ở mọi loại Office → trạng thái unsupported rõ
      ràng, không crash renderer. Không có **editor Office** đầy đủ.
- **Inspector Phase 1** (plan/activity/file review) còn PARTIAL; diagnostics/logging PARTIAL (Wave 5–6).
- **MCP:** Phase 1 reachability-only (`toolCount` = 0, chưa expose tool catalog); OAuth deferred
  (token do OpenCode quản sẽ nằm ngoài vault mã hoá của Cowork).
- **Web / Next.js** vẫn deferred.
- **OpenCode nạp `AGENTS.md` ngoài ranh giới workspace:** OpenCode đi ngược cây thư mục từ
  workspace root và nạp mọi `AGENTS.md` gặp được (kể cả ở thư mục **cha**, ngoài workspace đã chọn)
  làm instruction/system prompt. Hệ quả quan sát được (2026-07-16): một `AGENTS.md` ở thư mục cha
  đã âm thầm đổi danh tính agent từ "Cowork GHC" thành một persona khác cho mọi workspace con.
  Đây là hành vi của OpenCode, không phải file-mutation, nên không vi phạm ranh giới ghi file —
  nhưng instruction ngoài workspace có thể đổi hành vi/danh tính agent mà người dùng không biết.
  Cách né: đặt `AGENTS.md` riêng trong workspace để ghi đè, hoặc chọn workspace không có `AGENTS.md`
  cha. Cảnh báo/hiển thị instruction kế thừa là việc cân nhắc sau.
