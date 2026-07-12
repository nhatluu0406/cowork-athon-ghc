# Sub-project #3: Office document generation — Design

**Ngày:** 2026-07-12
**Roadmap:** mục #3 trong `docs/superpowers/specs/2026-07-11-qt-to-electron-migration-design.md`
**Phụ thuộc:** sub-project #1 (tool-calling loop, save_file, output dir) và #2 (extract-text dùng cho round-trip test) — đều đã hoàn thành.

## Bối cảnh

Bản Python cũ không có tool sinh tài liệu chuyên dụng: model tự viết script Python vào `.scratch/`, chạy bằng `run_command`, tự pip-install thư viện (`python-docx`, `openpyxl`, `python-pptx`) qua `install_package`, rồi pipeline cleanup xoá `.scratch/`, xoá script trung gian và flatten output (`core/chat_agent.py:30-52,109-172`, `core/tools.py:112-134`, `core/deps.py`).

Cơ chế đó không port được sang Electron: **không đảm bảo máy user có Python/pip** (quyết định người dùng 2026-07-12: app phải tự chứa), và thực thi mã tuỳ ý thuộc phạm vi Tab Code (#5). Thay vào đó, bản Electron dùng **tool sinh tài liệu chuyên dụng** với input có cấu trúc, render bằng thư viện JS bundle sẵn — không thực thi mã, hoạt động offline, unit-test được.

## Phạm vi

**Trong phạm vi:**
1. Bốn tool mới trong vòng lặp agent Cowork (`run-cowork.ts`), cạnh `save_file`/`update_plan`:
   - `create_docx(filename, markdown)` — Markdown → `.docx` qua `marked` (parse) + `docx` (build). Hỗ trợ tập con Markdown: heading 1–6, đoạn văn, **bold**/*italic*/`code`, bullet list, numbered list, bảng (GFM), blockquote, horizontal rule. Cú pháp ngoài tập con render như văn bản thường (không lỗi).
   - `create_xlsx(filename, sheets)` — `sheets: [{name: string, rows: any[][]}]` → `.xlsx` qua `xlsx` (SheetJS, đã có từ #2 — dùng chiều ghi). Nhiều sheet, giữ nguyên kiểu số/chuỗi.
   - `create_pptx(filename, slides)` — `slides: [{title: string, bullets: string[], notes?: string}]` → `.pptx` qua `pptxgenjs`. Layout đơn giản: title + bullet list mỗi slide, speaker notes tuỳ chọn.
   - `create_pdf(filename, html)` — HTML tự chứa → `.pdf` qua **Electron `webContents.printToPDF`** trong `BrowserWindow` ẩn (offscreen, không hiện lên màn hình), khổ A4. Không thêm dependency; render CSS đầy đủ.
2. Port **HTML Document Builder** — skill built-in luôn bật: hằng số `HTML_DOC_BUILDER_SKILL` chứa nguyên văn text từ `OldVersion/src/cowork_local/skill_templates/html-document.skill` (22 dòng, xem Phụ lục), inject vào hội thoại như một system message thứ hai, mở đầu bằng tag `[[ACTIVE_SKILLS]]` và câu `"The user enabled the following skills — follow them:"` — đúng cơ chế `_apply_skills` bản cũ (`core/code_agent.py:80-93`), để sub-project #4 (Skills) sau này gộp vào danh sách built-in mà không phải đổi format.
3. Cập nhật `COWORK_TOOL_PROMPT`: bỏ mọi hướng dẫn liên quan script/`.scratch/`, thay bằng: text thuần → `save_file`; tài liệu trình bày đẹp → `.html` (theo skill builder) hoặc `create_pdf`; Word/Excel/PowerPoint → tool tương ứng; khi tool trả lỗi, đọc lỗi - sửa input - thử lại; không hỏi lại user.
4. Pipeline output giữ nguyên hành vi #1: ghi vào output root qua `titledFilename` (tên file theo title hội thoại, giữ extension), overwrite-in-place khi trùng tên, emit `tool_proposed` → `tool_result` → `outputs_added` như `save_file`.

**Ngoài phạm vi:**
- `run_command` / `install_package` / sandbox `.scratch/` — thuộc Tab Code (#5). Vì không còn script trung gian, pipeline cleanup/flatten của bản cũ cũng không cần port.
- Sinh ảnh (PNG/chart), chỉnh sửa file Office có sẵn, template docx/pptx tuỳ biến.
- LibreOffice embedding/preview (#9); Skills manager UI (#4).
- Per-session/per-turn output sub-folders (`.turns/`) của bản cũ — bản Electron hiện dùng một output root chung (hành vi #1), giữ nguyên.

## Cấu trúc file

```
src/main/docgen/
├── markdown-docx.ts   # markdownToDocx(markdown: string): Promise<Buffer>
├── sheets-xlsx.ts     # sheetsToXlsx(sheets: SheetSpec[]): Buffer
├── slides-pptx.ts     # slidesToPptx(slides: SlideSpec[]): Promise<Buffer>
└── html-pdf.ts        # htmlToPdf(html: string): Promise<Buffer> — BrowserWindow ẩn + printToPDF;
                       #   tách sau interface PdfRenderer để test glue không cần Electron
src/main/agent/doc-tools.ts   # 4 ToolSpec + executor: validate args, gọi docgen, ghi file
                              #   qua titledFilename vào outputDir, trả {ok, output, path}
```

`run-cowork.ts` đăng ký 4 spec vào `toolSpecs` và dispatch trong vòng lặp tool (nhánh mới cạnh `save_file`), đồng thời inject skill message. Hằng số `HTML_DOC_BUILDER_SKILL` đặt trong `src/main/agent/skills-builtin.ts` (file mới, #4 sẽ mở rộng).

Dependency mới (runtime, pure-JS, esbuild bundle được): `docx`, `pptxgenjs`, `marked`.

## Error handling

- Executor không bao giờ ném exception ra vòng lặp agent: mọi lỗi render/ghi file → `{ok: false, output: '<mô tả lỗi>'}` để model đọc và thử lại (tương đương hành vi `_run_command` cũ trả `[exit N] + stderr`).
- Validate input trước khi render, thông báo lỗi mô tả rõ để model tự sửa: `sheets` rỗng/thiếu `rows`, `slides` rỗng/thiếu `title`, `markdown`/`html` rỗng, `filename` thiếu extension đúng (tự thêm nếu thiếu).
- `create_pdf`: timeout render (30s) → `ok: false`; BrowserWindow ẩn luôn được destroy trong `finally`.
- Filename đi qua sanitize sẵn có của `titledFilename` (giữ Unicode/tiếng Việt, bỏ ký tự cấm).

## Testing

- **Round-trip qua `extract-text.ts` (#2)**: `create_docx` sinh file → `extractText` đọc lại phải chứa đúng nội dung; tương tự xlsx (đúng sheet/row) và pptx (đúng slide/bullet). Đây là test chính cho 3 generator.
- Unit test `markdown-docx`: từng cấu trúc Markdown trong tập con hỗ trợ (heading, list, bảng, bold/italic) sinh ra docx đọc lại được; cú pháp lạ không throw.
- Unit test `doc-tools` executor: validate-args (input sai → `ok:false` + message rõ), filename tự thêm extension, ghi đúng outputDir (temp dir), overwrite-in-place.
- `html-pdf`: cần Electron runtime nên **không unit-test render thật** — test phần glue qua `PdfRenderer` giả; PDF thật verify tay.
- Verify tay (`npm start` + API key thật, task manual cuối): yêu cầu tạo báo cáo Word/Excel/PowerPoint/PDF thật, mở file bằng Office; xác nhận HTML Document Builder tự kích hoạt khi yêu cầu "tài liệu"; xác nhận file xuất hiện trong panel "Tệp đầu ra".

## Phụ lục — HTML Document Builder (nguyên văn bản gốc; port giữ nguyên trừ 1 câu, xem ghi chú cuối)

```
# HTML Document Builder

You turn the user's request into a polished, self-contained **HTML document** and
save it as the final ``.html`` file.

When the user asks for a document — report, one-pager, memo, proposal, meeting
minutes, guide, letter, summary, etc.:

1. Write the full content called for: clear structure, accurate to the request,
   in the user's language.
2. Produce ONE standalone ``.html`` file (no external dependencies):
   - Put ALL CSS inline in a ``<style>`` block; embed any images as base64 data URIs.
   - Include ``<meta charset="utf-8">`` and a ``<title>``.
   - Clean, readable typography; a centred content column (max-width ~820px);
     clear heading hierarchy; bordered tables; a subtle accent colour; spacing
     that prints well on A4.
3. Save it with the file tool as ``<name>.html`` — that is the final deliverable.
   Put any generator/helper script in a ``.scratch/`` subfolder and keep ONLY the
   final ``.html`` in the output folder.
4. Do NOT ask clarifying or confirmation questions — make reasonable assumptions,
   complete the request end-to-end, then report the saved file name.
```

*Ghi chú port:* dòng "Put any generator/helper script in a ``.scratch/`` subfolder…" không còn đúng ở bản Electron (không có script). Khi port, sửa riêng câu đó thành: "Save it with the save_file tool as ``<name>.html`` — that is the final deliverable." (giữ nguyên phần còn lại).
