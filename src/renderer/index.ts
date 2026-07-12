import { PlanStep, StreamEvent, contentText } from '../main/agent/types';

interface SkillInfo {
  name: string;
  description: string;
  instructions: string;
  enabled: boolean;
}

interface CoworkAPI {
  platform: string;
  minimize(): void;
  maximize(): void;
  close(): void;
  onPlatform(cb: (platform: string) => void): void;
  openExternal(url: string): void;
  send(
    conversationId: string,
    text: string,
    attachmentPaths?: string[],
  ): Promise<{ messageId: string; queued: boolean } | { info: string }>;
  pickAttachments(): Promise<string[]>;
  savePastedImage(base64Png: string): Promise<string>;
  getPathForFile(file: File): string;
  cancel(conversationId: string, messageId: string): Promise<boolean>;
  compress(conversationId: string): Promise<{ removed: number }>;
  onEvent(cb: (messageId: string, event: StreamEvent) => void): void;
  historyList(): Promise<Array<{ session_id: string; title: string; pinned: boolean }>>;
  historyLoad(sessionId: string): Promise<{ title: string; messages: any[] }>;
  historyNew(): Promise<{ sessionId: string }>;
  historyRename(sessionId: string, title: string): Promise<void>;
  historyPin(sessionId: string, pinned: boolean): Promise<void>;
  historyDelete(sessionId: string): Promise<void>;
  settingsGet(): Promise<any>;
  settingsSave(partial: any): Promise<void>;
  openPath(targetPath: string): Promise<void>;
  skillsList(): Promise<SkillInfo[]>;
  skillsBuiltins(): Promise<SkillInfo[]>;
  skillsSave(skill: SkillInfo, oldName?: string): Promise<void>;
  skillsDelete(name: string): Promise<void>;
  skillsImport(): Promise<{ imported: SkillInfo | null } | { error: string }>;
  skillsGenerate(description: string): Promise<{ skill: SkillInfo } | { error: string }>;
  skillsGenerateInstructions(description: string, name?: string): Promise<string>;
}

declare global {
  interface Window {
    coworkAPI?: CoworkAPI;
    lucide?: { createIcons: () => void };
  }
}

const api = window.coworkAPI;

// ── Platform setup ──────────────────────────────────────────
document.body.classList.add('platform-' + (api?.platform ?? 'unknown'));
api?.onPlatform((p) => {
  document.body.classList.remove('platform-unknown');
  document.body.classList.add('platform-' + p);
});

document.addEventListener('DOMContentLoaded', () => {
  window.lucide?.createIcons();
});

// ── Window controls ─────────────────────────────────────────
document.getElementById('btn-min')?.addEventListener('click', () => api?.minimize());
document.getElementById('btn-max')?.addEventListener('click', () => api?.maximize());
document.getElementById('btn-close')?.addEventListener('click', () => api?.close());

// ── State ────────────────────────────────────────────────────
let currentConversationId = '';
const assistantBubbles = new Map<string, HTMLElement>(); // messageId -> bubble element
const reasoningBoxes = new Map<string, HTMLElement>(); // messageId -> reasoning box element
let inFlightMessageId: string | null = null; // messageId currently being generated for currentConversationId

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Transcript rendering ─────────────────────────────────────
function appendUserBubble(text: string, attachmentPaths: string[] = []): void {
  const inner = document.querySelector('.transcript__inner');
  const thinking = document.getElementById('thinking');
  const bubble = document.createElement('div');
  bubble.className = 'msg msg--user';
  const chips = attachmentPaths.length
    ? `<div class="bubble__attachments">${attachmentPaths
        .map((p) => `<span class="attach-chip" title="${escapeHtml(p)}"><span class="attach-chip__name">📎 ${escapeHtml(shortName(p))}</span></span>`)
        .join('')}</div>`
    : '';
  bubble.innerHTML = `<div class="bubble bubble--user"><p>${escapeHtml(text)}</p>${chips}</div>`;
  inner?.insertBefore(bubble, thinking);
  scrollToBottom();
}

