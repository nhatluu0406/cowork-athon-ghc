---
title: "CGHC-003 — Shared core/contracts package + import-direction boundary lint"
document_type: "evidence"
language: "vi"
loop: "L6"
task: "CGHC-003"
promoted_from: "CGHC-ARCH-001"
status: "implemented"
date: "2026-07-11"
---

# CGHC-003 — `core/contracts` (shared types) + rule import-direction có kiểm tra

> Đóng gap **invariant #12** (PARTIAL) trong `.loop-engineer/evidence/L4/web-readiness-delta.md`:
> thiếu **package** `core/contracts` tường minh và **rule import-direction** có enforcement. Task chỉ
> **định nghĩa boundary/type**, không redesign L4, không build web. Kiến trúc L4 giữ `COMPLETED`.

## 1. Đã xây dựng gì

Package mới `@cowork-ghc/contracts` (private, `type: module`, **không runtime dependency**, không
Electron, không Node-only API) — nguồn duy nhất của các type dùng chung mà cả `app/ui` và web surface
tương lai import. Chia theo domain, mỗi file cohesive và < 250 dòng.

Files tạo mới:

- `core/contracts/package.json` — name `@cowork-ghc/contracts`, script `test` chạy
  `node --import tsx --test`, `typecheck` chạy `tsc -b`. `exports` mở `.` (barrel) và `./boundary`.
- `core/contracts/tsconfig.json` — kế thừa `../../tsconfig.base.json` (TypeScript **strict**),
  `composite`, include `src`/`boundary`/`test`, **exclude `test/fixtures/**`** (fixtures có import cố
  ý sai/không resolve, không được đưa vào typecheck).
- `core/contracts/src/refs.ts` — `ModelRef`, `CredentialRef` (chỉ handle/ref).
- `core/contracts/src/ev.ts` — EV event model + terminal-state set.
- `core/contracts/src/permission.ts` — permission request/decision + approval level.
- `core/contracts/src/provider.ts` — provider types (neutral).
- `core/contracts/src/workspace.ts` — workspace types.
- `core/contracts/src/session.ts` — session types.
- `core/contracts/src/index.ts` — barrel (`export *`).
- `core/contracts/boundary/import-direction.ts` — rule lint import-direction (module dùng lại được).
- `core/contracts/test/import-direction.test.ts` — test node:test cho rule.
- `core/contracts/test/fixtures/good/app/ui/renderer.ts` — fixture hướng ĐÚNG (import contracts + service).
- `core/contracts/test/fixtures/bad/app/ui/renderer.ts` — fixture hướng SAI (import `electron`,
  `@cowork-ghc/shell`, `app/shell/...`) — dùng để chứng minh rule bắt được vi phạm.

## 2. Acceptance → nơi thỏa mãn

**AC1 — package giữ SHARED types cho cả `app/ui` và web tương lai.** Đủ 6 nhóm, pure TS/enum, không
runtime dep:

| Nhóm type | File | Điểm khớp design/ADR |
|---|---|---|
| EV event model + terminal-state set `completed`/`errored`/`cancelled`/`denied` | `src/ev.ts` | design §11 (dòng 126-131), ADR 0003:95-98, VS-05 (master plan 99-104). Có `TerminalState`, hằng runtime `TERMINAL_STATES`, guard `isTerminalState`, union `EvEvent` (EV1 plan, EV2 step, EV3 tool_call, EV4 file_mutation, S2 token, EV5 progress, EV6 error+recovery, EV7 terminal) |
| Provider types | `src/provider.ts` | ADR 0005 (`ProviderDescriptor`, `TestResult`, `ProviderError`+`ProviderErrorKind` PR7, `ModelSelection` PR4/PR5, `KNOWN_PROVIDER_IDS` PR10). **Không** export type mang plaintext secret — value-bearing redaction pattern để service-private (CGHC-021/022) |
| Permission types (request/decision Allow/Deny + approval level) | `src/permission.ts` | P1–P7; `PermissionRequest`, `PermissionDecision` = `allow`/`deny`, `ApprovalLevel` = `standard`/`elevated` (P4), `PermissionScope` once/always (research FR-010), `PermissionReply` |
| Workspace types | `src/workspace.ts` | W1/W3/W4/F4; `WorkspaceGrant`, `WorkspaceRef`, `PathValidation` |
| Session types | `src/session.ts` | S1–S6; `SessionMeta`, `SessionStatus` honest (S6), `SessionSnapshot` cho resync |
| `CredentialRef` / `ModelRef` (chỉ ref/handle) | `src/refs.ts` | ADR 0005:48-49, ADR 0006. **Không có type nào mang key bytes** (PR9/SEC-1) |

