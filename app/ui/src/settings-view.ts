/**
 * General settings surface. The service remains the source of truth; the renderer only presents
 * typed preferences and sends narrow update requests.
 */

import type {
  DiagnosticsClearTarget,
  DiagnosticsStatus,
  ServiceClient,
  SettingsView,
  ThemePreference,
} from "./service-client.js";
import { applyThemePreference } from "./theme-manager.js";
import { getShellBridge } from "./bridge.js";

export interface SettingsViewDeps {
  readonly client: Pick<
    ServiceClient,
    | "getSettings"
    | "updateGeneral"
    | "getDiagnostics"
    | "clearDiagnostics"
    | "exportDiagnostics"
    | "authChangePassword"
  >;
}

/** Human labels for the aggregate telemetry counters shown in Settings. */
const TELEMETRY_LABELS: Readonly<Record<string, string>> = {
  app_launches: "Lượt mở ứng dụng",
  chat_turns_completed: "Lượt chat hoàn tất",
  chat_turns_failed: "Lượt chat thất bại",
  permission_approved: "Quyền được duyệt",
  permission_denied: "Quyền bị từ chối",
  file_created: "Tệp được tạo",
  file_modified: "Tệp được sửa",
  file_deleted: "Tệp bị xoá",
  errors: "Lỗi (đã ẩn nội dung)",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const THEMES: readonly ThemePreference[] = ["system", "light", "dark"];

function themeLabel(theme: ThemePreference): string {
  return theme === "system" ? "Theo hệ thống" : theme === "light" ? "Sáng" : "Tối";
}

async function applyDevToolsPreference(enabled: boolean): Promise<void> {
  try {
    await getShellBridge().setDevToolsEnabled(enabled);
  } catch {
    // Packaged without shell bridge (tests): ignore.
  }
}

export function mountSettingsView(container: HTMLElement, deps: SettingsViewDeps): void {
  const section = el("section", "settings-view settings-view--general");
  section.setAttribute("aria-label", "Cài đặt chung");

  const status = el("p", "settings-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.hidden = true;

  const generalBox = el("div", "settings-general");
  section.append(generalBox, status);
  container.replaceChildren(section);

  const setStatus = (text: string): void => {
    status.textContent = text;
    status.hidden = text.length === 0;
  };

  const run = async (label: string, action: () => Promise<SettingsView>): Promise<void> => {
    setStatus(`${label}…`);
    try {
      const next = await action();
      render(next);
      applyThemePreference(next.general.theme);
      void applyDevToolsPreference(next.general.devtoolsEnabled);
      setStatus("Đã lưu");
      window.setTimeout(() => setStatus(""), 1800);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Không lưu được cài đặt.");
    }
  };

  function settingSection(title: string, copy: string): { root: HTMLElement; body: HTMLElement } {
    const root = el("section", "settings-card");
    const header = el("div", "settings-card__header");
    header.append(el("h2", "settings-card__title", title), el("p", "settings-card__copy", copy));
    const body = el("div", "settings-card__body");
    root.append(header, body);
    return { root, body };
  }

  function switchRow(
    title: string,
    copy: string,
    checked: boolean,
    onChange: (checked: boolean) => Promise<void>,
  ): HTMLElement {
    const row = el("label", "settings-switch-row");
    const text = el("span", "settings-switch-row__copy");
    text.append(el("span", "settings-switch-row__title", title), el("span", "settings-switch-row__description", copy));
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.className = "settings-switch-row__input";
    const visual = el("span", "settings-switch-row__visual");
    visual.setAttribute("aria-hidden", "true");
    input.addEventListener("change", () => void onChange(input.checked));
    row.append(text, input, visual);
    return row;
  }

  function render(view: SettingsView): void {
    generalBox.replaceChildren();

    const appearance = settingSection(
      "Giao diện",
      "Chọn giao diện sáng, tối hoặc tự động theo Windows.",
    );
    const themeGroup = el("div", "settings-theme-segments");
    themeGroup.setAttribute("role", "radiogroup");
    themeGroup.setAttribute("aria-label", "Giao diện");
    for (const theme of THEMES) {
      const button = el("button", "settings-theme-segment", themeLabel(theme)) as HTMLButtonElement;
      button.type = "button";
      button.setAttribute("role", "radio");
      const active = view.general.theme === theme;
      button.setAttribute("aria-checked", active ? "true" : "false");
      button.classList.toggle("is-active", active);
      button.addEventListener("click", () => {
        void run("Đang đổi giao diện", () => deps.client.updateGeneral({ theme }));
      });
      themeGroup.append(button);
    }
    appearance.body.append(themeGroup);

    const diagnostics = settingSection(
      "Chẩn đoán",
      "Các tuỳ chọn hỗ trợ debug cục bộ. Không cần bật trong sử dụng thông thường.",
    );
    const diagnosticsPanel = el("div", "settings-diagnostics-panel");
    diagnostics.body.append(
      switchRow(
        "Ghi log chi tiết",
        "Ghi thêm dữ liệu kỹ thuật vào log cục bộ (đã ẩn khoá/secret). Lưu trong máy, không gửi ra ngoài.",
        view.general.verboseLogging,
        async (checked) => {
          await run("Đang lưu log", () => deps.client.updateGeneral({ verboseLogging: checked }));
          void refreshDiagnostics(diagnosticsPanel);
        },
      ),
      switchRow(
        "Telemetry cục bộ",
        "Đếm số liệu vận hành dạng tổng hợp trên máy — chỉ lưu trên máy, không gửi ra ngoài.",
        view.general.telemetryEnabled,
        async (checked) => {
          await run("Đang lưu telemetry", () =>
            deps.client.updateGeneral({ telemetryEnabled: checked }),
          );
          void refreshDiagnostics(diagnosticsPanel);
        },
      ),
      switchRow(
        "DevTools",
        "Mở cửa sổ DevTools (Console) để xem log và đo hiệu năng. Tắt để đóng.",
        view.general.devtoolsEnabled,
        (checked) => run("Đang lưu DevTools", () => deps.client.updateGeneral({ devtoolsEnabled: checked })),
      ),
      diagnosticsPanel,
    );

    // --- Security: "Require login at startup" (device-bound secure auto-unlock when OFF). ---
    const security = settingSection(
      "Bảo mật",
      "Kiểm soát việc hỏi mật khẩu mỗi khi mở ứng dụng.",
    );
    security.body.append(authToggleRow(view.general.requireLoginOnStartup), changePasswordRow());

    // --- Embedding: local (BGE-M3 ONNX) vs cloud (provider embedding API). ---
    const embedding = settingSection(
      "Embedding",
      "Chọn backend tạo vector embedding: cloud dùng API nhà cung cấp; local dùng model BGE-M3 int8 tích hợp sẵn.",
    );
    embedding.body.append(embeddingSection(view.general.embeddingMode, view.general.embeddingModelId));

    generalBox.append(appearance.root, security.root, embedding.root, diagnostics.root);
    void refreshDiagnostics(diagnosticsPanel);
  }

  const startupAuthReason = (reason?: string): string => {
    switch (reason) {
      case "invalid_password":
        return "Mật khẩu không đúng.";
      case "secure_storage_unavailable":
        return "Máy này chưa hỗ trợ mở khoá an toàn gắn với thiết bị — không thể tắt yêu cầu đăng nhập.";
      case "seal_failed":
        return "Không lưu được khoá thiết bị — giữ nguyên yêu cầu đăng nhập.";
      case "password_required":
        return "Cần nhập mật khẩu hiện tại.";
      case "service_not_ready":
        return "Dịch vụ chưa sẵn sàng — thử lại sau.";
      default:
        return "Không đổi được chế độ đăng nhập.";
    }
  };

  /**
   * The "Yêu cầu đăng nhập khi khởi động" switch. A security-sensitive change: it confirms the
   * current password and delegates the safeStorage work to the shell (setStartupAuthMode), reverting
   * the switch on any failure. `current` tracks the last-confirmed state for honest reverts.
   */
  function changePasswordRow(): HTMLElement {
    const wrapper = el("div", "settings-change-password");
    let open = false;
    const toggle = el("button", "settings-change-password__toggle", "Đổi mật khẩu") as HTMLButtonElement;
    toggle.type = "button";

    const form = el("form", "settings-change-password__form");
    form.hidden = true;

    const mkField = (labelText: string, id: string, autocomplete: AutoFill): HTMLInputElement => {
      const lbl = el("label", "settings-change-password__label", labelText) as HTMLLabelElement;
      lbl.htmlFor = id;
      const inp = el("input", "settings-change-password__input app-lock__input") as HTMLInputElement;
      inp.type = "password";
      inp.id = id;
      inp.autocomplete = autocomplete;
      inp.required = true;
      inp.minLength = 8;
      const wrap = el("div", "settings-change-password__field");
      wrap.append(lbl, inp);
      form.append(wrap);
      return inp;
    };

    const currentInp = mkField("Mật khẩu hiện tại", "chg-current", "current-password");
    const newInp = mkField("Mật khẩu mới (≥ 8 ký tự)", "chg-new", "new-password");
    const confirmInp = mkField("Xác nhận mật khẩu mới", "chg-confirm", "new-password");

    const errMsg = el("p", "settings-change-password__error");
    errMsg.setAttribute("role", "alert");
    errMsg.hidden = true;

    const actions = el("div", "settings-change-password__actions");
    const submitBtn = el("button", "settings-change-password__submit app-lock__btn", "Đổi mật khẩu") as HTMLButtonElement;
    submitBtn.type = "submit";
    const cancelBtn = el("button", "settings-change-password__cancel", "Huỷ") as HTMLButtonElement;
    cancelBtn.type = "button";
    actions.append(submitBtn, cancelBtn);
    form.append(errMsg, actions);

    const showErr = (msg: string): void => {
      errMsg.textContent = msg;
      errMsg.hidden = false;
    };
    const clearErr = (): void => { errMsg.hidden = true; errMsg.textContent = ""; };

    toggle.addEventListener("click", () => {
      open = !open;
      form.hidden = !open;
      toggle.textContent = open ? "Ẩn form đổi mật khẩu" : "Đổi mật khẩu";
      clearErr();
      if (open) currentInp.focus();
    });

    cancelBtn.addEventListener("click", () => {
      open = false;
      form.hidden = true;
      form.reset();
      clearErr();
      toggle.textContent = "Đổi mật khẩu";
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      clearErr();
      if (newInp.value !== confirmInp.value) {
        showErr("Mật khẩu mới và xác nhận không khớp.");
        confirmInp.focus();
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = "Đang đổi…";
      void (async () => {
        try {
          await deps.client.authChangePassword(currentInp.value, newInp.value);
          open = false;
          form.hidden = true;
          form.reset();
          toggle.textContent = "Đổi mật khẩu";
          setStatus("Đã đổi mật khẩu thành công.");
          window.setTimeout(() => setStatus(""), 2500);
        } catch (error) {
          showErr(error instanceof Error ? error.message : "Không đổi được mật khẩu.");
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = "Đổi mật khẩu";
        }
      })();
    });

    wrapper.append(toggle, form);
    return wrapper;
  }

  function authToggleRow(initial: boolean): HTMLElement {
    let current = initial;
    const row = el("label", "settings-switch-row");
    const text = el("span", "settings-switch-row__copy");
    text.append(
      el("span", "settings-switch-row__title", "Yêu cầu đăng nhập khi khởi động"),
      el(
        "span",
        "settings-switch-row__description",
        "Bật: luôn hỏi mật khẩu khi mở app. Tắt: mở thẳng vào Cowork — kho khoá vẫn được mã hoá và mở bằng khoá gắn với thiết bị (không lưu khoá dạng thô).",
      ),
    );
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = current;
    input.className = "settings-switch-row__input";
    const visual = el("span", "settings-switch-row__visual");
    visual.setAttribute("aria-hidden", "true");
    input.addEventListener("change", () => {
      const desiredRequireLogin = input.checked;
      void (async () => {
        const password = window.prompt(
          desiredRequireLogin
            ? "Nhập mật khẩu hiện tại để bật lại yêu cầu đăng nhập:"
            : "Nhập mật khẩu hiện tại để tắt yêu cầu đăng nhập (dùng mở khoá gắn thiết bị):",
        );
        if (password === null || password.length === 0) {
          input.checked = current;
          return;
        }
        setStatus("Đang cập nhật bảo mật khởi động…");
        try {
          const result = await getShellBridge().setStartupAuthMode(desiredRequireLogin, password);
          if (!result.ok) {
            input.checked = current;
            setStatus(startupAuthReason(result.reason));
            return;
          }
          current = result.requireLogin;
          input.checked = result.requireLogin;
          setStatus("Đã lưu");
          window.setTimeout(() => setStatus(""), 1800);
        } catch {
          input.checked = current;
          setStatus("Không đổi được chế độ đăng nhập trên bản dựng này.");
        }
      })();
    });
    row.append(text, input, visual);
    return row;
  }

  function embeddingSection(initialMode: "cloud" | "local", initialModelId: string): HTMLElement {
    const wrapper = el("div", "settings-embedding");
    let mode = initialMode;
    let modelId = initialModelId;

    const cloudBtn = el("button", "settings-embedding__mode-btn", "Cloud") as HTMLButtonElement;
    cloudBtn.type = "button";
    const localBtn = el("button", "settings-embedding__mode-btn", "Local (BGE-M3)") as HTMLButtonElement;
    localBtn.type = "button";

    const modeGroup = el("div", "settings-embedding__mode-group");
    modeGroup.setAttribute("role", "radiogroup");
    modeGroup.setAttribute("aria-label", "Chế độ embedding");
    modeGroup.append(cloudBtn, localBtn);

    const modelRow = el("div", "settings-embedding__model-row");
    const modelLabel = el("label", "settings-embedding__model-label", "Model ID") as HTMLLabelElement;
    modelLabel.htmlFor = "embedding-model-id";
    const modelInput = el("input", "settings-embedding__model-input") as HTMLInputElement;
    modelInput.id = "embedding-model-id";
    modelInput.value = modelId;
    modelInput.placeholder = "bge-m3-int8";
    modelRow.append(modelLabel, modelInput);

    const applyMode = (newMode: "cloud" | "local"): void => {
      mode = newMode;
      cloudBtn.classList.toggle("is-active", mode === "cloud");
      cloudBtn.setAttribute("aria-pressed", mode === "cloud" ? "true" : "false");
      localBtn.classList.toggle("is-active", mode === "local");
      localBtn.setAttribute("aria-pressed", mode === "local" ? "true" : "false");
      modelRow.hidden = mode === "cloud";
    };
    applyMode(mode);

    const saveEmbedding = (): void => {
      const patch: { embeddingMode: "cloud" | "local"; embeddingModelId?: string } = {
        embeddingMode: mode,
      };
      if (mode === "local") {
        const trimmed = modelInput.value.trim();
        patch.embeddingModelId = trimmed.length > 0 ? trimmed : "bge-m3-int8";
      }
      void run("Đang lưu embedding", () => deps.client.updateGeneral(patch));
    };

    cloudBtn.addEventListener("click", () => {
      applyMode("cloud");
      saveEmbedding();
    });
    localBtn.addEventListener("click", () => {
      applyMode("local");
      saveEmbedding();
    });
    modelInput.addEventListener("change", () => {
      modelId = modelInput.value.trim();
      saveEmbedding();
    });

    const note = el(
      "p",
      "settings-embedding__note",
      "Local cần chạy \"npm run fetch:model\" để tải model BGE-M3 int8 (~130 MB) trước khi đóng gói. Cloud dùng API của nhà cung cấp (cần API key hỗ trợ embedding).",
    );

    wrapper.append(modeGroup, modelRow, note);
    return wrapper;
  }

  async function refreshDiagnostics(panel: HTMLElement): Promise<void> {
    let data: DiagnosticsStatus;
    try {
      data = await deps.client.getDiagnostics();
    } catch {
      panel.replaceChildren(
        el("p", "settings-diagnostics-panel__note", "Chưa có dữ liệu chẩn đoán."),
      );
      return;
    }
    panel.replaceChildren();

    // Logging status + clear.
    const logRow = el("div", "settings-diagnostics-panel__row");
    logRow.append(
      el(
        "span",
        "settings-diagnostics-panel__label",
        data.logging.toFile
          ? `Log cục bộ: ${formatBytes(data.logging.sizeBytes)}`
          : "Log: chỉ hiển thị ở console",
      ),
    );
    if (data.logging.toFile) {
      logRow.append(
        actionButton("Xoá log", () => confirmClear("logs", "Xoá toàn bộ tệp log cục bộ?", panel)),
      );
    }
    panel.append(logRow);

    // Telemetry summary + export + clear.
    const counters = Object.entries(data.telemetry.counters).filter(([, v]) => v > 0);
    const telHead = el("div", "settings-diagnostics-panel__row");
    telHead.append(
      el(
        "span",
        "settings-diagnostics-panel__label",
        data.telemetry.enabled ? "Telemetry: đang thu thập" : "Telemetry: đang tắt",
      ),
      actionButton("Xuất chẩn đoán", exportDiagnostics),
      actionButton("Xoá số liệu", () =>
        confirmClear("telemetry", "Xoá toàn bộ số liệu telemetry cục bộ?", panel),
      ),
    );
    panel.append(telHead);

    if (counters.length === 0) {
      panel.append(
        el(
          "p",
          "settings-diagnostics-panel__note",
          data.telemetry.enabled ? "Chưa có số liệu." : "Bật telemetry để bắt đầu đếm.",
        ),
      );
    } else {
      const list = el("ul", "settings-diagnostics-panel__counters");
      for (const [name, value] of counters) {
        const item = el("li", "settings-diagnostics-panel__counter");
        item.append(
          el("span", "settings-diagnostics-panel__counter-name", TELEMETRY_LABELS[name] ?? name),
          el("span", "settings-diagnostics-panel__counter-value", String(value)),
        );
        list.append(item);
      }
      panel.append(list);
    }
  }

  function actionButton(label: string, onClick: () => void | Promise<void>): HTMLButtonElement {
    const btn = el("button", "settings-diagnostics-panel__btn", label) as HTMLButtonElement;
    btn.type = "button";
    btn.addEventListener("click", () => void onClick());
    return btn;
  }

  async function confirmClear(
    target: DiagnosticsClearTarget,
    message: string,
    panel: HTMLElement,
  ): Promise<void> {
    if (typeof window.confirm === "function" && !window.confirm(message)) return;
    setStatus("Đang xoá…");
    try {
      await deps.client.clearDiagnostics(target);
      setStatus("Đã xoá");
      window.setTimeout(() => setStatus(""), 1500);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Không xoá được.");
    }
    void refreshDiagnostics(panel);
  }

  async function exportDiagnostics(): Promise<void> {
    setStatus("Đang xuất…");
    try {
      const blob = await deps.client.exportDiagnostics();
      const saved = await getShellBridge().saveTextFile({
        filename: blob.filename,
        content: blob.json,
      });
      setStatus(saved.canceled ? "Đã huỷ xuất." : "Đã xuất chẩn đoán.");
      window.setTimeout(() => setStatus(""), 1800);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Không xuất được.");
    }
  }

  void (async () => {
    setStatus("Đang tải cài đặt…");
    try {
      const view = await deps.client.getSettings();
      render(view);
      applyThemePreference(view.general.theme);
      void applyDevToolsPreference(view.general.devtoolsEnabled);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Không tải được cài đặt.");
    }
  })();
}
