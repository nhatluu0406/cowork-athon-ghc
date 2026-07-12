/**
 * Placeholder renderer view.
 *
 * A tiny, HONEST status surface for the scaffold: it shows the real connection phase to
 * the loopback service and never fabricates a "completed"/"ready" state (frontend rule:
 * render execution visibility honestly). Real features — workspace picker (CGHC-008), EV
 * timeline (CGHC-015), permission UI (CGHC-017), settings (CGHC-022) — replace this. It
 * builds DOM via `textContent` only, so no untrusted string is ever parsed as HTML and no
 * secret is written into the DOM.
 */
function statusLine(label, kind) {
    const row = document.createElement("div");
    row.className = "status-row";
    const dot = document.createElement("span");
    dot.className = `status-dot ${kind === "connecting" ? "" : kind}`.trim();
    const text = document.createElement("span");
    text.textContent = label;
    row.append(dot, text);
    return row;
}
/** Render the current view state into `root`, replacing prior content. */
export function renderView(root, state) {
    root.replaceChildren();
    const title = document.createElement("h1");
    title.className = "scaffold-title";
    title.textContent = "Cowork GHC";
    const note = document.createElement("p");
    note.className = "scaffold-note";
    note.textContent =
        "Desktop scaffold — UI features arrive in CGHC-008 / 015 / 017 / 022.";
    root.append(title, note);
    if (state.phase === "connecting") {
        root.append(statusLine("Đang kết nối tới local service…", "connecting"));
        return;
    }
    if (state.phase === "error") {
        root.append(statusLine("Chưa kết nối được local service", "error"));
        const detail = document.createElement("p");
        detail.className = "status-detail";
        detail.textContent = state.message;
        root.append(detail);
        return;
    }
    root.append(statusLine("Đã kết nối local service", "ready"));
    const detail = document.createElement("p");
    detail.className = "status-detail";
    // Non-secret health fields only; the client token is never rendered.
    detail.textContent = `service=${state.health.service} · status=${state.health.status} · uptime=${state.health.uptimeMs}ms`;
    root.append(detail);
}
//# sourceMappingURL=view.js.map