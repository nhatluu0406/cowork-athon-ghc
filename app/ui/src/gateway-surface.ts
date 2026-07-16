/**
 * Gateway UI surface — D4 integration slot.
 *
 * Vanilla TS component. No framework dependency. All visual styling lives in
 * commercial.css (`.gateway-surface*` rules) — the CSP forbids inline styles.
 * Mounts into the dedicated gateway view element created by the shell frame.
 */

import type { GatewayHealth } from "./integration-slots.js";

export interface GatewaySurfaceClient {
  getBaseUrl(): string;
  getClientToken(): string;
}

interface GatewayAccount {
  id: string;
  providerId: string;
  label: string;
  isActive: boolean;
  addedAt: string;
}

interface GatewayStatus {
  health: GatewayHealth;
  accounts: GatewayAccount[];
  activeByProvider: Record<string, string>;
}

const KNOWN_PROVIDERS = [
  { id: "anthropic", label: "Anthropic" },
  { id: "openai", label: "OpenAI" },
  { id: "fpt-claude", label: "FPT Claude" },
  { id: "openrouter", label: "OpenRouter" },
] as const;

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

function healthLabel(health: GatewayHealth): string {
  switch (health) {
    case "healthy":
      return "Hoạt động tốt";
    case "degraded":
      return "Suy giảm";
    case "down":
      return "Ngừng hoạt động";
    default:
      return "Không rõ";
  }
}

function providerLabel(providerId: string): string {
  return KNOWN_PROVIDERS.find((p) => p.id === providerId)?.label ?? providerId;
}

async function fetchGatewayStatus(client: GatewaySurfaceClient): Promise<GatewayStatus> {
  const res = await fetch(`${client.getBaseUrl()}/v1/gateway/status`, {
    headers: { authorization: `Bearer ${client.getClientToken()}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const envelope = (await res.json()) as { data?: GatewayStatus };
  if (envelope.data === undefined) throw new Error("Phản hồi không hợp lệ từ gateway service.");
  return envelope.data;
}

async function addAccount(
  client: GatewaySurfaceClient,
  providerId: string,
  label: string,
  apiKey: string,
): Promise<void> {
  const res = await fetch(`${client.getBaseUrl()}/v1/gateway/accounts`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${client.getClientToken()}`,
    },
    body: JSON.stringify({ providerId, label, apiKey }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  }
}

async function removeAccount(client: GatewaySurfaceClient, id: string): Promise<void> {
  const res = await fetch(`${client.getBaseUrl()}/v1/gateway/accounts/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${client.getClientToken()}` },
  });
  if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
}