function ensureAssistantBubble(messageId: string): HTMLElement {
  let bubble = assistantBubbles.get(messageId);
  if (bubble) return bubble;
  const inner = document.querySelector('.transcript__inner');
  const thinking = document.getElementById('thinking');
  bubble = document.createElement('div');
  bubble.className = 'msg msg--assistant';
  bubble.innerHTML = `
    <div class="msg__avatar"><i data-lucide="sparkles"></i></div>
    <div class="msg__body">
      <div class="msg__name">Internal Agent</div>
      <div class="msg__text"><p></p></div>
    </div>`;
  inner?.insertBefore(bubble, thinking);
  assistantBubbles.set(messageId, bubble);
  window.lucide?.createIcons();
  return bubble;
}

function appendAssistantText(messageId: string, delta: string): void {
  const bubble = ensureAssistantBubble(messageId);
  const p = bubble.querySelector('.msg__text p');
  if (p) p.textContent = (p.textContent || '') + delta;
  scrollToBottom();
}

function appendAssistantError(messageId: string, message: string): void {
  const bubble = ensureAssistantBubble(messageId);
  const p = bubble.querySelector('.msg__text p');
  if (p) {
    const prefix = p.textContent && p.textContent.trim() ? '\n\n' : '';
    p.textContent = `${p.textContent || ''}${prefix}⚠ ${message}`;
  }
  bubble.classList.add('msg--error');
  scrollToBottom();
}

// ── Reasoning ("thinking") disclosure — reuses the .tool-step collapsible pattern ──
function ensureReasoningBox(messageId: string): HTMLElement {
  let box = reasoningBoxes.get(messageId);
  if (box) return box;
  const bubble = ensureAssistantBubble(messageId);
  box = document.createElement('div');
  box.className = 'tool-step reasoning-box';
  box.innerHTML = `
    <div class="tool-step__hd">
      <i data-lucide="brain" class="tool-step__icon"></i>
      <span class="tool-step__name">Thinking</span>
      <div class="tool-step__spacer"></div>
      <i data-lucide="chevron-down" class="tool-step__caret"></i>
    </div>
    <div class="tool-step__body"><pre class="tool-step__code reasoning-box__text"></pre></div>`;
  box.querySelector('.tool-step__hd')?.addEventListener('click', () => box!.classList.toggle('open'));
  const body = bubble.querySelector('.msg__body');
  const textEl = bubble.querySelector('.msg__text');
  if (body && textEl) body.insertBefore(box, textEl);
  reasoningBoxes.set(messageId, box);
  window.lucide?.createIcons();
  return box;
}

function appendReasoningText(messageId: string, delta: string): void {
  const box = ensureReasoningBox(messageId);
  const pre = box.querySelector('.reasoning-box__text');
  if (pre) pre.textContent = (pre.textContent || '') + delta;
  scrollToBottom();
}

function setThinking(active: boolean): void {
  const thinking = document.getElementById('thinking');
  if (thinking) thinking.style.display = active ? '' : 'none';
}

// ── Stop button ──────────────────────────────────────────────
const btnStop = document.getElementById('btn-stop') as HTMLButtonElement | null;

function setInFlight(messageId: string | null): void {
  inFlightMessageId = messageId;
  if (btnStop) btnStop.hidden = !messageId;
}

btnStop?.addEventListener('click', () => {
  if (currentConversationId && inFlightMessageId) {
    void api?.cancel(currentConversationId, inFlightMessageId);
  }
});

// ── Compress button ──────────────────────────────────────────
const btnCompress = document.querySelector<HTMLButtonElement>('.composer__bar [aria-label="Nén"]');

let composerHintBaseline: string | null = null;
let composerHintBaselineCaptured = false;

function showComposerStatus(message: string): void {
  const hint = document.querySelector('.composer__hint');
  if (!hint) return;
  if (!composerHintBaselineCaptured) {
    composerHintBaseline = hint.textContent;
    composerHintBaselineCaptured = true;
  }
  hint.textContent = message;
  setTimeout(() => {
    if (hint.textContent === message) hint.textContent = composerHintBaseline;
  }, 3000);
}

btnCompress?.addEventListener('click', async () => {
  if (!api || !currentConversationId) {
    showComposerStatus('Chưa có hội thoại nào để nén.');
    return;
  }
  const { removed } = await api.compress(currentConversationId);
  if (removed > 0) {
    showComposerStatus(`Đã nén hội thoại: bỏ ${removed} tin cũ.`);
  } else {
    showComposerStatus('Hội thoại đã ngắn — không cần nén.');
  }
});

