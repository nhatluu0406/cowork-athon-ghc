/**
 * Provider profiles settings panel (Multi-Provider Profiles Phase 1).
 */

import type { TestResult } from "@cowork-ghc/contracts";
import { createProductIcon } from "./product-icons.js";
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
    | "discoverProfileModels"
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

function icon(name: Parameters<typeof createProductIcon>[0], label?: string): SVGSVGElement {
  return createProductIcon(name, label);
}

function userFacingProviderError(error?: { message?: string } | string): string {
  const message = typeof error === "string" ? error : (error?.message ?? "");
  if (message.length > 0) return message;
  return "Kiểm tra kết nối thất bại.";
}

function formatVerifiedStatus(profile?: ProviderProfileView): string {
  if (profile === undefined) return "Chưa kiểm tra.";
  if (!profile.verificationCurrent || profile.lastVerifiedOk === undefined) return "Chưa kiểm tra.";
  const when = profile.lastVerifiedAt !== undefined ? ` · ${profile.lastVerifiedAt}` : "";
  return profile.lastVerifiedOk ? `Đã kiểm tra${when}` : `Kiểm tra thất bại${when}`;
}

const ONLY_PROFILE_DELETE_MESSAGE = "Bạn cần tạo một profile khác trước khi xóa profile này.";
const ACTIVE_PROFILE_DELETE_MESSAGE = "Hãy đặt một profile khác làm active trước khi xóa profile này.";

