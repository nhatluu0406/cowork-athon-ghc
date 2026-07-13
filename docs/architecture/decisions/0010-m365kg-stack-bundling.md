---
title: "Đóng gói M365 Knowledge Graph stack (PostgreSQL + Neo4j + backend + llm-svc) vào Cowork GHC"
document_type: "architecture-decision-record"
language: "vi"
status: "accepted"
---

# ADR 0010 — Đóng gói M365 Knowledge Graph stack vào Cowork GHC (đảo ngược REQ-205 D2)

- **Status**: Accepted — 2026-07-13, theo yêu cầu trực tiếp của Product Owner (DungPham).
- **Đảo ngược**: `specs/REQ-205-COWORK-001-m365-cowork-integration/spec.md` §1 Decision D2 ("M365KG
  backend stack runs externally; Cowork's service is a thin client, not a bundler") — quyết định
  gốc đã được chính DungPham sign-off ngày 2026-07-13 trong `IMPLEMENTATION_CHECKLIST.md`, nay
  được cùng người đảo ngược cùng ngày, ghi nhận rõ trong cả hai file đó và ADR này.
- **Liên quan**: ADR 0004 (Windows Process Lifecycle & Supervision — cơ chế supervision/kill được
  TÁI SỬ DỤNG nguyên vẹn cho các role mới, không phát minh cơ chế mới), ADR 0002 (shell =
  Electron), ADR 0003 (local service = loopback), REQ-204 (M365 Knowledge Graph gốc — source code
  không đổi).

## Context

REQ-205 D2 (gốc) chọn mô hình "external, thin-client": Postgres/Neo4j/Go backend/`llm-svc` tiếp
tục do người dùng tự khởi động (`docker-compose`, `go run`, `cargo run`), Cowork chỉ gọi REST API
tới backend. Lý do lúc đó: đây là POC Windows desktop, bundle thêm 2 database + 2 service native
vào installer "disproportionate" so với giá trị feature, và giữ đúng định vị "local-first,
lightweight".

Thực tế vận hành: end-user thật của Cowork GHC (nhân viên văn phòng dùng bản Windows đóng gói) **không
có khả năng và không nên phải** tự cài đặt, cấu hình, hay vận hành một cụm Postgres + Neo4j + Go
backend + Rust `llm-svc`. Với D2 gốc, feature M365 Knowledge trên thực tế **chỉ dùng được trong môi
trường dev/test** — không dùng được cho end-user sản phẩm thật, mâu thuẫn với mục tiêu ban đầu của
REQ-205 (đưa feature vào Cowork GHC cho người dùng cuối). Product Owner quyết định: đổi hướng, Cowork
tự cung cấp (provision) và tự quản lý (supervise) toàn bộ stack như một phần cài đặt/first-run của
sản phẩm, để feature dùng được ngay sau khi cài Cowork GHC, không cần bước thủ công nào từ người dùng.

## Decision

### 1. Binary portable, không cần installer, không cần Administrator

Dùng bản "portable ZIP" chính chủ của từng thành phần — **đã khảo sát thực tế nguồn tải** (không
đoán từ training data):

| Thành phần | Nguồn | Checksum vendor công bố? |
|---|---|---|
| PostgreSQL 16.14 Windows x64 zip | `sbp.enterprisedb.com/getfile.jsp?fileid=1260308` → redirect thật tới `get.enterprisedb.com/postgresql/postgresql-16.14-2-windows-x64-binaries.zip` (đã xác minh bằng `curl -I`, 325MB, `content-type: application/zip`) | **KHÔNG** — EDB không công bố SHA256/MD5 cho zip này (đã tra cứu, kể cả mailing-list than phiền từ thời PG10). Xem §Open items. |
| Neo4j Community Windows zip | `dist.neo4j.org/neo4j-community-<version>-windows.zip` + sibling `…zip.sha256` (đã xác minh: trả về đúng hex SHA256, ví dụ bản 5.26.4) | **CÓ** — tải sibling `.sha256` tươi mỗi lần provision, không hardcode. |
| Eclipse Temurin JRE 21 Windows x64 zip | Adoptium API `api.adoptium.net/v3/assets/latest/21/hotspot?image_type=jre&os=windows&architecture=x64` → JSON có `binary.package.link` + `binary.package.checksum` (SHA256 inline) | **CÓ** — trong JSON response, không cần đoán URL cố định. |

Không dùng installer hệ thống (EDB installer, Neo4j Desktop) — installer hệ thống cần quyền
Administrator và cài Windows service toàn máy, vi phạm `security.md`: *".bat files never require
Administrator unless proven necessary... never silently install system software."* Portable ZIP
giải nén vào app-data dir riêng của Cowork (không phải `%ProgramFiles%`), chạy bằng user hiện tại,
không cần elevation — nhất quán với ADR 0004 "No admin / packaging".

**Sửa so với bản nháp trước**: Neo4j 5.26.x yêu cầu **Java 21** theo trang cài đặt Windows chính
thức của Neo4j (không phải Java 17 như bản nháp đầu ghi nhầm) — dùng Temurin JRE **21**, không phải 17.

### 2. Provisioning tách biệt khỏi lifecycle

- **Provisioning** (lần đầu, hoặc khi thiếu): tải từng zip qua HTTPS từ nguồn chính chủ ở bảng trên.
  Với Neo4j và Temurin JRE: **verify SHA256** trước khi giải nén, lấy checksum tươi từ chính vendor
  mỗi lần (sibling `.sha256` / JSON API), không hardcode giá trị cũ có thể lỗi thời. Với PostgreSQL:
  **không có checksum vendor để verify** (xem bảng trên) — tải qua HTTPS (transport trust), ghi rõ
  trong log + docs rằng đây là mức đảm bảo THẤP HƠN Neo4j/JRE, không phải "verify SHA256" như 2 cái
  còn lại. Đây vẫn KHÔNG phải "unverified downloaded executable" theo nghĩa lén lút — có log tiến
  trình, người dùng thấy rõ Cowork đang chuẩn bị M365 Knowledge feature lần đầu — nhưng KHÔNG đạt
  mức "cryptographically verified" cho riêng PostgreSQL; đây là một giới hạn thật, ghi nhận ở
  §Open items, không che giấu.
- **Lifecycle** (mỗi lần chạy sau): chỉ start/stop process đã có sẵn cục bộ, không tải lại.

### 3. Lifecycle: mở rộng cây supervision ADR 0004, không phát minh cơ chế mới

Cây hiện tại (ADR 0004):
```
App Shell ──► Local Service ──► OpenCode runtime
```
Mở rộng bằng một **nhánh song song mới**, cùng Local Service làm gốc:
```
App Shell ──► Local Service ──┬─► OpenCode runtime            (không đổi)
                               └─► M365KG Stack Supervisor ──┬─► PostgreSQL
                                                              ├─► Neo4j
                                                              ├─► M365KG backend (Go)
                                                              └─► llm-svc (Rust)
```
`M365KG Stack Supervisor` là **một owner mới**, sở hữu đúng 4 process con này — không đụng, không
chia sẻ owner với cây OpenCode hiện có (giữ đúng "one owner per child-process lifecycle").
Tái sử dụng **nguyên vẹn** cơ chế ADR 0004 đã có:
- `.runtime/pids/<role>.json` schema (thêm 4 role: `m365kg-postgres`, `m365kg-neo4j`,
  `m365kg-backend`, `m365kg-llmsvc`).
- Identity = `{ pid, startedAt, exePath, port }`, re-verify trước khi kill — không kill theo tên
  process chung (không `taskkill /IM postgres.exe` tràn lan).
- Graceful-then-force stop: gọi shutdown API/graceful trước (Postgres: `pg_ctl stop -m fast`; Neo4j:
  lệnh `neo4j stop`; backend/llm-svc: HTTP/graceful nếu có, không thì SIGTERM tương đương Windows),
  sau đó `taskkill /PID <pid> /T /F` nếu còn sống sau timeout.
- Port: Supervisor tự chọn cổng trống khi khởi động (giống cách runtime hiện tại assign port cho
  OpenCode) thay vì cố định 5432/7687 — tránh đụng service khác đã chạy sẵn trên máy người dùng.

### 4. Rà soát license (kỹ thuật, không phải ý kiến pháp lý cuối cùng)

- **PostgreSQL License**: giấy phép rất permissive (tương tự MIT/BSD), cho phép đóng gói/phân phối
  lại tự do, chỉ cần giữ nguyên copyright notice. Không có rào cản.
- **Neo4j Community Edition — ⚠️ license CHƯA xác định chắc chắn, rủi ro cao hơn bản nháp đầu ghi
  nhận**. Khảo sát cho thấy tình trạng KHÔNG rõ ràng như "GPLv3 đơn giản": có nguồn cho thấy các bản
  Neo4j Community gần đây dùng **AGPLv3 kèm điều khoản bổ sung** giới hạn việc cung cấp dịch vụ "mà
  giá trị chính đến từ Neo4j Community" mà không có thoả thuận thương mại riêng — điều khoản này
  hướng tới nhà cung cấp cloud nhưng câu chữ khá rộng, CHƯA khảo sát được rõ nó có áp dụng cho việc
  Cowork đóng gói Neo4j như một child process nội bộ (không bán lại "Neo4j as a service") hay không.
  **Hành động bắt buộc trước khi merge/release, không phải optional**: đọc trực tiếp file `LICENSE`/
  `NOTICE` đóng kèm trong chính bản zip 5.26.x sẽ tải (không suy luận từ trang web), và có xác nhận
  pháp lý/PO trước khi bundle chính thức. Giả định kỹ thuật ban đầu của ADR này (mere aggregation
  → an toàn) áp dụng ĐÚNG với GPLv3 thuần, nhưng **có thể không đủ** nếu văn bản thật là AGPLv3 +
  additional terms — AGPLv3 mở rộng phạm vi "distribution" sang cả việc cung cấp qua network, và
  "additional terms" có thể đặt điều kiện Cowork chưa lường hết. Đây là **Open item chặn GA**, không
  chỉ là lưu ý.

### 5. Kích thước & tài nguyên

Cài đặt/first-run tăng đáng kể (Postgres portable ~100–150MB, Neo4j + JRE ~200–300MB). Đổi lại:
người dùng không cần cài gì thủ công, feature hoạt động ngay sau khi mở Cowork GHC lần đầu.

## Consequences

- **Positive**: feature M365 Knowledge dùng được ngay với end-user thật, không cần bước vận hành
  thủ công nào; tái dùng cơ chế supervision đã kiểm chứng (ADR 0004), không phát minh lại.
- **Negative**: cài đặt/first-run lớn hơn nhiều; thêm 4 process con cần quản lý (thêm bề mặt lỗi:
  hết dung lượng đĩa, đụng cổng, antivirus/SmartScreen cảnh báo khi tải file lạ lần đầu); JVM
  (Neo4j) tốn RAM đáng kể trên máy yếu; cần rà soát license/pháp lý trước GA (xem Open items).
- Không đổi source code `app/backend`/`app/llm-svc` (REQ-204) — chỉ đóng gói **binary đã build
  sẵn**, giữ đúng ràng buộc "No M365KG file changes" ở tầng source.

## Alternatives considered

- **Giữ nguyên D2 gốc (external, thin-client)** — bị bác: end-user thật không tự vận hành được
  4 service, feature thực chất không dùng được ngoài môi trường dev.
- **Dùng installer hệ thống (EDB Postgres installer, Neo4j Desktop)** — bị bác: cần Administrator,
  cài Windows service toàn máy, vi phạm rule `.bat` không cần admin (`security.md`).
- **Bundle Docker Desktop cùng sản phẩm** — bị bác: Docker Desktop có điều khoản license riêng cho
  dùng thương mại (Business/Enterprise), vẫn cần người dùng tự cài Docker + bật Hyper-V/WSL2 trước
  — ngược hẳn mục tiêu "không cần end-user cài gì".
- **Thay Postgres/Neo4j bằng SQLite/embedded graph** — ngoài phạm vi ADR này: đổi toàn bộ data
  layer của REQ-204 (Go backend) là một quyết định kiến trúc lớn hơn hẳn "đóng gói lại binary sẵn
  có"; để lại làm ADR riêng nếu PO muốn theo hướng đó.

## Requirements traceability

| Yêu cầu | ADR này giải quyết thế nào |
|---|---|
| REQ-205 D2 (đảo ngược) | §Decision 1–3: bundle 4 service làm child process, tự provision + tự supervise |
| `architecture.md` "one owner per child-process lifecycle" | §Decision 3: supervisor mới sở hữu đúng 4 con, không đụng cây OpenCode hiện tại |
| `security.md` ".bat never requires Administrator... never silently install system software" | §Decision 1–2: portable ZIP, verify checksum trước khi chạy, không cần admin, có log tiến trình |
| `coding.md` "Check license and maintenance" | §Decision 4: rà soát PostgreSQL License (permissive) + Neo4j Community (GPLv3, mere aggregation) |
| "No M365KG file changes" (REQ-205 checklist) | §Consequences: chỉ đóng gói binary đã build, không sửa source `app/backend`/`app/llm-svc` |

## Open items

- **[CHẶN GA] Xác định chính xác license Neo4j Community 5.26.x** bằng cách đọc file `LICENSE`/
  `NOTICE` thật trong zip sẽ tải, không suy luận — nếu là AGPLv3 + additional terms, cần xác nhận
  pháp lý riêng rằng cách Cowork đóng gói (child process nội bộ, không bán lại như dịch vụ) không
  vi phạm điều khoản bổ sung, trước khi bundle vào bản GA. §Decision 4 đã nâng mức rủi ro so với
  bản nháp đầu (từng ghi nhầm là GPLv3 đơn giản).
- **PostgreSQL Windows zip không có checksum vendor** (§Decision 1–2) — mức đảm bảo chỉ là HTTPS
  transport trust, thấp hơn Neo4j/JRE. Cần quyết định: chấp nhận mức này, hoặc tìm nguồn khác có
  công bố checksum, trước khi coi provisioning là "verified download" đầy đủ cho cả 3 thành phần.
- Cơ chế tải: bundle sẵn trong installer (installer lớn, dùng được offline ngay) vs tải ở first-run
  (installer nhỏ, cần mạng lần đầu) — §Decision 2 hiện chọn tải ở first-run; PO có thể đảo lại nếu
  ưu tiên offline-first.
- Chưa benchmark RAM/CPU thật của Neo4j (JVM, giờ cần Java 21) trên cấu hình máy end-user yếu — cần
  đo trong vòng lặp tiếp theo trước khi commit vào release checklist.
- Cổng mặc định tự chọn (§Decision 3) cần một cơ chế lưu lại cổng đã chọn cho lần khởi động sau
  (giống cách OpenCode runtime hiện tại làm) — chưa có trong ADR này, để phần thiết kế module.
