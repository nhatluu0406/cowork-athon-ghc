/**
 * Skills management screen inside full-screen Settings.
 */

import type { ServiceClient, SkillView } from "./service-client.js";
import { icon } from "./ui-shell/dom-utils.js";

export interface SkillWriteInput {
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly body: string;
}

export interface SkillCreateInput extends SkillWriteInput {
  readonly id?: string;
}

export interface SkillsSettingsHandle {
  refresh(): Promise<void>;
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

function sourceLabel(source: SkillView["source"]): string {
  return source === "built_in" ? "Tích hợp sẵn" : "Người dùng";
}

function suggestSkillId(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64);
  const candidate = slug.length > 0 ? slug : "skill";
  return /^[a-z0-9][a-z0-9._-]{1,63}$/u.test(candidate) ? candidate : "my-skill";
}

function field(label: string, input: HTMLElement): HTMLElement {
  const wrap = el("label", "skills-settings__field");
  wrap.append(el("span", "skills-settings__label", label), input);
  return wrap;
}

export function mountSkillsSettingsPanel(
  root: HTMLElement,
  client: ServiceClient,
  onChanged?: (skills: readonly SkillView[]) => void,
): SkillsSettingsHandle {
  const toolbar = el("div", "skills-settings__toolbar");
  const search = el("input", "skills-settings__search") as HTMLInputElement;
  search.type = "search";
  search.placeholder = "Tìm theo tên…";
  search.setAttribute("aria-label", "Tìm Skill theo tên");
  const createButton = el("button", "label-btn", "Tạo Skill") as HTMLButtonElement;
  createButton.type = "button";
  toolbar.append(search, createButton);

  const layout = el("div", "skills-settings__layout");
  const list = el("div", "skills-settings__list");
  list.setAttribute("role", "listbox");
  const editor = el("section", "skills-settings__editor");
  editor.setAttribute("aria-label", "Chi tiết Skill");
  const status = el("p", "skills-settings__status");
  status.setAttribute("role", "status");
  layout.append(list, editor);
  root.replaceChildren(
    el("h2", "skills-settings__title", "Skill"),
    el(
      "p",
      "skills-settings__intro",
      "Quản lý Skill local cho lượt gửi. Skill không chạy code và không cấp quyền mới.",
    ),
    toolbar,
    layout,
    status,
  );

  let skills: readonly SkillView[] = [];
  let selectedId: string | null = null;
  let creating = false;
  let dirty = false;
  let query = "";

  const idInput = el("input", "skills-settings__input") as HTMLInputElement;
  idInput.setAttribute("aria-label", "Skill id");
  const nameInput = el("input", "skills-settings__input") as HTMLInputElement;
  nameInput.setAttribute("aria-label", "Tên Skill");
  const descriptionInput = el("input", "skills-settings__input") as HTMLInputElement;
  descriptionInput.setAttribute("aria-label", "Mô tả Skill");
  const versionInput = el("input", "skills-settings__input") as HTMLInputElement;
  versionInput.setAttribute("aria-label", "Phiên bản Skill");
  const bodyInput = el("textarea", "skills-settings__textarea") as HTMLTextAreaElement;
  bodyInput.rows = 12;
  bodyInput.setAttribute("aria-label", "Nội dung Markdown Skill");
  const errorBox = el("p", "skills-settings__error");
  errorBox.hidden = true;
  errorBox.setAttribute("role", "alert");
  const meta = el("p", "skills-settings__meta");
  const saveButton = el("button", "label-btn", "Lưu") as HTMLButtonElement;
  saveButton.type = "button";
  const deleteButton = el("button", "label-btn skills-settings__delete", "Xóa") as HTMLButtonElement;
  deleteButton.type = "button";
  const toggleButton = el("button", "label-btn", "Bật/Tắt") as HTMLButtonElement;
  toggleButton.type = "button";

  function setDirty(next: boolean): void {
    dirty = next;
  }

  function readForm(): SkillWriteInput {
    return {
      name: nameInput.value.trim(),
      description: descriptionInput.value.trim(),
      version: versionInput.value.trim(),
      body: bodyInput.value,
    };
  }

  function confirmDiscard(): boolean {
    if (!dirty) return true;
    return window.confirm("Bạn có thay đổi chưa lưu. Bỏ thay đổi và chuyển Skill khác?");
  }

  function filteredSkills(): readonly SkillView[] {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return skills;
    return skills.filter((skill) => skill.name.toLowerCase().includes(q));
  }

  // Shared enable/disable + delete actions, reused by BOTH the per-row controls (issue #18: the
  // on/off toggle and delete now live on the list row, not only inside the editor) and the editor
  // buttons. Both call the same existing typed client methods — no new backend.
  async function applyToggle(skill: SkillView): Promise<void> {
    if (skill.validationStatus !== "valid") return;
    errorBox.hidden = true;
    try {
      await client.setSkillEnabled(skill.id, skill.status !== "enabled");
      await refresh();
    } catch (error) {
      errorBox.hidden = false;
      errorBox.textContent = error instanceof Error ? error.message : "Không cập nhật trạng thái.";
    }
  }

  async function applyDelete(skill: SkillView): Promise<void> {
    if (skill.source === "built_in") return;
    if (!window.confirm(`Xóa Skill “${skill.name}” khỏi thư mục người dùng?`)) return;
    errorBox.hidden = true;
    try {
      await client.deleteSkill(skill.id);
      if (selectedId === skill.id) {
        selectedId = null;
        setDirty(false);
      }
      await refresh();
      status.textContent = "Đã xóa Skill.";
    } catch (error) {
      errorBox.hidden = false;
      errorBox.textContent = error instanceof Error ? error.message : "Không xóa được Skill.";
    }
  }

  function renderList(): void {
    list.replaceChildren();
    const visible = filteredSkills();
    if (skills.length === 0 && query.trim().length === 0) {
      list.append(
        el(
          "p",
          "skills-settings__empty",
          "Chưa có Skill. Nhấn Tạo Skill để bắt đầu.",
        ),
      );
    }
    if (visible.length === 0) {
      if (query.trim().length > 0) {
        list.append(el("p", "skills-settings__empty", "Không có Skill khớp tìm kiếm."));
      }
      return;
    }
    for (const skill of visible) {
      const item = el("div", "skills-settings__item");
      item.dataset["skillId"] = skill.id;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", skill.id === selectedId ? "true" : "false");
      if (skill.id === selectedId) item.classList.add("skills-settings__item--active");

      // Clickable main area (name + meta) selects the skill for the editor.
      const main = el("button", "skills-settings__item-main") as HTMLButtonElement;
      main.type = "button";
      main.setAttribute("aria-label", `Mở Skill ${skill.name}`);
      main.append(
        el("span", "skills-settings__item-name", skill.name),
        el(
          "span",
          "skills-settings__item-meta",
          `${sourceLabel(skill.source)} · v${skill.version} · ${skill.status === "enabled" ? "Đang bật" : skill.status === "disabled" ? "Đang tắt" : "Không hợp lệ"}`,
        ),
      );
      main.addEventListener("click", () => {
        if (!confirmDiscard()) return;
        creating = false;
        void selectSkill(skill.id);
      });

      // Row controls: the on/off toggle (issue #18) always visible for a valid skill, and a delete
      // button for user-local skills (built-in skills are read-only, so no delete).
      const controls = el("div", "skills-settings__item-controls");
      const isValid = skill.validationStatus === "valid";
      const enabled = skill.status === "enabled";
      const toggle = el("button", "skills-settings__row-toggle") as HTMLButtonElement;
      toggle.type = "button";
      toggle.dataset["on"] = enabled ? "true" : "false";
      toggle.disabled = !isValid;
      toggle.setAttribute("role", "switch");
      toggle.setAttribute("aria-checked", enabled ? "true" : "false");
      toggle.setAttribute(
        "aria-label",
        isValid
          ? `${enabled ? "Tắt" : "Bật"} Skill ${skill.name}`
          : `Skill ${skill.name} không hợp lệ — không thể bật`,
      );
      toggle.title = isValid
        ? enabled
          ? "Đang bật — nhấn để tắt"
          : "Đang tắt — nhấn để bật"
        : "Skill không hợp lệ — không thể bật";
      toggle.append(el("span", "skills-settings__row-toggle-knob"));
      toggle.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!isValid) return;
        toggle.disabled = true;
        void applyToggle(skill);
      });
      controls.append(toggle);

      if (skill.source !== "built_in") {
        const del = el("button", "skills-settings__row-delete") as HTMLButtonElement;
        del.type = "button";
        del.setAttribute("aria-label", `Xóa Skill ${skill.name}`);
        del.title = "Xóa Skill";
        del.append(icon("trash"));
        del.addEventListener("click", (event) => {
          event.stopPropagation();
          void applyDelete(skill);
        });
        controls.append(del);
      }

      item.append(main, controls);
      list.append(item);
    }
  }

  function renderEditorEmpty(): void {
    editor.replaceChildren(
      el("p", "skills-settings__placeholder", "Chọn một Skill để xem chi tiết, hoặc tạo Skill mới."),
    );
  }

  for (const input of [idInput, nameInput, descriptionInput, versionInput, bodyInput]) {
    input.addEventListener("input", () => {
      if (creating) idInput.value = suggestSkillId(nameInput.value);
      setDirty(true);
    });
  }

  async function loadEditor(skill: SkillView | null, createMode: boolean): Promise<void> {
    errorBox.hidden = true;
    if (skill === null && !createMode) {
      renderEditorEmpty();
      return;
    }
    editor.replaceChildren();
    const readonly = skill !== null && skill.source === "built_in";
    idInput.value = createMode ? suggestSkillId(nameInput.value || "my-skill") : skill!.id;
    idInput.readOnly = !createMode;
    nameInput.value = skill?.name ?? "";
    descriptionInput.value = skill?.description ?? "";
    versionInput.value = skill?.version ?? "1.0.0";
    bodyInput.value = "";
    bodyInput.readOnly = readonly;
    nameInput.readOnly = readonly;
    descriptionInput.readOnly = readonly;
    versionInput.readOnly = readonly;
    if (skill !== null && skill.validationStatus === "valid") {
      try {
        bodyInput.value = await client.readSkillContent(skill.id);
      } catch (error) {
        errorBox.hidden = false;
        errorBox.textContent = error instanceof Error ? error.message : "Không đọc được Skill.";
      }
    }
    meta.textContent =
      skill === null
        ? "Skill mới sẽ lưu vào thư mục người dùng."
        : `${sourceLabel(skill.source)} · ${skill.status}${skill.invalidReason ? ` · ${skill.invalidReason}` : ""}`;
    saveButton.hidden = readonly;
    deleteButton.hidden = readonly || createMode;
    toggleButton.hidden = createMode || skill?.validationStatus !== "valid";
    toggleButton.textContent =
      skill?.status === "enabled" ? "Tắt Skill" : "Bật Skill";
    const actions = el("div", "skills-settings__actions");
    actions.append(saveButton, deleteButton, toggleButton);
    editor.append(
      field("ID", idInput),
      field("Tên", nameInput),
      field("Mô tả", descriptionInput),
      field("Phiên bản", versionInput),
      field("Nội dung Markdown", bodyInput),
      meta,
      errorBox,
      actions,
    );
    if (readonly) {
      editor.append(
        el("p", "skills-settings__note", "Skill tích hợp sẵn chỉ đọc. Bạn vẫn có thể bật hoặc tắt."),
      );
    }
    setDirty(false);
  }

  async function selectSkill(id: string): Promise<void> {
    selectedId = id;
    creating = false;
    const skill = skills.find((entry) => entry.id === id) ?? null;
    renderList();
    await loadEditor(skill, false);
  }

  async function refresh(): Promise<void> {
    status.textContent = "Đang tải Skills…";
    try {
      skills = await client.refreshSkills();
      onChanged?.(skills);
      renderList();
      if (creating) {
        await loadEditor(null, true);
      } else if (selectedId !== null && skills.some((skill) => skill.id === selectedId)) {
        await loadEditor(skills.find((skill) => skill.id === selectedId) ?? null, false);
      } else {
        selectedId = null;
        renderEditorEmpty();
      }
      status.textContent = `${skills.length} Skill được phát hiện.`;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Không tải được Skills.";
    }
  }

  saveButton.addEventListener("click", () => {
    void (async () => {
      errorBox.hidden = true;
      saveButton.disabled = true;
      try {
        const draft = readForm();
        if (creating) {
          const created = await client.createSkill({ ...draft, id: idInput.value.trim() });
          creating = false;
          selectedId = created.id;
        } else if (selectedId !== null) {
          await client.updateSkill(selectedId, draft);
        }
        setDirty(false);
        await refresh();
        status.textContent = "Đã lưu Skill.";
      } catch (error) {
        errorBox.hidden = false;
        errorBox.textContent = error instanceof Error ? error.message : "Không lưu được Skill.";
      } finally {
        saveButton.disabled = false;
      }
    })();
  });

  // Editor delete/toggle reuse the same shared actions as the per-row controls (issue #18).
  deleteButton.addEventListener("click", () => {
    const skill = selectedId === null ? undefined : skills.find((entry) => entry.id === selectedId);
    if (skill === undefined) return;
    deleteButton.disabled = true;
    void applyDelete(skill).finally(() => {
      deleteButton.disabled = false;
    });
  });

  toggleButton.addEventListener("click", () => {
    const skill = selectedId === null ? undefined : skills.find((entry) => entry.id === selectedId);
    if (skill === undefined || skill.validationStatus !== "valid") return;
    toggleButton.disabled = true;
    void applyToggle(skill).finally(() => {
      toggleButton.disabled = false;
    });
  });

  createButton.addEventListener("click", () => {
    if (!confirmDiscard()) return;
    creating = true;
    selectedId = null;
    renderList();
    void loadEditor(null, true);
  });

  search.addEventListener("input", () => {
    query = search.value;
    renderList();
  });

  void refresh();
  return { refresh };
}
