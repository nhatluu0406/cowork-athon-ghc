---
title: "User Story — Demo tính năng Dispatch (D1)"
document_type: "user-story"
language: "vi"
status: "accepted"
date: "2026-07-18"
updated_at: "2026-07-18"
---

# Demo Dispatch — Câu chuyện người dùng

Tài liệu này dành cho **người đọc để demo**: nó kể một câu chuyện ngắn về ai dùng Dispatch và để
làm gì, giới thiệu các chức năng chính bằng ngôn ngữ đời thường, đưa ra một kịch bản thử nghiệm đi
từ đầu đến cuối, và nói thẳng những hạn chế cần lưu ý khi trình bày.

> **Một dòng tóm tắt:** Dispatch cho phép bạn giao *một* việc rồi để *nhiều* trợ lý AI cùng làm song
> song, theo dõi trực quan tiến độ từng nhánh, với quyền hạn được kiểm soát chặt và **không bao giờ
> báo "xong" khi thực chất chưa xong**.

---

## 1. Nhân vật

**An** là một lập trình viên. Thay vì hỏi trợ lý AI từng câu một rồi ngồi chờ, An muốn giao hẳn một
đầu việc và để hệ thống **tự chia thành nhiều nhánh chạy cùng lúc** — chẳng hạn một nhánh đi tìm
hiểu, một nhánh thử sửa, một nhánh rà soát — rồi tổng hợp lại. An cần ba điều:

1. **Nhìn thấy rõ** nhánh nào đang chạy, nhánh nào xong, nhánh nào bị chặn.
2. **Yên tâm về quyền hạn** — trợ lý chỉ-đọc thì không được lén sửa file.
3. **Tin được kết quả** — hệ thống không tô hồng, không báo thành công giả.

Và nếu rời khỏi bàn làm việc, An muốn **theo dõi và ra lệnh từ điện thoại**.

---

## 2. Các chức năng chính

**Trợ lý dựng sẵn.** Có ba vai: *người tìm hiểu* (researcher), *người thực thi* (implementer) và
*người rà soát* (reviewer). Vai tìm hiểu và rà soát bị khoá **chỉ-đọc** — họ thực sự không ghi được
file, không phải chỉ "được dặn đừng ghi".

**Việc dựng sẵn.** Có sẵn vài mẫu công việc (điều tra, thực thi-có-kiểm-chứng, rà-soát-nhiều-nhánh)
để bấm chạy ngay, khỏi phải khai báo từ đầu.

**Ra lệnh bằng dấu gạch chéo.** Ngay trong ô chat:

| Gõ | Kết quả |
|---|---|
| `/dispatch` | Xem danh sách việc có thể chạy |
| `/dispatch run <mã-việc>` | Chạy một việc — hệ thống tự chia nhánh |
| `/dispatch runs` | Xem các lượt đang/đã chạy |
| `/dispatch cancel <mã-lượt>` | Hủy một lượt (dừng cả nhóm nhánh) |

**Chạy song song có kiểm soát.** Một việc được chia thành nhiều nhánh chạy cùng lúc — **mặc định 3
nhánh, tối đa 5**. Mỗi nhánh là một phiên trợ lý *thật*, không phải mô phỏng. Một nhánh hỏng **không**
kéo cả nhóm thành "thành công".

**Bảng theo dõi trực quan.** Màn hình Dispatch chia **hai cột**: bên trái là phần ghép nối điện thoại
(mã QR), bên phải là **bảng tiến độ** cập nhật trực tiếp — trạng thái, số lần thử, đã kiểm chứng hay
chưa, và tình trạng từng nhánh. Bảng chỉ tự làm mới khi có việc đang chạy (đỡ tốn tài nguyên).

**Không báo thành công giả.** Với chế độ *thử đến khi kiểm chứng được*, hệ thống chỉ đánh dấu "đã
kiểm chứng" khi có **bằng chứng thật trên đĩa** (file được tạo/sửa đúng như yêu cầu). Hết lượt mà
chưa có bằng chứng thì báo **"đã cạn lượt"**, tuyệt đối không tự nhận là "hoàn thành".

