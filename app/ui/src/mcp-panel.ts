/**
 * MCP management panel (#28) — compact catalog rows matching the Skill list.
 *
 * Each server is a compact row: name + transport/status meta, a health badge, a tool-count chip,
 * an ON/OFF toggle OUTSIDE the row, and an overflow menu (Sửa / Kiểm tra / Xóa). A detail editor
 * opens below/beside for add + edit. Built-in stdio servers are offered as a combobox of presets;
 * a custom stdio command or a remote URL stays fully editable. Secrets go to the encrypted vault
 * (never local storage); the panel only ever sees `hasHeaderSecret`.
 *
 * Backend note: CRUD + enable/disable + health are live (issue #30 tracks agent-side tool
 * invocation separately). `toolCount`/`health` reflect the backend's honest values — never faked.
 */

import { el, icon } from "./ui-shell/dom-utils.js";

export type McpTransport = "stdio" | "url";

export interface McpServerView {
  readonly id: string;
  readonly name: string;
  readonly transport: McpTransport;
  readonly command?: string;
  readonly url?: string;
  readonly hasHeaderSecret: boolean;
  readonly enabled: boolean;
  readonly health: "unknown" | "ok" | "error";
  readonly toolCount: number;
  /** ISO timestamp of the last status refresh (updatedAt), shown as "kiểm tra lần cuối". */
  readonly lastChecked?: string;
}

export interface McpServerWriteInput {
  readonly name: string;
  readonly transport: McpTransport;
  readonly command?: string;
  readonly url?: string;
  readonly headerSecret?: string;
}

export interface McpServerCreateInput extends McpServerWriteInput {
  readonly id?: string;
}

export interface McpPanelCallbacks {
  readonly listMcpServers?: () => Promise<readonly McpServerView[]>;
  readonly createMcpServer?: (input: McpServerCreateInput) => Promise<McpServerView>;
  readonly updateMcpServer?: (id: string, input: McpServerWriteInput) => Promise<McpServerView>;
  readonly deleteMcpServer?: (id: string) => Promise<void>;
  readonly setMcpServerEnabled?: (id: string, enabled: boolean) => Promise<McpServerView>;
  /** Re-probe reachability/health for one server (GET /v1/mcp/servers/{id}/health). */
  readonly checkMcpServerHealth?: (id: string) => Promise<McpServerView>;
}

export interface McpPanelHandle {
  refresh(): Promise<void>;
}

/** Built-in stdio server presets offered as a combobox (issue #28). Command is non-secret. */
interface McpPreset {
  readonly id: string;
  readonly label: string;
  readonly command: string;
}

const STDIO_PRESETS: readonly McpPreset[] = [
  { id: "filesystem", label: "Filesystem — đọc/ghi tệp cục bộ", command: "npx -y @modelcontextprotocol/server-filesystem" },
  { id: "git", label: "Git — thao tác kho Git", command: "npx -y @modelcontextprotocol/server-git" },
  { id: "fetch", label: "Fetch — tải nội dung web", command: "npx -y @modelcontextprotocol/server-fetch" },
  { id: "memory", label: "Memory — bộ nhớ tri thức", command: "npx -y @modelcontextprotocol/server-memory" },
  {
    id: "sequential-thinking",
    label: "Sequential Thinking — suy luận theo bước",
    command: "npx -y @modelcontextprotocol/server-sequential-thinking",
  },
  { id: "everything", label: "Everything — máy chủ demo MCP", command: "npx -y @modelcontextprotocol/server-everything" },
];

function field(label: string, input: HTMLElement): HTMLElement {
  const wrap = el("label", "mcp-panel__field");
  wrap.append(el("span", "mcp-panel__label", label), input);
  return wrap;
}

function healthLabel(view: McpServerView): { text: string; tone: string } {
  if (!view.enabled) return { text: "Đang tắt", tone: "off" };
  switch (view.health) {
    case "ok":
      return { text: "Sẵn sàng", tone: "ok" };
    case "error":
      return { text: "Không kết nối", tone: "error" };
    default:
      return { text: "Chưa kiểm tra", tone: "unknown" };
  }
}

function formatLastChecked(iso: string | undefined): string {
  if (iso === undefined) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `kiểm tra: ${d.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}`;
}