// ── Attachments ──────────────────────────────────────────────
let pendingAttachments: string[] = [];
let maxAttachFiles = 10;
void api?.settingsGet().then((s) => {
  const n = Number(s?.attachments?.max_files);
  if (Number.isFinite(n)) maxAttachFiles = n;
});

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

function shortName(p: string): string {
  const name = baseName(p);
  return name.length > 22 ? name.slice(0, 19) + '…' : name;
}

function renderAttachmentChips(): void {
  const strip = document.getElementById('composer-attachments');
  if (!strip) return;
  strip.innerHTML = '';
  for (const p of pendingAttachments) {
    const chip = document.createElement('span');
    chip.className = 'attach-chip';
    chip.title = p;
    const name = document.createElement('span');
    name.className = 'attach-chip__name';
    name.textContent = `📎 ${shortName(p)}`;
    const x = document.createElement('button');
    x.className = 'attach-chip__x';
    x.setAttribute('aria-label', 'Bỏ tệp này');
    x.textContent = '✕';
    x.addEventListener('click', () => {
      pendingAttachments = pendingAttachments.filter((q) => q !== p);
      renderAttachmentChips();
    });
    chip.append(name, x);
    strip.appendChild(chip);
  }
  strip.hidden = pendingAttachments.length === 0;
}

function addAttachments(paths: string[]): void {
  let limited = false;
  for (const p of paths) {
    if (!p || pendingAttachments.includes(p)) continue;
    if (maxAttachFiles > 0 && pendingAttachments.length >= maxAttachFiles) {
      limited = true;
      break;
    }
    pendingAttachments.push(p);
  }
  renderAttachmentChips();
  if (limited) showComposerStatus(`Tối đa ${maxAttachFiles} tệp đính kèm — bỏ qua phần dư.`);
}

const btnAttach = document.querySelector<HTMLButtonElement>('.composer__bar [aria-label="Đính kèm"]');
btnAttach?.addEventListener('click', async () => {
  if (!api) return;
  const paths = await api.pickAttachments();
  if (paths.length) addAttachments(paths);
});

function scrollToBottom(): void {
  const transcript = document.getElementById('transcript');
  if (transcript) transcript.scrollTop = transcript.scrollHeight;
}

// ── Plan panel ───────────────────────────────────────────────
function renderPlan(steps: PlanStep[]): void {
  const container = document.getElementById('plan-card-steps');
  if (!container) return;
  container.innerHTML = steps
    .map((s) => {
      const cls = s.status === 'done' ? 'pstep--done' : s.status === 'running' ? 'pstep--active' : 'pstep--pending';
      const icon = s.status === 'done' ? 'check-circle-2' : s.status === 'running' ? 'loader' : 'circle';
      const spin = s.status === 'running' ? ' class="spin"' : '';
      return `<div class="pstep ${cls}"><i data-lucide="${icon}"${spin}></i><span>${escapeHtml(s.title)}</span></div>`;
    })
    .join('');
  window.lucide?.createIcons();
}

// ── Output files panel ───────────────────────────────────────
function addOutputFile(filePath: string): void {
  const container = document.getElementById('output-files');
  if (!container) return;
  const name = filePath.split(/[\\/]/).pop() || filePath;
  const item = document.createElement('div');
  item.className = 'file-item file-item--elevated';
  item.dataset.path = filePath;
  item.innerHTML = `
    <i data-lucide="file-text" class="fi-icon fi-icon--doc"></i>
    <div class="fi-info"><div class="fi-name">${escapeHtml(name)}</div><div class="fi-meta">vừa cập nhật</div></div>
    <i data-lucide="external-link" class="fi-action"></i>`;
  item.addEventListener('click', () => api?.openPath(filePath));
  container.appendChild(item);
  window.lucide?.createIcons();
}

function removeOutputFile(filePath: string): void {
  const container = document.getElementById('output-files');
  container?.querySelector(`[data-path="${CSS.escape(filePath)}"]`)?.remove();
}