**AC2 — rule import-direction có enforcement.** `boundary/import-direction.ts` +
`test/import-direction.test.ts`. Rule mặc định `UI_AND_WEB_MUST_NOT_IMPORT_SHELL`: file thuộc
`app/ui`/`app/web`/`apps/web` **không được** import `electron`, `@cowork-ghc/shell`, hay đường dẫn
vào `app/shell`. Chi tiết cơ chế ở mục 4. Chạy được cả khi `app/` chưa tồn tại (quét text, chỉ soi
file có path bị rule governance; cây hiện tại → 0 vi phạm).

**AC3 — chỉ định nghĩa boundary/type.** Không đụng `runtime/`, `service/`, `app/`, không sửa state
YAML, không kéo Electron/web build. Type khớp cái mà CGHC-002/012/016/009/010 sẽ tiêu thụ (mục 5) nên
load-bearing, không speculative. Không thêm seam thừa: rule lint là 1 module + 1 test, không framework.

## 3. Mapping type → downstream task tiêu thụ

- `src/ev.ts` (EV event model, terminal-state) → **CGHC-012** (EV contract + map OpenCode SSE→EV),
  **CGHC-014/015** (EV timeline UI), event reducer/state machine (testing.md).
- `src/permission.ts` → **CGHC-016** (enforce Deny + explicit deny reply), **CGHC-017** (modal Allow/Deny).
- `src/provider.ts` + `src/refs.ts` (`ProviderDescriptor`/`ProviderError`/`ModelRef`/`CredentialRef`)
  → **CGHC-009/010** (ProviderPort + credential), **CGHC-019/020** (model config/switch + provider
  error). Value-bearing redaction pattern (PR8/SD3) **không** ở đây — CGHC-021/022 tự định nghĩa
  service-private (xem HIGH-1 mục 8).
- `src/session.ts` (`SessionMeta`/`SessionStatus`/`SESSION_STATUSES`/`terminalStateToSessionStatus`/
  `sessionStatusForTerminal`) → **CGHC-012/013/014/015** (session lifecycle + resync + map terminal
  EV → session status).
- `src/workspace.ts` → surface workspace grant/validate (VS-02, CGHC-006 nhóm workspace) + UI picker.
- `boundary/import-direction.ts` → gate dùng lại được cho **CGHC-002** (boundary) và mọi task UI/web
  (VS-06+, W-loops tương lai) để bảo vệ hướng import.

## 4. Rule import-direction hoạt động thế nào + bằng chứng bắt vi phạm

Cơ chế (text-level scan, không cần TypeScript program):

1. `scanImportDirection(root, opts)` duyệt đệ quy `root`, bỏ qua `node_modules`/`.git`/`dist`/
   `.runtime` (và `ignore` truyền thêm), lấy file theo extension (`.ts/.tsx/.mts/.cts/.js/...`).
2. Với mỗi file, tính path POSIX tương đối; chỉ xét các rule mà `appliesTo` match path đó (nên nếu
   `app/` chưa tồn tại → không file nào bị governance → 0 vi phạm).
3. Trích mọi import specifier bằng regex (bắt `import … from`, `export … from`, `import()`,
   `require()`, và side-effect `import "x"`).
4. Nếu specifier match `forbiddenImport` của rule → sinh `BoundaryViolation` (rule, file, specifier, reason).

