# Sub-project #2: Attachments — Design

**Ngày:** 2026-07-12
**Roadmap:** mục #2 trong `docs/superpowers/specs/2026-07-11-qt-to-electron-migration-design.md`
**Phụ thuộc:** sub-project #1 (Tab Cowork chat end-to-end) — đã hoàn thành.

## Bối cảnh

Bản Python cũ (`OldVersion/src/cowork_local`) cho phép đính kèm tệp/ảnh vào tin nhắn Cowork qua 3 cách: nút "+" (file picker), paste ảnh từ clipboard, kéo-thả vào ô nhập (`ui/composer.py`). Nội dung text của docx/xlsx/pptx/odf được trích bằng regex+zip thuần (`core/doc_extract.py`), pdf qua `pypdf`/LibreOffice fallback, rồi nhúng vào prompt dạng đoạn `[Attachments]`. **Ảnh không được gửi thật cho model** — chỉ nhét tên file + đường dẫn vào prompt dạng text (`core/chat_panel.py::_augment`), nghĩa là model không thực sự "nhìn" được ảnh trong bản cũ.

Sub-project này port lại tính năng đính kèm cho bản Electron, đồng thời **cải tiến so với bản cũ**: gửi ảnh thật qua vision API (base64) thay vì chỉ reference tên/path, vì cả Anthropic và phần lớn model OpenAI-compatible đều hỗ trợ vision.

## Phạm vi

**Trong phạm vi:**
- Đính kèm qua 3 cách: nút "+" (Electron `dialog.showOpenDialog`), paste ảnh từ clipboard, kéo-thả file/ảnh vào ô composer.
- Hiển thị attachment dưới dạng chip có thể xoá trong composer trước khi gửi, và trong bubble tin nhắn user sau khi gửi (dùng class `.attachment` đã có sẵn trong `renderer/index.html`).
- Giới hạn: tối đa 10 file/tin nhắn, tối đa 500K token (~2M ký tự) nội dung trích xuất mỗi file — cấu hình được qua `AppConfig` (mục `attachments: {max_files, max_tokens}`), giá trị mặc định giữ nguyên như bản cũ.
- Trích xuất nội dung text từ `.docx`/`.xlsx`/`.pptx`/`.pdf` bằng thư viện npm chuyên dụng (`mammoth`, `xlsx`, `pdf-parse`), nhúng vào prompt dạng đoạn `[Attachments]` — giống format bản cũ.
- Ảnh (`.png`/`.jpg`/`.jpeg`/`.gif`/`.bmp`/`.webp`): đọc thành base64, gửi thật qua vision content block của provider (Anthropic image content block / OpenAI `image_url` data-URI) — model đọc được nội dung ảnh thật.
- File không thuộc các định dạng trên: nếu là text thuần (không chứa byte null trong 8KB đầu) thì đọc trực tiếp làm UTF-8; nếu không, ghi chú "không đọc được nội dung" nhưng vẫn cho gửi kèm path.

**Ngoài phạm vi:**
- Sinh file Office (.docx/.xlsx/.pptx/.pdf) — sub-project #3.
- Đính kèm trong Tab Code/Structure (các tab này chưa được migrate).
- OCR ảnh, transcribe audio/video, `.doc`/`.xls`/`.ppt`/`.odt` cũ (LibreOffice fallback trong bản Python) — không port, vì hiếm gặp và cần thêm phụ thuộc ngoài (LibreOffice hoặc thư viện tương đương).
- Đổi giới hạn `max_files`/`max_tokens` qua Settings UI — vẫn cấu hình được qua `config.json` trực tiếp, nhưng chưa thêm field trong Settings modal ở sub-project này.

## Thay đổi kiến trúc: Message/ContentPart

