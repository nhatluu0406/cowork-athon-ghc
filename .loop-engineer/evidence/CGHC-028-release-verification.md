---
task: CGHC-028
title: "Release verification (L9) — packaged Windows build + live critical-path; verdict PARTIAL (release-candidate)"
language: "vi"
status: PARTIAL
created_at: "2026-07-12"
---

# CGHC-028 — Bằng chứng release verification (L9)

**Verdict co-sign (release-verifier ≠ implementer): PARTIAL — release-candidate.** Phần đóng gói + artifact +
`.bat`/CLI + full suite + đường LLM live (service-layer + product-boundary) + PR7 + template + resume + boot
smoke đều PASS-grade và đáng kể. Phần CÒN LẠI là các leg GUI tương tác + artifact đã cài đặt, KHÔNG tự động
hoá được trong môi trường headless. KHÔNG đánh dấu DONE cho tới khi bullet 3–5 chạy qua GUI đã đóng gói.

## Bảng verdict theo acceptance

| # | Acceptance | Verdict | Bằng chứng |
|---|---|---|---|
| 1 | Đóng gói ra installer; artifact là bản packaged | **PASS** | `dist-app/Cowork GHC-0.0.0-setup.exe` (NSIS 115M) + `-portable.exe` (114.7M) + blockmap. `app.asar` (250K) chứa `main.js` bundle esbuild THẬT (182,147 bytes, inline toàn bộ @cowork-ghc/*), 0 file `*.map`. Keyring native `.node` unpacked trong `app.asar.unpacked/.../keyring-win32-x64-msvc`. `resources/opencode/opencode.exe` = 157.6M. `electron-builder.yml`: asarUnpack keyring, extraResources opencode, loại sourcemap, win nsis+portable, signing skip sạch (không cert). |
| 2 | Bốn `.bat` root-independent, exit code trung thực (LC5) | **PASS** (caveat) | Cả 4 `.bat` thin, tự định vị root qua `%~dp0..`, gọi `node tools/app/cli.mjs`, propagate `%ERRORLEVEL%`. `cli.mjs status` → exit 0 trung thực; `clean` dry-run → exit 0, chỉ liệt kê `node_modules` + `.runtime/*`. Caveat: KHÔNG double-click init/start (build+launch electron) trong headless. |
| 3 | E2E critical path trên stack lắp ráp | **PARTIAL** | Chứng minh LIVE ở service-layer (leg1: opencode.exe+DeepSeek → EV7 `completed` → `ready.txt` ghi đĩa → resume) VÀ product-boundary qua HTTP (leg4: POST /v1/session=201 → SSE token-guarded → POST message=202 → `completed` thật). Gap: chưa chạy qua GUI packaged (folder picker native, permission Allow/Deny modal click-through). |
| 4 | PR7 provider-error end-to-end, distinct + no secret | **PARTIAL** | leg2 live: key sai → error EV distinct + `errored` terminal (không bịa completed), secret-free; + map tĩnh 401/429/408/503 distinct. Gap: PR7 render qua UI packaged chưa chạy. |
| 5 | Packaged smoke gồm critical path + PR7 + template + resume | **PARTIAL** | Boot smoke packaged PASS (dưới). Mỗi leg đã chứng minh live. Gap: chưa có một packaged INTERACTIVE smoke nối chuỗi qua renderer đã đóng gói. |

## Boot smoke headless — ĐÍNH CHÍNH (đợt đầu là FALSE POSITIVE)
> **CẢNH BÁO:** Kết luận "STAYED_ALIVE = PASS" ở ĐỢT ĐẦU là SAI. App packaged là binary Windows
> GUI-subsystem → tách console → stderr redirect luôn rỗng; và process "sống" chỉ vì một **hộp thoại
> lỗi modal** giữ nó lại, KHÔNG phải vì app khởi động. Thực tế bản packaged đầu tiên KHÔNG khởi động
> được: `ReferenceError: require is not defined in ES module scope` (bundle CJS bị nạp như ESM do
> `"type": "module"`). Chi tiết + cách sửa + xác minh cửa sổ render thật:
> [CGHC-028-packaged-launch-fix.md](CGHC-028-packaged-launch-fix.md).

**Sau khi sửa (bản packaged hiện tại, đã verify bằng CDP + liệt kê window):** cửa sổ render THẬT
(`app://cowork/index.html`, `readyState=complete`, title "Cowork GHC", `window.coworkShell` bridge có),
KHÔNG hộp thoại Error (`ERROR_DIALOG_PRESENT: 0`, `APP_WINDOW_PRESENT: 1`), KHÔNG lỗi console, kill → 0
orphan. Bài học: STAYED_ALIVE ≠ cửa sổ render — verify GUI phải kiểm tra renderer/window thật.

## Đường live (bounded) — secret-free, trong ngân sách
- `wave-c-report.json`: PASS, **2** request live thành công. leg1 critical path (EV7, file ghi đĩa, resume, stop
  no-orphan), leg2 PR7 (error distinct, secret-free), leg3 template RE4 + resume S4. `secretScan: CLEAN`.
- `leg4-report.json`: PASS, **1** request live. Product-boundary qua HTTP: 201 → SSE `[step,token,completed]`
  (EV7 thật, không bịa) → stop no-orphan. `secretScan: CLEAN`.
- **Tích luỹ = 3/3 request thành công (đã HẾT ngân sách CGHC-028).** Token KHÔNG bao giờ in/lưu; grep độc lập
  cả hai report: không rò. DeepSeek chỉ là endpoint thay-thế-được SAU OpenCode qua custom OpenAI-compat; không
  hard-code vào source; giá trị chỉ vào ENV child qua keyring `resolveInjection`.

## Full suite + tsc
`npm test` → **616 pass / 0 fail / 0 skip**; `npx tsc -b` sạch. (Windows tsx đôi khi discovery thiếu — số ổn
định repo-wide là 616.)

## clean allowlist (an toàn)
`cleanup-manifest.json` PRESERVE `.git`/`docs`/`.agent-workflow`/`.claude`/`CLAUDE.md`/`AGENTS.md`/`tools`/
`scripts`/`.loop-engineer/{state,checkpoints,evidence,reports,source}`; `user-data`+`credential` categories rỗng,
KHÔNG BAO GIỜ xoá; unit test chứng minh clean TỪ CHỐI manifest có entry traversal `../outside` (không xoá gì).

## CÒN LẠI — cần một lượt chạy TƯƠNG TÁC/ĐÃ CÀI trên desktop thật (đây là phần PARTIAL)
1. Chạy `Cowork GHC-0.0.0-setup.exe` (NSIS): clean-profile **install → chạy từ vị trí đã cài → uninstall**.
2. Full **GUI click-through packaged**: folder picker native (workspace grant), nhập provider/model ở UI, session
   mới, streaming render, permission modal **Allow VÀ Deny** + kiểm tra file trên đĩa, stop, reopen+**resume**,
   **template re-run** — tất cả qua renderer đã đóng gói.
3. **PR7 render trong UI packaged** (distinct/actionable/secret-free) qua click-through.
4. **Keyring round-trip từ vị trí đã cài** (xác nhận `.node` asarUnpack resolve dưới Program-Files/portable).
5. Một **packaged interactive smoke** nối chuỗi critical-path + PR7 + template + resume.

Lưu ý: mọi leg trên đã được chứng minh bằng chương trình/live ở lớp service/boundary — khoảng trống ĐÚNG là GUI
tương tác packaged + thực thi artifact đã cài. Ngân sách live đã hết (3/3): một packaged interactive live smoke
cần **uỷ quyền product-owner mới** cho request thứ 4 (KHÔNG tự ý thực hiện).

## Carry-forward (đã ghi nhận)
- **S4 resume terminal-status fidelity** (MEDIUM): OpenCode không lưu `session.idle`/terminal như một message part
  replay được → rebuild dựng lại NỘI DUNG nhưng không dựng lại status `completed`. Cân nhắc synth terminal khi
  reopen một session store cho là kết thúc, hoặc chấp nhận giới hạn store.
- **PR7 401 → reconfigure_credential** (LOW): map hiện 401→`auth_invalid` (recovery=retry) vì tên OpenCode
  `session.error` chưa normalize thành `ProviderAuthError`; tinh chỉnh bộ tên của mapper.
- **Multi-turn per session** (MEDIUM đã làm honest): task registry freeze ở terminal đầu (S6 finality); prompt thứ 2
  tới session đã completed nay trả **409 `session_completed`** trung thực (không bịa 202). Multi-turn re-stream là
  follow-up (session mới mỗi lượt trong POC).
