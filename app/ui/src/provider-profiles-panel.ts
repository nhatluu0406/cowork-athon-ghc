/**
 * Provider profiles settings panel (Multi-Provider Profiles Phase 1).
 */

import type { TestResult } from "@cowork-ghc/contracts";
import type {
  ProviderProfileType,
  ProviderProfileView,
  ServiceClient,
  SettingsView,
} from "./service-client.js";

const DEEPSEEK_MODELS = [
  { id: "deepseek-chat", label: "DeepSeek Chat" },
  { id: "deepseek-reasoner", label: "DeepSeek Reasoner" },
] as const;

export interface ProviderProfilesPanelDeps {
  readonly client: Pick<
    ServiceClient,
    | "getSettings"
    | "listProviderProfiles"
    | "createProviderProfile"
    | "updateProviderProfile"
    | "deleteProviderProfile"
    | "setActiveProviderProfile"
    | "storeProfileCredential"
    | "removeProfileCredential"
    | "testProfileConnection"
  >;
  readonly onSettingsUpdated?: (view: SettingsView) => void;
  readonly onConnectionTestResult?: (profileId: string, ok: boolean) => void;
}

type PanelView = "list" | "edit" | "add";

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

function userFacingProviderError(error?: { message?: string } | string): string {
  const message = typeof error === "string" ? error : (error?.message ?? "");
  if (message.length > 0) return message;
  return "Kiểm tra kết nối thất bại.";
}

const ONLY_PROFILE_DELETE_MESSAGE = "Bạn cần tạo một profile khác trước khi xóa profile này.";
const ACTIVE_PROFILE_DELETE_MESSAGE = "Hãy đặt một profile khác làm active trước khi xóa profile này.";

