/**
 * Knowledge settings section — configure/test-connection/disconnect (T2.6).
 *
 * Reuses existing Settings UX conventions (diagnostics/settings-router.ts pattern).
 * Enforces FR-013/SEC-2: token field is empty on load, cleared after submit, never in state.
 *
 * Routes:
 * - POST /v1/knowledge/configure (baseUrl, token)
 * - POST /v1/knowledge/test-connection
 * - DELETE /v1/knowledge/connection
 * - GET /v1/knowledge/status
 */
function el(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined)
        node.textContent = text;
    return node;
}
function statusLabel(status) {
    switch (status) {
        case "not_configured":
            return "Chưa cấu hình";
        case "connected":
            return "Đã kết nối";
        case "unreachable":
            return "Không thể truy cập";
        case "auth_failed":
            return "Xác thực thất bại";
    }
}
function validateUrl(url) {
    if (!url)
        return false;
    try {
        new URL(url);
        return true;
    }
    catch {
        return false;
    }
}
async function loadStatus(client) {
    try {
        return await client.getKnowledgeStatus();
    }
    catch {
        return { status: "not_configured", baseUrl: null, lastHealthCheckAt: null };
    }
}
export function mountKnowledgeSettingsPanel(host, config) {
    const root = el("section", "knowledge-settings");
    const titleSection = el("div", "knowledge-settings-title-section");
    titleSection.append(el("h4", "knowledge-settings-title", "Lập chỉ mục tri thức M365"));
    root.append(titleSection);
    // Status display
    const statusSection = el("div", "knowledge-settings-section");
    statusSection.append(el("label", "knowledge-settings-label", "Trạng thái"));
    const statusDisplay = el("div", "knowledge-settings-status");
    statusDisplay.textContent = "Đang tải...";
    statusSection.append(statusDisplay);
    root.append(statusSection);
    // Configuration form
    const configSection = el("fieldset", "knowledge-settings-section");
    configSection.append(el("legend", "knowledge-settings-legend", "Cấu hình"));
    const baseUrlGroup = el("div", "knowledge-settings-field-group");
    baseUrlGroup.append(el("label", "knowledge-settings-label", "URL cơ sở"));
    const baseUrlInput = document.createElement("input");
    baseUrlInput.type = "text";
    baseUrlInput.className = "knowledge-base-url-input";
    baseUrlInput.placeholder = "http://localhost:8080";
    baseUrlGroup.append(baseUrlInput);
    const urlError = el("div", "knowledge-url-error");
    urlError.hidden = true;
    baseUrlGroup.append(urlError);
    configSection.append(baseUrlGroup);
    const tokenGroup = el("div", "knowledge-settings-field-group");
    tokenGroup.append(el("label", "knowledge-settings-label", "Token"));
    const tokenInput = document.createElement("input");
    tokenInput.type = "password";
    tokenInput.className = "knowledge-token-input";
    tokenInput.placeholder = "Nhập token từ M365KG";
    tokenInput.value = ""; // SEC-2: Always start empty
    tokenGroup.append(tokenInput);
    configSection.append(tokenGroup);
    const buttonGroup = el("div", "knowledge-settings-button-group");
    const saveButton = el("button", "knowledge-configure-save", "Lưu cấu hình");
    saveButton.type = "button";
    const testButton = el("button", "knowledge-test-connection", "Kiểm tra kết nối");
    testButton.type = "button";
    testButton.disabled = true;
    const disconnectButton = el("button", "knowledge-disconnect", "Ngắt kết nối");
    disconnectButton.type = "button";
    disconnectButton.disabled = true;
    buttonGroup.append(saveButton);
    buttonGroup.append(testButton);
    buttonGroup.append(disconnectButton);
    configSection.append(buttonGroup);
    root.append(configSection);
    host.append(root);
    // Event handlers
    let currentStatus = null;
    baseUrlInput.addEventListener("change", () => {
        const url = baseUrlInput.value.trim();
        if (url && !validateUrl(url)) {
            urlError.textContent = "URL không hợp lệ";
            urlError.hidden = false;
            saveButton.disabled = true;
        }
        else {
            urlError.hidden = true;
            saveButton.disabled = false;
        }
    });
    saveButton.addEventListener("click", async () => {
        const baseUrl = baseUrlInput.value.trim();
        const token = tokenInput.value;
        if (!baseUrl || !token) {
            alert("Vui lòng điền đầy đủ thông tin");
            return;
        }
        if (!validateUrl(baseUrl)) {
            alert("URL không hợp lệ");
            return;
        }
        saveButton.disabled = true;
        statusDisplay.textContent = "Đang lưu...";
        try {
            const result = await config.client.configureKnowledgeSource(baseUrl, token);
            currentStatus = result;
            baseUrlInput.value = result.baseUrl || "";
            tokenInput.value = ""; // SEC-2: Clear token after successful submit
            updateUI();
            statusDisplay.textContent = statusLabel(result.status);
        }
        catch (error) {
            statusDisplay.textContent = "Lỗi khi lưu cấu hình";
            console.error("Configure error:", error);
        }
        finally {
            saveButton.disabled = false;
        }
    });
    testButton.addEventListener("click", async () => {
        if (!currentStatus)
            return;
        testButton.disabled = true;
        statusDisplay.textContent = "Đang kiểm tra...";
        try {
            await config.client.testKnowledgeConnection();
            const updated = await loadStatus(config.client);
            currentStatus = updated;
            updateUI();
            statusDisplay.textContent = statusLabel(updated.status);
        }
        catch (error) {
            statusDisplay.textContent = "Kiểm tra thất bại";
            console.error("Test connection error:", error);
        }
        finally {
            testButton.disabled = false;
        }
    });
    disconnectButton.addEventListener("click", async () => {
        if (!currentStatus)
            return;
        if (!confirm("Bạn chắc chắn muốn ngắt kết nối?")) {
            return;
        }
        disconnectButton.disabled = true;
        statusDisplay.textContent = "Đang ngắt kết nối...";
        try {
            const result = await config.client.disconnectKnowledgeSource();
            currentStatus = result;
            baseUrlInput.value = "";
            tokenInput.value = ""; // SEC-2: Clear on disconnect
            updateUI();
            statusDisplay.textContent = statusLabel(result.status);
        }
        catch (error) {
            statusDisplay.textContent = "Lỗi khi ngắt kết nối";
            console.error("Disconnect error:", error);
        }
        finally {
            disconnectButton.disabled = false;
        }
    });
    function updateUI() {
        if (!currentStatus)
            return;
        const isConfigured = currentStatus.status !== "not_configured";
        configSection.disabled = isConfigured;
        saveButton.disabled = isConfigured;
        testButton.disabled = !isConfigured;
        disconnectButton.disabled = !isConfigured;
        if (isConfigured) {
            baseUrlInput.value = currentStatus.baseUrl || "";
            baseUrlInput.disabled = true;
        }
        else {
            baseUrlInput.disabled = false;
            baseUrlInput.value = "";
            tokenInput.value = "";
        }
        statusDisplay.className = `knowledge-settings-status knowledge-status--${currentStatus.status}`;
    }
    // Load initial status
    (async () => {
        try {
            currentStatus = await loadStatus(config.client);
            updateUI();
            statusDisplay.textContent = statusLabel(currentStatus.status);
        }
        catch (error) {
            statusDisplay.textContent = "Lỗi khi tải trạng thái";
            console.error("Load status error:", error);
        }
    })();
}
//# sourceMappingURL=knowledge-settings.js.map