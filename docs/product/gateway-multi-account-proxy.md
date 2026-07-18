---
title: "Gateway — multi-account API key proxy"
document_type: "product-feature"
language: "vi"
status: "accepted"
updated_at: "2026-07-18"
---

# Gateway — multi-account API key proxy

> **Phân biệt tên gọi**: tài liệu này nói về bề mặt sản phẩm **"Gateway"** (quản lý nhiều tài
> khoản API key, bật/tắt hệ thống, nhật ký request) — **khác hoàn toàn** với module
> `service/src/remote-gateway/` (điều khiển app từ điện thoại/PWA, xem
> [ADR 0010](../architecture/decisions/0010-remote-gateway-and-pwa-surface.md)). Hai tính năng
> trùng tên "gateway" nhưng không liên quan gì nhau.

## 1. Mục đích

Cowork GHC mặc định gọi thẳng nhà cung cấp LLM (DeepSeek/FPT Cloud/OpenAI-compatible…) bằng
`baseUrl` + key đã cấu hình ở **Cài đặt → Nhà cung cấp**. Gateway thêm một lớp **tùy chọn** ở
giữa: khi bật, request chat của một profile đã tick sẽ đi qua một điểm trung chuyển cục bộ trước
khi tới nhà cung cấp thật, để dần có:

- Một nơi **quan sát** tập trung mọi request thực sự được gửi đi (model, provider, thời gian,
  kết quả) mà không cần sửa code chat.
- Một điểm **kiểm soát traffic theo từng tài khoản/nhà cung cấp** — nền tảng cho quota, giới hạn
  tốc độ, xoay vòng nhiều key, và failover sau này.

Gateway không phải một nhà cung cấp mới — nó đứng giữa Cowork và (các) nhà cung cấp đã cấu hình,
trong suốt về nội dung request/response.

## 2. Thiết kế

### 2.1. Nguyên lý: proxy thật, không phải permission-check

Thiết kế cốt lõi: khi Gateway **BẬT**, traffic **vật lý đi qua** một tiến trình HTTP proxy cục bộ
(`service/src/gateway/proxy-server.ts`) — không phải một lớp kiểm tra quyền chèn vào giữa đường
đi cũ. Luồng hoạt động:

1. Bật công tắc → `baseUrl` của **profile** trong Cài đặt được **thay** thành địa chỉ proxy cục
   bộ (`http://127.0.0.1:<port>/v1`). Địa chỉ thật của nhà cung cấp được cất lại
   (`GatewayAccount.upstreamBaseUrl`).
2. OpenCode (child process) đọc `opencode.json` — nơi `baseUrl` đã bị thay — nên mọi cuộc gọi
   `chat/completions` của profile đó đi tới proxy trước.
3. Proxy tra `resolveProxyUpstream()` để biết địa chỉ thật, forward request nguyên vẹn (giữ
   header/body, streaming), đo `httpStatus`/`ttfbMs`/`totalMs`, rồi ghi 1 dòng nhật ký.
4. Tắt công tắc → `baseUrl` của profile được **phục hồi** về địa chỉ thật.

```text
Gateway TẮT (mặc định):
  OpenCode → (baseUrl thật) → Nhà cung cấp

Gateway BẬT (profile đã tick):
  OpenCode → http://127.0.0.1:<port>/v1 (proxy)
           → resolveProxyUpstream() tra baseUrl thật đã lưu
           → forward nguyên vẹn tới Nhà cung cấp thật
           → ghi 1 dòng nhật ký (model, thời gian, kết quả)
```

Khi BẬT: request thật sự "đi qua Gateway". Khi TẮT: profile gọi thẳng nhà cung cấp, không khác gì
lúc chưa có Gateway.

### 2.2. Công tắc tổng và ràng buộc restart

Bật/tắt Gateway ở tab Gateway (mặc định TẮT) áp dụng cho toàn hệ thống:

- **BẬT**: mọi profile đã tick trong "Cấu hình từ Cài đặt" được swap `baseUrl` sang proxy.
- **TẮT**: mọi profile đã tick được phục hồi `baseUrl` thật.

