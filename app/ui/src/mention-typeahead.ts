/**
 * @-mention typeahead over workspace files for the Cowork composer.
 *
 * Typing `@` (at the start of the text or after whitespace) opens a popup listing files of the
 * active workspace; picking one inserts `@<relativePath> ` into the prompt. The mention is plain
 * text — the agent resolves the path with its ordinary read tools, so no new capability boundary
 * is introduced here. The file list comes from the guarded `/v1/workspace/list` endpoint via a
 * bounded breadth-first walk (depth/count capped) and is cached per workspace root.
 *
 * Pure token/filter/apply logic is exported separately so it is unit-testable without a DOM.
 */

export interface MentionToken {
  /** Index of the `@` in the composer plain text. */
  readonly start: number;
  /** Text between the `@` and the caret. */
  readonly fragment: string;
}

/** Find the active `@fragment` token ending at the caret, or null when none is active. */
export function findMentionToken(text: string, caret: number): MentionToken | null {
  if (caret < 0 || caret > text.length) return null;
  for (let i = caret - 1; i >= 0; i -= 1) {
    const ch = text[i]!;
    if (ch === "@") {
      // `@` must start the text or follow whitespace, so emails/handles mid-word never trigger.
      if (i > 0 && !/\s/u.test(text[i - 1]!)) return null;
      return { start: i, fragment: text.slice(i + 1, caret) };
    }
    if (/\s/u.test(ch)) return null;
  }
  return null;
}

/** Rank workspace paths for a fragment: basename prefix < path prefix < basename hit < path hit. */
export function filterMentionCandidates(
  paths: readonly string[],
  fragment: string,
  limit = 8,
): readonly string[] {
  const needle = fragment.toLowerCase();
  if (needle.length === 0) return paths.slice(0, limit);
  const scored: { path: string; score: number }[] = [];
  for (const path of paths) {
    const lower = path.toLowerCase();
    const base = lower.split(/[\\/]/u).pop() ?? lower;
    let score: number;
    if (base.startsWith(needle)) score = 0;
    else if (lower.startsWith(needle)) score = 1;
    else if (base.includes(needle)) score = 2;
    else if (lower.includes(needle)) score = 3;
    else continue;
    scored.push({ path, score });
  }
  scored.sort((a, b) => (a.score !== b.score ? a.score - b.score : a.path.localeCompare(b.path)));
  return scored.slice(0, limit).map((entry) => entry.path);
}

/** Replace the active token with `@<path> ` and report the caret position after the space. */
export function applyMention(
  text: string,
  token: MentionToken,
  caret: number,
  path: string,
): { readonly text: string; readonly caret: number } {
  const inserted = `@${path} `;
  return {
    text: text.slice(0, token.start) + inserted + text.slice(caret),
    caret: token.start + inserted.length,
  };
}

// ---------------------------------------------------------------------------
// Bounded workspace file index
// ---------------------------------------------------------------------------

interface MentionListEntry {
  readonly name: string;
  readonly relativePath: string;
  readonly kind: "file" | "folder";
}

export interface MentionFileSource {
  listWorkspaceChildren(
    relativePath?: string,
    limit?: number,
  ): Promise<{ readonly entries: readonly MentionListEntry[] }>;
}

export const MENTION_INDEX_MAX_FILES = 400;
export const MENTION_INDEX_MAX_DEPTH = 3;
const MENTION_SKIPPED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "dist-app",
  ".runtime",
  "__pycache__",
]);

