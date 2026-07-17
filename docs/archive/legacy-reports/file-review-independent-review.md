# File Work Review Independent Review

## 1. Executive conclusion

Dự án Cowork GHC đã hoàn thành các bước sửa lỗi sản phẩm (RC2, RC4, RC5) và củng cố bộ kiểm thử (RC1, RC3) cho các hành trình A và B trong lát cắt **File Work Review**. Tuy nhiên, hành trình C (xóa tệp) đang bị chặn (blocked) bởi tính không ổn định của mô hình ngôn ngữ (live DeepSeek LLM) khi không liên tục chọn đúng công cụ xóa tệp (`file_delete`). 

Để lát cắt này đạt trạng thái **PASS** toàn diện, một giải pháp kiểm thử kết hợp giữa **Live-agent** (cho create/modify và smoke check permission) và **Deterministic Packaged Product-Path** (cho delete, deny, truncation, binary, secret redaction, v.v.) là hoàn toàn cần thiết và hợp lý.

**Verdict cuối cùng:**
`Proceed after small fixes`

---

## 2. Product diff findings

### Windows 8.3 path normalization (`toRelativePath` in `activity-model.ts`)
*   **Vấn đề/Rủi ro (High):** Cách tiếp cận so khớp tên thư mục cuối cùng (`folder`) của thư mục workspace root:
    ```typescript
    const folder = normRoot.split("/").filter(Boolean).at(-1);
    if (folder !== undefined) {
      const marker = `/${folder}/`;
      const markerIndex = normPath.indexOf(marker);
      if (markerIndex >= 0) {
        return originalNorm.slice(markerIndex + marker.length).replace(/^\/+/u, "");
      }
    }
    ```
    1.  **Trùng khớp sai (False Positives):** Nếu tên thư mục cuối cùng của workspace là một từ thông thường (ví dụ: `project`, `temp`, `src`) và tệp nằm ngoài thư mục workspace chứa đường dẫn tương tự (ví dụ: `C:/external/project/file.txt`), UI sẽ chuẩn hóa nó thành `"file.txt"` (tệp tương đối bên trong workspace). Mặc dù dịch vụ thực tế vẫn ngăn chặn các thao tác ngoài workspace nhờ `assertRealPathInside`, việc hiển thị UI và chụp snapshot trước/sau đối với tệp này sẽ bị sai lệch.
    2.  **Lỗi khi segment cuối là 8.3:** Nếu segment cuối của workspace chứa khoảng trắng và bị Windows viết tắt dưới dạng 8.3 trong đường dẫn của agent (ví dụ: workspace root là `C:/My Long Project`, và agent nhận đường dẫn `C:/MYLONG~1/file.txt`), `folder` sẽ là `My Long Project` nhưng marker sẽ tìm `/my long project/` trong `c:/mylong~1/file.txt` và sẽ thất bại.
*   **Khuyến nghị:** Cần đưa phần chuẩn hóa đường dẫn 8.3 về phía local service (chạy bằng Node.js), nơi có thể truy cập module `fs` và hàm `fs.realpathSync` để giải quyết triệt để và an toàn các đường dẫn viết tắt của Windows trước khi trả dữ liệu về client UI.
*   **Phân loại:** `Risky`

### Permission-wait watchdog (`startStreamWatchdog` in `app-shell.ts`)
*   **Chi tiết:** Watchdog tạm dừng khi phát hiện có yêu cầu quyền chưa xử lý (`decision === "pending"`). Khi quyền được cho phép/từ chối, trạng thái `decision` cập nhật và watchdog tiếp tục theo dõi thời gian nhàn rỗi (idle) một cách bình thường.
*   **Lỗi rò rỉ hoặc treo turn:** Watchdog chỉ được kích hoạt lại và không treo vô hạn khi luồng sự kiện (stream) tiếp tục hoạt động hoặc gặp lỗi (`onError`/`finalizeConversationTurn`). Việc tạm dừng khi người dùng đang cân nhắc quyết định là thiết kế đúng đắn để tránh timeout 90s ngoài mong muốn.
*   **Phân loại:** `No issue`

### Before snapshot at tool start (`captureBeforeOnToolStart` in `app-shell.ts`)
*   **Chi tiết:** Giải quyết trường hợp OpenCode gửi tool call mà chưa đi qua bước xin cấp quyền hoặc không cung cấp `targetPath` sớm.
*   **Trùng lặp snapshot:** Tránh trùng lặp với `capturePermissionBeforeSnapshot` bằng cách duyệt qua `pendingBeforeSnapshots` và kiểm tra nếu `relativePath` đã tồn tại trước đó.
*   **Cập nhật trễ đường dẫn (Delayed Path):** Ban đầu OpenCode chỉ phát ra title hành động (chưa có filePath). `captureBeforeOnToolStart` sẽ chụp dựa trên title (bị lỗi). Tuy nhiên khi tool cập nhật trạng thái kèm theo `filePath`, hàm tiếp tục chạy lại, ghi đè khóa `tool:${event.callId}` bằng đường dẫn chính xác và snapshot đúng đắn.
*   **Tồn dư snapshot lỗi:** Nếu một tool gọi bị lỗi nửa chừng và không tạo ra `file_mutation`, snapshot trước đó của nó sẽ bị kẹt lại trong `pendingBeforeSnapshots` trong suốt turn đó, nhưng sẽ được giải phóng hoàn toàn khi bắt đầu turn tiếp theo qua `resetLiveActivity`.
*   **Phân loại:** `Mostly correct`