export function mountProviderProfilesPanel(container: HTMLElement, deps: ProviderProfilesPanelDeps): void {
  const root = el("section", "provider-profiles llm-settings");
  root.setAttribute("aria-label", "Hồ sơ nhà cung cấp");

  const title = el("h2", "llm-settings-title", "Hồ sơ nhà cung cấp");
  const status = el("p", "llm-settings-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const listView = el("div", "provider-profiles__list-view");
  const list = el("ul", "provider-profiles__list");
  const addDeepSeekBtn = el("button", "provider-profiles__add", "Thêm DeepSeek") as HTMLButtonElement;
  addDeepSeekBtn.type = "button";
  const addCustomBtn = el("button", "provider-profiles__add", "Thêm tuỳ chỉnh") as HTMLButtonElement;
  addCustomBtn.type = "button";
  listView.append(list, el("div", "provider-profiles__add-row", undefined), addDeepSeekBtn, addCustomBtn);

  const formView = el("div", "provider-profiles__form-view");
  formView.hidden = true;
  const formTitle = el("h3", "provider-profiles__form-title");
  const backBtn = el("button", "provider-profiles__back", "← Danh sách") as HTMLButtonElement;
  backBtn.type = "button";

  const nameLabel = el("label", "llm-field", "Tên hiển thị");
  const nameInput = document.createElement("input");
  nameInput.className = "provider-profiles__name";
  nameLabel.append(nameInput);

  const modelLabel = el("label", "llm-field", "Mô hình");
  const modelSelect = document.createElement("select");
  modelSelect.className = "provider-profiles__model";
  modelLabel.append(modelSelect);

  const modelCustomLabel = el("label", "llm-field", "Model ID");
  const modelCustomInput = document.createElement("input");
  modelCustomInput.className = "provider-profiles__model-custom";
  modelCustomLabel.append(modelCustomInput);

  const baseUrlLabel = el("label", "llm-field", "Base URL");
  const baseUrlInput = document.createElement("input");
  baseUrlInput.className = "provider-profiles__base-url";
  baseUrlLabel.append(baseUrlInput);

  const credLabel = el("label", "llm-field", "Khoá API");
  const credInput = document.createElement("input");
  credInput.type = "password";
  credInput.className = "llm-credential-input";
  credInput.autocomplete = "off";
  credInput.placeholder = "Nhập khoá mới (không hiển thị lại sau khi lưu)";
  credLabel.append(credInput);

  const credStatus = el("p", "llm-credential-status");
  const testStatus = el("p", "provider-profiles__test-status");
  const deleteStatus = el("p", "provider-profiles__delete-status");

  const saveBtn = el("button", "llm-save-credential", "Lưu") as HTMLButtonElement;
  saveBtn.type = "button";
  const saveCredBtn = el("button", "llm-save-credential", "Lưu khoá API") as HTMLButtonElement;
  saveCredBtn.type = "button";
  const deleteCredBtn = el("button", "llm-delete-credential", "Xoá khoá API") as HTMLButtonElement;
  deleteCredBtn.type = "button";
  const testBtn = el("button", "llm-test-connection", "Kiểm tra kết nối") as HTMLButtonElement;
  testBtn.type = "button";
  const setActiveBtn = el("button", "provider-profiles__set-active", "Đặt làm active") as HTMLButtonElement;
  setActiveBtn.type = "button";
  const deleteBtn = el("button", "provider-profiles__delete", "Xoá hồ sơ") as HTMLButtonElement;
  deleteBtn.type = "button";

  const actions = el("div", "llm-actions");
  actions.append(backBtn, saveBtn, saveCredBtn, deleteCredBtn, testBtn, setActiveBtn, deleteBtn);
  formView.append(
    formTitle,
    nameLabel,
    modelLabel,
    modelCustomLabel,
    baseUrlLabel,
    credLabel,
    credStatus,
    testStatus,
    deleteStatus,
    actions,
  );

  root.append(title, status, listView, formView);
  container.replaceChildren(root);

  let panel: PanelView = "list";
  let profiles: readonly ProviderProfileView[] = [];
  let editingId: string | null = null;
  let addingType: ProviderProfileType | null = null;
  const testState = new Map<string, "unknown" | "ok" | "failed" | "testing">();

  const setStatus = (text: string, kind: "idle" | "ok" | "err" = "idle"): void => {
    status.textContent = text;
    root.classList.toggle("is-error", kind === "err");
    root.classList.toggle("is-ok", kind === "ok");
  };

  const currentProfile = (): ProviderProfileView | undefined =>
    editingId === null ? undefined : profiles.find((p) => p.id === editingId);

  const fillModelOptions = (providerType: ProviderProfileType, selected?: string): void => {
    modelSelect.replaceChildren();
    if (providerType === "deepseek") {
      for (const m of DEEPSEEK_MODELS) {
        const opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = m.label;
        modelSelect.append(opt);
      }
      modelSelect.hidden = false;
      modelCustomLabel.hidden = true;
      if (selected !== undefined) modelSelect.value = selected;
    } else {
      modelSelect.hidden = true;
      modelCustomLabel.hidden = false;
      if (selected !== undefined) modelCustomInput.value = selected;
    }
  };

  const showList = (): void => {
    panel = "list";
    editingId = null;
    addingType = null;
    listView.hidden = false;
    formView.hidden = true;
  };

  const showForm = (mode: "edit" | "add", profile?: ProviderProfileView, type?: ProviderProfileType): void => {
    panel = mode;
    listView.hidden = true;
    formView.hidden = false;
    if (mode === "edit" && profile !== undefined) {
      editingId = profile.id;
      addingType = null;
      formTitle.textContent = `Sửa: ${profile.displayName}`;
      nameInput.value = profile.displayName;
      baseUrlInput.value = profile.baseUrl;
      fillModelOptions(profile.providerType, profile.modelId);
      baseUrlLabel.hidden = profile.providerType === "deepseek";
      credStatus.textContent = profile.credentialConfigured ? "Đã cấu hình" : "Chưa cấu hình";
      deleteCredBtn.disabled = !profile.credentialConfigured;
      setActiveBtn.hidden = profile.isActive;
      deleteBtn.hidden = false;
      deleteBtn.disabled = profiles.length <= 1 || profile.isActive;
      deleteStatus.textContent =
        profiles.length <= 1
          ? ONLY_PROFILE_DELETE_MESSAGE
          : profile.isActive
            ? ACTIVE_PROFILE_DELETE_MESSAGE
            : "";
      const ts = testState.get(profile.id) ?? "unknown";
      testStatus.textContent =
        ts === "testing"
          ? "Đang kiểm tra…"
          : ts === "ok"
            ? "Kết nối thành công."
            : ts === "failed"
              ? "Kết nối thất bại."
              : "Chưa kiểm tra.";
    } else {
      editingId = null;
      addingType = type ?? "custom-openai-compat";
      formTitle.textContent = addingType === "deepseek" ? "Thêm DeepSeek" : "Thêm nhà cung cấp tuỳ chỉnh";
      nameInput.value = addingType === "deepseek" ? "DeepSeek" : "";
      baseUrlInput.value = addingType === "deepseek" ? "https://api.deepseek.com/v1" : "";
      fillModelOptions(addingType);
      baseUrlLabel.hidden = addingType === "deepseek";
      credStatus.textContent = "Chưa cấu hình";
      deleteCredBtn.disabled = true;
      setActiveBtn.hidden = true;
      deleteBtn.hidden = true;
      deleteBtn.disabled = true;
      deleteStatus.textContent = "";
      testStatus.textContent = "Chưa kiểm tra.";
    }
  };

  const renderList = (): void => {
    list.replaceChildren();
    if (profiles.length === 0) {
      list.append(el("li", "provider-profiles__empty", "Chưa có hồ sơ nhà cung cấp."));
      return;
    }
    for (const profile of profiles) {
      const item = el("li", "provider-profiles__item");
      const head = el("div", "provider-profiles__item-head");
      const name = el("span", "provider-profiles__item-name", profile.displayName);
      if (profile.isActive) {
        name.append(document.createTextNode(" "));
        const badge = el("span", "provider-profiles__active-badge", "Active");
        name.append(badge);
      }
      const meta = el(
        "span",
        "provider-profiles__item-meta",
        `${profile.modelId} · ${profile.credentialConfigured ? "Đã cấu hình" : "Chưa cấu hình"}`,
      );
      head.append(name, meta);
      const editButton = el("button", "provider-profiles__edit", "Sửa") as HTMLButtonElement;
      editButton.type = "button";
      editButton.addEventListener("click", () => showForm("edit", profile));
      item.append(head, editButton);
      list.append(item);
    }
  };

  const refresh = async (): Promise<SettingsView> => {
    const listed = await deps.client.listProviderProfiles();
    profiles = listed.profiles;
    const view = await deps.client.getSettings();
    deps.onSettingsUpdated?.(view);
    renderList();
    return view;
  };

  backBtn.addEventListener("click", () => {
    showList();
    setStatus("");
  });

  addDeepSeekBtn.addEventListener("click", () => showForm("add", undefined, "deepseek"));
  addCustomBtn.addEventListener("click", () => showForm("add", undefined, "custom-openai-compat"));

  saveBtn.addEventListener("click", () => {
    void (async () => {
      setStatus("Đang lưu…");
      try {
        const modelId =
          (addingType ?? currentProfile()?.providerType) === "deepseek"
            ? modelSelect.value
            : modelCustomInput.value.trim();
        if (panel === "add" && addingType !== null) {
          await deps.client.createProviderProfile({
            displayName: nameInput.value.trim(),
            providerType: addingType,
            baseUrl: baseUrlInput.value.trim(),
            modelId,
            ...(addingType === "deepseek" ? { presetId: "deepseek" } : {}),
          });
          await refresh();
          showList();
          setStatus("Đã tạo hồ sơ.", "ok");
        } else if (editingId !== null) {
          await deps.client.updateProviderProfile(editingId, {
            displayName: nameInput.value.trim(),
            baseUrl: baseUrlInput.value.trim(),
            modelId,
          });
          const view = await refresh();
          const updated = view.providerProfiles?.find((p) => p.id === editingId);
          if (updated !== undefined) showForm("edit", updated);
          setStatus("Đã lưu hồ sơ.", "ok");
        }
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Không lưu được.", "err");
      }
    })();
  });

  saveCredBtn.addEventListener("click", () => {
    if (editingId === null) {
      setStatus("Lưu hồ sơ trước khi thêm khoá API.", "err");
      return;
    }
    const secret = credInput.value;
    if (secret.trim().length === 0) {
      setStatus("Nhập khoá API trước khi lưu.", "err");
      return;
    }
    void (async () => {
      setStatus("Đang lưu khoá API…");
      try {
        const view = await deps.client.storeProfileCredential(editingId!, secret);
        credInput.value = "";
        deps.onSettingsUpdated?.(view);
        profiles = view.providerProfiles ?? profiles;
        const updated = profiles.find((p) => p.id === editingId);
        if (updated !== undefined) showForm("edit", updated);
        setStatus("Đã lưu khoá API.", "ok");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Không lưu được khoá.", "err");
      }
    })();
  });

  deleteCredBtn.addEventListener("click", () => {
    if (editingId === null) return;
    void (async () => {
      setStatus("Đang xoá khoá API…");
      try {
        const view = await deps.client.removeProfileCredential(editingId!);
        deps.onSettingsUpdated?.(view);
        profiles = view.providerProfiles ?? profiles;
        const updated = profiles.find((p) => p.id === editingId);
        if (updated !== undefined) showForm("edit", updated);
        setStatus("Đã xoá khoá API.");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Không xoá được khoá.", "err");
      }
    })();
  });

  testBtn.addEventListener("click", () => {
    if (editingId === null) return;
    void (async () => {
      testState.set(editingId!, "testing");
      testStatus.textContent = "Đang kiểm tra…";
      setStatus("Đang kiểm tra kết nối…");
      try {
        const result: TestResult = await deps.client.testProfileConnection(editingId!);
        testState.set(editingId!, result.ok ? "ok" : "failed");
        testStatus.textContent = result.ok ? "Kết nối thành công." : userFacingProviderError(result.error);
        setStatus(result.ok ? "Kết nối thành công." : userFacingProviderError(result.error), result.ok ? "ok" : "err");
        deps.onConnectionTestResult?.(editingId!, result.ok);
      } catch (error) {
        testState.set(editingId!, "failed");
        testStatus.textContent = "Kết nối thất bại.";
        setStatus(error instanceof Error ? error.message : "Kiểm tra thất bại.", "err");
        deps.onConnectionTestResult?.(editingId!, false);
      }
    })();
  });

  setActiveBtn.addEventListener("click", () => {
    if (editingId === null) return;
    void (async () => {
      setStatus("Đang đặt active…");
      try {
        const view = await deps.client.setActiveProviderProfile(editingId!);
        deps.onSettingsUpdated?.(view);
        profiles = view.providerProfiles ?? profiles;
        await refresh();
        const updated = profiles.find((p) => p.id === editingId);
        if (updated !== undefined) showForm("edit", updated);
        setStatus("Đã chuyển hồ sơ active.", "ok");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Không đặt được active.", "err");
      }
    })();
  });

  deleteBtn.addEventListener("click", () => {
    if (editingId === null) return;
    const profile = currentProfile();
    if (profile === undefined) return;
    if (profiles.length <= 1) {
      setStatus(ONLY_PROFILE_DELETE_MESSAGE, "err");
      return;
    }
    if (profile.isActive) {
      setStatus(ACTIVE_PROFILE_DELETE_MESSAGE, "err");
      return;
    }
    const ok = window.confirm(`Xoá hồ sơ "${profile.displayName}"?`);
    if (!ok) return;
    void (async () => {
      setStatus("Đang xoá…");
      try {
        await deps.client.deleteProviderProfile(editingId!);
        await refresh();
        showList();
        setStatus("Đã xoá hồ sơ.");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Không xoá được.", "err");
      }
    })();
  });

  void (async () => {
    setStatus("Đang tải…");
    try {
      await refresh();
      if (profiles.length === 0) {
        await deps.client.createProviderProfile({
          displayName: "DeepSeek",
          providerType: "deepseek",
          presetId: "deepseek",
        });
        await refresh();
      }
      showList();
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Không tải được hồ sơ.", "err");
    }
  })();
}
