---
task: "CGHC-007"
loop: "L6"
title: "Workspace boundary enforcement (W4/F4) — confine mọi file op vào workspace root"
language: "vi"
status: "implemented"
adr_refs: ["0003", "0008"]
requirement: "W4"
---

# CGHC-007 — Workspace boundary enforcement (W4/F4)

## 1. Đã xây dựng cái gì

Module confinement độc lập dưới `service/src/workspace/`, thực thi **tại execution boundary
(service)** chứ không phải UI. Đây là lớp bảo mật: mọi file op hạ nguồn phải đi qua nó để chắc chắn
path nằm trong workspace root đã grant. Không thêm dependency (chỉ `node:path`, `node:fs/promises`,
`node:crypto`). Pattern tham chiếu `normalizeWorkspaceRelativePath`/`resolveSafeChildPath` (design §5)
được **viết lại**, không copy từ OpenWork.

Cấu trúc (mỗi file cohesive, < 250 dòng; barrel cục bộ riêng — không sửa `service/src/index.ts`):

```
service/src/workspace/
  index.ts        # barrel cục bộ (seam duy nhất task này expose)
  grant.ts        # grantWorkspace(): validate + normalize root (W1/W4)
  guard.ts        # createWorkspaceGuard(): bề mặt confinement downstream gọi (resolve/assertInside/assertRealPathInside)
  path-safety.ts  # resolver thuần chuỗi, KHÔNG chạm đĩa: chặn .., absolute, UNC/device, drive-qualified
  realpath.ts     # lớp symlink-aware: fs.realpath + re-confine (create-case cho file chưa tồn tại)
  errors.ts       # WorkspaceBoundaryError / WorkspaceGrantError (mang PathRejectReason, message không lộ path)
  audit.ts        # WorkspaceAuditEvent + WorkspaceAuditSink (callback inject; ghi lại mọi refusal, P5)
service/tests/
  workspace-path-allowlist.test.ts   # path allowlist (positive)
  workspace-traversal.test.ts        # traversal negative (.., absolute, UNC, symlink) trên temp dir thật
```

Type dùng chung lấy từ `@cowork-ghc/contracts`: `WorkspaceGrant`, `WorkspaceId`, `PathValidation`,
`PathRejectReason` (không định nghĩa lại type — một nguồn sự thật).

## 2. Acceptance criteria → nơi thỏa mãn (code mapping)

**AC1 — Mọi file op resolve theo workspace root tại execution boundary; cung cấp `grantWorkspace`, một
path-safety resolver, và confinement check downstream gọi:**
- `grant.ts::grantWorkspace()` — biến folder user chọn thành `WorkspaceGrant` (root tuyệt đối, đã
  normalize `path.resolve`). Đây là **ranh giới confinement duy nhất**.
- `guard.ts::createWorkspaceGuard(grant)` — bề mặt mọi file op hạ nguồn gọi: `resolve()` (non-throwing),
  `resolveOrThrow()` (trả absolute an toàn), `assertInside()` (check path tuyệt đối đã cho), và
  `assertRealPathInside()` (realpath re-validation). Enforcement nằm ở service, không phải UI.
- `path-safety.ts::resolveWorkspacePath()` — resolver thuần chuỗi; containment `isInsideRoot()` là
  authoritative (so sánh có trailing separator + case-insensitive trên win32).

