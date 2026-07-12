# Cowork Local — Electron v2.0

Giao diện desktop AI assistant phong nền sáng, thiết kế theo hướng **1a "Airy"**  
Brand: FPT Software · Điểm nhấn cam #F36F21 · Typeface Be Vietnam Pro

---

## Cấu trúc dự án

```
cowork-local-electron/
├── main.js              # Main process — tạo cửa sổ, IPC
├── preload.js           # Context bridge (contextIsolation)
├── package.json
└── renderer/
    ├── index.html       # Toàn bộ UI 1a
    ├── style.css        # Design tokens + layout + components
    ├── app.js           # Tab switching, sidebar, composer, IPC calls
    └── assets/
        └── fpt-logo-color.png
```

---

## Khởi chạy

```bash
npm install
npm start
```

Yêu cầu: **Node.js ≥ 18**, **npm ≥ 9**.  
Electron 35 sẽ được cài tự động qua devDependencies.

---

## Tính năng UI hiện có

| Tính năng | Trạng thái |
|-----------|-----------|
| Custom titlebar (macOS native traffic lights / Windows frameless) | ✅ |
| Tab Cowork — chat transcript đầy đủ | ✅ |
| Sidebar lịch sử (collapse/expand) | ✅ |
| Panel Kế hoạch / Tệp bên phải (collapse/expand) | ✅ |
| Inline plan + tool step (expand/collapse) | ✅ |
| Composer — Enter gửi, Shift+Enter xuống dòng | ✅ |
| Thinking indicator (animated dots) | ✅ |
| Tab Code / Structure / M365 | ⏳ Placeholder |
| Kết nối AI thực (Anthropic / Azure / Internal Gateway) | ⏳ Cần tích hợp |

---

## Tích hợp AI

Trong `renderer/app.js`, hàm `sendMessage()` hiện chỉ render bubble người dùng.  
Để gọi model thực, thêm IPC call tới main process:

```js
// renderer/app.js — trong sendMessage()
const reply = await window.coworkAPI.chat({ message: text, model: 'claude-sonnet-4' });
```

```js
// main.js — IPC handler
const Anthropic = require('@anthropic-ai/sdk');
ipcMain.handle('chat', async (_e, { message, model }) => {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [{ role: 'user', content: message }],
  });
  return res.content[0].text;
});
```

---

## Design tokens (CSS variables)

Tất cả màu sắc, bóng, font được định nghĩa trong `:root` của `style.css`.  
Thay đổi accent color tại: `--accent: #F36F21`.

---

## Build phân phối

```bash
npm install electron-builder --save-dev
npm run build
```

Output: `dist/` — .dmg (macOS), .exe installer (Windows), .AppImage (Linux).

---

*Thiết kế bởi Claude · FPT Software Design System · 2026*