Ràng buộc thiết kế quan trọng: OpenCode chỉ đọc `opencode.json` **một lần lúc khởi động child
process**, không hot-reload. Vì vậy bật/tắt công tắc đổi Cài đặt ngay lập tức, nhưng chỉ có hiệu
lực với phiên chat **sau khi khởi động lại app**. Để việc TẮT vẫn "hoạt động bình thường" ngay cả
khi chưa restart (không cần chờ), proxy luôn biết địa chỉ thật gần nhất
(`GatewayAccount.lastKnownUpstreamBaseUrl`) và tiếp tục chuyển tiếp bình thường cho traffic còn
đang trỏ vào nó — chỉ khác là traffic đó không còn được ghi vào nhật ký (Gateway không còn "quản
lý" nữa, chỉ là đường ống trung chuyển tạm thời).

### 2.3. Địa chỉ server

Proxy luôn bind loopback cố định `127.0.0.1` (bất biến bảo mật: không bao giờ mở ra ngoài máy).
**Cổng** là một thiết lập có thể chỉnh ở tab Gateway (mặc định `47771`, hợp lệ 1024–65535), lưu
bền vững và áp dụng từ lần khởi động app tiếp theo. Cổng cố định qua các lần chạy (không phải cấp
phát ngẫu nhiên mỗi lần) để một `baseUrl` đã swap trong Cài đặt luôn khớp đúng địa chỉ proxy ở lần
khởi động sau — đổi cổng trong lúc đang có profile swapped sẽ tự phục hồi các profile đó và tắt
công tắc, buộc bật lại có ý thức sau khi khởi động lại (tránh để sót một cổng cũ không còn đúng).

Nếu cổng đã bị chương trình khác chiếm, Gateway tự phát hiện, hiển thị cảnh báo, và khoá công tắc
BẬT cho tới khi hết xung đột và khởi động lại app.

### 2.4. Nhật ký request

Mỗi request thật sự đi qua proxy **trong lúc Gateway đang BẬT** tạo một dòng nhật ký: thời gian,
kết nối, model, kết quả (Cho phép/Bị chặn), `httpStatus`/`ttfbMs`/`totalMs` đo thật từ proxy, và
đoạn đầu prompt (≤ 300 ký tự, đã che PII cơ bản: email/số thẻ dạng số dài/số điện thoại VN). Giữ
tối đa 200 dòng và 30 ngày, dọn tự động. Không ghi nhật ký khi Gateway TẮT.

### 2.5. Bảo mật

- Proxy chỉ bind `127.0.0.1`, không bao giờ lộ ra mạng ngoài; host không cho cấu hình.
- Gateway tái sử dụng credential đã lưu trong vault mã hoá của profile — không tự tạo bản sao khi
  liên kết một profile có sẵn; xoá một account liên kết không bao giờ xoá credential gốc.
- Nhật ký chỉ chứa đoạn prompt đã che PII cơ bản — không log response của AI, tool output, hay
  secret.

## 3. Hiện tại đã làm được gì

- [x] Bật/tắt Gateway cho toàn hệ thống, mặc định TẮT.
- [x] Checklist liên kết từng kết nối ở Cài đặt → Nhà cung cấp (tên hiển thị đồng bộ).
- [x] Proxy HTTP thật, byte-transparent, đo metric thật (`httpStatus`/`ttfbMs`/`totalMs`).
- [x] Cấu hình cổng server (mặc định + chỉnh sửa được), tự phát hiện xung đột cổng.
- [x] Nhật ký request: model, kết quả, thời gian đo thật, prompt đã che PII, xem chi tiết từng dòng.
- [x] TẮT hoạt động ngay (không cần restart để traffic đi thẳng bình thường), chỉ nhật ký cần
      restart để dừng ghi log của phiên cũ.
- [x] Thêm account thủ công (nhập key riêng) ngoài việc liên kết từ Cài đặt.
- [x] Nhiều account cho cùng một provider, chọn account đang hoạt động.

## 4. Kế hoạch tiếp theo

- [ ] **Xoay vòng nhiều key** cho cùng một provider (round-robin/least-used) thay vì chỉ 1
      account active tại một thời điểm.
- [ ] **Giới hạn tốc độ / quota** theo account hoặc theo profile (chặn/hàng đợi khi vượt ngưỡng).
- [ ] **Failover tự động**: chuyển sang account dự phòng khi account đang dùng lỗi liên tục.
- [ ] **Theo dõi chi phí** (ước tính token/cost) dựa trên metric đã có sẵn trong nhật ký.
- [ ] **Xuất/lọc nhật ký** (theo khoảng thời gian, provider, kết quả) thay vì chỉ xem 200 dòng
      gần nhất trong UI.
- [ ] Giảm phụ thuộc restart cho việc bật/tắt/đổi cổng (cần thay đổi cách OpenCode nhận cấu hình
      endpoint — hiện là giới hạn từ runtime, không phải từ thiết kế Gateway).

## 5. Giới hạn hiện tại

- Cần khởi động lại app để bật/tắt hoặc đổi cổng có hiệu lực với phiên chat đang chạy.
- Chỉ 1 account **active** cho mỗi profile tại một thời điểm — chưa xoay vòng/failover tự động.
- Host proxy không cho cấu hình (luôn `127.0.0.1`) — đây là lựa chọn bảo mật cố định, không phải
  hạng mục sẽ mở trong tương lai.

## 6. Bề mặt API (`/v1/gateway`)

| Method | Path | Việc làm |
|---|---|---|
| GET | `/status` | Trạng thái: accounts, `enabled`, `serverAddress` (đang chạy), `configuredPort` (đã lưu), `proxyAvailable` |
| POST | `/accounts` | Thêm account thủ công (nhập key riêng) |
| POST | `/accounts/link` | Liên kết 1 profile Cài đặt vào checklist (tick ô) |
| DELETE | `/accounts/{id}` | Bỏ liên kết/xoá account (phục hồi `baseUrl` thật trước khi xoá) |
| PUT | `/accounts/{id}/activate` | Chọn account đang dùng cho 1 provider (khi có nhiều account cùng provider) |
| PUT | `/enabled` | Bật/tắt công tắc tổng — từ chối BẬT nếu proxy không khả dụng |
| PUT | `/server-port` | Lưu cổng proxy mới (1024–65535), áp dụng từ lần khởi động sau |
| GET | `/logs` | Nhật ký request, mới nhất trước |

## 7. File & module liên quan

```text
service/src/gateway/
  types.ts             — GatewayAccount, GatewayStatus, log entry shape
  gateway-store.ts      — persist gateway.json (accounts, enabled, logs, serverPort)
  gateway-service.ts    — nghiệp vụ: link/remove/enable/resolveProxyUpstream/recordRequest
  gateway-router.ts     — /v1/gateway/* HTTP routes
  gateway-proxy-url.ts  — hằng số cổng mặc định + nhận diện "đây là địa chỉ Gateway" cho SSRF
  proxy-server.ts       — HTTP reverse proxy thật (byte-transparent, đo metrics)
  prompt-extract.ts     — parse model/prompt từ request body để ghi log

service/src/composition/compose-service.ts  — wire gatewayService + proxy vào composition root
app/ui/src/gateway-surface.ts               — UI tab Gateway (checklist, công tắc, cổng, nhật ký)
app/shell/src/main.ts                       — đọc cổng đã lưu TRƯỚC khi khởi tạo service
```
