---
task: CGHC-028
title: "Sửa lỗi packaged app không khởi động (ESM/CJS entry) + regression hardening"
language: "vi"
status: FIXED
created_at: "2026-07-12"
---

# CGHC-028 — Bằng chứng sửa lỗi packaged app không khởi động

**Trạng thái: FIXED (đã review độc lập, 0 Critical/High).** Người dùng báo `dist-app/win-unpacked/
Cowork GHC.exe` báo lỗi khi chạy. Báo cáo đúng — và nó phơi bày một lỗi THẬT mà đợt verify trước đã
BỎ SÓT. Đây là đính chính cho tuyên bố "boot smoke STAYED_ALIVE = PASS-grade" trong
[CGHC-028-release-verification.md](CGHC-028-release-verification.md) (xem mục "Đính chính").

## Triệu chứng người dùng gặp (đã tái hiện)
Chạy exe → hiện hộp thoại **"Error"** native (class `#32770`), KHÔNG có cửa sổ ứng dụng. Đọc nội dung
hộp thoại bằng UI Automation:

```
A JavaScript error occurred in the main process
Uncaught Exception:
ReferenceError: require is not defined in ES module scope, you can use import instead
This file is being treated as an ES module because it has a '.js' file extension and
'...app.asar\app\shell\package.json' contains "type": "module".
    at .../app.asar/app/shell/dist/main.js:1:31
```

## Root cause
Electron main là một bundle **CommonJS** (esbuild `format: "cjs"`, dùng `require`), nhưng
`app/shell/package.json` khai báo `"type": "module"` → Electron nạp `dist/main.js` như **ESM** →
`require` ở dòng 1 (shim `import.meta.url`) ném `ReferenceError`. Main process không bao giờ tạo cửa sổ;
chỉ hiện hộp thoại lỗi modal.

**Vì sao verify trước bỏ sót:** app packaged là binary **Windows GUI-subsystem** → tách khỏi console,
nên stdout/stderr redirect luôn RỖNG. "Boot smoke STAYED_ALIVE + stderr rỗng" là **FALSE POSITIVE**:
process sống chỉ vì hộp thoại lỗi modal giữ nó lại, không phải vì app khởi động thành công. Bài học:
STAYED_ALIVE ≠ cửa sổ render. Verify đúng phải kiểm tra cửa sổ/renderer thực (CDP hoặc liệt kê window).

## Cách sửa (self-documenting, đúng khuyến nghị của Node)
1. `app/shell/scripts/main-bundle.mjs`: output `dist/main.js` → **`dist/main.cjs`**. Đuôi `.cjs` ép
   CommonJS bất kể `"type": "module"`.
2. `app/shell/scripts/preload-bundle.mjs`: `dist/preload.js` → **`dist/preload.cjs`**.
3. `app/shell/src/create-window.ts`: `PRELOAD_PATH` → `preload.cjs`.
4. `app/shell/package.json`: `main` + `start:electron` → `./dist/main.cjs`.
5. `package.json` (root): thêm `"main": "app/shell/dist/main.cjs"`.
6. `app/shell/electron-builder.yml`: **BỎ khối `extraMetadata.main`**. Lý do: inject extraMetadata làm
   electron-builder ghi đè tại chỗ root `package.json` nguồn (xoá `scripts`, thêm `main`), và bước
   restore async KHÔNG tin cậy dưới `--dir` → làm hỏng working tree. Đặt `main` thẳng trong manifest
   nguồn → electron-builder không có gì để inject → không đụng vào `package.json` đã commit. (Đã xác nhận
   hai lần: sau khi bỏ extraMetadata, chạy package xong `scripts` vẫn nguyên, `main` vẫn đúng.)
7. `app/shell/src/security/csp.ts` + `app/ui/index.html`: bỏ nguồn `http://[::1]:*` / `ws://[::1]:*`
   khỏi `connect-src`. Chromium từ chối IPv6-literal có wildcard port → lỗi console mỗi lần khởi động;
   service bind IPv4 `127.0.0.1` (`server.listen(0, "127.0.0.1")`) nên `[::1]` chỉ là nhiễu.

