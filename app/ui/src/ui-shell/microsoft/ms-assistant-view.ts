import type { Ms365ViewData } from "../../service-client.js";
import { el, icon } from "../dom-utils.js";
import { createMicrosoftLogo } from "./ms-logo.js";
import type { MsChatController, MsChatMessage } from "./ms-chat-controller.js";

const SUGGESTIONS = [
  "Task trễ trên Planner",
  "Mail chưa đọc hôm nay",
  "Tìm tệp trên SharePoint",
  "Đăng thông báo lên Teams",
] as const;

export interface MsAssistantHandlers {
  readonly onOpenConnect: () => void;
  /** Render đọc chat.state() — nguồn sự thật duy nhất cho transcript (không state trong DOM). */
  readonly chat: MsChatController;
  readonly onSend: (prompt: string) => void;
  readonly onCancel: () => void;
  /** Root của pill write-mode (Task 3 truyền vào); Task 2 chỉ mount vào composer row. */
  readonly writeModePill?: HTMLElement;
}

/**
 * Signature of everything that requires a full rebuild. When only the streaming assistant text
 * (or its pending flag) changes between renders, the signature is identical and we patch the last
 * bubble in place instead of tearing down the DOM — otherwise every token delta would re-run the
 * `ms-message-in` mount animation on every bubble and the transcript would flash. Mirrors Cowork's
 * `updateAssistantBubble` in-place streaming (app-shell `state.activeAssistant`).
 */
function transcriptSignature(view: Ms365ViewData, state: ReturnType<MsChatController["state"]>): string {
  const connected = view.connectionState === "connected";
  const roles = state.messages.map((m) => `${m.role}${m.error ? "!" : ""}`).join(",");
  return [connected ? "on" : "off", state.phase, state.errorMessage ? "err" : "ok", state.messages.length, roles].join("|");
}

/** In-place patch of the streaming (last) assistant bubble — no rebuild, no re-animation. */
function patchLastBubble(container: HTMLElement, message: MsChatMessage): boolean {
  const bubbles = container.querySelectorAll<HTMLElement>(".ms-assistant__transcript .ms-bubble");
  const last = bubbles[bubbles.length - 1];
  if (last === undefined) return false;
  const body = last.querySelector<HTMLElement>(".ms-bubble__text");
  if (body === null) return false;
  const text = message.error ? message.error : message.content;
  // Rebuild only the text body's content (cheap; the bubble element itself is untouched so its
  // mount animation does not replay). Re-add thinking-dots while still pending.
  body.replaceChildren(document.createTextNode(text));
  last.classList.toggle("ms-bubble--pending", message.pending === true);
  if (message.pending) body.append(buildThinking(), el("span", "ms-bubble__pending-marker", " (đang xử lý…)"));

  // Reflect the settled metrics footer without a rebuild: append it once the turn is done, and
  // remove any stale one while still streaming. (The full-rebuild path also renders it.)
  const existing = last.querySelector<HTMLElement>(".ms-bubble__metrics");
  if (existing !== null) existing.remove();
  if (message.role === "assistant" && message.pending !== true && message.error === undefined) {
    const footer = buildMetricsFooter(message);
    if (footer !== null) last.append(footer);
  }
  return true;
}

