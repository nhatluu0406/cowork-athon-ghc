/**
 * Safe Markdown rendering for Cowork assistant answers.
 *
 * Pipeline: `marked` (GFM: headings, bold/italic, lists, links, blockquote, inline + fenced code,
 * tables, hr, strikethrough, task lists) → `DOMPurify` sanitize → `highlight.js` for fenced code.
 *
 * Security invariants (exhibition-grade):
 *   - No raw HTML execution: DOMPurify strips `<script>`, `<iframe>`, `<object>`, `<embed>`, inline
 *     event handlers, and `javascript:` / other unsafe protocols by construction; we additionally
 *     forbid form controls and inline `style`.
 *   - Links are neutralized safely: the Electron shell denies `window.open` and off-origin
 *     navigation and exposes no `openExternal` bridge, so we force `target="_blank"` +
 *     `rel="noopener noreferrer nofollow"` — a click becomes a harmless no-op instead of hijacking
 *     the single-page app. (Same-origin/relative links therefore cannot navigate the app away.)
 *   - Task-list checkboxes are allowed but forced disabled + type=checkbox with no name/value.
 *
 * Streaming-safe: the caller passes the FULL accumulated (already tool/thinking-sanitized) text on
 * every repaint and we re-parse the whole string, so incomplete Markdown mid-stream just renders as
 * partial content (never throws, never duplicates). On any parse failure we fall back to plain text.
 */

import { marked } from "marked";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";

// GFM on; soft single-newline → <br> reads better for chat prose.
marked.setOptions({ gfm: true, breaks: true });

let hooksInstalled = false;
function ensureHooks(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    const el = node as Element;
    if (el.tagName === "A") {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer nofollow");
    }
    if (el.tagName === "INPUT") {
      // Only GFM task-list checkboxes survive, always inert (keep `checked` for `[x]` items).
      el.setAttribute("type", "checkbox");
      el.setAttribute("disabled", "");
      el.removeAttribute("name");
      el.removeAttribute("value");
    }
  });
}

const PURIFY_CONFIG = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form", "button", "textarea", "select"],
  FORBID_ATTR: ["style"],
  ALLOW_DATA_ATTR: false,
};

/** Parse Markdown → sanitized HTML string (no DOM side effects). Falls back to escaped text. */
export function markdownToSafeHtml(markdown: string): string {
  ensureHooks();
  let rawHtml: string;
  try {
    rawHtml = marked.parse(markdown, { async: false }) as string;
  } catch {
    return escapeHtml(markdown);
  }
  return DOMPurify.sanitize(rawHtml, PURIFY_CONFIG) as unknown as string;
}

/**
 * Render sanitized Markdown into `container` (replacing its content) and highlight fenced code.
 * `container` should be the `.msg__text` box; block-level Markdown cannot live inside a `<p>`.
 */
export function renderAssistantMarkdown(container: HTMLElement, markdown: string): void {
  container.classList.add("md");
  if (markdown.trim().length === 0) {
    container.replaceChildren();
    return;
  }
  container.innerHTML = markdownToSafeHtml(markdown);
  const blocks = container.querySelectorAll<HTMLElement>("pre code");
  blocks.forEach((block) => {
    const languageClass = [...block.classList].find((c) => c.startsWith("language-"));
    const language = languageClass?.slice("language-".length);
    try {
      const result =
        language !== undefined && hljs.getLanguage(language) !== undefined
          ? hljs.highlight(block.textContent ?? "", { language, ignoreIllegals: true })
          : hljs.highlightAuto(block.textContent ?? "");
      block.innerHTML = result.value;
      block.classList.add("hljs");
    } catch {
      // Leave the DOMPurify-escaped source as-is on any highlight failure.
    }
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