## Review độc lập (reviewer ≠ implementer) → PASS, 0 Critical/High
- **Medium-1 (đã sửa):** cây ESM chưa bundle (`main.js`/`preload.js`/`create-window.js`/...) do `tsc -b`
  emit VẪN bị đóng vào asar cạnh bundle — chính file `main.js` gây crash nằm ngay cạnh entry. Sửa: thêm
  glob `!app/shell/dist/**/*.js` → asar CHỈ ship `.cjs` từ shell (đã xác nhận: `app/shell/dist/` trong
  asar chỉ còn `main.cjs` + `preload.cjs`; `.js` Vite của renderer trong `app/ui/dist/` được giữ). Loại
  bỏ đúng artifact hỏng khỏi bản đóng gói → chặn regression âm thầm nếu entry bị trỏ nhầm về sau.
- **Low-3 (đã sửa):** `csp.test.ts` giờ assert `[::1]` KHÔNG xuất hiện trong `connect-src` (regex bỏ
  `[::1]` khỏi danh sách hợp lệ) → chặn tái xuất hiện nguồn không hợp lệ.
- **Low-4 (đã sửa):** comment `main-bundle.mjs` "main.js" → "main.cjs".
- **Low-2 (carry-forward, có sẵn, vô hại hôm nay):** `<meta>` CSP thiếu `ws://` trong khi header
  (`csp.ts`) có `ws://127.0.0.1:* ws://localhost:*`. Trình duyệt enforce GIAO của mọi policy → meta sẽ
  chặn WebSocket. Không chặn gì hiện tại vì renderer stream bằng SSE-over-`fetch` (HTTP). Bẫy tiềm ẩn:
  nếu sau này thêm WS loopback, meta sẽ âm thầm chặn. Đã có TRƯỚC thay đổi này (diff chỉ bỏ `[::1]`).

## Xác minh sau sửa (bản packaged thật, không phải dev server)
- **Cửa sổ render THẬT:** CDP attach → `location.href = app://cowork/index.html`, `readyState =
  complete`, `document.title = "Cowork GHC"`, body render nội dung thật (surface "Chưa kết nối được" —
  ĐÚNG vì chưa cấu hình workspace/provider), `window.coworkShell` bridge hiện diện (⇒ `preload.cjs`
  nạp OK).
- **KHÔNG còn hộp thoại Error:** liệt kê top-level window → chỉ có `class='Chrome_WidgetWin_1'
  title='Cowork GHC'`; `ERROR_DIALOG_PRESENT: 0`, `APP_WINDOW_PRESENT: 1`.
- **KHÔNG còn lỗi console:** CDP Log/console/exception rỗng (cảnh báo CSP `[::1]` đã hết).
- **Full suite:** `npm test` → **616 pass / 0 fail**; `tsc -b` sạch.
- **Artifact:** `dist-app/Cowork GHC-0.0.0-setup.exe` (NSIS ~115M) + `-portable.exe` (~114.7M) build lại;
  asar entry = `app/shell/dist/main.cjs`; keyring `.node` unpacked; `resources/opencode/opencode.exe`
  (157.6M) hiện diện; root `package.json` nguồn KHÔNG bị mutate.

## Ảnh hưởng tới verdict CGHC-028
Bullet 1 (đóng gói ra installer) vẫn PASS NHƯNG nay có thêm điều kiện đúng đắn: **bản packaged thực sự
KHỞI ĐỘNG được** (trước đây chưa được chứng minh — smoke cũ hollow). Các bullet 3–5 (GUI click-through
tương tác, install/uninstall, keyring-from-installed, packaged interactive live smoke) VẪN cần một lượt
chạy thủ công trên desktop thật + uỷ quyền live mới cho request thứ 4 (ngân sách 3/3 đã hết). Không tự ý
đánh dấu CGHC-028 DONE.