// ── Event stream from main ───────────────────────────────────
api?.onEvent((messageId, event: StreamEvent) => {
  setThinking(true);
  switch (event.type) {
    case 'text':
      appendAssistantText(messageId, event.delta);
      break;
    case 'reasoning':
      appendReasoningText(messageId, event.delta);
      break;
    case 'assistant_done':
      setThinking(false);
      if (inFlightMessageId === messageId) setInFlight(null);
      break;
    case 'plan_set':
      renderPlan(event.steps);
      break;
    case 'tool_result':
      if (event.path) addOutputFile(event.path);
      break;
    case 'outputs_added':
      event.paths.forEach(addOutputFile);
      break;
    case 'outputs_removed':
      event.paths.forEach(removeOutputFile);
      break;
    case 'error':
      appendAssistantError(messageId, event.message);
      setThinking(false);
      if (inFlightMessageId === messageId) setInFlight(null);
      break;
    default:
      break;
  }
});

// ── Composer: Enter = send, Shift+Enter = newline ────────────
const composerInput = document.getElementById('composer-input') as HTMLElement | null;
const btnSend = document.getElementById('btn-send');

// ── /skill autocomplete popup ─────────────────────────────────
const skillPopup = document.getElementById('skill-popup') as HTMLElement | null;
let popupEntries: Array<{ slug: string; label: string; desc: string }> = [];
let popupIndex = 0;

function skillFilter(text: string): string | null {
  const first = text.split('\n', 1)[0];
  if (first.length >= 2 && '/skill'.startsWith(first)) return '';
  const m = /^\/skill:?([\w\-.]*)$/.exec(first);
  return m ? m[1] : null;
}

function slugify(name: string): string {
  // display-only slug for popup insertion; the authoritative slug lives in main.
  let s = '';
  for (const ch of name.trim().toLowerCase()) {
    s += /[\p{L}\p{N}\-_]/u.test(ch) ? ch : '-';
  }
  return s.split('-').filter(Boolean).join('-') || 'skill';
}

function hideSkillPopup(): void {
  if (skillPopup) skillPopup.hidden = true;
  popupEntries = [];
}

function renderSkillPopup(): void {
  if (!skillPopup) return;
  skillPopup.innerHTML = '';
  popupEntries.forEach((entry, i) => {
    const item = document.createElement('div');
    item.className =
      'skill-popup__item' +
      (i === popupIndex ? ' skill-popup__item--active' : '') +
      (entry.slug === '__manage__' ? ' skill-popup__item--manage' : '');
    item.textContent = entry.label;
    if (entry.desc) {
      const d = document.createElement('span');
      d.className = 'skill-popup__desc';
      d.textContent = `  —  ${entry.desc}`;
      item.appendChild(d);
    }
    item.addEventListener('mousedown', (e) => {
      e.preventDefault(); // keep composer focus
      acceptSkillEntry(entry.slug);
    });
    skillPopup.appendChild(item);
  });
  skillPopup.hidden = popupEntries.length === 0;
}

function acceptSkillEntry(slug: string): void {
  hideSkillPopup();
  if (slug === '__manage__') {
    openSkillsModal();
    return;
  }
  if (!slug || !composerInput) return;
  composerInput.innerText = `/skill:${slug} `;
  composerInput.focus();
  const range = document.createRange();
  range.selectNodeContents(composerInput);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

async function maybeShowSkillPopup(): Promise<void> {
  if (!api || !composerInput || !skillPopup) return;
  const filter = skillFilter(composerInput.innerText);
  if (filter === null) {
    hideSkillPopup();
    return;
  }
  const [user, builtins] = await Promise.all([api.skillsList(), api.skillsBuiltins()]);
  const pool = [...user, ...builtins];
  const f = filter.toLowerCase();
  const matches = pool.filter(
    (s) =>
      s.name.toLowerCase().includes(f) ||
      slugify(s.name).includes(f) ||
      (s.description || '').toLowerCase().includes(f),
  );
  popupEntries = matches.map((s) => ({
    slug: slugify(s.name),
    label: (s.enabled ? '✓ ' : '   ') + s.name,
    desc: s.description || '',
  }));
  if (!matches.length) popupEntries.push({ slug: '', label: '   (no skills yet)', desc: '' });
  popupEntries.push({ slug: '__manage__', label: '⚙  Manage skills…', desc: '' });
  popupIndex = matches.length ? 0 : popupEntries.length - 1;
  renderSkillPopup();
}

composerInput?.addEventListener('input', () => void maybeShowSkillPopup());

composerInput?.addEventListener('blur', () => {
  // mousedown on popup items calls preventDefault, so blur here means "clicked away".
  setTimeout(hideSkillPopup, 120);
});

composerInput?.addEventListener('keydown', (e) => {
  const key = (e as KeyboardEvent).key;
  if (skillPopup && !skillPopup.hidden) {
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      e.preventDefault();
      const n = popupEntries.length;
      if (n) popupIndex = (popupIndex + (key === 'ArrowDown' ? 1 : -1) + n) % n;
      renderSkillPopup();
      return;
    }
    if (key === 'Tab') {
      e.preventDefault();
      acceptSkillEntry(popupEntries[popupIndex]?.slug || '');
      return;
    }
    if (key === 'Escape') {
      e.preventDefault();
      hideSkillPopup();
      return;
    }
    if (key === 'Enter' && !(e as KeyboardEvent).shiftKey) {
      hideSkillPopup(); // fall through to send below
    }
  }
  if (key === 'Enter' && !(e as KeyboardEvent).shiftKey) {
    e.preventDefault();
    void sendMessage();
  }
});

