// This suite uses jsdom (NOT the shared happy-dom setup): DOMPurify does not sanitize correctly under
// happy-dom (it leaves <script> intact), so a faithful XSS test needs a real DOM. jsdom globals are
// installed BEFORE importing markdown-message so its module-level DOMPurify binds to this window.
// node --test runs each file in its own process, so these globals never leak into the happy-dom suites.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const jsdom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
const g = globalThis as unknown as Record<string, unknown>;
for (const key of [
  "window",
  "document",
  "DocumentFragment",
  "Node",
  "Element",
  "HTMLElement",
  "NodeFilter",
  "DOMParser",
] as const) {
  g[key] = (jsdom.window as unknown as Record<string, unknown>)[key];
}

const { markdownToSafeHtml, renderAssistantMarkdown } = await import("../src/markdown-message.js");

test("renders common Markdown block elements", () => {
  const html = markdownToSafeHtml(
    "# Title\n\nSome **bold** and *italic* and `inline`.\n\n- one\n- two\n\n1. first\n2. second\n\n> quote\n\n---\n",
  );
  assert.match(html, /<h1[^>]*>Title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<code>inline<\/code>/);
  assert.match(html, /<ul>[\s\S]*<li>one<\/li>/);
  assert.match(html, /<ol>[\s\S]*<li>first<\/li>/);
  assert.match(html, /<blockquote>[\s\S]*quote/);
  assert.match(html, /<hr\s*\/?>/);
});

test("renders GFM tables and fenced code with a language class", () => {
  const html = markdownToSafeHtml(
    "| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```js\nconst x = 1;\n```\n",
  );
  assert.match(html, /<table>/);
  assert.match(html, /<th>a<\/th>/);
  assert.match(html, /<td>1<\/td>/);
  assert.match(html, /<pre><code class="language-js">/);
});

test("strips script tags and does not execute raw HTML", () => {
  const html = markdownToSafeHtml('Hello <script>window.__pwned = 1;</script> world');
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /__pwned/);
});

test("strips iframe and object/embed", () => {
  const html = markdownToSafeHtml('<iframe src="https://evil"></iframe><object></object><embed>');
  assert.doesNotMatch(html, /<iframe/i);
  assert.doesNotMatch(html, /<object/i);
  assert.doesNotMatch(html, /<embed/i);
});

test("neutralizes javascript: and event-handler URLs", () => {
  const html = markdownToSafeHtml('[click](javascript:alert(1)) and <a href="javascript:evil()" onclick="x()">y</a>');
  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /onclick/i);
});

test("external links get target=_blank + rel noopener (no SPA hijack / opener)", () => {
  const html = markdownToSafeHtml("[site](https://example.com)");
  assert.match(html, /<a [^>]*href="https:\/\/example\.com"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer nofollow"/);
});

test("task-list checkboxes are inert (disabled, no name/value)", () => {
  const html = markdownToSafeHtml("- [x] done\n- [ ] todo\n");
  assert.match(html, /<input[^>]*type="checkbox"/);
  assert.match(html, /disabled/);
  assert.doesNotMatch(html, /name=/);
});

test("incomplete Markdown mid-stream does not throw", () => {
  // Simulate partial streamed fences / tables / emphasis.
  for (const partial of ["```js\nconst x =", "| a | b", "**bold without close", "# ", "- item\n  - nested"]) {
    assert.doesNotThrow(() => markdownToSafeHtml(partial));
  }
});

test("renderAssistantMarkdown fills the container and adds .md, empty clears it", () => {
  const box = document.createElement("div");
  renderAssistantMarkdown(box, "## Hi\n\ntext");
  assert.ok(box.classList.contains("md"));
  assert.match(box.innerHTML, /<h2[^>]*>Hi<\/h2>/);
  renderAssistantMarkdown(box, "   ");
  assert.equal(box.childNodes.length, 0);
});

test("renderAssistantMarkdown highlights fenced code (adds .hljs)", () => {
  const box = document.createElement("div");
  renderAssistantMarkdown(box, "```ts\nexport const n: number = 1;\n```\n");
  const code = box.querySelector("pre code");
  assert.ok(code, "code block present");
  assert.ok(code!.classList.contains("hljs"), "code block highlighted");
});