**AC2 — Input dùng `..`, absolute escape, UNC (`\\server\share`, `\\?\`), hoặc symlink escape bị từ chối
và được ghi lại:** xem mục 3 (từng vector) + `guard.ts::record()` phát `workspace_path_rejected` qua
`WorkspaceAuditSink` cho **mọi** refusal (reason code + input thô, không có path ngoài workspace, không
secret). Rejection typed: `WorkspaceBoundaryError` mang `reason: PathRejectReason`.

**AC3 — Test khẳng định không file nào ngoài workspace bị chạm (F4):**
`workspace-traversal.test.ts` tạo temp dir **thật** (`mkdtemp`) với một dir "outside" sibling chứa
`secret.txt` thật. Với mỗi vector escape: khẳng định refused + reason đúng, `resolvedPath` trả về **root
(boundary)** chứ không phải path ngoài (không leak), `resolveOrThrow` ném, refusal được ghi audit, và
`secret.txt` ngoài workspace **không đổi nội dung** + không bao giờ được trả về như real path hợp lệ.

**AC4 — OpenCode child root ở workspace đã grant; real-path re-validate trên MỖI proxied
tool-permission event (không escape qua tool call):**
- Seam: `guard.assertRealPathInside(input)` — (1) chạy lexical safety trước (chặn `..`/absolute/UNC
  trước khi chạm đĩa), (2) `realpath.ts::realPathInsideRoot()` canonicalize (giải symlink) rồi re-confine.
  Trả real path an toàn hoặc ném `symlink_escape`. CGHC-016/018 gọi hàm này với path đích của tool trên
  **mỗi** event. Có sẵn `guard.assertInside(realpath)` nếu caller đã tự realpath.
- `grantWorkspace().rootPath` là root mà supervisor (CGHC-004) sẽ dùng làm cwd của OpenCode child; task
  này định nghĩa + enforce logic confinement/realpath, wiring permission là CGHC-016/018.

## 3. Từng vector escape bị chặn thế nào

- **`..` (traversal):** `path-safety.ts::hasParentSegment()` tách theo cả `/` và `\` và bắt segment `..`
  → reason `traversal`. Phòng thủ tầng 2: sau `path.resolve`, `isInsideRoot()` vẫn bắt mọi escape còn sót.
- **Absolute escape:** `isAbsoluteOrDriveQualified()` = `path.isAbsolute(raw)` (bắt `/etc/passwd`,
  `C:\...`) **hoặc** `^[a-zA-Z]:` (bắt drive-qualified `C:secret.txt`) → reason `outside_workspace`.
  Input được kỳ vọng là **workspace-relative**; mọi input mang drive/absolute bị coi là escape.
- **UNC / device path:** `isUncOrDevicePath()` = `^[\\/]{2}` → bắt `\\server\share`, `//server/share`,
  `\\?\` (extended-length), `\\.\` (device) → reason `unc_path`. `grantWorkspace` cũng từ chối UNC/device
  làm **root** (không phải reason ở child).
- **Symlink escape:** thuần chuỗi không thấy được (`path.resolve` không chạm đĩa). `realpath.ts`
  `fs.realpath` cả root và candidate rồi `isInsideRoot(realRoot, realCandidate)`; nếu symlink/junction trỏ
  ra ngoài → `realPathInsideRoot` trả `undefined` → `guard` ném `symlink_escape` + ghi audit.
  `realpathAllowingMissing()` xử lý create-case: đi ngược lên ancestor tồn tại gần nhất, realpath nó (giải
  symlink ở prefix), rồi ghép lại phần đuôi chưa tồn tại — nên file mới trong workspace vẫn pass, còn
  symlink prefix ra ngoài vẫn bị bắt. Lỗi non-ENOENT được ném (không im lặng allow).

Chống prefix-collision: `${root}-evil` KHÔNG bị coi là inside `${root}` nhờ so sánh có `path.sep` đuôi
(test `a sibling directory sharing a name prefix`).

## 4. Test — lệnh chính xác + PASS thật

Lệnh (chạy trong `service/`):

```
node --import tsx --test "tests/workspace-*.test.ts"
```

Output thật (8 test):

```
✔ grantWorkspace normalizes an absolute root and rejects a relative one (5.5345ms)
✔ legitimate workspace-relative inputs resolve inside the root (2.5246ms)
✔ assertInside accepts an absolute path within the root and rejects one outside (1.3073ms)
✔ a sibling directory sharing a name prefix is NOT treated as inside (1.0485ms)
✔ assertRealPathInside allows a not-yet-existing file inside the workspace (create case) (3.3063ms)
✔ .., absolute, and UNC inputs are refused, recorded, and never resolve outside (12.6923ms)
✔ a symlink/junction escaping the workspace is refused by the realpath guard (6.4182ms)
✔ realPathInsideRoot returns the canonical path for a real file inside the workspace (5.3419ms)
ℹ tests 8
ℹ pass 8
ℹ fail 0
```

- **Nhánh symlink đã chạy:** trên host Windows này `fs.symlink(..., "junction")` tạo được **không cần
  quyền admin** → nhánh symlink/junction thật đã chạy (đã xác nhận riêng: "JUNCTION BRANCH RAN: created
  OK"). Test vẫn có nhánh fallback: nếu OS chặn tạo link, khẳng định `realPathInsideRoot(root, outsideFile)
  === undefined` (cùng guard) — luôn có ít nhất một đường chứng minh realpath guard.
- **Typecheck strict:** `tsc -b service/tsconfig.json` → `No errors found`, EXIT 0. Test + src cũng
  typecheck sạch dưới strict/noEmit (exactOptionalPropertyTypes, noUncheckedIndexedAccess,
  verbatimModuleSyntax) → EXIT 0.

Mapping test → acceptance:
- **path allowlist** (`workspace-path-allowlist.test.ts`): grant normalize + reject relative; input hợp lệ
  (nested subdir, `./`, backslash, spaces `My Projects (test)`, Unicode `thư mục/tệp.txt`) resolve đúng vào
  trong root; `assertInside` accept trong root / reject ngoài; prefix-collision bị chặn; create-case
  (`assertRealPathInside` cho file chưa tồn tại) pass. → AC1.
- **traversal negative** (`workspace-traversal.test.ts`): 8 vector `..`/absolute/drive/UNC/device bị refuse
  + reason đúng + không leak + audit đúng số lượng; symlink/junction escape → `symlink_escape`; secret
  ngoài workspace không đổi (F4). → AC2/AC3/AC4.

## 5. Seam realpath re-validation cho CGHC-016/018

- **Hàm:** `guard.assertRealPathInside(toolTargetPath): Promise<string>` — gọi trên **mỗi** proxied
  tool-permission event, trả real path an toàn hoặc ném `WorkspaceBoundaryError(symlink_escape|...)`.
- **Biến thể:** `guard.assertInside(realpath)` nếu permission layer đã tự `fs.realpath`; `realPathInsideRoot(root, abs)`
  (pure) nếu cần kiểm mà không cần guard.
- **Audit:** truyền `createWorkspaceGuard(grant, { audit })`; mọi refusal phát `workspace_path_rejected`
  (reason + input thô + stage `string|realpath`, không secret) — CGHC-016/018 nối sink này vào audit log
  local (P5).
- **Root của OpenCode child:** `grant.rootPath` là cwd mà supervisor (CGHC-004) dùng cho child; confinement
  không tin cwd của child mà luôn re-resolve theo `grant.rootPath`.

## 6. Assumptions

- `grantWorkspace` chỉ **validate + normalize root** (absolute, không UNC/device). **Không** kiểm tồn
  tại/is-directory/writable — đó là W3 / picker task **CGHC-008**. Ghi lại để CGHC-008 bổ sung.
- Input rỗng/whitespace map về **root** (inside boundary, `ok:true`) — confinement W4 chỉ quan tâm "có
  trong workspace không". Yêu cầu "phải trỏ tới file cụ thể" (không phải chính root) là mối quan tâm của
  files task **CGHC-016**, không thuộc W4.
- Null byte trong input → reject `traversal` (path-truncation injection). Path có **spaces/Unicode hợp
  lệ được chấp nhận** (không nhầm với null byte) — có test khẳng định.
- So sánh case-insensitive trên `win32` (`process.platform`); trên POSIX case-sensitive. Root canonical
  hoá bằng `path.resolve` (grant) + `fs.realpath` (lớp realpath) nên root symlink so sánh đúng.
- Junction (Windows) không cần elevation nên nhánh symlink thật chạy được trong CI/dev bình thường.

## 7. Open risks

- **Confinement chỉ đúng khi downstream THỰC SỰ đi qua guard.** Task này cung cấp + enforce logic; nếu
  CGHC-016 (files) hoặc CGHC-018 (permission) bỏ qua `assertRealPathInside`/`resolveOrThrow` và tự ghép
  path, confinement bị bypass. Carry-forward: mọi file op và mọi tool-permission event PHẢI qua guard.
- **TOCTOU (time-of-check/time-of-use):** `assertRealPathInside` realpath tại thời điểm check; nếu một
  symlink được đổi target giữa check và mở file thì vẫn có khe. Giảm thiểu ở downstream: mở bằng handle
  đã canonical / `O_NOFOLLOW`-tương đương, hoặc re-check ngay trước ghi. Ghi lại cho CGHC-016/018.
- **Junction vs symlink privilege:** nhánh symlink dựa vào junction trên Windows; nếu chạy trên môi
  trường chặn cả junction, chỉ nhánh fallback (crafted realpath) chạy — vẫn kiểm đúng guard nhưng không
  qua một junction thật. Đã tài liệu hoá.
- **Audit sink hiện là callback in-memory** (chưa nối audit log bền vững) — chủ đích để CGHC-016/018/021
  wiring; message lỗi đã không lộ path/secret nhưng scrubber value-based (SEC-2) là của task diagnostics.

## 8. Security review fix — HIGH đã đóng

Independent security review = CHANGES_REQUIRED với 1 HIGH; đã sửa và re-verify.

- **HIGH — `grant.ts` từ chối theo ký tự SPACE thay vì NUL byte (đã đóng).** Guard cũ
  `raw === "" || raw.includes(<space>)` thực tế chứa ký tự space `0x20` (không phải NUL byte như
  comment và như `path-safety.ts`). Hệ quả: (a) MỌI workspace root có dấu cách bị từ chối
  (`C:\Users\John Doe\...`, `C:\Program Files\...`, `My Documents`) → phần lớn user Windows không grant
  được workspace; (b) root chứa NUL byte thật lại KHÔNG bị chặn.
- **Cách sửa + chống tái diễn:** tập trung hoá kiểm NUL vào một định nghĩa duy nhất
  `path-safety.ts::hasNullByte()` dùng `String.fromCharCode(0)` — ký tự NUL **không bao giờ là literal
  vô hình nhúng trong source** (đây chính là nguyên nhân gốc khiến hai file phân kỳ). `grant.ts` và
  `resolveWorkspacePath` giờ cùng gọi `hasNullByte`. Đã quét toàn bộ `service/src/workspace/*.ts` khẳng
  định không còn ký tự control/NUL literal.
- **Test bổ sung (đã PASS):**
  - POSITIVE `grantWorkspace accepts a real absolute root containing spaces and Unicode` — tạo dir THẬT
    `…/John Doe/My Workspace (dự án)` bằng `mkdtemp`+`mkdir` (space + Unicode) rồi grant + resolve một
    child → chứng minh root có dấu cách được chấp nhận và dùng được. (Test cũ dùng `mkdtemp` cho path
    không dấu cách nên bỏ lọt bug.)
  - NEGATIVE `grantWorkspace rejects an empty root and a NUL-byte-bearing root` — `""`, whitespace-only,
    và root chèn `String.fromCharCode(0)` → `WorkspaceGrantError(not_absolute)`.
- **Re-run:** `node --import tsx --test "tests/workspace-*.test.ts"` → **10 pass / 0 fail**;
  `npx tsc -b service/tsconfig.json` → `No errors found`, EXIT 0. HIGH = CLOSED.

Output tail sau fix:

```
✔ grantWorkspace accepts a real absolute root containing spaces and Unicode (2.8001ms)
✔ grantWorkspace rejects an empty root and a NUL-byte-bearing root (1.0039ms)
...
ℹ tests 10
ℹ pass 10
ℹ fail 0
```

## 9. Hardening item bàn giao CGHC-016 (LOW — không block W4)

- **NTFS alternate-data-stream colon.** Input như `file.txt:evil` hiện được chấp nhận (resolve vào
  trong workspace như một ADS; **không phải** boundary escape — vẫn nằm trong root). Không thuộc phạm vi
  W4. Đề xuất cho files task **CGHC-016**: trên win32 từ chối `:` trong segment không phải drive-letter
  như defense-in-depth, để tránh ghi lén vào ADS của một file hợp lệ.

## 10. Gating conditions cho CGHC-016/018 (reviewer liệt kê — BẮT BUỘC)

- **Route MỌI tool target qua `assertRealPathInside`.** Confinement chỉ đúng khi downstream thực sự đi
  qua guard; không được tự ghép path rồi mở.
- **Mở file bằng canonical path mà guard trả về** (không mở lại từ input thô) để đóng khe **TOCTOU**
  giữa lúc check và lúc use; hoặc re-check ngay trước ghi.
- **Nối `WorkspaceAuditSink`** vào audit log local bền vững (P5) khi tạo guard.
- **cwd của OpenCode child = `grant.rootPath`, nhưng KHÔNG BAO GIỜ tin cwd của child.** Luôn re-resolve
  mọi path theo `grant.rootPath` phía service; child có thể `chdir` nên cwd của nó không phải nguồn tin cậy.

## 11. Boundaries đã tuân thủ

Chỉ tạo file dưới `service/src/workspace/` + `service/tests/workspace-*.test.ts` + evidence note này.
**Không** sửa `service/src/index.ts`, `service/package.json`, subfolder task khác, reference source, hay
`.loop-engineer/state/*.yaml`. Không thêm dependency (Node builtins). Không có live/paid call.
