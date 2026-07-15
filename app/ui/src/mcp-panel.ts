/**
 * MCP management panel — Phase 1 stub (Wave 2B).
 *
 * ServiceClient does not yet expose MCP methods. Callbacks are injectable so the backend
 * team can wire real `list/create/update/delete/setEnabled` MCP methods once available
 * without another UI change. Until then this renders an honest empty state instead of
 * fake data (no health/tool-count fabrication).
 */

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

/**
 * Wave 2 Phase 1 TODO: wire to real ServiceClient MCP methods once the backend adds them
 * (assumed shape: `listMcpServers`, `createMcpServer`, `updateMcpServer`, `deleteMcpServer`,
 * `setMcpServerEnabled`). Left undefined here — panel renders a truthful "not available yet"
 * state instead of fabricating servers/health.
 */
export interface McpPanelCallbacks {
  readonly listMcpServers?: () => Promise<readonly McpServerView[]>;
  readonly createMcpServer?: (input: McpServerCreateInput) => Promise<McpServerView>;
  readonly updateMcpServer?: (id: string, input: McpServerWriteInput) => Promise<McpServerView>;
  readonly deleteMcpServer?: (id: string) => Promise<void>;
  readonly setMcpServerEnabled?: (id: string, enabled: boolean) => Promise<McpServerView>;
}