export function renderMsAssistant(
  container: HTMLElement,
  view: Ms365ViewData,
  handlers: MsAssistantHandlers,
): void {
  const connected = view.connectionState === "connected";
  const state = handlers.chat.state();

  // Capture whether the user is pinned to the bottom BEFORE we mutate, so streaming keeps the view
  // at the newest text without yanking the scroll away when the user has scrolled up to read.
  const priorScroll = container.querySelector<HTMLElement>(".ms-assistant__transcript");
  const wasAtBottom = priorScroll === null || isNearBottom(priorScroll);

  // Fast path: structure unchanged (same messages/roles/phase/state) → this is a streaming
  // text update. Patch the last bubble in place and skip the full rebuild that would flash.
  const sig = transcriptSignature(view, state);
  if (connected && state.messages.length > 0 && container.dataset["msSig"] === sig) {
    const lastMsg = state.messages[state.messages.length - 1];
    if (lastMsg !== undefined && patchLastBubble(container, lastMsg)) {
      if (wasAtBottom && priorScroll !== null) priorScroll.scrollTop = priorScroll.scrollHeight;
      return;
    }
  }
  container.dataset["msSig"] = sig;

  container.replaceChildren();
  const column = el("div", "ms-assistant");
  const transcript = el("div", "ms-assistant__transcript");

  if (!connected) {
    const card = el("section", "ms-card ms-assistant__empty");
    const logo = el("div", "ms-assistant__logo");
    logo.append(createMicrosoftLogo(30));
    const cta = el("button", "ms-assistant__connect-cta", "Mở trang kết nối") as HTMLButtonElement;
    cta.type = "button";
    cta.addEventListener("click", handlers.onOpenConnect);
    card.append(
      logo,
      el("h2", "ms-card__title", "Chưa kết nối Microsoft 365"),
      el("p", "ms-card__copy", "Kết nối tài khoản để trợ lý thao tác trên Outlook, Teams, SharePoint và Planner thay bạn."),
      cta,
    );
    transcript.classList.add("ms-assistant__transcript--empty");
    transcript.append(card);
  } else if (state.messages.length === 0) {
    transcript.classList.add("ms-assistant__transcript--empty");
    transcript.append(
      el("p", "ms-assistant__placeholder", "Bắt đầu bằng cách hỏi trợ lý hoặc chọn một gợi ý bên dưới."),
    );
  } else {
    transcript.classList.add("ms-assistant__transcript--list");
    // Inner wrapper carries the chat-max width; the transcript itself spans full width so its
    // scrollbar sits at the surface edge (mirrors Cowork's .transcript / .transcript__inner).
    const inner = el("div", "ms-assistant__inner");
    state.messages.forEach((message, index) => {
      const bubble = renderBubble(message);
      // Only a brand-new pending (streaming) assistant bubble may play the mount animation.
      // Everything else stays static so a rebuild (add message / switch conversation / turn end)
      // does not re-animate the transcript and flash.
      const isNewestPending = index === state.messages.length - 1 && message.pending === true;
      if (!isNewestPending) bubble.classList.add("ms-bubble--static");
      inner.append(bubble);
    });
    if (state.errorMessage) {
      inner.append(el("p", "ms-assistant__error-banner", state.errorMessage));
    }
    transcript.append(inner);
  }

  if (state.errorMessage && state.messages.length === 0) {
    transcript.append(el("p", "ms-assistant__error-banner", state.errorMessage));
  }

  column.append(transcript, renderComposer(connected, state.phase, handlers));
  container.append(column);

  // After a rebuild, keep the newest content in view if the user was at the bottom (or this is a
  // fresh render). Mirrors Cowork's scrollTo(scrollHeight) so a new turn scrolls down, not up.
  if (wasAtBottom) transcript.scrollTop = transcript.scrollHeight;
}

/** True when the scroll container is at (or within ~80px of) its bottom — the "follow" zone. */
function isNearBottom(elem: HTMLElement): boolean {
  return elem.scrollHeight - elem.scrollTop - elem.clientHeight < 80;
}

function renderBubble(message: MsChatMessage): HTMLElement {
  // Cowork bubble look (name label + text body) driven by the NEW MsChatMessage fields. The
  // `.ms-bubble*` classes stay as the state hooks (role / pending / error), while the Cowork
  // `__bubble-name` / `__bubble-text` sub-elements carry the visual structure.
  const classes = ["ms-bubble", `ms-bubble--${message.role}`];
  if (message.pending) classes.push("ms-bubble--pending");
  if (message.error) classes.push("ms-bubble--error");
  const bubble = el("div", classes.join(" "));

  // Only the assistant carries a name label ("MS365" + dot); user bubbles show no name.
  if (message.role === "assistant") {
    const name = el("div", "ms-bubble__name");
    name.append(el("span", "ms-bubble__name-dot"), document.createTextNode("MS365"));
    bubble.append(name);
  }

  const body = el("div", "ms-bubble__text");
  const text = message.error ? message.error : message.content;
  body.textContent = text;
  if (message.pending) {
    // Cowork thinking-dots while the turn streams, plus the (đang xử lý…) marker for a11y/state.
    body.append(buildThinking(), el("span", "ms-bubble__pending-marker", " (đang xử lý…)"));
  }
  bubble.append(body);

  // Per-turn metrics footer under the settled assistant answer (mirrors Cowork's `.turn-metrics`).
  // Only on a settled (non-pending) assistant message that actually carries metrics/duration.
  if (message.role === "assistant" && message.pending !== true && message.error === undefined) {
    const footer = buildMetricsFooter(message);
    if (footer !== null) bubble.append(footer);
  }
  return bubble;
}