`Message.content` hiện tại (từ sub-project #1, `src/main/agent/types.ts`) là `string` đơn thuần. Để hỗ trợ vision, mở rộng thành union:

```ts
type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; data: string }; // base64, không kèm data: URI prefix

interface Message {
  role: Role;
  content: string | ContentPart[];  // string cho message không có ảnh (giữ tương thích ngược)
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}
```

Khi `content` là `ContentPart[]`: cả `AnthropicProvider.split()` (`src/main/agent/provider-anthropic.ts`) và `OpenAICompatProvider.toApiMessages()` (`src/main/agent/provider-openai-compat.ts`) cần thêm nhánh convert từng `ContentPart` sang định dạng API tương ứng:
- Anthropic: `{type:'image', source:{type:'base64', media_type, data}}` xen giữa các `{type:'text', text}` block trong cùng content array.
- OpenAI-compatible: `{type:'image_url', image_url:{url: 'data:<mimeType>;base64,<data>'}}` xen giữa `{type:'text', text}`.

Khi `content` là `string` (trường hợp không đính kèm ảnh — kể cả khi có đính kèm file text), hành vi giữ nguyên như cũ, không đổi.

## Cấu trúc file mới

```
src/main/attachments/
├── extract-text.ts       # docx/xlsx/pptx/pdf/text-thuần → text; dùng mammoth, xlsx, pdf-parse
├── image-encode.ts        # đọc file ảnh → {mimeType, base64Data}; nhận diện qua phần mở rộng
└── augment-prompt.ts      # build ContentPart[] hoàn chỉnh (text gốc + [Attachments] section + image parts) từ danh sách path, áp giới hạn max_files/max_tokens
```

## IPC & preload mở rộng

- `attachment:pick()` (invoke) — mở `dialog.showOpenDialog` (multi-select, filter "Files"/"Images"), trả về `string[]` đường dẫn đã chọn.
- `cowork:send(conversationId, text, attachmentPaths?: string[])` — mở rộng signature hiện có (sub-project #1) để nhận thêm danh sách path đính kèm; main process gọi `augment-prompt.ts` để build `ContentPart[]` trước khi đưa vào `Message` gửi cho provider.
- Preload (`src/preload/index.ts`) expose thêm `pickAttachment(): Promise<string[]>`; cập nhật `send(conversationId, text, attachmentPaths?)`.

## Renderer UI

- Nút "+" trong composer (`#composer-input` khu vực `.composer__bar`, đã có sẵn markup trong `index.html`) → gọi `api.pickAttachment()` → thêm path vào danh sách đính kèm đang chờ gửi, render chip (tên rút gọn + nút ✕ xoá) phía trên composer, giống bản cũ.
- Paste: bắt sự kiện `paste` trên `#composer-input`, nếu clipboard có ảnh → lưu tạm vào `~/.cowork_local/pasted/paste-<timestamp>.png` (main process xử lý qua IPC `attachment:savePastedImage(base64)`), thêm vào danh sách đính kèm.
- Kéo-thả: bắt `dragover`/`drop` trên `#composer-input`, lấy `File.path` (Electron cho phép truy cập path thật của file kéo-thả), thêm vào danh sách.
- Giới hạn 10 file: chip thứ 11 trở đi bị từ chối, hiện thông báo ngắn dưới composer (tương tự `attach_limit_note` bản cũ).
- Khi gửi: danh sách path đính kèm được truyền vào `api.send(conversationId, text, attachmentPaths)`, sau đó chip đính kèm hiện lại trong bubble user đã gửi (đọc từ `message.content` khi render, hoặc giữ riêng danh sách tên file cho bubble — chi tiết implementer quyết định khi viết plan).

## Error handling

- File không đọc được nội dung (định dạng lạ, corrupt, binary không hỗ trợ): không chặn gửi tin nhắn — nhúng ghi chú `"- <tên file> (không đọc được nội dung: <lý do>; tại <path>)"` vào phần `[Attachments]` của prompt, giống bản cũ.
- Vượt `max_files` (mặc định 10): chip vượt giới hạn bị từ chối ngay khi thêm, hiện thông báo ngắn, không thêm vào danh sách.
- Vượt `max_tokens` mỗi file (mặc định 500K, ~2M ký tự): cắt nội dung trích xuất, giữ phần đầu, ghi chú đã bị cắt.
- Ảnh lỗi khi đọc/encode base64: bỏ qua ảnh đó (không crash), ghi chú lỗi tương tự file thường.

## Testing

- Unit test cho `extract-text.ts`: dùng file mẫu nhỏ thật (.docx/.xlsx/.pptx) trong `tests/fixtures/`, verify trích đúng nội dung text.
- Unit test cho `image-encode.ts`: verify mime-type detection theo phần mở rộng và base64 encode đúng.
- Unit test cho `augment-prompt.ts`: verify build đúng `ContentPart[]`/string theo các giới hạn `max_files`/`max_tokens`, và xử lý file lỗi không chặn toàn bộ.
- Cập nhật test cho `AnthropicProvider`/`OpenAICompatProvider` (đã có từ sub-project #1): thêm case `content` là `ContentPart[]` chứa ảnh, verify convert đúng format API.
- Renderer/IPC wiring (nút đính kèm, paste, drag-drop, chip UI): không có test tự động — verify tay bằng `npm start` giống cách làm ở sub-project #1's Task 13.
