# Cowork GHC Recovery and Modernization Plan

## 1. Freeze Baseline

Để đảm bảo tính ổn định trong suốt quá trình thực hiện kế hoạch phục hồi, toàn bộ mã nguồn của dự án sẽ được đóng băng (freeze) ngoại trừ các thay đổi được chỉ định rõ ràng trong kế hoạch này.
*   **Git Commit Gốc:** `bc3518f — fix(shell): show packaged window on Windows and harden lifecycle scripts`.
*   **Quy tắc đóng băng:** Không thêm bất kỳ tính năng (feature) mới nào, không tích hợp các nhánh D1–D4, không thay đổi các quy tắc cấp quyền (permission rules) hoặc chính sách tệp nhạy cảm (secret policies) cho đến khi các bước dọn dẹp và tái cấu trúc nền tảng hoàn thành.

---

## 2. Code Cleanup Sequence

Thực hiện dọn dẹp các tệp mã nguồn và script verifier dư thừa để làm gọn repository:

1.  **Bước 1: Lưu trữ/Xóa bỏ các verifier lỗi thời (Wave C):**
    *   Di chuyển các tệp `tools/verify/run-wave-c.mts`, `tools/verify/leg1-live-critical-path.mts`, `tools/verify/leg2-provider-error.mts`, `tools/verify/leg3-template-resume.mts`, `tools/verify/leg4-product-boundary.mts` và báo cáo `tools/verify/leg4-report.json` vào thư mục lưu trữ (ví dụ: `.loop-engineer/archive/`) hoặc xóa hẳn sau khi được Product Owner phê duyệt.
2.  **Bước 2: Xóa bỏ các verifier lát cắt cũ (Superseded Slopes):**
    *   Xóa bỏ các tệp tin kiểm thử đơn lẻ cũ: `tools/verify/slice2-workspace-packaged.mjs`, `tools/verify/slice3-provider-packaged.mjs`, `tools/verify/slice4-session-packaged.mjs`, `tools/verify/session-management-packaged.mjs`.
3.  **Bước 3: Hợp nhất seam kiểm thử File Review:**
    *   Hợp nhất biến môi trường và logic cấu hình từ hai tệp stub `tools/verify/file-review-live-packaged.mjs` và `tools/verify/file-review-deterministic-packaged.mjs` trực tiếp vào tham số dòng lệnh `--mode` của tệp tin kiểm thử chính `file-review-packaged.mjs`. Xóa bỏ hai tệp stub này.

---

## 3. Architecture Refactor Sequence

Mục tiêu chính là di chuyển logic nghiệp vụ ra khỏi giao diện UI và phân tách "God Object" `app-shell.ts`:

```mermaid
seqDiag
    loop Tái cấu trúc
        Tách app-shell.ts -> Tạo các Controller chuyên trách (Sidebar, Composer, Timeline)
        Chuyển đổi lưu trữ snapshot -> Service sở hữu thay vì UI lưu tạm
        Di chuyển watchdog phản hồi stream -> Đưa về phía Node.js Service quản lý
    end
```

1.  **Giai đoạn 1: Phân tách `app-shell.ts`**
    *   Tách phần quản lý Sidebar và tìm kiếm cuộc hội thoại thành `ConversationSidebarController`.
    *   Tách phần Composer nhập liệu và quản lý tệp đính kèm (attachments) thành `ComposerController`.
    *   Tách phần hiển thị Timeline, File changes và Preview thành `TimelinePanelController`.
    *   Tách phần cấu hình Model/Gateway thành `LlmSettingsController`.
2.  **Giai đoạn 2: Trả lại trạng thái Snapshot cho Service**
    *   Thay đổi cơ chế lưu trữ trước/sau snapshot: Khi bắt đầu tool call, UI gửi lệnh đến service yêu cầu chụp và lưu tạm snapshot trước vào cơ sở dữ liệu/session của service (thay vì lưu ở `state.pendingBeforeSnapshots` trong RAM của UI). Khi sự kiện `file_mutation` hoàn thành, service sẽ tự động lấy snapshot trước từ session của mình, chụp snapshot sau, thực hiện diff và lưu thành artifact hoàn chỉnh.
3.  **Giai đoạn 3: Di chuyển watchdog giám sát về Service**
    *   Service sẽ tự quản lý thời gian nhàn rỗi (idle) của luồng stream. Nếu tiến trình OpenCode không có phản hồi sau 90s (trừ khi có trạng thái đợi quyền pending), service tự động phát ra sự kiện lỗi `timeout` và đóng phiên, UI chỉ việc lắng nghe sự kiện để hiển thị trạng thái tương ứng.