/** Human-readable turn duration ("820ms" / "2.3s") — mirrors Cowork's `formatTurnDuration`. */
function formatMsTurnDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Build the Cowork-style per-turn footer: `⏱ {duration} · {total} tokens ({in}↑ · {out}↓[ · {cache}
 * cache]) · ${cost}`. Only parts that exist are rendered; returns null when nothing to show.
 */
function buildMetricsFooter(message: MsChatMessage): HTMLElement | null {
  const parts: string[] = [];
  if (typeof message.durationMs === "number") {
    parts.push(`⏱ ${formatMsTurnDuration(message.durationMs)}`);
  }
  const m = message.metrics;
  if (m !== undefined) {
    if (typeof m.tokensTotal === "number") {
      const io = [
        typeof m.tokensInput === "number" ? `${m.tokensInput.toLocaleString("vi-VN")}↑` : null,
        typeof m.tokensOutput === "number" ? `${m.tokensOutput.toLocaleString("vi-VN")}↓` : null,
        typeof m.tokensCache === "number" && m.tokensCache > 0
          ? `${m.tokensCache.toLocaleString("vi-VN")} cache`
          : null,
      ]
        .filter((x): x is string => x !== null)
        .join(" · ");
      parts.push(`${m.tokensTotal.toLocaleString("vi-VN")} tokens${io.length > 0 ? ` (${io})` : ""}`);
    }
    if (typeof m.costUsd === "number" && m.costUsd > 0) {
      parts.push(`$${m.costUsd.toFixed(4)}`);
    }
  }
  if (parts.length === 0) return null;
  return el("p", "ms-bubble__metrics", parts.join(" · "));
}

/** The animated three-dot "thinking" indicator shown inside a pending assistant bubble. */
function buildThinking(): HTMLElement {
  const thinking = el("span", "ms-bubble__thinking-dots");
  thinking.setAttribute("aria-hidden", "true");
  thinking.append(
    el("span", "ms-bubble__thinking-dot"),
    el("span", "ms-bubble__thinking-dot"),
    el("span", "ms-bubble__thinking-dot"),
  );
  return thinking;
}

function renderComposer(
  enabled: boolean,
  phase: "idle" | "running" | "error",
  handlers: MsAssistantHandlers,
): HTMLElement {
  const composer = el("div", "ms-composer");
  const chips = el("div", "ms-composer__chips");
  const running = phase === "running";
  for (const suggestion of SUGGESTIONS) {
    const chip = el("button", "ms-composer__chip", suggestion) as HTMLButtonElement;
    chip.type = "button";
    chip.disabled = !enabled || running;
    chip.addEventListener("click", () => handlers.onSend(suggestion));
    chips.append(chip);
  }

  // Cowork composer: a rounded box holding the textarea over an action bar. `ms-composer__row`
  // is kept as the action-bar element (it is where writeModePill mounts + the test looks for it).
  const box = el("div", "ms-composer__box");
  const input = el("textarea", "ms-composer__input") as HTMLTextAreaElement;
  input.rows = 1;
  input.placeholder = "Hỏi trợ lý về Microsoft 365…";
  input.setAttribute("aria-label", "Soạn yêu cầu Microsoft 365");
  input.disabled = !enabled || running;

  const submit = (): void => {
    const value = input.value.trim();
    if (value.length === 0) return;
    handlers.onSend(value);
    input.value = "";
  };

  input.addEventListener("keydown", (event) => {
    if (!(event instanceof KeyboardEvent)) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  });

  const bar = el("div", "ms-composer__row");
  bar.append(el("span", "ms-composer__spacer"));
  if (handlers.writeModePill) bar.append(handlers.writeModePill);

  const cancel = el("button", "ms-composer__cancel") as HTMLButtonElement;
  cancel.type = "button";
  cancel.setAttribute("aria-label", "Hủy yêu cầu đang xử lý");
  cancel.textContent = "Dừng";
  cancel.hidden = !running;
  cancel.addEventListener("click", handlers.onCancel);

  const send = el("button", "ms-composer__send") as HTMLButtonElement;
  send.type = "button";
  send.setAttribute("aria-label", "Gửi yêu cầu");
  send.dataset["tooltip"] = "Gửi";
  send.append(icon("paper-plane", "Gửi"));
  send.disabled = !enabled;
  send.hidden = running;
  send.addEventListener("click", submit);

  bar.append(cancel, send);
  box.append(input, bar);

  const hint = el(
    "p",
    "ms-composer__hint",
    "Hành động ghi (gửi mail, đăng Teams…) luôn cần phê duyệt trước khi thực thi qua Microsoft Graph.",
  );
  composer.append(chips, box, hint);
  return composer;
}
