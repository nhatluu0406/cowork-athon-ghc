---
language: "vi"
status: "active"
updated_at: "2026-07-14"
---

# Yêu cầu Azure App Registration cho Cowork GHC

## Mục đích

Cowork GHC (ứng dụng desktop Windows) cần một Azure app registration để người dùng có thể đăng nhập vào Microsoft 365 bằng device-code flow (delegated — thay mặt người dùng). Công nghệ này phục vụ các tác vụ SharePoint và các dịch vụ Microsoft 365 khác.

## Loại ứng dụng

**Public client** — không sử dụng client secret. Ứng dụng desktop bản thân không có khả năng lưu trữ secret một cách an toàn.

## Cấu hình platform

1. Vào **Authentication** → **Add a platform**
2. Chọn **Mobile and desktop applications**
3. Redirect URI (không bắt buộc cho device-code flow):
   - Có thể để trống hoặc để giá trị mặc định `https://login.microsoftonline.com/common/oauth2/nativeclient`

## Bắt buộc: Cho phép public client flows

Trong **Authentication** → **Advanced settings**, tìm **Allow public client flows** và chuyển sang **Yes**.

Thiết lập này bắt buộc — nếu không, device-code flow sẽ bị chặn.

## Quyền API (Microsoft Graph)

### Slice hiện tại (cần được cấp ngay)

Thêm các delegated permissions sau (NOT application permissions):

- `User.Read` — đọc thông tin hồ sơ người dùng
- `Sites.Read.All` — đọc SharePoint sites
- `Files.ReadWrite.All` — đọc và ghi file trong SharePoint

### Danh sách mở rộng (cho các dịch vụ sau)

Chuẩn bị sẵn để cấp khi cần:

- `Mail.ReadWrite` — đọc và ghi email
- `Mail.Send` — gửi email
- `Calendars.ReadWrite` — quản lý lịch
- `Tasks.ReadWrite` — quản lý tác vụ
- `ChannelMessage.Send` — gửi tin nhắn vào Teams channels
- `offline_access` — giữ phiên đăng nhập khi người dùng không online

## Admin consent

Nếu Azure tenant yêu cầu admin consent:

1. Người quản trị tenant vào app registration
2. Chọn **API permissions**
3. Bấm **Grant admin consent for [Tenant Name]**

Để cho phép người dùng thường xuyên đăng nhập mà không cần admin mỗi lần.

## Trả về cho team

Sau khi app registration hoàn tất, cung cấp cho team:

- **Application (client) ID** — đặt vào biến môi trường `CGHC_MS365_CLIENT_ID`
- **Directory (tenant) ID** — đặt vào biến môi trường `CGHC_MS365_TENANT`

Hai giá trị này được thêm vào file cấu hình runtime của Cowork GHC.

## Ghi chú bảo mật

- **Token storage**: Access tokens được lưu trong Windows Credential Manager (OS-backed secure store), không nằm trong browser local storage, UI state, hay file log.
- **Permission enforcement**: Mọi hành động ghi (upload file, gửi email, v.v.) đều phải qua màn hình phê duyệt (permission modal) trong giao diện Cowork GHC. Người dùng có thể từ chối từng hành động.
- **Network boundary**: Connector chỉ gọi đến `graph.microsoft.com` (Microsoft Graph API) và `login.microsoftonline.com` (Azure authentication). Không có kết nối ngoài ra những endpoint này.

---

## Mẫu email gửi IT

Nếu cần, bạn có thể sử dụng mẫu dưới đây:

---

**Tiêu đề:** Yêu cầu tạo Azure App Registration cho Cowork GHC

**Nội dung:**

Chào [Tên admin],

Cowork GHC (ứng dụng desktop Windows của team) cần một Azure app registration để user có thể đăng nhập Microsoft 365 qua device-code flow.

Vui lòng tạo app registration theo chi tiết tại `docs/integration/ms365-it-request.md`.

Sau khi hoàn tất, vui lòng cung cấp:
- Application (client) ID
- Directory (tenant) ID

Cảm ơn,
[Tên bạn]

---