---

## 4. Docs Consolidation

Hợp nhất các tài liệu hướng dẫn để tạo ra một nguồn sự thật duy nhất (Single Source of Truth - SSOT) sạch sẽ và chính xác:

1.  **Di chuyển tài liệu lịch sử:**
    *   Đưa `docs/product/cowork-ghc-master-plan.md` và `docs/product/cowork-ghc-scope-and-acceptance.md` vào thư mục lưu trữ `docs/archive/` để tránh người đọc hiểu nhầm đây là kế hoạch hiện tại.
2.  **Hợp nhất tài liệu sản phẩm:**
    *   Hợp nhất thông tin từ `docs/product/current-status.md` và `docs/product/productization-roadmap.md` trực tiếp vào tài liệu cốt lõi **`docs/product/cowork-ghc-product-plan.md`**.
3.  **Hợp nhất tài liệu kỹ thuật & giới hạn:**
    *   Giữ lại bộ 4 tài liệu hoạt động (Active Set) tối giản:
        1.  `docs/product/cowork-ghc-product-plan.md` (Kế hoạch sản phẩm & Roadmap).
        2.  `docs/architecture/system-overview.md` (Kiến trúc & Ranh giới hệ thống).
        3.  `docs/quality/poc-acceptance.md` (Trạng thái Acceptance của các lát cắt).
        4.  `docs/quality/known-limitations.md` (Các giới hạn kỹ thuật đã biết).

---

## 5. D1–D4 Merge Strategy

Tích hợp các luồng song song do các nhóm khác phát triển theo trình tự từ dưới lên (Bottom-up) để giảm thiểu rủi ro phá hỏng Core Orchestration:

1.  **Bước 1: Merge D4 (Advanced LLM Gateway) trước tiên**
    *   *Mục tiêu:* Hỗ trợ đổi base URL động và quản lý khóa API linh hoạt từ UI, tạo tiền đề để OpenCode trỏ vào các mock gateway hoặc gateway thật.
2.  **Bước 2: Merge D3 (Knowledge / RAG)**
    *   *Mục tiêu:* Tích hợp chức năng quét thư mục và cấu trúc cây thư mục của workspace. Hiển thị thanh trạng thái index tệp tin trên UI.
3.  **Bước 3: Merge D2 (Microsoft Automation)**
    *   *Mục tiêu:* Bổ sung các công cụ kết nối dữ liệu đám mây (SharePoint/Teams) và giao diện xác thực người dùng.
4.  **Bước 4: Merge D1 (Dispatch / Concurrency) cuối cùng**
    *   *Mục tiêu:* Nâng cấp kiến trúc thực thi OpenCode tuần tự hiện tại lên chạy song song nhiều tác vụ, gom nhóm quyền và hiển thị đa tiến trình của sub-agents.

---

## 6. UI Recovery Strategy

Để khôi phục chất lượng giao diện đạt chuẩn thương mại (Commercial Quality) mà không cần viết lại toàn bộ shell (lựa chọn B):

1.  **Giải phóng không gian khi Collapsed:**
    *   Sửa đổi CSS của `.right-panel--collapsed`: Khi cột phải bị thu nhỏ, thay đổi kích thước thực tế về `0px` (hoặc ẩn hoàn toàn `display: none` cho cả panel thay vì co về `58px`). Nút bấm mở rộng panel sẽ được đưa về dạng nút nổi (Floating Button) ở góc phải màn hình chat hoặc tích hợp vào Product Rail. Việc này giải phóng hoàn toàn không gian và loại bỏ lỗi tràn chữ.
2.  **Giới hạn chiều rộng khung Chat chính:**
    *   Khống chế chiều rộng hiển thị nội dung hội thoại tối đa ở mức `800px` đến `900px` (sử dụng `max-width: 900px; margin: 0 auto;` cho container chat) để tránh việc chữ bị kéo dài quá mức trên màn hình rộng `1920x1080`, đảm bảo mật độ đọc tối ưu.
3.  **Tối ưu hóa Spacing và Spacing Density:**
    *   Thu nhỏ khoảng cách đệm (padding/margin) trống của các card Integration Slots. Expose các nhãn Tooltips rõ ràng cho tất cả các icon trên product rail để người dùng dễ dàng định hướng khi thu nhỏ sidebar.

---

## 7. Test Strategy

Tối ưu hóa thời gian chạy và tính ổn định của các bài kiểm thử:

*   **Tầng 1: Per-change (Tĩnh & Nhanh):** Chạy lệnh `npm run typecheck && npm run test`. Chỉ kiểm tra cú pháp và chạy unit test trong thư mục `tests` (không chạy Electron, không gọi mạng). Thời gian hoàn thành yêu cầu < 5 giây.
*   **Tầng 2: Per-integration-track (Mô phỏng tích hợp):** Chạy `node tools/verify/release-regression.mjs`. Xác thực ranh giới API, kịch bản lỗi mạng và mock gateway chạy cục bộ.
*   **Tầng 3: Milestone/Release (Toàn diện):** Chạy đóng gói `npm run package:win` sau đó thực thi bộ test E2E `file-review-packaged.mjs` ở chế độ `--mode deterministic` (sử dụng Mock LLM Gateway cục bộ cho các hành trình C-L) kết hợp với smoke test live tối thiểu cho hành trình A và B.

---

## 8. Product Roadmap Recovery

Lịch trình triển khai khôi phục dự án sau audit:

```text
Phase 1: Cleanup & CSS Fix (2 ngày)
  └─ Dọn dẹp file verifier rác, sửa lỗi co giãn cột phải, khống chế chiều rộng chat.
Phase 2: Refactor app-shell.ts & Chuyển Snapshot về Service (4 ngày)
  └─ Component hóa UI, di chuyển state lưu trữ snapshot và watchdog về service.
Phase 3: E2E Deterministic Harness (2 ngày)
  └─ Tích hợp Mock LLM Gateway chạy toàn diện các kịch bản E2E từ C đến L.
Phase 4: D4 Integration & Multi-provider Config (3 ngày)
  └─ Merge D4, thay thế cấu hình DeepSeek cứng bằng profile động.
```

---

## 9. Entry/Exit Acceptance Criteria

### Phase 1: Cleanup & CSS Fix
*   **Entry Criteria:** Git working tree sạch ở commit baseline.
*   **Exit Criteria:**
    *   Không còn các tệp kiểm thử Wave C (`leg1-leg4`) trong thư mục `tools/verify/`.
    *   Ở độ phân giải `1366x768` và zoom `125%`, việc co gọn cột phải không gây tràn chữ hay đè nút; khung chat hiển thị gọn gàng ở giữa.
    *   `npm run verify:release` hoàn toàn PASS.

### Phase 2: Refactor & Service State
*   **Entry Criteria:** Phase 1 đạt Exit Criteria.
*   **Exit Criteria:**
    *   Tệp `app-shell.ts` giảm xuống dưới 1,000 dòng mã.
    *   `state.pendingBeforeSnapshots` không còn được định nghĩa ở UI; việc lưu trữ do service quản lý.
    *   Watchdog không hoạt động ở tầng UI.
    *   Mọi bài test unit liên quan đến lưu trữ phiên và activity vẫn PASS.

### Phase 3: E2E Deterministic Harness
*   **Entry Criteria:** Phase 2 đạt Exit Criteria.
*   **Exit Criteria:**
    *   Chạy `node tools/verify/file-review-packaged.mjs --mode deterministic` hoàn thành toàn bộ hành trình A-L và báo cáo trạng thái xanh (**PASS**) mà không cần gọi mạng internet ngoài.

---

## 10. Exact Next Three Cursor Tasks

1.  **Task 1: Dọn dẹp các file verifier thừa và cấu trúc lại hệ thống CSS của cột phải (Collapsed Panel Fix)**
    *   *Chi tiết:* Xóa các tệp `leg1-leg4`, `run-wave-c.mts` cùng các file verifier chặng cũ. Sửa file `app/ui/src/styles.css` để ẩn hoàn toàn cột phải khi collapsed và điều chỉnh container chat chính về `max-width: 900px`.
2.  **Task 2: Trích xuất các lớp xử lý con khỏi `app-shell.ts` (Componentization & UI Refactor)**
    *   *Chi tiết:* Tạo các tệp tin mới `conversation-sidebar-controller.ts` và `composer-controller.ts`, chuyển các hàm khởi tạo DOM và xử lý sự kiện tương ứng từ `app-shell.ts` sang các file mới để giảm kích thước file chính xuống dưới 1,000 dòng.
3.  **Task 3: Di chuyển quản lý Snapshot và Watchdog từ UI về Local Service**
    *   *Chi tiết:* Khai báo thêm trạng thái lưu trữ session snapshot trên service router, cập nhật API để UI gửi tín hiệu chụp thay vì tự quản lý mảng snapshot trong bộ nhớ RAM client.