### Early filePath in `tool_call.summary` (`part-mapper.ts`)
*   **Chi tiết:** Trích xuất đường dẫn sớm từ các trường `filePath`, `path` hoặc `file` từ cấu trúc dữ liệu OpenCode. 
*   **Phân loại:** `No issue`

### Unified Diff Algorithm (`diff.ts`)
*   **Chi tiết (Medium/Low):** Thuật toán so khớp dòng của hệ thống hoạt động theo chỉ số mảng (index-based comparison) thay vì thuật toán LCS (Longest Common Subsequence).
    ```typescript
    const max = Math.max(bLines.length, aLines.length);
    for (let i = 0; i < max; i += 1) { ... }
    ```
    Nếu một dòng được chèn thêm ở đầu tệp, toàn bộ các dòng phía sau sẽ bị dịch chuyển và hiển thị dưới dạng xóa/thêm xen kẽ chứ không hiển thị đúng là chèn dòng đơn. Tuy nhiên, đây là giới hạn đã được thừa nhận cho phiên bản POC ("Does not attempt merge-editor semantics").
*   **Phân loại:** `No issue` (Được chấp nhận như giới hạn POC)

---

## 3. Verifier diff findings

*   **Độ tin cậy của A/B PASS:** Bằng chứng cho Journeys A và B là đáng tin cậy. Verifier kiểm tra cả trạng thái UI lẫn sự hiện diện và nội dung tệp trên đĩa cứng thực tế.
*   **Logic chờ phê duyệt quyền:** Được cải tiến Deterministic hơn bằng cách chia tách giai đoạn `waitPermissionRequest` và `approveObservedPermission`.
*   **Lựa chọn hàng tệp thay đổi:** Việc chuyển đổi từ `clickFirstFileChange` sang `clickFileChange(relativePath)` giúp xác định chính xác hàng dữ liệu cần hiển thị diff.
*   **Rủi ro từ Journey C:** Cố gắng cho phép `command_exec` (chạy bash lệnh xóa) trong lần thử thứ 2 của Journey C để tránh lỗi không gọi công cụ xóa chuyên dụng:
    ```javascript
    await approveFilePermissionFlow("delete-me.txt", { allowCommandExec: attempt > 0 });
    ```
    Tuy nhiên, nếu mô hình dùng lệnh bash để xóa tệp, sản phẩm sẽ không phát ra sự kiện `file_mutation` tương ứng cho tệp `delete-me.txt`, dẫn đến việc không tạo `fileReviews` và khiến bước `clickFileChange("delete-me.txt")` tiếp theo của verifier **chắc chắn thất bại**. Đây là một điểm lỗi logic của bộ verifier hiện tại.
*   **Phân loại:** `Medium`

---

## 4. Security findings

*   **Lộ lọt khóa bí mật:** Các cơ chế lọc và ẩn (redaction) nội dung đối với các tệp có đuôi `.pem`, `.key` hay tên `.env` đã được thực thi tốt ở cả tầng Dịch vụ (`snapshot.ts` -> `isSecretLikeAttachmentPath`) và UI, không hiển thị nội dung nhạy cảm lên timeline.
*   **UNC / Path Traversal:** Các biện pháp kiểm soát biên giới workspace (`assertRealPathInside`) vẫn hoạt động độc lập và an toàn tại Dịch vụ, ngăn cản việc tận dụng hàm chuẩn hóa đường dẫn của UI để đọc tệp ngoài biên.
*   **Phân loại:** `No issue`

---

## 5. Race-condition findings

*   **Ghi nhận After-Snapshot trễ:** Việc ghi tệp lên đĩa của OpenCode có độ trễ do I/O buffering. `finalizeFileMutationReview` xử lý việc này bằng cách thử lại 6 lần (mỗi lần cách nhau 250ms) để đợi tệp xuất hiện và đồng bộ nội dung hoàn chỉnh trước khi tạo review artifact.
*   **Phân loại:** `No issue`

---

## 6. Acceptance split assessment

1.  **Sự phân chia lát cắt kiểm thử (Split) có hợp lệ không?**
    *   **Trả lời:** Có. Sự phân chia giúp giảm độ nhiễu và loại bỏ sự phụ thuộc không xác định (non-deterministic) vào mô hình LLM khi cần kiểm thử các nhánh logic sâu của ứng dụng.
2.  **Các hành trình cần giữ lại dạng Live-agent:**
    *   Hành trình A (Tạo tệp) và Hành trình B (Sửa tệp) nhằm đảm bảo liên kết OpenCode -> LLM -> Tool Call -> UI hoạt động thông suốt.
