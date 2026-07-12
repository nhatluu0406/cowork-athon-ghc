# Sub-project #4: Skills system — Design

**Ngày:** 2026-07-12
**Roadmap:** mục #4 trong `docs/superpowers/specs/2026-07-11-qt-to-electron-migration-design.md`
**Phụ thuộc:** sub-project #1 (IPC/provider/renderer), #3 (`skills-builtin.ts`, `[[ACTIVE_SKILLS]]` injection trong `run-cowork.ts`) — đều đã hoàn thành.

## Bối cảnh

Bản Python có hệ thống skill hoàn chỉnh (`core/skills.py`, `ui/skills_dialog.py`, `ui/composer.py`): skill là các đoạn hướng dẫn tái sử dụng, lưu JSON tại `~/.cowork_local/skills/`, bật/tắt được, inject vào system prompt mỗi lượt; lệnh `/skill` áp dụng one-shot; manager UI có CRUD + import + 2 tính năng AI authoring. Sub-project #3 đã port trước phần built-in (HTML Document Builder) với envelope `[[ACTIVE_SKILLS]]` đúng format `_apply_skills` để #4 hợp nhất.

**Quyết định phạm vi (người dùng, 2026-07-12): full port cả 4 mảng** — store + inject, lệnh `/skill`, manager UI với AI auto-generate, composer autocomplete popup.

**Kiến trúc (hướng A đã duyệt):** toàn bộ logic (store/parse/generate) ở main process, một nguồn sự thật, unit-test được; renderer chỉ hiển thị. Lệnh `/skill` parse ngay trong `cowork:send`.

## Phạm vi

### 1. Skill store — `src/main/skills/store.ts`

Port nguyên `core/skills.py:30-161`:

- `interface Skill { name: string; description: string; instructions: string; enabled: boolean }` + `skillSlug(name)`: lowercase, giữ chữ-số và `-_`, ký tự khác → `-`, gộp chuỗi `-`, fallback `'skill'` (y hệt `Skill.slug`).
- Thư mục user skills: `~/.cowork_local/skills/` (`SKILLS_DIR`, dựa trên `CONFIG_DIR` sẵn có). **Format ghi: JSON `{name, description, instructions, enabled}`, file `<slug>.json`, indent 2, không escape Unicode** — tương thích 2 chiều với bản Python (skill cũ của user dùng được ngay).
- `loadSkillFile(path)`: `.json` hoặc text bắt đầu bằng `{` → parse JSON (nhận `instructions` hoặc `content`, `enabled` mặc định **false**); còn lại (`.skill/.md/.txt`) → markdown: `name` = dòng `#` đầu tiên (bỏ `#`), fallback tên file; `instructions` = toàn bộ text đã trim; `enabled=false`.
- `listSkills(dir?)`: quét `*.json` + `*.skill` (sort, dedupe theo tên file), **loại** skill có slug trùng built-in.
- `saveSkill(skill, dir?, oldName?)`: nếu `oldName` khác tên mới → xoá file slug cũ trước (cơ chế rename); ghi `<slug>.json`.
- `deleteSkill(name, dir?)`, `importSkillFile(path, dir?)` (throw lỗi mô tả nếu không đọc được/không có tên), `pruneSeededBuiltins(dir?)` (xoá `*.skill` trong thư mục user trùng slug built-in — chạy 1 lần khi app khởi động, không đụng `.json`).

### 2. Built-ins hợp nhất + inject — sửa `src/main/agent/skills-builtin.ts`, `run-cowork.ts`