composerInput?.addEventListener('paste', (e) => {
  const items = (e as ClipboardEvent).clipboardData?.items;
  if (!items || !api) return;
  for (const item of Array.from(items)) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (!file) continue;
    e.preventDefault();
    const realPath = api.getPathForFile(file);
    if (realPath) {
      addAttachments([realPath]);
    } else if (file.type.startsWith('image/')) {
      // Clipboard screenshot: no disk path — save it via main, then attach the saved file.
      void file.arrayBuffer().then((buf) => {
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        return api!.savePastedImage(base64).then((saved) => addAttachments([saved]));
      });
    }
  }
});

composerInput?.addEventListener('dragover', (e) => {
  if ((e as DragEvent).dataTransfer?.types.includes('Files')) e.preventDefault();
});

composerInput?.addEventListener('drop', (e) => {
  const files = (e as DragEvent).dataTransfer?.files;
  if (!files || !files.length || !api) return;
  e.preventDefault();
  const paths = Array.from(files)
    .map((f) => api!.getPathForFile(f))
    .filter(Boolean);
  if (paths.length) addAttachments(paths);
});

btnSend?.addEventListener('click', () => void sendMessage());

async function sendMessage(): Promise<void> {
  const text = composerInput?.innerText.trim() || '';
  if ((!text && !pendingAttachments.length) || !api) return;

  if (!currentConversationId) {
    const { sessionId } = await api.historyNew();
    currentConversationId = sessionId;
  }

  const attachments = [...pendingAttachments];
  pendingAttachments = [];
  renderAttachmentChips();

  appendUserBubble(text || '(tệp đính kèm)', attachments);
  composerInput!.innerText = '';
  composerInput!.focus();

  const result = await api.send(currentConversationId, text, attachments);
  if ('info' in result) {
    // Local /skill command answered inline — restore any attachments that were
    // snapshotted for this send; they were not consumed by a real turn.
    if (attachments.length) {
      pendingAttachments = attachments;
      renderAttachmentChips();
    }
    appendAssistantText(`info_${Math.random()}`, result.info);
    return;
  }
  setInFlight(result.messageId);
}