/** Breadth-first bounded walk of the active workspace; returns file relative paths. */
export async function buildMentionIndex(client: MentionFileSource): Promise<readonly string[]> {
  const files: string[] = [];
  const queue: { path: string; depth: number }[] = [{ path: "", depth: 0 }];
  while (queue.length > 0 && files.length < MENTION_INDEX_MAX_FILES) {
    const { path, depth } = queue.shift()!;
    let entries: readonly MentionListEntry[];
    try {
      entries = (await client.listWorkspaceChildren(path, 200)).entries;
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.kind === "file") {
        files.push(entry.relativePath);
        if (files.length >= MENTION_INDEX_MAX_FILES) break;
      } else if (depth + 1 <= MENTION_INDEX_MAX_DEPTH && !MENTION_SKIPPED_DIRS.has(entry.name)) {
        queue.push({ path: entry.relativePath, depth: depth + 1 });
      }
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// DOM controller (popup + keyboard)
// ---------------------------------------------------------------------------

export interface MentionTypeaheadOptions {
  /** The contenteditable composer input (plain text via textContent). */
  readonly input: HTMLElement;
  /** Element the popup is appended to; must be a positioning context. */
  readonly anchor: HTMLElement;
  readonly getClient: () => MentionFileSource | null;
  /** Active workspace root path; index cache is keyed by it. Null hides the popup. */
  readonly getWorkspace: () => string | null;
  /** Called after a mention is inserted (composer chrome resync). */
  readonly onApplied: () => void;
  /**
   * Called with the picked file's workspace-relative path after it is inserted. The composer
   * uses this to also attach the file's content (so `@file` both references the path in the
   * prompt AND pulls the file into context, like Claude Code). Optional — omit to only insert text.
   */
  readonly onPicked?: (relativePath: string) => void;
}

export interface MentionTypeahead {
  /** Recompute the popup from the current text/caret. Call from the input event. */
  refresh(): void;
  /** Returns true when the event drove the popup and must not reach other handlers. */
  handleKeydown(event: KeyboardEvent): boolean;
  hide(): void;
}

function caretOffset(input: HTMLElement): number | null {
  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!input.contains(range.endContainer)) return null;
  const pre = range.cloneRange();
  pre.selectNodeContents(input);
  pre.setEnd(range.endContainer, range.endOffset);
  return pre.toString().length;
}

function placeCaret(input: HTMLElement, offset: number): void {
  const selection = window.getSelection();
  if (selection === null) return;
  const range = document.createRange();
  let remaining = offset;
  const walker = document.createTreeWalker(input, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (remaining <= length) {
      range.setStart(node, remaining);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    remaining -= length;
  }
  range.selectNodeContents(input);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function createMentionTypeahead(options: MentionTypeaheadOptions): MentionTypeahead {
  const popup = document.createElement("div");
  popup.className = "mention-popup";
  popup.hidden = true;
  popup.setAttribute("role", "listbox");
  popup.setAttribute("aria-label", "Gợi ý tệp workspace");
  options.anchor.append(popup);

  let items: readonly string[] = [];
  let selected = 0;
  let activeToken: MentionToken | null = null;
  let activeCaret = 0;
  let index: readonly string[] | null = null;
  let indexWorkspace: string | null = null;
  let loading = false;

  function hide(): void {
    popup.hidden = true;
    activeToken = null;
    items = [];
  }

  function accept(path: string): void {
    if (activeToken === null) return;
    const text = options.input.textContent ?? "";
    const applied = applyMention(text, activeToken, activeCaret, path);
    options.input.textContent = applied.text;
    placeCaret(options.input, applied.caret);
    hide();
    options.onApplied();
    options.onPicked?.(path);
  }

  function render(): void {
    popup.replaceChildren();
    if (loading) {
      const note = document.createElement("div");
      note.className = "mention-popup__empty";
      note.textContent = "Đang quét workspace…";
      popup.append(note);
      popup.hidden = false;
      return;
    }
    if (items.length === 0) {
      hide();
      return;
    }
    items.forEach((path, i) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `mention-popup__item${i === selected ? " is-selected" : ""}`;
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", i === selected ? "true" : "false");
      row.textContent = path;
      // mousedown (not click) so the composer never loses focus/caret before we apply.
      row.addEventListener("mousedown", (event) => {
        event.preventDefault();
        accept(path);
      });
      popup.append(row);
    });
    popup.hidden = false;
  }

  function ensureIndex(): void {
    const workspace = options.getWorkspace();
    const client = options.getClient();
    if (workspace === null || client === null) return;
    if (index !== null && indexWorkspace === workspace) return;
    if (loading) return;
    loading = true;
    void buildMentionIndex(client)
      .then((files) => {
        index = files;
        indexWorkspace = workspace;
      })
      .catch(() => {
        index = [];
        indexWorkspace = workspace;
      })
      .finally(() => {
        loading = false;
        refresh();
      });
  }

  function refresh(): void {
    const workspace = options.getWorkspace();
    if (workspace === null || options.getClient() === null) {
      hide();
      return;
    }
    const text = options.input.textContent ?? "";
    const caret = caretOffset(options.input);
    const token = caret === null ? null : findMentionToken(text, caret);
    if (token === null) {
      hide();
      return;
    }
    activeToken = token;
    activeCaret = caret!;
    if (index === null || indexWorkspace !== workspace) {
      ensureIndex();
      render();
      return;
    }
    items = filterMentionCandidates(index, token.fragment);
    if (selected >= items.length) selected = 0;
    render();
  }

  function handleKeydown(event: KeyboardEvent): boolean {
    if (popup.hidden) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (items.length > 0) {
        selected =
          event.key === "ArrowDown"
            ? (selected + 1) % items.length
            : (selected - 1 + items.length) % items.length;
        render();
      }
      event.preventDefault();
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      const path = items[selected];
      event.preventDefault();
      if (path !== undefined) accept(path);
      else hide();
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      hide();
      return true;
    }
    return false;
  }

  return { refresh, handleKeydown, hide };
}