- `skills-builtin.ts` chuyển thành: `BUILTIN_SKILLS: Skill[]` — phần tử duy nhất hiện tại là HTML Document Builder (name `'HTML Document Builder'`, instructions = text hiện có nguyên văn, `enabled: true`). Giữ export `ACTIVE_SKILLS_TAG`.
- `activeSkillsText(dir?)` (đặt trong `store.ts`): `BUILTIN_SKILLS + listSkills(dir).filter(enabled)`, mỗi skill → `## Skill: <name>\n<instructions.trim()>`, nối `'\n\n'`, bỏ skill có instructions rỗng — **đúng format `active_skills_text` bản cũ** (khác #3: có wrapper `## Skill:`; nội dung message vì thế đổi nhẹ, envelope tag giữ nguyên).
- `activeSkillsMessage()` nhận text làm tham số: `` `${ACTIVE_SKILLS_TAG}\nThe user enabled the following skills — follow them:\n\n${text}` ``.
- `run-cowork.ts`: port đúng `_apply_skills` — **remove-then-insert**: xoá mọi system message bắt đầu bằng tag, rồi (nếu text không rỗng) chèn message mới tại index 1 (sau system prompt) — để thay đổi bật/tắt skill có hiệu lực ngay lượt sau, kể cả với hội thoại cũ đã persist message tag phiên bản trước. `runCowork` nhận `skillsText` qua `RunCoworkOptions` (mặc định: `activeSkillsText()` do `ipc.ts` truyền) — giữ module tab-agnostic cho #5 dùng lại.

### 3. Lệnh `/skill` — `src/main/skills/parse-command.ts` + `ipc.ts`

Port nguyên `parse_skill_command` (`core/skills.py:247-310`), regex `^/skill(?::([^\s]+))?[ \t]*([\s\S]*)$`:

- `parseSkillCommand(text, dir?) → { prefix: string; request: string; info: string | null }`. Pool = user skills + built-ins; match theo slug hoặc name.
- 5 dạng, giữ nguyên chuỗi thông báo bản cũ (kể cả markdown và câu tiếng Việt):
  1. `/skill:<slug> <request>` (có match) → `prefix = "## Skill: <name>\n<instructions>"`, `request = rest` — one-shot cho lượt đó.
  2. `/skill:<slug>` → info `"Skill **<name>** selected — add your request, e.g. \`/skill:<slug> summarise this file\`."`.
  3. `/skill:<slug>` không tồn tại → info `` "Skill `<slug>` not found. Type `/skill` to see the available skills." ``.
  4. `/skill` → info liệt kê: header `**Available skills**`, mỗi dòng `` - `/skill:<slug>` — **<name>**: <description>`` + tag `_(built-in, always on)_` / `_(disabled)_`, footer hướng dẫn; hoặc `"No skills found yet. Add one in the Skills manager (**Skills** button)."`.
  5. `/skill <request>` → prefix = `activeSkillsText()` nếu có skill bật; nếu không có skill bật nhưng có đúng 1 skill → dùng skill đó; còn lại info `"Chưa bật skill nào. Chọn một skill cụ thể:\n"` + listing.
- Text không bắt đầu `/skill` → `{prefix:'', request: text, info: null}`.
- **`ipc.ts` `cowork:send`**: parse trước khi augment. `info` → trả `{info}` ngay (không tạo turn, không persist). `prefix` → nội dung đưa vào `augmentPrompt` là `prefix || text`; user message set `display = text` (bubble hiển thị lệnh gốc). Kiểu trả về mở rộng: `{messageId, queued} | {info: string}`.

### 4. Manager UI — renderer modal (index.html/index.ts/style.css)

Theo pattern Settings modal sẵn có:

- **Skills modal**: hint `"Tick to enable a skill. Enabled skills are followed by the agent."`; danh sách skill user (`skills:list` — không hiện built-in, giống bản cũ) dạng hàng có checkbox (toggle → `skills:save` ngay), text `name — description`; placeholder khi rỗng `"(No skills yet — click '✨ Auto-generate' or 'Import…')"`. Nút: **✨ Auto-generate**, **Import…**, **Edit**, **Delete** (confirm), **Close**.
- **Editor modal** (tạo/sửa): Name (placeholder `"e.g. Always write unit tests"`), Short description, Instructions (textarea, placeholder `"Describe the rules / guidance the agent must follow…"`), nút **✨ Generate from description** (điền Instructions từ `skills:generateInstructions`), Save/Cancel. Skill mới `enabled=false`. Save → `skills:save` với `oldName` khi sửa.
- **Auto-generate flow**: prompt nhập mô tả (textarea trong modal nhỏ) → `skills:generate` → mở Editor modal điền sẵn kết quả cho user duyệt → Save.
- Mở modal từ: nút "Skills" sẵn có trên chat header, và mục "⚙ Manage skills…" trong autocomplete popup.

### 5. AI authoring — `src/main/skills/generate.ts`

Port nguyên 2 hàm (`core/skills.py:178-244`), dùng `Provider` inject (production: `createProvider(config)`):

- `generateSkill(provider, description) → Promise<Skill>`: system prompt **nguyên văn** bản cũ (single JSON object, keys `name`/`description`/`instructions`, "Reply with ONLY the JSON object — no code fences, no preamble."); parse substring `{...}` đầu tiên; JSON hỏng hoặc thiếu instructions → fallback `generateSkillInstructions`; fallback name = 40 ký tự đầu mô tả (hoặc `'New Skill'`), description = 80 ký tự đầu; trả `enabled=false`; throw `Error` chỉ khi không sinh được gì dùng được.
- `generateSkillInstructions(provider, description, name?) → Promise<string>`: system prompt **nguyên văn** ("You write the INSTRUCTIONS body of a reusable agent skill. … Reply with ONLY the instructions text — no preamble, no title."); user message `"Skill name: <name>\nShort description: <description>"`; trả `''` khi lỗi.

### 6. Composer autocomplete popup — renderer

- Kích hoạt khi dòng đầu của input là prefix của `/skill` (dài ≥2) hoặc khớp `^/skill:?([\w\-.]*)$`; filter = phần sau `:`.
- Overlay phía trên composer input: pool = user skills + built-ins, lọc substring trên name/slug/description; mỗi hàng `✓ ` (nếu enabled) + name + ` — description`; hàng rỗng `"(no skills yet)"`; hàng cuối luôn là `"⚙ Manage skills…"`.
- Phím (bắt trên composer input, popup không chiếm focus): ↑/↓ điều hướng vòng, **Tab** chọn (điền `/skill:<slug> ` + con trỏ cuối), **Esc** đóng, **Enter** đóng popup và gửi như bình thường; click hàng = chọn; blur input = đóng (trừ khi click vào popup).
- **Local command fast path**: `/skill` hoặc `/skill:<slug>` (không request) được gửi và trả lời `{info}` ngay cả khi có turn đang chạy — `cowork:send` với info không đi qua ConversationManager nên tự nhiên không xếp queue.

### IPC & preload mới

`skills:list`, `skills:save(skill, oldName?)`, `skills:delete(name)`, `skills:import` (mở `dialog.showOpenDialog` filter `Skills (*.skill *.json *.md *.txt);;All files (*.*)` rồi import, trả skill hoặc lỗi), `skills:generate(description)`, `skills:generateInstructions(description, name?)`. Preload expose tương ứng (`skillsList`, `skillsSave`, ...). `cowork:send` giữ tên, mở rộng kiểu trả về.

## Error handling

- Store: file hỏng/không đọc được khi list → bỏ qua file đó (không crash); import lỗi → throw message rõ, IPC trả `{error}` cho renderer hiển thị.
- Generate: lỗi provider → `generateSkill` throw (renderer hiện thông báo trong modal), `generateSkillInstructions` trả `''` (giữ hành vi bản cũ).
- `/skill` với slug sai → info lịch sự, không tạo turn.
- Renderer escape mọi name/description khi render (escapeHtml sẵn có).

## Ngoài phạm vi

- Áp skill cho Tab Code/Structure (chưa tồn tại; `runCowork`/store viết tab-agnostic để #5 tái sử dụng).
- Skill dạng thư mục nhiều file, chia sẻ/marketplace, version skill.
- Cancel giữa chừng cho AI generate (bản cũ có worker cancel; bản Electron: chờ hết request — đơn giản hoá, generate thường nhanh).

## Testing

- Unit `store.ts`: đọc file JSON tạo đúng format bản Python (fixture chuỗi verbatim), slug derivation (case, ký tự đặc biệt, tiếng Việt), markdown `.skill` load, save/rename/delete/import, listSkills loại built-in slug, pruneSeededBuiltins chỉ xoá `.skill` trùng built-in.
- Unit `parse-command.ts`: đủ 5 dạng + text thường + match theo name lẫn slug + chuỗi thông báo đúng nguyên văn.
- Unit `activeSkillsText`: format `## Skill:`, thứ tự builtins trước, bỏ instructions rỗng, nối `\n\n`.
- Unit `generate.ts` với provider giả: JSON chuẩn, JSON kèm văn bản thừa, JSON hỏng → fallback, provider throw.
- Unit `run-cowork`: remove-then-insert tag message (đổi skillsText giữa 2 lượt → message được thay, không nhân đôi).
- IPC/renderer wiring (modal, popup, checkbox toggle): không test tự động — verify tay bằng `npm start` (tạo/sửa/xoá/import skill, auto-generate, `/skill` cả 5 dạng, popup Tab/Esc, bật skill và thấy model tuân theo).