**Quyền hạn được siết ở tận gốc.** Nếu một nhánh chỉ-đọc cố ghi file, nó **tự bị từ chối** ngay tại
ranh giới thực thi — nhánh đó báo lỗi, còn **người dùng không bị hỏi han làm phiền**. Quyền của mỗi
vai chỉ có thể *thu hẹp*, không thể *nới rộng*.

**Tạo việc từ mô tả.** Bạn có thể mô tả một quy trình bằng lời thường; hệ thống soạn thành **bản
nháp** để bạn xem lại, và **chỉ khi bạn xác nhận** nó mới được lưu thành việc chạy được. Không có bản
nháp nào tự động chạy.

**Điều khiển từ điện thoại.** Qua kênh mạng riêng (Tailscale) hoặc Wi‑Fi chung, điện thoại có thể xem
hội thoại theo thời gian thực, **duyệt/từ chối** một quyền (từ chối là chặn thật), và **bấm một chạm**
để chạy một việc đã lưu. Điện thoại **không** được tạo/sửa/xóa việc — chỉ xem, chạy nhanh, và hủy.

---

## 3. Kịch bản thử nghiệm (từ đầu đến cuối)

> Mục tiêu: đi hết một vòng để người xem thấy Dispatch *chạy thật*, *kiểm soát quyền thật*, và *trung
> thực về kết quả*.

**Chuẩn bị.** Mở ứng dụng, mở khoá, chọn nhà cung cấp AI đã cấu hình và một thư mục làm việc (một
repo nhỏ có sẵn vài file văn bản).

**Bước 1 — Xem việc có sẵn.** Gõ `/dispatch`.
→ *Kỳ vọng:* hiện danh sách vài việc dựng sẵn kèm mã và kiểu chạy.

**Bước 2 — Giao một việc chia nhánh.** Gõ `/dispatch run <mã-việc>` (chọn việc rà-soát-nhiều-nhánh).
→ *Kỳ vọng:* trả về mã lượt chạy và danh sách các nhánh; mở màn Dispatch thấy cột phải hiện lượt đang
chạy với từng nhánh.

**Bước 3 — Quan sát chạy song song.**
→ *Kỳ vọng:* nhiều nhánh chạy cùng lúc (tối đa 3 mặc định). Bảng cập nhật trạng thái theo thời gian
thực.

**Bước 4 — Thử quyền (điểm nhấn).** Chạy một việc có nhánh chỉ-đọc cố ghi file.
→ *Kỳ vọng:* nhánh đó **báo lỗi vì bị từ chối** — và **không** có hộp thoại hỏi người dùng. Thông
điệp: *máy tự chặn, không nới quyền, không làm phiền người.*

**Bước 5 — Thử tính trung thực.** Chạy một việc theo chế độ *thử đến khi kiểm chứng được*, trong tình
huống chưa thể tạo bằng chứng.
→ *Kỳ vọng:* bảng báo **"đã cạn lượt"** kèm số lần đã thử — chứ **không** báo "hoàn thành". Thông
điệp: *chỉ công nhận khi có bằng chứng thật.*

**Bước 6 — Hủy.** Gõ `/dispatch cancel <mã-lượt>`.
→ *Kỳ vọng:* cả nhóm nhánh dừng lại.

**Bước 7 (tùy chọn) — Dùng điện thoại.** Mở màn Dispatch hoặc gõ `/remote` → "Tạo mã ghép nối" → trên
điện thoại (cùng Tailscale/Wi‑Fi) quét QR hoặc mở địa chỉ → nhập mã → đặt tên → Kết nối.
→ *Kỳ vọng:* từ điện thoại xem được hội thoại trực tiếp, **bấm một chạm chạy** một việc, và **duyệt/từ
chối** một quyền — từ chối chặn thật ở máy tính.