3.  **Các hành trình nên chuyển sang Deterministic:**
    *   Hành trình C (Xóa tệp), Hành trình D (Từ chối quyền), các hành trình kiểm tra biên dữ liệu (truncation), tệp nhị phân (binary metadata), bảo mật nhạy cảm (secret redaction), khôi phục phiên lưu trữ sau khi relaunch (relaunch persistence) và cảnh báo hash mismatch.
4.  **Các mối nối (seams) bắt buộc phải là thật:**
    *   Tất cả các thành phần UI (Timeline rendering, right panel preview, copy path), Bridge IPC (preload), Local Service Router (snapshot, build review) và Conversation Storage (SQLite/JSON persistence).
5.  **Những gì không bao giờ được phép giả lập (mock)?**
    *   Không được ghi đè trực tiếp các file JSON lưu trữ hoặc ghi trực tiếp cấu trúc `fileReviews[]` giả vào cơ sở dữ liệu để ép kiểm thử thông qua. Dữ liệu bắt buộc phải được tạo ra thông qua các cuộc gọi API thực và quy trình reducers thực tế của ứng dụng.

---

## 7. Recommended deterministic seam

**Định hướng khuyến nghị: Mock LLM Gateway (Mô phỏng phản hồi của LLM)**

*   **Mô tả:** Thay vì chỉnh sửa mã nguồn sản phẩm (production code) để chèn các điểm kiểm thử giả (test-only endpoints), bộ kiểm thử (verifier) sẽ chạy một HTTP server siêu nhẹ mô phỏng giao thức `/chat/completions` tương thích với OpenAI. Cấu hình gateway của app sẽ trỏ về cổng loopback này.
*   **Lý do chọn:**
    1.  **Giữ mã nguồn sản phẩm sạch:** Hoàn toàn không cần thay đổi hay thêm mã test-only vào ứng dụng.
    2.  **Tính trung thực E2E cực cao:** Quy trình đi qua OpenCode thực tế, tạo lệnh thực tế, kiểm tra quyền thực tế, thực thi ghi/xóa trên đĩa thực tế, kích hoạt snapshot thực tế và hiển thị UI thực tế.
    3.  **Độ ổn định tối đa:** Dễ dàng định hình chính xác lệnh gọi công cụ xóa hoặc thay đổi tệp mà không lo LLM chọn sai công cụ.
    4.  **Fails-safe:** Đảm bảo môi trường sản xuất không bị ảnh hưởng vì không chứa bất kỳ tính năng "bật cửa sau" nào.

---

## 8. Required tests

Các kịch bản kiểm thử biên/kiểm thử đơn vị cần bổ sung cho lát cắt tiếp theo:
1.  **Watchdog pause/resume:** Kiểm tra watchdog không kích hoạt timeout khi có trạng thái `pending`, và tự động chạy lại khi chuyển sang các trạng thái quyết định khác.
2.  **Đăng ký trùng lặp snapshot:** Xác thực việc ghi đè an toàn khóa tool call khi đường dẫn tệp được cập nhật muộn trong chu kỳ tool_call.
3.  **Windows 8.3 False Positives:** Bổ sung ca kiểm thử với đường dẫn tương đồng nằm ngoài workspace chứa thư mục trùng tên với thư mục gốc của workspace.
4.  **Mock Gateway E2E:** Các ca kiểm thử cho kịch bản xóa tệp, từ chối quyền, tệp quá khổ, tệp nhị phân và tệp secret thông qua Mock Gateway.

---

## 9. Blocking findings

*   **Không có.** Các thay đổi hiện tại an toàn và ổn định đối với các mục tiêu hiện thời của sản phẩm.

---

## 10. Non-blocking findings

*   **Khuyết điểm thuật toán Diff (Low):** Sử dụng zip-diff so khớp chỉ số dòng đơn giản, không phản ánh đúng các thay đổi dạng chèn/xóa dòng ở giữa tệp.
*   **Logic Thử lại Hành trình C của Verifier (Medium):** Việc cho phép `command_exec` trong hành trình C dẫn tới việc tệp bị xóa qua lệnh shell, làm mất đi sự kiện `file_mutation` và khiến kiểm tra UI review sau đó bị lỗi.

---

## 11. Exact next Cursor task

1.  **Chỉnh sửa bộ verifier (`tools/verify/file-review-packaged.mjs`):** Xóa bỏ cơ chế tự động chấp nhận `command_exec` ở hành trình C.
2.  **Xây dựng Mock LLM Provider trong bộ verifier:** Thiết lập một API server cục bộ giả lập `/v1/chat/completions` để trả về các Tool Calls định sẵn cho các hành trình từ C đến L.
3.  **Chuyển đổi các hành trình C–L sang dạng kiểm thử Deterministic:** Sử dụng Mock Gateway nói trên để chạy tự động hóa hoàn toàn các hành trình còn lại trong bộ kiểm thử mà không cần gọi API DeepSeek.

---

# Final verdict

```text
Safe to proceed with deterministic C–L harness
```