// ── History sidebar ───────────────────────────────────────────
async function refreshHistoryList(): Promise<void> {
  if (!api) return;
  const items = await api.historyList();
  const list = document.getElementById('history-list');
  if (!list) return;
  list.innerHTML = items
    .map(
      (item) => `
    <div class="history-item${item.session_id === currentConversationId ? ' history-item--active' : ''}" data-session-id="${escapeHtml(item.session_id)}">
      <i data-lucide="message-square" class="hi-icon"></i>
      <div class="hi-body">
        <div class="hi-title">${escapeHtml(item.title)}</div>
        <div class="hi-meta"><span class="badge badge--cowork">COWORK</span></div>
      </div>
      <div class="hi-actions">
        <button class="hi-action-btn" data-action="pin" aria-label="Ghim" title="${item.pinned ? 'Bỏ ghim' : 'Ghim'}">
          <i data-lucide="pin" class="${item.pinned ? 'hi-icon--accent' : ''}"></i>
        </button>
        <button class="hi-action-btn" data-action="rename" aria-label="Đổi tên" title="Đổi tên">
          <i data-lucide="pencil"></i>
        </button>
        <button class="hi-action-btn" data-action="delete" aria-label="Xóa" title="Xóa">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
    </div>`,
    )
    .join('');
  list.querySelectorAll<HTMLElement>('.history-item').forEach((el) => {
    const sessionId = el.dataset.sessionId!;
    el.addEventListener('click', () => void openConversation(sessionId));

    el.querySelector('[data-action="pin"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = items.find((i) => i.session_id === sessionId);
      void api!.historyPin(sessionId, !(item?.pinned ?? false)).then(() => refreshHistoryList());
    });

    el.querySelector('[data-action="rename"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = items.find((i) => i.session_id === sessionId);
      const newTitle = window.prompt('Đổi tên cuộc trò chuyện', item?.title || '');
      if (newTitle && newTitle.trim()) {
        void api!.historyRename(sessionId, newTitle.trim()).then(() => refreshHistoryList());
      }
    });

    el.querySelector('[data-action="delete"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!window.confirm('Xóa cuộc trò chuyện này?')) return;
      void api!.historyDelete(sessionId).then(() => {
        if (sessionId === currentConversationId) {
          currentConversationId = '';
          const inner = document.querySelector('.transcript__inner');
          inner?.querySelectorAll('.msg').forEach((m) => m.remove());
          assistantBubbles.clear();
          reasoningBoxes.clear();
          const titleEl = document.getElementById('chat-title');
          if (titleEl) titleEl.textContent = 'Cuộc trò chuyện mới';
        }
        return refreshHistoryList();
      });
    });
  });
  window.lucide?.createIcons();
}

async function highlightLastSession(): Promise<void> {
  if (!api) return;
  const settings = await api.settingsGet();
  const lastSessionId = settings?.last_session?.cowork;
  if (!lastSessionId) return;
  const item = document.querySelector(`.history-item[data-session-id="${CSS.escape(lastSessionId)}"]`);
  item?.classList.add('history-item--last-session');
}

async function openConversation(sessionId: string): Promise<void> {
  if (!api) return;
  currentConversationId = sessionId;
  const record = await api.historyLoad(sessionId);
  const inner = document.querySelector('.transcript__inner');
  const thinking = document.getElementById('thinking');
  inner?.querySelectorAll('.msg').forEach((m) => m.remove());
  assistantBubbles.clear();
  reasoningBoxes.clear();

  for (const message of record.messages) {
    if (message.role === 'user') {
      const display = message.display ?? contentText(message.content);
      appendUserBubble(display || '(tệp đính kèm)', message.attachments || []);
    } else if (message.role === 'assistant') {
      const tempId = `history_${Math.random()}`;
      const text = contentText(message.content);
      if (text.trim()) {
        appendAssistantText(tempId, text);
      } else {
        appendAssistantText(tempId, '✓ (tool actions completed)');
      }
    }
  }

  const titleEl = document.getElementById('chat-title');
  if (titleEl) titleEl.textContent = record.title || 'Cuộc trò chuyện mới';
  void thinking;
  await refreshHistoryList();
}

document.getElementById('btn-new-chat')?.addEventListener('click', () => {
  currentConversationId = '';
  const inner = document.querySelector('.transcript__inner');
  inner?.querySelectorAll('.msg').forEach((m) => m.remove());
  assistantBubbles.clear();
  reasoningBoxes.clear();
  setInFlight(null);
  const titleEl = document.getElementById('chat-title');
  if (titleEl) titleEl.textContent = 'Cuộc trò chuyện mới';
  composerInput?.focus();
});

// ── Settings modal ────────────────────────────────────────────
const settingsModal = document.getElementById('settings-modal') as HTMLElement | null;
document.getElementById('btn-settings')?.addEventListener('click', async () => {
  if (!api || !settingsModal) return;
  const data = await api.settingsGet();
  (document.getElementById('settings-provider') as HTMLSelectElement).value = data.active_provider;
  const conf = data.providers[data.active_provider];
  (document.getElementById('settings-base-url') as HTMLInputElement).value = conf.base_url || '';
  (document.getElementById('settings-api-key') as HTMLInputElement).value = conf.api_key || '';
  (document.getElementById('settings-model') as HTMLInputElement).value = conf.model || '';
  settingsModal.hidden = false;
});

document.getElementById('settings-cancel')?.addEventListener('click', () => {
  if (settingsModal) settingsModal.hidden = true;
});