export function mountMcpSettingsPanel(
  root: HTMLElement,
  callbacks: McpPanelCallbacks = {},
  onChanged?: (servers: readonly McpServerView[]) => void,
): McpPanelHandle {
  const backendAvailable = callbacks.listMcpServers !== undefined;

  const toolbar = el("div", "mcp-panel__toolbar");
  const createButton = el("button", "label-btn mcp-panel__add", "Thêm MCP") as HTMLButtonElement;
  createButton.type = "button";
  toolbar.append(createButton);

  const layout = el("div", "mcp-panel__layout");
  const list = el("div", "mcp-panel__list");
  list.setAttribute("role", "list");
  const editor = el("section", "mcp-panel__editor");
  editor.setAttribute("aria-label", "Chi tiết MCP");
  editor.hidden = true;
  const status = el("p", "mcp-panel__status");
  status.setAttribute("role", "status");
  layout.append(list, editor);

  root.replaceChildren(toolbar, layout, status);

  let servers: readonly McpServerView[] = [];
  let editingId: string | null = null;
  let creating = false;
  let busyId: string | null = null;

  // --- Editor fields ---
  const idInput = el("input", "mcp-panel__input") as HTMLInputElement;
  idInput.setAttribute("aria-label", "MCP id");
  const nameInput = el("input", "mcp-panel__input") as HTMLInputElement;
  nameInput.setAttribute("aria-label", "Tên MCP");
  const transportSelect = el("select", "mcp-panel__input") as HTMLSelectElement;
  transportSelect.setAttribute("aria-label", "Loại kết nối");
  for (const [value, text] of [["stdio", "Lệnh cục bộ (stdio)"], ["url", "Máy chủ remote (URL)"]] as const) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = text;
    transportSelect.append(opt);
  }
  const presetSelect = el("select", "mcp-panel__input") as HTMLSelectElement;
  presetSelect.setAttribute("aria-label", "Máy chủ MCP dựng sẵn");
  {
    const custom = document.createElement("option");
    custom.value = "";
    custom.textContent = "Tùy chỉnh (nhập lệnh)";
    presetSelect.append(custom);
    for (const preset of STDIO_PRESETS) {
      const opt = document.createElement("option");
      opt.value = preset.id;
      opt.textContent = preset.label;
      presetSelect.append(opt);
    }
  }
  const commandInput = el("input", "mcp-panel__input") as HTMLInputElement;
  commandInput.setAttribute("aria-label", "Lệnh khởi động MCP");
  commandInput.placeholder = "vd: npx -y @modelcontextprotocol/server-filesystem /duong/dan";
  const urlInput = el("input", "mcp-panel__input") as HTMLInputElement;
  urlInput.type = "url";
  urlInput.setAttribute("aria-label", "URL máy chủ MCP");
  urlInput.placeholder = "https://...";
  const headerSecretInput = el("input", "mcp-panel__input") as HTMLInputElement;
  headerSecretInput.type = "password";
  headerSecretInput.setAttribute("aria-label", "Header/API key secret (tuỳ chọn)");
  const errorBox = el("p", "mcp-panel__error");
  errorBox.hidden = true;
  errorBox.setAttribute("role", "alert");
  const saveButton = el("button", "label-btn mcp-panel__primary", "Lưu") as HTMLButtonElement;
  saveButton.type = "button";
  const cancelButton = el("button", "label-btn", "Hủy") as HTMLButtonElement;
  cancelButton.type = "button";

  const presetField = field("Máy chủ dựng sẵn", presetSelect);
  const commandField = field("Lệnh (stdio)", commandInput);
  const urlField = field("URL (remote)", urlInput);

  function transportFieldsFor(transport: McpTransport): void {
    presetField.hidden = transport !== "stdio";
    commandField.hidden = transport !== "stdio";
    urlField.hidden = transport !== "url";
  }

  transportSelect.addEventListener("change", () => {
    transportFieldsFor(transportSelect.value === "url" ? "url" : "stdio");
  });
  presetSelect.addEventListener("change", () => {
    const preset = STDIO_PRESETS.find((p) => p.id === presetSelect.value);
    if (preset !== undefined) {
      commandInput.value = preset.command;
      if (nameInput.value.trim().length === 0) nameInput.value = preset.label.split(" — ")[0] ?? preset.id;
    }
  });

  function closeEditor(): void {
    creating = false;
    editingId = null;
    editor.hidden = true;
    editor.replaceChildren();
    renderList();
  }

  function openEditor(server: McpServerView | null): void {
    creating = server === null;
    editingId = server?.id ?? null;
    errorBox.hidden = true;
    idInput.value = server?.id ?? "";
    idInput.readOnly = server !== null;
    nameInput.value = server?.name ?? "";
    transportSelect.value = server?.transport ?? "stdio";
    presetSelect.value = "";
    commandInput.value = server?.command ?? "";
    urlInput.value = server?.url ?? "";
    headerSecretInput.value = "";
    headerSecretInput.placeholder = server?.hasHeaderSecret === true ? "Đã lưu — nhập để đổi" : "Để trống nếu không cần";
    saveButton.disabled = !backendAvailable;

    const actions = el("div", "mcp-panel__actions");
    actions.append(saveButton, cancelButton);
    editor.replaceChildren(
      el("h3", "mcp-panel__editor-title", server === null ? "Thêm kết nối MCP" : `Sửa: ${server.name}`),
      field("ID", idInput),
      field("Tên", nameInput),
      field("Loại kết nối", transportSelect),
      presetField,
      commandField,
      urlField,
      field("Header/API key secret", headerSecretInput),
      errorBox,
      actions,
    );
    transportFieldsFor(transportSelect.value === "url" ? "url" : "stdio");
    editor.hidden = false;
    renderList();
    nameInput.focus();
  }

  function makeRow(srv: McpServerView): HTMLElement {
    const row = el("div", "mcp-row");
    row.dataset["mcpId"] = srv.id;
    row.setAttribute("role", "listitem");
    if (srv.id === editingId) row.classList.add("mcp-row--active");

    const main = el("button", "mcp-row__main") as HTMLButtonElement;
    main.type = "button";
    main.dataset["mcpId"] = srv.id;
    main.append(icon(srv.transport === "url" ? "gateway" : "code"));
    const text = el("div", "mcp-row__text");
    text.append(el("span", "mcp-row__name", srv.name));
    const health = healthLabel(srv);
    const metaParts = [
      srv.transport === "url" ? "URL" : "stdio",
      `${srv.toolCount} tool`,
      formatLastChecked(srv.lastChecked),
    ].filter((s) => s.length > 0);
    text.append(el("span", "mcp-row__meta", metaParts.join(" · ")));
    main.append(text);
    main.addEventListener("click", () => openEditor(srv));

    const badge = el("span", "mcp-row__badge", health.text);
    badge.dataset["tone"] = health.tone;

    const controls = el("div", "mcp-row__controls");
    const toggle = el("button", "mcp-row__toggle") as HTMLButtonElement;
    toggle.type = "button";
    toggle.setAttribute("role", "switch");
    toggle.dataset["on"] = srv.enabled ? "true" : "false";
    toggle.setAttribute("aria-checked", srv.enabled ? "true" : "false");
    toggle.setAttribute("aria-label", srv.enabled ? `Tắt ${srv.name}` : `Bật ${srv.name}`);
    toggle.disabled = !backendAvailable || busyId === srv.id;
    toggle.append(el("span", "mcp-row__toggle-knob"));
    toggle.addEventListener("click", () => void applyToggle(srv));

    const menuBtn = el("button", "mcp-row__menu-btn") as HTMLButtonElement;
    menuBtn.type = "button";
    menuBtn.setAttribute("aria-label", `Tùy chọn cho ${srv.name}`);
    menuBtn.append(icon("more"));
    menuBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      openRowMenu(srv, menuBtn);
    });

    controls.append(badge, toggle, menuBtn);
    row.append(main, controls);
    return row;
  }

  let openMenu: HTMLElement | null = null;
  function closeRowMenu(): void {
    openMenu?.remove();
    openMenu = null;
  }
  function openRowMenu(srv: McpServerView, anchor: HTMLElement): void {
    closeRowMenu();
    const menu = el("div", "mcp-row__menu");
    menu.setAttribute("role", "menu");
    const mk = (label: string, fn: () => void): HTMLButtonElement => {
      const b = el("button", "mcp-row__menu-item", label) as HTMLButtonElement;
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.disabled = !backendAvailable;
      b.addEventListener("click", () => {
        closeRowMenu();
        fn();
      });
      return b;
    };
    menu.append(mk("Sửa", () => openEditor(srv)));
    if (callbacks.checkMcpServerHealth !== undefined) {
      menu.append(mk("Kiểm tra", () => void checkHealth(srv)));
    }
    const del = mk("Xóa", () => void applyDelete(srv));
    del.classList.add("mcp-row__menu-item--danger");
    menu.append(del);
    const rect = anchor.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${Math.max(12, rect.right - 160)}px`;
    document.body.append(menu);
    openMenu = menu;
    setTimeout(() => {
      const onDoc = (e: MouseEvent): void => {
        if (!menu.contains(e.target as Node)) {
          closeRowMenu();
          document.removeEventListener("pointerdown", onDoc, true);
        }
      };
      document.addEventListener("pointerdown", onDoc, true);
    }, 0);
  }

  async function applyToggle(srv: McpServerView): Promise<void> {
    if (!backendAvailable || callbacks.setMcpServerEnabled === undefined) return;
    busyId = srv.id;
    renderList();
    try {
      await callbacks.setMcpServerEnabled(srv.id, !srv.enabled);
      await refresh();
      status.textContent = srv.enabled ? "Đã tắt MCP." : "Đã bật MCP.";
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Không cập nhật được trạng thái.";
    } finally {
      busyId = null;
      renderList();
    }
  }

  async function applyDelete(srv: McpServerView): Promise<void> {
    if (!backendAvailable || callbacks.deleteMcpServer === undefined) return;
    if (!window.confirm(`Xóa kết nối MCP “${srv.name}”?`)) return;
    try {
      await callbacks.deleteMcpServer(srv.id);
      if (editingId === srv.id) closeEditor();
      await refresh();
      status.textContent = "Đã xóa MCP.";
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Không xóa được MCP.";
    }
  }

  async function checkHealth(srv: McpServerView): Promise<void> {
    if (callbacks.checkMcpServerHealth === undefined) return;
    busyId = srv.id;
    status.textContent = `Đang kiểm tra ${srv.name}…`;
    renderList();
    try {
      await callbacks.checkMcpServerHealth(srv.id);
      await refresh();
      status.textContent = "Đã kiểm tra kết nối.";
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Không kiểm tra được kết nối.";
    } finally {
      busyId = null;
      renderList();
    }
  }

  function renderList(): void {
    list.replaceChildren();
    if (servers.length === 0) {
      list.append(
        el(
          "p",
          "mcp-panel__empty",
          backendAvailable
            ? "Chưa có kết nối MCP. Nhấn Thêm MCP để bắt đầu."
            : "Chưa có kết nối MCP — MCP sẽ khả dụng sau khi backend triển khai.",
        ),
      );
      return;
    }
    for (const srv of servers) list.append(makeRow(srv));
  }

  async function refresh(): Promise<void> {
    if (!backendAvailable) {
      servers = [];
      onChanged?.(servers);
      renderList();
      status.textContent = "MCP: chờ tích hợp backend.";
      return;
    }
    try {
      servers = await callbacks.listMcpServers!();
      onChanged?.(servers);
      renderList();
      status.textContent = `${servers.length} MCP được cấu hình.`;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Không tải được MCP.";
    }
  }

  saveButton.addEventListener("click", () => {
    void (async () => {
      if (!backendAvailable) return;
      errorBox.hidden = true;
      saveButton.disabled = true;
      try {
        const transport: McpTransport = transportSelect.value === "url" ? "url" : "stdio";
        const input: McpServerWriteInput = {
          name: nameInput.value.trim(),
          transport,
          ...(transport === "stdio" ? { command: commandInput.value.trim() } : {}),
          ...(transport === "url" ? { url: urlInput.value.trim() } : {}),
          ...(headerSecretInput.value.length > 0 ? { headerSecret: headerSecretInput.value } : {}),
        };
        if (creating) {
          await callbacks.createMcpServer!({
            ...input,
            ...(idInput.value.trim().length > 0 ? { id: idInput.value.trim() } : {}),
          });
        } else if (editingId !== null) {
          await callbacks.updateMcpServer!(editingId, input);
        }
        closeEditor();
        await refresh();
        status.textContent = "Đã lưu MCP.";
      } catch (error) {
        errorBox.hidden = false;
        errorBox.textContent = error instanceof Error ? error.message : "Không lưu được MCP.";
      } finally {
        saveButton.disabled = !backendAvailable;
      }
    })();
  });

  cancelButton.addEventListener("click", () => closeEditor());
  createButton.addEventListener("click", () => openEditor(null));

  void refresh();
  return { refresh };
}