export interface McpPanelHandle {
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

function field(label: string, input: HTMLElement): HTMLElement {
  const wrap = el("label", "mcp-panel__field");
  wrap.append(el("span", "mcp-panel__label", label), input);
  return wrap;
}

export function mountMcpSettingsPanel(
  root: HTMLElement,
  callbacks: McpPanelCallbacks = {},
  onChanged?: (servers: readonly McpServerView[]) => void,
): McpPanelHandle {
  const backendAvailable = callbacks.listMcpServers !== undefined;

  const toolbar = el("div", "mcp-panel__toolbar");
  const createButton = el("button", "label-btn", "Thêm MCP") as HTMLButtonElement;
  createButton.type = "button";
  toolbar.append(createButton);

  const layout = el("div", "mcp-panel__layout");
  const list = el("div", "mcp-panel__list");
  list.setAttribute("role", "listbox");
  const editor = el("section", "mcp-panel__editor");
  editor.setAttribute("aria-label", "Chi tiết MCP");
  const status = el("p", "mcp-panel__status");
  status.setAttribute("role", "status");
  layout.append(list, editor);

  root.replaceChildren(
    el("h2", "mcp-panel__title", "MCP"),
    el(
      "p",
      "mcp-panel__intro",
      "Kết nối MCP cục bộ (stdio) hoặc máy chủ remote (URL). Secret được lưu trong vault mã hoá — không lưu trong local storage.",
    ),
    toolbar,
    layout,
    status,
  );

  let servers: readonly McpServerView[] = [];
  let selectedId: string | null = null;
  let creating = false;

  const idInput = el("input", "mcp-panel__input") as HTMLInputElement;
  idInput.setAttribute("aria-label", "MCP id");
  const nameInput = el("input", "mcp-panel__input") as HTMLInputElement;
  nameInput.setAttribute("aria-label", "Tên MCP");
  const transportSelect = el("select", "mcp-panel__input") as HTMLSelectElement;
  transportSelect.setAttribute("aria-label", "Loại kết nối");
  const stdioOption = document.createElement("option");
  stdioOption.value = "stdio";
  stdioOption.textContent = "Lệnh cục bộ (stdio)";
  const urlOption = document.createElement("option");
  urlOption.value = "url";
  urlOption.textContent = "Máy chủ remote (URL)";
  transportSelect.append(stdioOption, urlOption);
  const commandInput = el("input", "mcp-panel__input") as HTMLInputElement;
  commandInput.setAttribute("aria-label", "Lệnh khởi động MCP");
  commandInput.placeholder = "vd: npx my-mcp-server";
  const urlInput = el("input", "mcp-panel__input") as HTMLInputElement;
  urlInput.type = "url";
  urlInput.setAttribute("aria-label", "URL máy chủ MCP");
  urlInput.placeholder = "https://...";
  const headerSecretInput = el("input", "mcp-panel__input") as HTMLInputElement;
  headerSecretInput.type = "password";
  headerSecretInput.setAttribute("aria-label", "Header/API key secret (tuỳ chọn)");
  headerSecretInput.placeholder = "Để trống nếu không cần";
  const errorBox = el("p", "mcp-panel__error");
  errorBox.hidden = true;
  errorBox.setAttribute("role", "alert");
  const meta = el("p", "mcp-panel__meta");
  const saveButton = el("button", "label-btn", "Lưu") as HTMLButtonElement;
  saveButton.type = "button";
  const deleteButton = el("button", "label-btn mcp-panel__delete", "Xóa") as HTMLButtonElement;
  deleteButton.type = "button";
  const toggleButton = el("button", "label-btn", "Bật/Tắt") as HTMLButtonElement;
  toggleButton.type = "button";

  function commandFieldsFor(transport: McpTransport): void {
    commandInput.closest("label")?.toggleAttribute("hidden", transport !== "stdio");
    urlInput.closest("label")?.toggleAttribute("hidden", transport !== "url");
  }

  transportSelect.addEventListener("change", () => {
    commandFieldsFor(transportSelect.value === "url" ? "url" : "stdio");
  });

  function renderEditorEmpty(): void {
    editor.replaceChildren(
      el("p", "mcp-panel__placeholder", "Chọn một kết nối MCP để xem chi tiết, hoặc thêm mới."),
    );
  }

  function loadEditor(server: McpServerView | null, createMode: boolean): void {
    errorBox.hidden = true;
    if (server === null && !createMode) {
      renderEditorEmpty();
      return;
    }
    editor.replaceChildren();
    idInput.value = createMode ? "" : server!.id;
    idInput.readOnly = !createMode;
    nameInput.value = server?.name ?? "";
    transportSelect.value = server?.transport ?? "stdio";
    commandInput.value = server?.command ?? "";
    urlInput.value = server?.url ?? "";
    headerSecretInput.value = "";
    headerSecretInput.placeholder = server?.hasHeaderSecret === true ? "Đã lưu — nhập để đổi" : "Để trống nếu không cần";
    meta.textContent =
      server === null
        ? "Kết nối MCP mới cho phiên chat."
        : `${server.health === "ok" ? "Khỏe mạnh" : server.health === "error" ? "Lỗi" : "Chưa kiểm tra"} · ${server.toolCount} tool`;
    saveButton.disabled = !backendAvailable;
    saveButton.dataset["tooltip"] = backendAvailable ? "" : "Chưa khả dụng — chờ backend MCP Phase 1.";
    deleteButton.hidden = createMode;
    deleteButton.disabled = !backendAvailable;
    toggleButton.hidden = createMode;
    toggleButton.disabled = !backendAvailable;
    toggleButton.textContent = server?.enabled === true ? "Tắt MCP" : "Bật MCP";
    const actions = el("div", "mcp-panel__actions");
    actions.append(saveButton, deleteButton, toggleButton);
    editor.append(
      field("ID", idInput),
      field("Tên", nameInput),
      field("Loại kết nối", transportSelect),
      field("Lệnh (stdio)", commandInput),
      field("URL (remote)", urlInput),
      field("Header/API key secret", headerSecretInput),
      meta,
      errorBox,
      actions,
    );
    commandFieldsFor(transportSelect.value === "url" ? "url" : "stdio");
    if (!backendAvailable) {
      editor.append(
        el(
          "p",
          "mcp-panel__note",
          "MCP Phase 1 chưa được backend triển khai. Biểu mẫu sẵn sàng cho team backend; hành động lưu/xóa/bật-tắt sẽ hoạt động khi ServiceClient thêm phương thức MCP.",
        ),
      );
    }
  }

  function selectServer(id: string): void {
    selectedId = id;
    creating = false;
    const server = servers.find((entry) => entry.id === id) ?? null;
    renderList();
    loadEditor(server, false);
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
            : "Chưa có kết nối MCP — MCP Phase 1 sẽ khả dụng sau khi backend triển khai.",
        ),
      );
      return;
    }
    for (const srv of servers) {
      const item = el("button", "mcp-panel__item") as HTMLButtonElement;
      item.type = "button";
      item.dataset["mcpId"] = srv.id;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", srv.id === selectedId ? "true" : "false");
      if (srv.id === selectedId) item.classList.add("mcp-panel__item--active");
      item.append(
        el("span", "mcp-panel__item-name", srv.name),
        el(
          "span",
          "mcp-panel__item-meta",
          `${srv.transport === "stdio" ? "stdio" : "URL"} · ${srv.enabled ? "Đang bật" : "Đang tắt"}`,
        ),
      );
      item.addEventListener("click", () => selectServer(srv.id));
      list.append(item);
    }
  }

  async function refresh(): Promise<void> {
    if (!backendAvailable) {
      servers = [];
      onChanged?.(servers);
      renderList();
      if (creating) {
        loadEditor(null, true);
      } else {
        renderEditorEmpty();
      }
      status.textContent = "MCP Phase 1: chờ tích hợp backend.";
      return;
    }
    status.textContent = "Đang tải MCP…";
    try {
      servers = await callbacks.listMcpServers!();
      onChanged?.(servers);
      renderList();
      if (creating) {
        loadEditor(null, true);
      } else if (selectedId !== null && servers.some((s) => s.id === selectedId)) {
        loadEditor(servers.find((s) => s.id === selectedId) ?? null, false);
      } else {
        selectedId = null;
        renderEditorEmpty();
      }
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
          const created = await callbacks.createMcpServer!({
            ...input,
            ...(idInput.value.trim().length > 0 ? { id: idInput.value.trim() } : {}),
          });
          creating = false;
          selectedId = created.id;
        } else if (selectedId !== null) {
          await callbacks.updateMcpServer!(selectedId, input);
        }
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

  deleteButton.addEventListener("click", () => {
    if (!backendAvailable || selectedId === null) return;
    if (!window.confirm("Xóa kết nối MCP này?")) return;
    void (async () => {
      deleteButton.disabled = true;
      try {
        await callbacks.deleteMcpServer!(selectedId!);
        selectedId = null;
        await refresh();
        status.textContent = "Đã xóa MCP.";
      } catch (error) {
        errorBox.hidden = false;
        errorBox.textContent = error instanceof Error ? error.message : "Không xóa được MCP.";
      } finally {
        deleteButton.disabled = !backendAvailable;
      }
    })();
  });

  toggleButton.addEventListener("click", () => {
    if (!backendAvailable || selectedId === null) return;
    const server = servers.find((entry) => entry.id === selectedId);
    if (server === undefined) return;
    toggleButton.disabled = true;
    void callbacks
      .setMcpServerEnabled!(selectedId, !server.enabled)
      .then(() => refresh())
      .catch((error) => {
        errorBox.hidden = false;
        errorBox.textContent = error instanceof Error ? error.message : "Không cập nhật được trạng thái.";
      })
      .finally(() => {
        toggleButton.disabled = !backendAvailable;
      });
  });

  createButton.addEventListener("click", () => {
    creating = true;
    selectedId = null;
    renderList();
    loadEditor(null, true);
  });

  void refresh();
  return { refresh };
}
