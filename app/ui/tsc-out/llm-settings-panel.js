/**
 * LLM settings panel (Slice 3 — CGHC-011 / CGHC-019).
 *
 * Thin renderer client: provider preset selection, model persistence, credential store/delete,
 * and bounded test-connection through the loopback service. No secret is ever read back or
 * written into persistent renderer state beyond the password field (cleared after save).
 */
import { DEEPSEEK_PRESET, PROVIDER_PRESETS, presetById, } from "./provider-presets.js";
function el(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined)
        node.textContent = text;
    return node;
}
function userFacingProviderError(error) {
    const message = typeof error === "string" ? error : (error?.message ?? "");
    const kind = typeof error === "string" ? "" : (error?.kind ?? "");
    const lower = message.toLowerCase();
    if (kind === "auth_invalid" || lower.includes("authentication was rejected")) {
        return "Xác thực bị từ chối. Kiểm tra lại khoá API rồi thử lại.";
    }
    if (kind === "model_invalid" || lower.includes("model was not accepted")) {
        return "Mô hình không được nhà cung cấp chấp nhận. Chọn mô hình hợp lệ rồi thử lại.";
    }
    if (lower.includes("ssrf policy") || lower.includes("base_url refused")) {
        return "Base URL bị từ chối bởi chính sách bảo mật. Dùng endpoint HTTPS công khai hợp lệ.";
    }
    if (kind === "rate_limited" || lower.includes("rate-limit")) {
        return "Nhà cung cấp đang giới hạn tần suất. Thử lại sau.";
    }
    if (kind === "timeout" || lower.includes("time bound") || lower.includes("timeout")) {
        return "Nhà cung cấp không phản hồi kịp thời. Kiểm tra base URL và mạng rồi thử lại.";
    }
    if (kind === "unavailable" ||
        lower.includes("network error") ||
        lower.includes("could not reach") ||
        lower.includes("econnrefused") ||
        lower.includes("enotfound")) {
        return "Không kết nối được tới base URL. Kiểm tra URL và mạng rồi thử lại.";
    }
    if (lower.includes("unavailable")) {
        return "Nhà cung cấp tạm thời không khả dụng. Thử lại sau.";
    }
    if (lower.includes("unrecognized reason")) {
        return "Yêu cầu thất bại. Kiểm tra cấu hình và thử lại.";
    }
    if (message.length > 0)
        return message;
    return "Kiểm tra kết nối thất bại.";
}
function userFacingBaseUrlError(message) {
    const lower = message.toLowerCase();
    if (lower.includes("ssrf"))
        return userFacingProviderError(message);
    if (lower.includes("https"))
        return "Base URL phải dùng HTTPS.";
    return message;
}
function setControlsBusy(busy, controls) {
    controls.testBtn.disabled = busy;
    controls.saveCredBtn.disabled = busy;
    controls.deleteCredBtn.disabled = busy;
    controls.providerSelect.disabled = busy;
    controls.modelSelect.disabled = busy;
    controls.baseUrlInput.disabled = busy;
}
function providerRow(settings, providerId) {
    return settings.providers.find((p) => p.providerId === providerId);
}
function activeSummary(view) {
    const model = view.defaultModel;
    if (model === null)
        return "Chưa chọn nhà cung cấp / mô hình.";
    const preset = PROVIDER_PRESETS.find((p) => p.providerId === model.providerID);
    const providerLabel = preset?.label ?? model.providerID;
    const cred = providerRow(view, model.providerID);
    const credState = cred?.hasCredential ? "Đã cấu hình" : "Chưa cấu hình";
    return `${providerLabel} · ${model.modelID} · Khoá API: ${credState}`;
}
/** Mount the LLM settings panel into `container`. */
export function mountLlmSettingsPanel(container, deps) {
    const section = el("section", "llm-settings");
    section.setAttribute("aria-label", "Cài đặt nhà cung cấp");
    const title = el("h2", "llm-settings-title", "Cài đặt nhà cung cấp");
    const summary = el("p", "llm-settings-summary");
    summary.setAttribute("role", "status");
    const status = el("p", "llm-settings-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const providerLabel = el("label", "llm-field", "Nhà cung cấp");
    const providerSelect = document.createElement("select");
    providerSelect.className = "llm-provider-select";
    providerLabel.append(providerSelect);
    const modelLabel = el("label", "llm-field", "Mô hình");
    const modelSelect = document.createElement("select");
    modelSelect.className = "llm-model-select";
    modelLabel.append(modelSelect);
    const baseUrlLabel = el("label", "llm-field", "Base URL (tuỳ chọn)");
    const baseUrlInput = document.createElement("input");
    baseUrlInput.type = "text";
    baseUrlInput.className = "llm-base-url";
    baseUrlInput.placeholder = "https://api.example.com/v1";
    baseUrlLabel.append(baseUrlInput);
    const credLabel = el("label", "llm-field", "Khoá API");
    const credInput = document.createElement("input");
    credInput.type = "password";
    credInput.className = "llm-credential-input";
    credInput.autocomplete = "off";
    credInput.placeholder = "Nhập khoá mới (không hiển thị lại sau khi lưu)";
    credLabel.append(credInput);
    const credStatus = el("p", "llm-credential-status");
    const saveCredBtn = el("button", "llm-save-credential", "Lưu khoá API");
    saveCredBtn.type = "button";
    const deleteCredBtn = el("button", "llm-delete-credential", "Xoá khoá API");
    deleteCredBtn.type = "button";
    const testBtn = el("button", "llm-test-connection", "Kiểm tra kết nối");
    testBtn.type = "button";
    const importEnvBtn = el("button", "llm-import-env dev-only", "Import từ biến môi trường (dev)");
    importEnvBtn.type = "button";
    importEnvBtn.hidden = true;
    const actions = el("div", "llm-actions");
    actions.append(saveCredBtn, deleteCredBtn, testBtn, importEnvBtn);
    section.append(title, summary, status, providerLabel, modelLabel, baseUrlLabel, credLabel, credStatus, actions);
    container.append(section);
    let selectedPreset = DEEPSEEK_PRESET;
    let allowEnvImport = false;
    const setStatus = (text, kind = "idle") => {
        status.textContent = text;
        section.classList.toggle("is-error", kind === "err");
        section.classList.toggle("is-ok", kind === "ok");
    };
    const renderCredentialStatus = (view) => {
        const row = providerRow(view, selectedPreset.providerId);
        credStatus.textContent = row?.hasCredential ? "Đã cấu hình" : "Chưa cấu hình";
        deleteCredBtn.disabled = !row?.hasCredential;
    };
    const fillProviderOptions = () => {
        providerSelect.replaceChildren();
        for (const preset of PROVIDER_PRESETS) {
            const opt = document.createElement("option");
            opt.value = preset.id;
            opt.textContent = preset.label;
            providerSelect.append(opt);
        }
        providerSelect.value = selectedPreset.id;
    };
    const fillModelOptions = () => {
        modelSelect.replaceChildren();
        for (const m of selectedPreset.models) {
            const opt = document.createElement("option");
            opt.value = m.ref.modelID;
            opt.textContent = m.label;
            modelSelect.append(opt);
        }
    };
    const applyPresetFields = () => {
        baseUrlInput.value = selectedPreset.baseUrl;
        fillModelOptions();
    };
    const persistModel = async (model) => {
        if (model.modelID.trim().length === 0) {
            throw new Error("Mô hình không được để trống.");
        }
        return deps.client.setDefaultModel(model);
    };
    const applyPresetToService = async () => {
        await deps.client.setProviderBaseUrl(selectedPreset.providerId, selectedPreset.baseUrl);
        await deps.client.setProviderEnvVar(selectedPreset.providerId, selectedPreset.envVar);
        const model = selectedPreset.models[0]?.ref ?? {
            providerID: selectedPreset.providerId,
            modelID: modelSelect.value,
        };
        return persistModel(model);
    };
    const render = (view) => {
        summary.textContent = activeSummary(view);
        renderCredentialStatus(view);
        deps.onSettingsUpdated?.(view);
        if (view.defaultModel !== null) {
            const preset = PROVIDER_PRESETS.find((p) => p.providerId === view.defaultModel.providerID);
            if (preset !== undefined) {
                selectedPreset = preset;
                providerSelect.value = preset.id;
                applyPresetFields();
                const match = preset.models.find((m) => m.ref.modelID === view.defaultModel.modelID);
                if (match !== undefined)
                    modelSelect.value = match.ref.modelID;
            }
        }
        const row = providerRow(view, selectedPreset.providerId);
        if (row?.baseUrl)
            baseUrlInput.value = row.baseUrl;
    };
    providerSelect.addEventListener("change", () => {
        const next = presetById(providerSelect.value);
        if (next === undefined)
            return;
        selectedPreset = next;
        applyPresetFields();
        void (async () => {
            setStatus("Đang lưu nhà cung cấp…");
            try {
                render(await applyPresetToService());
                setStatus("Đã lưu nhà cung cấp.");
            }
            catch (error) {
                setStatus(error instanceof Error ? error.message : "Không lưu được.", "err");
            }
        })();
    });
    modelSelect.addEventListener("change", () => {
        void (async () => {
            setStatus("Đang lưu mô hình…");
            try {
                const model = {
                    providerID: selectedPreset.providerId,
                    modelID: modelSelect.value,
                };
                render(await persistModel(model));
                setStatus("Đã lưu mô hình.");
            }
            catch (error) {
                setStatus(error instanceof Error ? error.message : "Không lưu được mô hình.", "err");
            }
        })();
    });
    baseUrlInput.addEventListener("change", () => {
        void (async () => {
            setStatus("Đang lưu base URL…");
            try {
                render(await deps.client.setProviderBaseUrl(selectedPreset.providerId, baseUrlInput.value.trim()));
                setStatus("Đã lưu base URL.");
            }
            catch (error) {
                setStatus(userFacingBaseUrlError(error instanceof Error ? error.message : "Base URL không hợp lệ."), "err");
            }
        })();
    });
    saveCredBtn.addEventListener("click", () => {
        const secret = credInput.value;
        if (secret.trim().length === 0) {
            setStatus("Nhập khoá API trước khi lưu.", "err");
            return;
        }
        void (async () => {
            setStatus("Đang lưu khoá API…");
            try {
                render(await deps.client.storeProviderCredential(selectedPreset.providerId, secret));
                credInput.value = "";
                setStatus("Đã lưu khoá API.", "ok");
            }
            catch (error) {
                setStatus(error instanceof Error ? error.message : "Không lưu được khoá.", "err");
            }
        })();
    });
    deleteCredBtn.addEventListener("click", () => {
        void (async () => {
            setStatus("Đang xoá khoá API…");
            try {
                render(await deps.client.removeProviderCredential(selectedPreset.providerId));
                credInput.value = "";
                setStatus("Đã xoá khoá API.");
            }
            catch (error) {
                setStatus(error instanceof Error ? error.message : "Không xoá được khoá.", "err");
            }
        })();
    });
    testBtn.addEventListener("click", () => {
        void (async () => {
            setStatus("Đang kiểm tra kết nối…");
            setControlsBusy(true, {
                saveCredBtn,
                deleteCredBtn,
                testBtn,
                providerSelect,
                modelSelect,
                baseUrlInput,
            });
            try {
                const result = await deps.client.testProviderConnection(selectedPreset.providerId);
                if (result.ok) {
                    setStatus("Kết nối thành công.", "ok");
                    deps.onConnectionTestResult?.(true);
                }
                else {
                    setStatus(userFacingProviderError(result.error), "err");
                    deps.onConnectionTestResult?.(false);
                }
            }
            catch (error) {
                setStatus(userFacingProviderError(error instanceof Error ? error.message : "Kiểm tra kết nối thất bại."), "err");
                deps.onConnectionTestResult?.(false);
            }
            finally {
                setControlsBusy(false, {
                    saveCredBtn,
                    deleteCredBtn,
                    testBtn,
                    providerSelect,
                    modelSelect,
                    baseUrlInput,
                });
                renderCredentialStatus(await deps.client.getSettings());
            }
        })();
    });
    importEnvBtn.addEventListener("click", () => {
        void (async () => {
            setStatus("Đang import từ biến môi trường…");
            try {
                render(await deps.client.importProviderCredentialFromEnv(selectedPreset.providerId, selectedPreset.envVar));
                credInput.value = "";
                setStatus("Đã import khoá từ biến môi trường.", "ok");
            }
            catch (error) {
                setStatus(error instanceof Error ? error.message : "Import thất bại.", "err");
            }
        })();
    });
    void (async () => {
        fillProviderOptions();
        applyPresetFields();
        if (deps.getBootstrap !== undefined) {
            try {
                allowEnvImport = (await deps.getBootstrap()).allowEnvCredentialImport === true;
            }
            catch {
                allowEnvImport = false;
            }
        }
        importEnvBtn.hidden = !allowEnvImport;
        setStatus("Đang tải…");
        try {
            await deps.client.listProviders();
            const view = await deps.client.getSettings();
            if (view.defaultModel === null) {
                const seeded = await applyPresetToService();
                render(seeded);
            }
            else {
                render(view);
            }
            setStatus("");
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : "Không tải được cài đặt.", "err");
        }
    })();
}
//# sourceMappingURL=llm-settings-panel.js.map