**Bước 8 (tùy chọn) — Tạo việc từ lời.** Mô tả một quy trình bằng lời → nhận bản nháp → xem lại → xác
nhận mới lưu.
→ *Kỳ vọng:* không có bản nháp nào tự chạy khi chưa xác nhận.

---

## 4. Xem như demo thành công khi…

- [ ] `/dispatch` liệt kê đúng các việc dựng sẵn.
- [ ] `/dispatch run` tạo lượt chạy với **nhiều nhánh song song**.
- [ ] Bảng Dispatch cập nhật trực tiếp và chỉ làm mới khi đang chạy.
- [ ] Nhánh chỉ-đọc cố ghi file → **báo lỗi, không hỏi người dùng**.
- [ ] Chế độ kiểm chứng khi thiếu bằng chứng → **"đã cạn lượt"**, không "hoàn thành".
- [ ] `/dispatch cancel` dừng cả nhóm.
- [ ] (Nếu demo điện thoại) bấm-một-chạm và duyệt/từ chối hoạt động.

---

## 5. Hạn chế — nói thẳng khi trình bày

| Hạn chế | Nghĩa là | Nên làm gì khi demo |
|---|---|---|
| **Chưa nghiệm thu bản đóng gói/chạy thật đầy đủ** | Dispatch ở mức **PARTIAL**: fan-out chạy thật, nhưng vòng end-to-end trên bản đóng gói còn chờ nghiệm thu. | Nói "chạy thật, có kiểm chứng", **đừng** nói "đã hoàn thiện". |
| **Không xoá được file đáng tin** | Trợ lý hiện chưa có công cụ xoá file ổn định; yêu cầu "xoá" có thể báo thành công sai. | **Tránh** kịch bản nhờ agent xoá file. |
| **Không lưu qua khởi động lại** | Lịch sử lượt chạy và số liệu chỉ tồn tại trong phiên hiện tại. | Demo trong **một phiên**; khởi động lại là mất lịch sử. |
| **Chưa giới hạn số lượt chạy từ điện thoại** | Chưa có hạn mức chống bấm chạy dồn dập từ phone. | **Đừng** bấm "chạy" liên tục khi demo. |
| **Kênh LAN chưa mã hoá (chưa TLS)** | Ở chế độ Wi‑Fi thường, mã thiết bị truyền dạng thô. | Demo qua **Tailscale** (đã mã hoá) hoặc Wi‑Fi tin cậy; **không** mở ra Internet. |
| **Mã thiết bị theo phiên** | Khởi động lại ứng dụng thì phải ghép nối điện thoại lại. | Ghép nối lại sau mỗi lần khởi động. |
| **QR có thể ra địa chỉ Wi‑Fi** | Máy liệt kê nhiều địa chỉ; QR đôi khi encode địa chỉ Wi‑Fi thay vì Tailscale. | Nếu vậy, **gõ tay** địa chỉ Tailscale trên điện thoại. |
| **Số liệu chi phí không suy đoán** | Chỉ hiện khi hệ thống có số thật; không tự tính chi phí. | **Đừng** hứa con số chi phí chính xác. |

---

## 6. Câu chốt

> Dispatch giúp bạn giao một việc rồi để nhiều trợ lý AI cùng làm — **quyền hạn siết thật ở gốc**,
> **kết quả trung thực** (không báo xong khi chưa xong), theo dõi trực quan trên một bảng, và điều
> khiển được từ điện thoại qua kênh đã mã hoá.

---

*Chi tiết khởi động & cấu hình:* [`walkthrough-dispatch-d1.md`](./walkthrough-dispatch-d1.md) ·
*Trạng thái thật:* [`current-status.md`](./current-status.md) ·
*Giới hạn đầy đủ:* [`../quality/known-limitations.md`](../quality/known-limitations.md) ·
*Lộ trình:* [`roadmap-dispatch.md`](./roadmap-dispatch.md)