async function activateAccount(client: GatewaySurfaceClient, id: string): Promise<void> {
  const res = await fetch(
    `${client.getBaseUrl()}/v1/gateway/accounts/${encodeURIComponent(id)}/activate`,
    {
      method: "PUT",
      headers: { authorization: `Bearer ${client.getClientToken()}` },
    },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export function mountGatewayIntegrationSlot(
  rootEl: HTMLElement,
  client: GatewaySurfaceClient,
): { destroy(): void } {
  let destroyed = false;
  let status: GatewayStatus | null = null;
  let loading = false;
  let errorMsg: string | null = null;

  // ── Root structure ──
  const root = el("section", "gateway-surface");
  root.setAttribute("aria-label", "Gateway");

  // Header
  const header = el("div", "gateway-surface__header");
  const title = el("h1", "gateway-surface__title", "Gateway");
  const healthBadge = el("span", "gateway-surface__health-badge");
  const healthDot = el("span", "gateway-surface__health-dot");
  const healthText = el("span", "gateway-surface__health-text");
  healthBadge.append(healthDot, healthText);
  const refreshBtn = el("button", "gateway-surface__refresh icon-btn") as HTMLButtonElement;
  refreshBtn.type = "button";
  refreshBtn.textContent = "↻";
  refreshBtn.setAttribute("aria-label", "Tải lại");
  header.append(title, healthBadge, refreshBtn);

  // Status message area
  const statusMsg = el("p", "gateway-surface__status");

  // Accounts area
  const accountsArea = el("div", "gateway-surface__accounts");

  // Add form
  const addForm = el("div", "gateway-surface__add-form");
  const addTitle = el("h2", "gateway-surface__add-title", "Thêm tài khoản API");

  const addFields = el("div", "gateway-surface__add-fields");

  const providerSelect = document.createElement("select");
  providerSelect.className = "gateway-surface__provider-select";
  providerSelect.setAttribute("aria-label", "Nhà cung cấp");
  for (const provider of KNOWN_PROVIDERS) {
    const opt = document.createElement("option");
    opt.value = provider.id;
    opt.textContent = provider.label;
    providerSelect.append(opt);
  }

  const labelInput = document.createElement("input");
  labelInput.type = "text";
  labelInput.className = "gateway-surface__input";
  labelInput.placeholder = "Nhãn (vd: Tài khoản chính)";
  labelInput.setAttribute("aria-label", "Nhãn tài khoản");

  const keyInput = document.createElement("input");
  keyInput.type = "password";
  keyInput.className = "gateway-surface__input gateway-surface__input--key";
  keyInput.placeholder = "API Key";
  keyInput.setAttribute("aria-label", "API Key");
  keyInput.autocomplete = "off";

  const addRow = el("div", "gateway-surface__add-row");
  const addBtn = el("button", "gateway-surface__add-btn") as HTMLButtonElement;
  addBtn.type = "button";
  addBtn.textContent = "Thêm";
  const formError = el("span", "gateway-surface__form-error");
  addRow.append(addBtn, formError);

  addFields.append(providerSelect, labelInput, keyInput, addRow);
  addForm.append(addTitle, addFields);

  root.append(header, statusMsg, accountsArea, addForm);
  rootEl.replaceChildren(root);

  // ── Render functions ──

  function renderHealthBadge(health: GatewayHealth): void {
    healthBadge.dataset["health"] = health;
    healthText.textContent = healthLabel(health);
  }

  function renderAccounts(accounts: GatewayAccount[]): void {
    accountsArea.replaceChildren();
    if (accounts.length === 0) {
      const empty = el(
        "p",
        "gateway-surface__empty",
        "Chưa có account nào. Thêm API key để bắt đầu.",
      );
      accountsArea.append(empty);
      return;
    }

    // Group by providerId
    const grouped = new Map<string, GatewayAccount[]>();
    for (const account of accounts) {
      const list = grouped.get(account.providerId) ?? [];
      list.push(account);
      grouped.set(account.providerId, list);
    }

    for (const [pid, accs] of grouped) {
      const section = el("div", "gateway-surface__provider-section");

      const sectionHeader = el(
        "div",
        "gateway-surface__provider-header",
        providerLabel(pid),
      );
      section.append(sectionHeader);

      for (const account of accs) {
        const row = el("div", "gateway-surface__account-row");

        const labelSpan = el("span", "gateway-surface__account-label", account.label);
        const providerBadge = el("span", "gateway-surface__provider-badge", pid);
        const activeBadge = el(
          "span",
          "gateway-surface__active-badge",
          account.isActive ? "Đang dùng" : "",
        );
        activeBadge.hidden = !account.isActive;

        const actions = el("div", "gateway-surface__account-actions");

        if (!account.isActive) {
          const activateBtn = el("button", "gateway-surface__activate-btn") as HTMLButtonElement;
          activateBtn.type = "button";
          activateBtn.textContent = "Kích hoạt";
          activateBtn.addEventListener("click", () => {
            activateBtn.disabled = true;
            activateBtn.textContent = "…";
            void activateAccount(client, account.id)
              .then(() => load())
              .catch((err: unknown) => {
                activateBtn.disabled = false;
                activateBtn.textContent = "Kích hoạt";
                statusMsg.textContent = `Lỗi: ${err instanceof Error ? err.message : "Không kích hoạt được."}`;
              });
          });
          actions.append(activateBtn);
        }

        const removeBtn = el("button", "gateway-surface__remove-btn") as HTMLButtonElement;
        removeBtn.type = "button";
        removeBtn.textContent = "Xóa";
        removeBtn.setAttribute("aria-label", `Xóa ${account.label}`);

        let confirmTimer: ReturnType<typeof setTimeout> | null = null;
        removeBtn.addEventListener("click", () => {
          if (removeBtn.dataset["confirm"] === "true") {
            if (confirmTimer !== null) clearTimeout(confirmTimer);
            removeBtn.disabled = true;
            void removeAccount(client, account.id)
              .then(() => load())
              .catch((err: unknown) => {
                removeBtn.disabled = false;
                statusMsg.textContent = `Lỗi: ${err instanceof Error ? err.message : "Không xóa được."}`;
              });
            return;
          }
          removeBtn.dataset["confirm"] = "true";
          removeBtn.textContent = "Xác nhận xóa";
          confirmTimer = setTimeout(() => {
            removeBtn.dataset["confirm"] = "false";
            removeBtn.textContent = "Xóa";
          }, 3000);
        });

        actions.append(removeBtn);
        row.append(labelSpan, providerBadge, activeBadge, actions);
        section.append(row);
      }

      accountsArea.append(section);
    }
  }

  function render(): void {
    if (loading) {
      statusMsg.textContent = "Đang tải…";
      renderHealthBadge("unknown");
      accountsArea.replaceChildren();
      return;
    }
    if (errorMsg !== null) {
      statusMsg.textContent = `Lỗi kết nối: ${errorMsg}`;
      renderHealthBadge("unknown");
      return;
    }
    if (status === null) return;
    statusMsg.textContent = "";
    renderHealthBadge(status.health);
    renderAccounts(status.accounts);
  }

  async function load(): Promise<void> {
    if (destroyed) return;
    loading = true;
    errorMsg = null;
    render();
    try {
      status = await fetchGatewayStatus(client);
      errorMsg = null;
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : "Không kết nối được tới gateway service.";
    } finally {
      loading = false;
    }
    if (!destroyed) render();
  }

  // ── Add form logic ──
  addBtn.addEventListener("click", () => {
    const pid = providerSelect.value;
    const lbl = labelInput.value.trim();
    const key = keyInput.value;
    formError.textContent = "";

    if (lbl.length === 0) {
      formError.textContent = "Vui lòng nhập nhãn tài khoản.";
      labelInput.focus();
      return;
    }
    if (key.length === 0) {
      formError.textContent = "Vui lòng nhập API key.";
      keyInput.focus();
      return;
    }

    addBtn.disabled = true;
    addBtn.textContent = "Đang thêm…";

    void addAccount(client, pid, lbl, key)
      .then(() => {
        labelInput.value = "";
        keyInput.value = "";
        formError.textContent = "";
        return load();
      })
      .catch((err: unknown) => {
        formError.textContent = err instanceof Error ? err.message : "Thêm thất bại.";
      })
      .finally(() => {
        addBtn.disabled = false;
        addBtn.textContent = "Thêm";
      });
  });

  refreshBtn.addEventListener("click", () => void load());

  // Initial load
  void load();

  return {
    destroy(): void {
      destroyed = true;
      rootEl.replaceChildren();
    },
  };
}
