/**
 * Settings view (CGHC-022 SD1/SD4/LOW-1) — renderer side.
 *
 * A thin CLIENT of the loopback service with NO business logic: it renders whatever the
 * service returns and calls typed client methods to persist edits. The service owns the
 * settings store, validation, redaction, and the credential HANDLE — the renderer never
 * touches the filesystem or the credential store and never holds key bytes.
 *
 * It shows: general settings (theme + verbose logging + telemetry), each provider's
 * credential-binding STATUS (hasCredential + the non-secret account label — never a key)
 * and base_url, the persisted default-model preference, and a control to clear the current
 * session's model override so it reverts to the default (LOW-1).
 *
 * DOM is built with `textContent` only (no HTML parsing); controls are keyboard-reachable
 * and labelled; no secret is ever written into the DOM.
 */
function el(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined)
        node.textContent = text;
    return node;
}
const THEMES = ["system", "light", "dark"];
/** Mount the settings view into `container`. Returns nothing; it manages its own state. */
export function mountSettingsView(container, deps) {
    const section = el("section", "settings-view");
    section.setAttribute("aria-label", "Cài đặt");
    const status = el("p", "settings-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const generalBox = el("div", "settings-general");
    const providersBox = el("div", "settings-providers");
    const modelBox = el("div", "settings-model");
    section.append(el("h2", "settings-title", "Cài đặt"), status, generalBox, providersBox, modelBox);
    container.append(section);
    const setStatus = (text) => {
        status.textContent = text;
    };
    // A single guarded runner: every edit goes through the service, never local business logic.
    const run = async (label, action) => {
        setStatus(`${label}…`);
        try {
            render(await action());
            setStatus("Đã lưu.");
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Không lưu được cài đặt.";
            setStatus(message);
        }
    };
    function renderGeneral(view) {
        generalBox.replaceChildren(el("h3", "settings-subtitle", "Chung"));
        const themeLabel = el("label", "settings-field", "Giao diện");
        const themeSelect = document.createElement("select");
        themeSelect.className = "settings-theme";
        for (const theme of THEMES) {
            const opt = document.createElement("option");
            opt.value = theme;
            opt.textContent = theme;
            if (view.general.theme === theme)
                opt.selected = true;
            themeSelect.append(opt);
        }
        themeSelect.addEventListener("change", () => {
            void run("Đang lưu giao diện", () => deps.client.updateGeneral({ theme: themeSelect.value }));
        });
        themeLabel.append(themeSelect);
        const verbose = toggle("Ghi log chi tiết", view.general.verboseLogging, (checked) => run("Đang lưu log", () => deps.client.updateGeneral({ verboseLogging: checked })));
        const telemetry = toggle("Bật telemetry cục bộ", view.general.telemetryEnabled, (checked) => run("Đang lưu telemetry", () => deps.client.updateGeneral({ telemetryEnabled: checked })));
        generalBox.append(themeLabel, verbose, telemetry);
    }
    function toggle(label, checked, onChange) {
        const wrap = el("label", "settings-toggle", label);
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = checked;
        input.addEventListener("change", () => void onChange(input.checked));
        wrap.prepend(input);
        return wrap;
    }
    function renderProvider(p) {
        const item = el("li", "settings-provider");
        // Credential STATUS only — the account label is a non-secret handle, never a key.
        const state = p.hasCredential
            ? `đã cấu hình khoá (${p.credentialAccount ?? ""})`
            : "chưa có khoá";
        item.append(el("span", "settings-provider-id", p.providerId));
        item.append(el("span", "settings-provider-cred", state));
        const urlLabel = el("label", "settings-field", "base_url");
        const urlInput = document.createElement("input");
        urlInput.type = "text";
        urlInput.className = "settings-base-url";
        urlInput.value = p.baseUrl ?? "";
        urlInput.placeholder = "https://…";
        const save = el("button", "settings-base-url-save", "Lưu");
        save.type = "button";
        save.addEventListener("click", () => {
            void run("Đang lưu base_url", () => deps.client.setProviderBaseUrl(p.providerId, urlInput.value.trim()));
        });
        urlLabel.append(urlInput, save);
        item.append(urlLabel);
        return item;
    }
    function renderProviders(view) {
        providersBox.replaceChildren(el("h3", "settings-subtitle", "Nhà cung cấp"));
        const list = el("ul", "settings-provider-list");
        if (view.providers.length === 0) {
            list.append(el("li", "settings-provider-empty", "Chưa cấu hình nhà cung cấp nào."));
        }
        for (const p of view.providers)
            list.append(renderProvider(p));
        providersBox.append(list);
    }
    function renderModel(view) {
        modelBox.replaceChildren(el("h3", "settings-subtitle", "Mô hình mặc định"));
        const current = view.defaultModel
            ? `${view.defaultModel.providerID} / ${view.defaultModel.modelID}`
            : "chưa đặt";
        modelBox.append(el("p", "settings-model-current", current));
        if (view.defaultModel) {
            const clearDefault = el("button", "settings-model-clear", "Xoá mô hình mặc định");
            clearDefault.type = "button";
            clearDefault.addEventListener("click", () => {
                void run("Đang xoá mô hình mặc định", () => deps.client.setDefaultModel(null));
            });
            modelBox.append(clearDefault);
        }
        if (deps.sessionId !== undefined) {
            const clearSession = el("button", "settings-session-clear", "Trở về mặc định cho phiên này");
            clearSession.type = "button";
            clearSession.addEventListener("click", () => void clearSessionOverride());
            modelBox.append(clearSession);
        }
    }
    async function clearSessionOverride() {
        const sessionId = deps.sessionId;
        if (sessionId === undefined)
            return;
        setStatus("Đang trở về mô hình mặc định…");
        try {
            const result = await deps.client.clearSessionModel(sessionId);
            setStatus(result.cleared
                ? "Phiên đã trở về mô hình mặc định."
                : "Phiên chưa có ghi đè — vẫn dùng mặc định.");
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : "Không thể xoá ghi đè phiên.");
        }
    }
    function render(view) {
        renderGeneral(view);
        renderProviders(view);
        renderModel(view);
    }
    async function load() {
        setStatus("Đang tải cài đặt…");
        try {
            render(await deps.client.getSettings());
            setStatus("");
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : "Không tải được cài đặt.");
        }
    }
    void load();
}
//# sourceMappingURL=settings-view.js.map