document.getElementById('settings-save')?.addEventListener('click', async () => {
  if (!api || !settingsModal) return;
  const provider = (document.getElementById('settings-provider') as HTMLSelectElement).value;
  const baseUrl = (document.getElementById('settings-base-url') as HTMLInputElement).value;
  const apiKey = (document.getElementById('settings-api-key') as HTMLInputElement).value;
  const model = (document.getElementById('settings-model') as HTMLInputElement).value;
  const current = await api.settingsGet();
  current.active_provider = provider;
  current.providers[provider] = { ...current.providers[provider], base_url: baseUrl, api_key: apiKey, model };
  await api.settingsSave(current);
  settingsModal.hidden = true;
});

// ── Skills manager ───────────────────────────────────────────
const skillsModal = document.getElementById('skills-modal') as HTMLElement | null;
const skillEditModal = document.getElementById('skill-edit-modal') as HTMLElement | null;
const skillGenModal = document.getElementById('skill-gen-modal') as HTMLElement | null;

let managerSkills: SkillInfo[] = [];
let selectedSkillName: string | null = null;
let editingOldName = '';

async function refreshSkillsList(): Promise<void> {
  if (!api) return;
  managerSkills = await api.skillsList();
  const list = document.getElementById('skills-list');
  if (!list) return;
  if (!managerSkills.length) {
    list.innerHTML = `<div class="skills-empty">(No skills yet — click '✨ Auto-generate' or 'Import…')</div>`;
    selectedSkillName = null;
    return;
  }
  if (!managerSkills.some((s) => s.name === selectedSkillName)) selectedSkillName = null;
  list.innerHTML = '';
  for (const skill of managerSkills) {
    const row = document.createElement('div');
    row.className = 'skill-row' + (skill.name === selectedSkillName ? ' skill-row--selected' : '');
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = skill.enabled;
    check.addEventListener('click', (e) => e.stopPropagation());
    check.addEventListener('change', () => {
      void api!.skillsSave({ ...skill, enabled: check.checked }).then(refreshSkillsList);
    });
    const label = document.createElement('span');
    label.textContent = skill.name + (skill.description ? '  —  ' : '');
    const desc = document.createElement('span');
    desc.className = 'skill-row__desc';
    desc.textContent = skill.description;
    row.append(check, label, desc);
    row.addEventListener('click', () => {
      selectedSkillName = skill.name;
      void refreshSkillsList();
    });
    list.appendChild(row);
  }
}

function openSkillsModal(): void {
  if (!skillsModal) return;
  skillsModal.hidden = false;
  void refreshSkillsList();
}

function openSkillEditor(skill: SkillInfo | null): void {
  if (!skillEditModal) return;
  editingOldName = skill?.name || '';
  (document.getElementById('skill-edit-title') as HTMLElement).textContent = skill ? 'Edit skill' : 'New skill';
  (document.getElementById('skill-name') as HTMLInputElement).value = skill?.name || '';
  (document.getElementById('skill-description') as HTMLInputElement).value = skill?.description || '';
  (document.getElementById('skill-instructions') as HTMLTextAreaElement).value = skill?.instructions || '';
  skillEditModal.hidden = false;
}

document.getElementById('btn-skills')?.addEventListener('click', openSkillsModal);
document.getElementById('skills-close')?.addEventListener('click', () => {
  if (skillsModal) skillsModal.hidden = true;
});

document.getElementById('skills-edit')?.addEventListener('click', () => {
  const skill = managerSkills.find((s) => s.name === selectedSkillName);
  if (skill) openSkillEditor(skill);
  else showComposerStatus('Chọn một skill trong danh sách trước.');
});

document.getElementById('skills-delete')?.addEventListener('click', () => {
  const skill = managerSkills.find((s) => s.name === selectedSkillName);
  if (!skill) {
    showComposerStatus('Chọn một skill trong danh sách trước.');
    return;
  }
  if (!window.confirm(`Xóa skill "${skill.name}"?`)) return;
  void api!.skillsDelete(skill.name).then(refreshSkillsList);
});

document.getElementById('skills-import')?.addEventListener('click', async () => {
  if (!api) return;
  const result = await api.skillsImport();
  if ('error' in result) window.alert(result.error);
  await refreshSkillsList();
});