Rule mặc định: `appliesTo = /(^|\/)(app\/ui|app\/web|apps\/web)\//`,
`forbiddenImport = /(^electron(\/|$)|@cowork-ghc\/shell|(^|\/)app\/shell(\/|$))/`.

**Chứng minh cả hai chiều của assertion** (3 test):

- Test 1 — quét **cây repo thật** (exclude `test/fixtures/`) → **0 vi phạm** (pass trên tree hiện tại).
  Exclude chỉ bỏ fixtures; một import `app/ui → app/shell` thật ở bất kỳ chỗ nào khác vẫn bị bắt.
- Test 2 — quét fixture `good` (app/ui import contracts + service client) → **0 vi phạm** (hướng đúng
  không bị false-positive).
- Test 3 — quét fixture `bad` (app/ui import `electron`, `@cowork-ghc/shell`, `../../../app/shell/...`)
  → **>= 1 vi phạm**, đúng 3 specifier bị bắt, rule = `ui-and-web-must-not-import-shell`, file khớp
  `app/ui/renderer.ts`. Đây là bằng chứng rule THỰC SỰ FAIL trên hướng sai.

## 5. Lệnh test + output PASS thật

Lệnh (chạy trong `core/contracts/`):

```
node --import tsx --test "test/**/*.test.ts"
```

Output thật (tail) — sau review fixes:

```
✔ boundary lint passes on the current repository tree (85.8677ms)
✔ boundary lint passes on the allowed-direction fixture (2.8602ms)
✔ boundary lint catches the planted app/ui -> app/shell violations (2.7654ms)
✔ boundary lint catches multi-line forbidden imports (1.8854ms)
✔ terminalStateToSessionStatus covers every TerminalState with a valid SessionStatus (0.5747ms)
✔ SessionStatus vocabulary is aligned with TerminalState tokens (0.0964ms)
ℹ tests 6
ℹ pass 6
ℹ fail 0
ℹ duration_ms 585.9852
```

Typecheck strict (`npx tsc -b` trong `core/contracts/`): `TypeScript: No errors found` (exit 0).
Artifact build (`dist/`, `tsconfig.tsbuildinfo`) đã được dọn sau khi verify.

## 6. Giả định (assumptions)

- **`npm install` ở root chạy được** dù `service`/`runtime`/`app/*` chưa tồn tại — npm workspaces bỏ
  qua workspace thiếu; đã xác nhận exit 0, thêm 9 package (tsx/typescript/esbuild).
- **Field name của `ModelRef`/`CredentialRef` bám sát ADR 0005:48-49**: `providerID`/`modelID`,
  `store: "os"`/`account`. Giữ nguyên để khớp contract đã freeze (không "chuẩn hóa" thành `providerId`).
- **`SessionStatus` bám sát token của `TerminalState`** (`completed`/`errored`/`cancelled`/`denied`) và
  thêm `runtime_down` tách khỏi `errored` (khớp scope acceptance dòng 194) để UI chọn recovery
  restart-runtime thay vì retry task. Mapping terminal EV → session status là duy nhất và exhaustive
  (`terminalStateToSessionStatus`, guard `satisfies Record<TerminalState, SessionStatus>`).
- **`PermissionScope` once/always** đưa vào theo research FR-010 (Allow once/Allow always) như thông
  tin tùy chọn cho allow; quyết định lõi vẫn là Allow/Deny + approval level đúng như task.
- **Vị trí web surface tương lai chưa chốt**: rule govern `app/ui`, `app/web`, `apps/web`. Khi web
  activate (sau L9/PASS) chỉ cần bổ sung path vào `appliesTo` — không đổi cấu trúc rule.
- **Export barrel trỏ tới `./src/*.ts`** (dev qua tsx). Bản build JS cho packaging do task đóng gói xử lý.

## 7. Rủi ro mở (open risks)