export function mountProviderProfilesPanel(container: HTMLElement, deps: ProviderProfilesPanelDeps): void {
  const root = el("section", "provider-profiles llm-settings");
  root.setAttribute("aria-label", "Nhà cung cấp và mô hình");

  const title = el("h2", "llm-settings-title", "Nhà cung cấp & mô hình");
  const intro = el(
    "p",
    "provider-profiles__intro",
    "Lưu nhiều kết nối API, chọn kết nối đang dùng và đổi model cho cuộc trò chuyện mới.",
  );
  const status = el("p", "llm-settings-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const listView = el("div", "provider-profiles__list-view");
  const listHeader = el("div", "provider-profiles__list-header");
  const listHeading = el("div", "provider-profiles__list-heading");
  listHeading.append(
    el("h3", "provider-profiles__list-title", "Kết nối đã lưu"),
    el("p", "provider-profiles__list-copy", "Mỗi kết nối có endpoint, model và khoá API riêng trong kho mật mã cục bộ."),
  );
  const addBtn = el("button", "provider-profiles__add provider-profiles__add--primary", "Thêm kết nối") as HTMLButtonElement;
  addBtn.type = "button";
  addBtn.setAttribute("aria-expanded", "false");
  listHeader.append(listHeading, addBtn);

  const list = el("ul", "provider-profiles__list");
  const addChooser = el("div", "provider-profiles__add-chooser");
  addChooser.hidden = true;
  const addDeepSeekBtn = el("button", "provider-profiles__preset") as HTMLButtonElement;
  addDeepSeekBtn.type = "button";
  addDeepSeekBtn.append(
    el("strong", "provider-profiles__preset-title", "DeepSeek"),
    el("span", "provider-profiles__preset-copy", "Preset nhanh cho DeepSeek Chat hoặc Reasoner."),
  );
  const addCustomBtn = el("button", "provider-profiles__preset") as HTMLButtonElement;
  addCustomBtn.type = "button";
  addCustomBtn.append(
    el("strong", "provider-profiles__preset-title", "OpenAI-compatible"),
    el("span", "provider-profiles__preset-copy", "Nhập tên, endpoint, model ID và API token bất kỳ."),
  );
  addChooser.append(addDeepSeekBtn, addCustomBtn);
  listView.append(listHeader, addChooser, list);

  const formView = el("div", "provider-profiles__form-view");
  formView.hidden = true;
  const formTitle = el("h3", "provider-profiles__form-title");
  const backBtn = el("button", "provider-profiles__back") as HTMLButtonElement;
  backBtn.type = "button";
  backBtn.dataset["tooltip"] = "Quay lại danh sách";
  backBtn.setAttribute("aria-label", "Quay lại danh sách");
  backBtn.removeAttribute("title");
  backBtn.append(icon("arrow-left", "Quay lại"), el("span", "provider-profiles__back-label", "Danh sách"));

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
  modelCustomInput.placeholder = "Nhập Model ID thủ công hoặc dò từ endpoint";
  // A datalist turns the free-text input into a searchable combobox while ALWAYS retaining
  // manual entry (the user can type any id the discovered list does not contain).
  const modelDatalist = document.createElement("datalist");
  modelDatalist.id = "provider-profiles-model-options";
  modelCustomInput.setAttribute("list", modelDatalist.id);
  const discoverBtn = el("button", "provider-profiles__discover", "Dò model") as HTMLButtonElement;
  discoverBtn.type = "button";
  const discoverStatus = el("p", "provider-profiles__discover-status");
  discoverStatus.setAttribute("role", "status");
  discoverStatus.setAttribute("aria-live", "polite");
  modelCustomLabel.append(modelCustomInput, modelDatalist, discoverBtn, discoverStatus);

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

  const saveAndTestBtn = el("button", "llm-save-credential provider-profiles__primary", "Lưu & kiểm tra") as HTMLButtonElement;
  saveAndTestBtn.type = "button";

  const overflow = el("div", "provider-profiles__overflow");
  const overflowBtn = el("button", "provider-profiles__overflow-toggle") as HTMLButtonElement;
  overflowBtn.type = "button";
  overflowBtn.dataset["tooltip"] = "Thêm thao tác";
  overflowBtn.setAttribute("aria-label", "Thêm thao tác");
  overflowBtn.setAttribute("aria-haspopup", "menu");
  overflowBtn.setAttribute("aria-expanded", "false");
  overflowBtn.removeAttribute("title");
  overflowBtn.append(icon("more", "Thêm thao tác"));
  const overflowMenu = el("div", "provider-profiles__overflow-menu");
  overflowMenu.setAttribute("role", "menu");
  overflowMenu.hidden = true;

  const saveOnlyBtn = el("button", "provider-profiles__overflow-item", "Lưu không kiểm tra") as HTMLButtonElement;
  saveOnlyBtn.type = "button";
  saveOnlyBtn.setAttribute("role", "menuitem");
  const setActiveBtn = el("button", "provider-profiles__overflow-item", "Đặt làm mặc định") as HTMLButtonElement;
  setActiveBtn.type = "button";
  setActiveBtn.setAttribute("role", "menuitem");
  const deleteCredBtn = el("button", "provider-profiles__overflow-item", "Xoá khoá API") as HTMLButtonElement;
  deleteCredBtn.type = "button";
  deleteCredBtn.setAttribute("role", "menuitem");
  const deleteBtn = el("button", "provider-profiles__overflow-item provider-profiles__overflow-item--danger", "Xoá hồ sơ") as HTMLButtonElement;
  deleteBtn.type = "button";
  deleteBtn.setAttribute("role", "menuitem");
  overflowMenu.append(saveOnlyBtn, setActiveBtn, deleteCredBtn, deleteBtn);
  overflow.append(overflowBtn, overflowMenu);

  const actions = el("div", "llm-actions provider-profiles__actions");
  actions.append(backBtn, saveAndTestBtn, overflow);
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

  root.append(title, intro, status, listView, formView);
  container.replaceChildren(root);

  let panel: PanelView = "list";
  let profiles: readonly ProviderProfileView[] = [];
  let editingId: string | null = null;
  let addingType: ProviderProfileType | null = null;
  let busy = false;

  const setStatus = (text: string, kind: "idle" | "ok" | "err" = "idle"): void => {
    status.textContent = text;
    root.classList.toggle("is-error", kind === "err");
    root.classList.toggle("is-ok", kind === "ok");
  };

  const closeOverflow = (): void => {
    overflowMenu.hidden = true;
    overflowBtn.setAttribute("aria-expanded", "false");
  };

  const currentProfile = (): ProviderProfileView | undefined =>
    editingId === null ? undefined : profiles.find((p) => p.id === editingId);

  const selectedModelId = (): string =>
    (addingType ?? currentProfile()?.providerType) === "deepseek"
      ? modelSelect.value
      : modelCustomInput.value.trim();

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

  const fillDiscoveredModels = (models: readonly string[]): void => {
    modelDatalist.replaceChildren();
    for (const id of models) {
      const opt = document.createElement("option");
      opt.value = id;
      modelDatalist.append(opt);
    }
  };

  // Discovery needs a persisted profile (id) with a stored credential; a brand-new draft must
  // be saved once first. Manual entry is always available regardless.
  const updateDiscoverAvailability = (): void => {
    const profile = currentProfile();
    const providerType = addingType ?? profile?.providerType;
    if (providerType === "deepseek") return; // deepseek uses a fixed model select
    const canDiscover = editingId !== null && profile?.credentialConfigured === true && !busy;
    discoverBtn.disabled = !canDiscover;
    discoverBtn.dataset["tooltip"] = canDiscover
      ? "Lấy danh sách model từ endpoint"
      : "Lưu hồ sơ và khoá API trước, rồi dò model";
  };

  const showList = (): void => {
    panel = "list";
    editingId = null;
    addingType = null;
    listView.hidden = false;
    formView.hidden = true;
    closeOverflow();
  };

  const showForm = (mode: "edit" | "add", profile?: ProviderProfileView, type?: ProviderProfileType): void => {
    panel = mode;
    listView.hidden = true;
    formView.hidden = false;
    closeOverflow();
    fillDiscoveredModels([]);
    discoverStatus.textContent = "";
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
      testStatus.textContent = formatVerifiedStatus(profile);
      updateDiscoverAvailability();
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
      updateDiscoverAvailability();
    }
  };

  const renderList = (): void => {
    list.replaceChildren();
    if (profiles.length === 0) {
      const empty = el("li", "provider-profiles__empty");
      empty.append(
        el("strong", "provider-profiles__empty-title", "Chưa có kết nối mô hình"),
        el("span", "provider-profiles__empty-copy", "Thêm DeepSeek hoặc một endpoint OpenAI-compatible để bắt đầu."),
      );
      list.append(empty);
      return;
    }
    for (const profile of profiles) {
      const item = el("li", "provider-profiles__item");
      const head = el("div", "provider-profiles__item-head");
      const name = el("span", "provider-profiles__item-name", profile.displayName);
      if (profile.isActive) {
        name.append(document.createTextNode(" "));
        const badge = el("span", "provider-profiles__active-badge", "Mặc định");
        name.append(badge);
      }
      const verifiedLabel =
        profile.verificationCurrent && profile.lastVerifiedOk === true
          ? "Đã kiểm tra"
          : profile.verificationCurrent && profile.lastVerifiedOk === false
            ? "Kiểm tra thất bại"
            : "Chưa kiểm tra";
      const meta = el(
        "span",
        "provider-profiles__item-meta",
        `${profile.modelId} · ${profile.credentialConfigured ? "Đã cấu hình" : "Chưa cấu hình"} · ${verifiedLabel}`,
      );
      head.append(name, meta);
      const editButton = el("button", "provider-profiles__edit") as HTMLButtonElement;
      editButton.type = "button";
      editButton.dataset["tooltip"] = "Sửa kết nối";
      editButton.removeAttribute("title");
      editButton.setAttribute("aria-label", `Sửa kết nối ${profile.displayName}`);
      editButton.append(icon("pencil", "Sửa"));
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

  const saveProfileFields = async (options: { readonly runTest: boolean }): Promise<void> => {
    if (busy) return;
    busy = true;
    closeOverflow();
    try {
      const modelId = selectedModelId();
      let profileId = editingId;

      if (panel === "add" && addingType !== null) {
        setStatus("Đang lưu…");
        const created = await deps.client.createProviderProfile({
          displayName: nameInput.value.trim(),
          providerType: addingType,
          baseUrl: baseUrlInput.value.trim(),
          modelId,
          ...(addingType === "deepseek" ? { presetId: "deepseek" } : {}),
        });
        profileId = created.id;
        editingId = created.id;
      } else if (editingId !== null) {
        setStatus("Đang lưu…");
        await deps.client.updateProviderProfile(editingId, {
          displayName: nameInput.value.trim(),
          baseUrl: baseUrlInput.value.trim(),
          modelId,
        });
      } else {
        setStatus("Không xác định được hồ sơ.", "err");
        return;
      }

      const secret = credInput.value;
      if (secret.trim().length > 0 && profileId !== null) {
        setStatus("Đang lưu khoá API…");
        const view = await deps.client.storeProfileCredential(profileId, secret);
        credInput.value = "";
        deps.onSettingsUpdated?.(view);
        profiles = view.providerProfiles ?? profiles;
      } else {
        await refresh();
      }

      if (options.runTest && profileId !== null) {
        testStatus.textContent = "Đang kiểm tra…";
        setStatus("Đang kiểm tra kết nối…");
        try {
          const result: TestResult = await deps.client.testProfileConnection(profileId);
          await refresh();
          const updated = profiles.find((p) => p.id === profileId);
          if (updated !== undefined) showForm("edit", updated);
          else showList();
          testStatus.textContent = result.ok
            ? formatVerifiedStatus(updated)
            : userFacingProviderError(result.error);
          setStatus(
            result.ok ? "Đã lưu và xác minh kết nối." : userFacingProviderError(result.error),
            result.ok ? "ok" : "err",
          );
          deps.onConnectionTestResult?.(profileId, result.ok);
        } catch (error) {
          await refresh();
          const updated = profiles.find((p) => p.id === profileId);
          if (updated !== undefined) showForm("edit", updated);
          testStatus.textContent = "Kết nối thất bại.";
          setStatus(error instanceof Error ? error.message : "Kiểm tra thất bại.", "err");
          deps.onConnectionTestResult?.(profileId, false);
        }
        return;
      }

      const updated = profiles.find((p) => p.id === profileId);
      if (updated !== undefined) showForm("edit", updated);
      else showList();
      setStatus("Đã lưu hồ sơ.", "ok");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Không lưu được.", "err");
    } finally {
      busy = false;
    }
  };

  backBtn.addEventListener("click", () => {
    showList();
    setStatus("");
  });

  overflowBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = overflowMenu.hidden;
    overflowMenu.hidden = !open;
    overflowBtn.setAttribute("aria-expanded", open ? "true" : "false");
  });
  root.addEventListener("click", () => closeOverflow());
  overflowMenu.addEventListener("click", (event) => event.stopPropagation());

  addBtn.addEventListener("click", () => {
    const open = addChooser.hidden;
    addChooser.hidden = !open;
    addBtn.setAttribute("aria-expanded", open ? "true" : "false");
  });
  addDeepSeekBtn.addEventListener("click", () => {
    addChooser.hidden = true;
    addBtn.setAttribute("aria-expanded", "false");
    showForm("add", undefined, "deepseek");
  });
  addCustomBtn.addEventListener("click", () => {
    addChooser.hidden = true;
    addBtn.setAttribute("aria-expanded", "false");
    showForm("add", undefined, "custom-openai-compat");
  });

  discoverBtn.addEventListener("click", () => {
    if (busy || editingId === null) return;
    const profileId = editingId;
    busy = true;
    updateDiscoverAvailability();
    discoverStatus.textContent = "Đang dò model…";
    void (async () => {
      try {
        const baseUrl = baseUrlInput.value.trim();
        const result = await deps.client.discoverProfileModels(
          profileId,
          baseUrl.length > 0 ? baseUrl : undefined,
        );
        if (result.ok && result.models !== undefined) {
          fillDiscoveredModels(result.models);
          discoverStatus.textContent =
            result.models.length > 0
              ? `Tìm thấy ${result.models.length} model. Chọn hoặc nhập thủ công.`
              : "Không có model nào. Nhập Model ID thủ công.";
        } else {
          fillDiscoveredModels([]);
          discoverStatus.textContent = userFacingProviderError(result.error);
        }
      } catch (error) {
        fillDiscoveredModels([]);
        discoverStatus.textContent = error instanceof Error ? error.message : "Dò model thất bại.";
      } finally {
        busy = false;
        updateDiscoverAvailability();
      }
    })();
  });

  saveAndTestBtn.addEventListener("click", () => {
    void saveProfileFields({ runTest: true });
  });
  saveOnlyBtn.addEventListener("click", () => {
    void saveProfileFields({ runTest: false });
  });

  deleteCredBtn.addEventListener("click", () => {
    if (editingId === null) return;
    closeOverflow();
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

  setActiveBtn.addEventListener("click", () => {
    if (editingId === null) return;
    closeOverflow();
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
    closeOverflow();
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
      showList();
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Không tải được hồ sơ.", "err");
    }
  })();
}