document.getElementById('skill-edit-cancel')?.addEventListener('click', () => {
  if (skillEditModal) skillEditModal.hidden = true;
});

document.getElementById('skill-edit-save')?.addEventListener('click', async () => {
  if (!api || !skillEditModal) return;
  const name = (document.getElementById('skill-name') as HTMLInputElement).value.trim();
  if (!name) {
    window.alert('Skill cần có tên.');
    return;
  }
  const existing = managerSkills.find((s) => s.name === editingOldName);
  await api.skillsSave(
    {
      name,
      description: (document.getElementById('skill-description') as HTMLInputElement).value.trim(),
      instructions: (document.getElementById('skill-instructions') as HTMLTextAreaElement).value.trim(),
      enabled: existing ? existing.enabled : false,
    },
    editingOldName || undefined,
  );
  skillEditModal.hidden = true;
  await refreshSkillsList();
});

document.getElementById('skill-gen-instructions')?.addEventListener('click', async () => {
  if (!api) return;
  const name = (document.getElementById('skill-name') as HTMLInputElement).value.trim();
  const desc = (document.getElementById('skill-description') as HTMLInputElement).value.trim();
  if (!desc && !name) {
    window.alert('Nhập mô tả ngắn trước.');
    return;
  }
  const btn = document.getElementById('skill-gen-instructions') as HTMLButtonElement;
  btn.disabled = true;
  try {
    const text = await api.skillsGenerateInstructions(desc, name);
    if (text) (document.getElementById('skill-instructions') as HTMLTextAreaElement).value = text;
    else window.alert('Không sinh được nội dung — kiểm tra cấu hình model.');
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('skills-generate')?.addEventListener('click', () => {
  if (!skillGenModal) return;
  (document.getElementById('skill-gen-desc') as HTMLTextAreaElement).value = '';
  skillGenModal.hidden = false;
});

document.getElementById('skill-gen-cancel')?.addEventListener('click', () => {
  if (skillGenModal) skillGenModal.hidden = true;
});

document.getElementById('skill-gen-ok')?.addEventListener('click', async () => {
  if (!api || !skillGenModal) return;
  const desc = (document.getElementById('skill-gen-desc') as HTMLTextAreaElement).value.trim();
  if (!desc) return;
  const btn = document.getElementById('skill-gen-ok') as HTMLButtonElement;
  btn.disabled = true;
  try {
    const result = await api.skillsGenerate(desc);
    if ('error' in result) {
      window.alert(`Không sinh được skill: ${result.error}`);
      return;
    }
    skillGenModal.hidden = true;
    openSkillEditor(result.skill); // review before saving, like the Python dialog
    editingOldName = ''; // NEW skill: saving must not delete any existing file (openSkillEditor set it to the generated name)
  } finally {
    btn.disabled = false;
  }
});

// ── Sidebar / panel collapse (unchanged from the static mockup) ──
const sidebar = document.getElementById('sidebar');
const btnCollapse = document.getElementById('btn-collapse-sidebar');

function setSidebar(expanded: boolean): void {
  if (!sidebar || !btnCollapse) return;
  sidebar.dataset.expanded = expanded ? 'true' : 'false';
  const icon = btnCollapse.querySelector('i');
  icon?.setAttribute('data-lucide', expanded ? 'panel-left-close' : 'panel-left-open');
  window.lucide?.createIcons();
}

btnCollapse?.addEventListener('click', () => setSidebar(sidebar?.dataset.expanded === 'false'));

const rightPanel = document.getElementById('right-panel');
const btnCollapseRp = document.getElementById('btn-collapse-panel');

function setPanel(expanded: boolean): void {
  if (!rightPanel || !btnCollapseRp) return;
  rightPanel.dataset.expanded = expanded ? 'true' : 'false';
  const icon = btnCollapseRp.querySelector('i');
  icon?.setAttribute('data-lucide', expanded ? 'panel-right-close' : 'panel-right-open');
  window.lucide?.createIcons();
}

btnCollapseRp?.addEventListener('click', () => setPanel(rightPanel?.dataset.expanded === 'false'));

// ── Init ───────────────────────────────────────────────────────
window.addEventListener('load', () => {
  scrollToBottom();
  window.lucide?.createIcons();
  void refreshHistoryList().then(() => void highlightLastSession());
});