- **Lint theo regex text, không phải AST**: đã xử lý multi-line (HIGH-2: matcher dùng `[^;]*?`, có
  fixture + test riêng chứng minh; `import()`/`require()` multi-line cũng được phủ). Vẫn còn giới hạn
  với import "bị làm mờ" (vd `require("elec" + "tron")`, hằng đường dẫn ghép chuỗi) có thể lọt. Chấp
  nhận cho POC (đúng phạm vi "boundary lint nhẹ", không over-engineer); nếu cần chặt hơn, nâng lên
  phân tích AST/`ts-morph` trong một task sau — ghi nhận, không làm bây giờ.
- **`forbiddenImport` dựa trên tên package/đường dẫn quy ước** (`@cowork-ghc/shell`, `app/shell`,
  `electron`). Nếu shell package đặt tên khác khi CGHC tạo `app/shell`, phải cập nhật regex. Đã chọn
  tên `@cowork-ghc/shell` nhất quán với `@cowork-ghc/contracts`.
- **Rule chưa được nối vào CI/`npm test` root**: hiện là test của riêng package `core/contracts`
  (`node --import tsx --test`). Việc gắn vào một lệnh lint chung ở root là việc của task CI/boundary
  (CGHC-002) — không thuộc phạm vi CGHC-003, chỉ nêu để bàn giao.
- **Root `tsconfig.json` reference `service`/`runtime` chưa tồn tại** → `tsc -b` ở ROOT sẽ lỗi cho tới
  khi các task đó tạo package. Không thuộc phạm vi task này; `tsc -b` trong `core/contracts/` sạch.

## 8. Review fixes (CHANGES_REQUIRED → đã sửa)

- **HIGH-1 — type mang secret trong barrel dùng cho UI/web.** Đã **XÓA hoàn toàn** `RedactPattern`
  (`{ value: string }`) khỏi `src/provider.ts` và khỏi barrel `src/index.ts` (option (a)). Barrel
  không còn type nào mang plaintext secret; chỉ còn ref/handle (`CredentialRef`/`ModelRef`). Scrubber
  chạy ở service/logging boundary (CGHC-021/022) sẽ tự định nghĩa type value-bearing service-private.
  Không consumer nào trong `core/contracts` cần ref shape nên không thêm `RedactPatternRef`. **Closed.**
- **HIGH-2 — lint bỏ sót multi-line import (false green).** Đã đổi matcher `[^;\n]*?` → `[^;]*?`
  (newline-tolerant, vẫn non-greedy, vẫn được neo bởi `from "..."`); `import()`/`require()` dùng `\s*`
  nên đã span newline. Thêm fixture `test/fixtures/bad/app/ui/renderer-multiline.ts` (named import
  electron multi-line + `import(...)` multi-line + `require(...)` multi-line) và test
  `boundary lint catches multi-line forbidden imports` assert đủ 3 specifier bị bắt trong đúng file
  multi-line. **Closed.**
- **MEDIUM-1 — SessionStatus vs TerminalState lệch token.** Đã đổi `error` → `errored`, thêm `denied`
  vào `SessionStatus`; đổi sang list runtime `SESSION_STATUSES` + type derive. Thêm mapping duy nhất
  `terminalStateToSessionStatus` với guard `satisfies Record<TerminalState, SessionStatus>`
  (exhaustiveness ở compile-time) + helper `sessionStatusForTerminal`. Thêm test
  `test/session-status.test.ts` (mọi `TerminalState` map tới `SessionStatus` hợp lệ + không tái diễn
  drift token). **Closed.**
- **LOW-1 — câu chữ purity.** Đã siết doc barrel `src/index.ts`: guarantee "no Node-only APIs" chỉ áp
  dụng cho barrel `.`; entry `./boundary` là Node-only dev/lint tool (dùng `node:fs`/`node:path`),
  không dành cho UI/web bundle. **Fixed.**
- **LOW-2 (exports → dist)** — defer cho CGHC-028, không hành động (đúng chỉ dẫn review).

Sau khi sửa: `node --import tsx --test "test/**/*.test.ts"` → **6 pass / 0 fail**; `npx tsc -b` (strict)
→ `No errors found`. Mọi thay đổi chỉ trong `core/contracts/` + evidence note này.
