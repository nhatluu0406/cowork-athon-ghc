/**
 * Gateway UI surface — D4 integration slot.
 *
 * Vanilla TS component. No framework dependency. All visual styling lives in
 * commercial.css (`.gateway-surface*` rules) — the CSP forbids inline styles.
 * Mounts into the dedicated gateway view element created by the shell frame.
 */

import type { GatewayHealth } from "./integration-slots.js";

/** One row from Settings → Nhà cung cấp (Provider Profiles) — the app's actual source of truth. */
export interface GatewayProfile {
  readonly id: string;
  readonly displayName: string;
  readonly providerType: string;
  readonly credentialConfigured: boolean;
  readonly credentialAccount?: string;
}

export interface GatewaySurfaceClient {
  getBaseUrl(): string;
  getClientToken(): string;
  /** The exact Provider Profile list shown in Settings → Nhà cung cấp — same names, same rows. */
  listProfiles(): Promise<readonly GatewayProfile[]>;
  /**
   * Restart the live loopback service (stop the current OpenCode child, spawn a fresh one) so a
   * just-applied Settings change (the Gateway master-switch swap/restore) actually reaches
   * `opencode.json` — OpenCode only reads that file at spawn, never hot-reloads. Best-effort:
   * never throws (mirrors the shell's own `connectLive` contract) — a session that was never
   * live yet, or fails to reconnect, degrades honestly rather than surfacing an error here.
   */
  reconnectLive(): Promise<void>;
}

interface GatewayAccountView {
  id: string;
  providerId: string;
  label: string;
  isActive: boolean;
  addedAt: string;
  linked: boolean;
}

interface GatewayStatus {
  health: GatewayHealth;
  accounts: GatewayAccountView[];
  activeByProvider: Record<string, string>;
  enabled: boolean;
  serverAddress: string;
  proxyAvailable: boolean;
  configuredPort: number;
}

type GatewayRequestOutcome = "allowed" | "blocked";

interface GatewayRequestLogEntry {
  id: string;
  at: string;
  sessionId?: string;
  profileId?: string;
  profileLabel?: string;
  accountId?: string;
  gatewayEnabled: boolean;
  outcome: GatewayRequestOutcome;
  reason?: string;
  promptPreview?: string;
  modelId?: string;
  providerType?: string;
  /** REAL metrics from the proxy round-trip — present only for requests that flowed through it. */
  httpStatus?: number;
  ttfbMs?: number;
  totalMs?: number;
}

/** Auto-refresh the log/status view while the tab is open, so sends show up without a manual click. */
const AUTO_REFRESH_MS = 3_000;

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

function providerTypeLabel(providerType: string): string {
  switch (providerType) {
    case "deepseek":
      return "DeepSeek";
    case "custom-openai-compat":
      return "OpenAI-compatible";
    default:
      return providerType;
  }
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

async function linkAccount(
  client: GatewaySurfaceClient,
  providerId: string,
  label: string,
  credentialAccount: string,
): Promise<void> {
  const res = await fetch(`${client.getBaseUrl()}/v1/gateway/accounts/link`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${client.getClientToken()}`,
    },
    body: JSON.stringify({ providerId, label, credentialAccount }),
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

async function fetchGatewayLogs(client: GatewaySurfaceClient): Promise<GatewayRequestLogEntry[]> {
  const res = await fetch(`${client.getBaseUrl()}/v1/gateway/logs`, {
    headers: { authorization: `Bearer ${client.getClientToken()}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const envelope = (await res.json()) as { data?: { logs?: GatewayRequestLogEntry[] } };
  return envelope.data?.logs ?? [];
}

function formatLogTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("vi-VN");
  } catch {
    return iso;
  }
}

async function setGatewayEnabled(client: GatewaySurfaceClient, enabled: boolean): Promise<void> {
  const res = await fetch(`${client.getBaseUrl()}/v1/gateway/enabled`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${client.getClientToken()}`,
    },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  }
}

async function setGatewayServerPort(client: GatewaySurfaceClient, port: number): Promise<void> {
  const res = await fetch(`${client.getBaseUrl()}/v1/gateway/server-port`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${client.getClientToken()}`,
    },
    body: JSON.stringify({ port }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  }
}

export function mountGatewayIntegrationSlot(
  rootEl: HTMLElement,
  client: GatewaySurfaceClient,
): { destroy(): void } {
  let destroyed = false;
  let status: GatewayStatus | null = null;
  let profiles: readonly GatewayProfile[] = [];
  let logs: readonly GatewayRequestLogEntry[] = [];
  let loading = false;
  let errorMsg: string | null = null;
  // profileId currently mid-toggle — disables its checkbox until the request settles.
  let pendingProfileId: string | null = null;
  // Log entry id the user clicked to expand — shows its full detail inline.
  let expandedLogId: string | null = null;
  let logRefreshing = false;

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

  // Master switch: OFF (default) = pure bookkeeping, chat keeps using Settings directly.
  // ON = every new session is required to route through an active gateway account.
  const masterCard = el("div", "gateway-surface__master");
  const masterRow = el("label", "gateway-surface__master-row");
  const masterToggle = document.createElement("input");
  masterToggle.type = "checkbox";
  masterToggle.className = "gateway-surface__master-toggle";
  const masterTextWrap = el("div", "gateway-surface__master-text");
  const masterTitle = el(
    "span",
    "gateway-surface__master-title",
    "Bật Gateway cho toàn hệ thống",
  );
  const masterHint = el(
    "span",
    "gateway-surface__master-hint",
    "Mặc định TẮT: Cowork gọi thẳng nhà cung cấp, Gateway không can thiệp gì. Khi BẬT: traffic của các kết nối đã tick bên dưới sẽ ĐI QUA thật sự Gateway (proxy cục bộ) trước khi tới nhà cung cấp. Bật/tắt sẽ tự khởi động lại phiên làm việc để áp dụng ngay — không cần thoát ứng dụng.",
  );
  masterTextWrap.append(masterTitle, masterHint);
  masterRow.append(masterToggle, masterTextWrap);

  // Server address: host is a fixed loopback constant (never user-editable — the app never binds
  // this proxy anywhere but 127.0.0.1); only the port is a saved setting, applied on next restart.
  const serverConfigRow = el("div", "gateway-surface__server-config");
  const serverHostLabel = el("span", "gateway-surface__server-host", "http://127.0.0.1:");
  const serverPortInput = document.createElement("input");
  serverPortInput.type = "number";
  serverPortInput.min = "1024";
  serverPortInput.max = "65535";
  serverPortInput.className = "gateway-surface__server-port-input";
  serverPortInput.setAttribute("aria-label", "Cổng Gateway server");
  const serverPathLabel = el("span", "gateway-surface__server-host", "/v1");
  const serverSaveBtn = el("button", "gateway-surface__server-save") as HTMLButtonElement;
  serverSaveBtn.type = "button";
  serverSaveBtn.textContent = "Lưu";
  const serverSaveMsg = el("span", "gateway-surface__server-save-msg");
  serverConfigRow.append(serverHostLabel, serverPortInput, serverPathLabel, serverSaveBtn, serverSaveMsg);
  const serverWarning = el("p", "gateway-surface__server-warning");
  serverWarning.hidden = true;
  masterCard.append(masterRow, serverConfigRow, serverWarning);

  // Active accounts area (accounts currently exposed to the gateway)
  const activeArea = el("div", "gateway-surface__accounts");

  // Checklist: every Provider Profile from Settings, tick ON/OFF to expose it to the gateway.
  const checklistCard = el("div", "gateway-surface__add-form");
  const checklistTitle = el("h2", "gateway-surface__add-title", "Cấu hình từ Cài đặt");
  const checklistHint = el(
    "p",
    "gateway-surface__mode-hint",
    "Tick chọn những kết nối ở Cài đặt → Nhà cung cấp mà bạn muốn gateway dùng. Tên hiển thị giống hệt bên Cài đặt.",
  );
  const checklistBody = el("div", "gateway-surface__checklist");
  checklistCard.append(checklistTitle, checklistHint, checklistBody);

  // Recent request log — one row per actual prompt dispatch (every chat send).
  const logCard = el("div", "gateway-surface__add-form");
  const logHeader = el("div", "gateway-surface__log-header");
  const logTitle = el("h2", "gateway-surface__add-title", "Nhật ký gần đây");
  const logRefreshBtn = el("button", "gateway-surface__refresh icon-btn") as HTMLButtonElement;
  logRefreshBtn.type = "button";
  logRefreshBtn.textContent = "↻";
  logRefreshBtn.setAttribute("aria-label", "Tải lại nhật ký");
  logHeader.append(logTitle, logRefreshBtn);
  const logHint = el(
    "p",
    "gateway-surface__mode-hint",
    "Mỗi lần gửi tin nhắn tạo 1 dòng. Bấm vào 1 dòng để xem chi tiết prompt.",
  );
  const logBody = el("div", "gateway-surface__log-list");
  logCard.append(logHeader, logHint, logBody);

  root.append(header, statusMsg, masterCard, activeArea, checklistCard, logCard);
  rootEl.replaceChildren(root);

  // Sticky until the user acts again: sits alongside `showingError` in `render()`'s guard so the
  // routine "pending restart" hint recompute (every poll) doesn't silently erase this notice.
  let portTurnedOffNotice = false;

  let masterPending = false;
  masterToggle.addEventListener("change", () => {
    const wantsOn = masterToggle.checked;
    portTurnedOffNotice = false;
    masterPending = true;
    masterToggle.disabled = true;
    statusMsg.textContent = "Đang cập nhật…";
    void setGatewayEnabled(client, wantsOn)
      .then(async () => {
        // The swap/restore in Settings already happened — OpenCode just needs to be respawned
        // so its `opencode.json` picks it up (it only reads that file at spawn, never hot-reload).
        statusMsg.textContent = "Đang khởi động lại để áp dụng…";
        await client.reconnectLive();
        await load();
        statusMsg.textContent = "";
      })
      .catch((err: unknown) => {
        masterToggle.checked = !wantsOn;
        statusMsg.textContent = `Lỗi: ${err instanceof Error ? err.message : "Không cập nhật được."}`;
      })
      .finally(() => {
        masterPending = false;
        masterToggle.disabled = status?.proxyAvailable === false;
      });
  });

  // Port field: edited value only overwrites the input while the user isn't actively editing it
  // (tracked via `portFieldDirty`), same guard pattern as `masterPending` for the toggle above.
  let portFieldDirty = false;
  let portSaving = false;
  serverPortInput.addEventListener("input", () => {
    portFieldDirty = true;
    portTurnedOffNotice = false;
    serverSaveMsg.textContent = "";
    serverSaveMsg.classList.remove("gateway-surface__server-save-msg--error");
  });
  serverSaveBtn.addEventListener("click", () => {
    const raw = serverPortInput.value.trim();
    const port = Number.parseInt(raw, 10);
    if (!Number.isInteger(port) || port < 1024 || port > 65535 || String(port) !== raw) {
      serverSaveMsg.textContent = "Cổng không hợp lệ (1024-65535).";
      serverSaveMsg.classList.add("gateway-surface__server-save-msg--error");
      return;
    }
    // Saving a new port always restores every swapped profile and turns Gateway OFF server-side
    // (a swap made against the OLD port would otherwise dangle and brick the next restart — see
    // `setConfiguredPort` in gateway-service.ts) — warn here only when that will actually happen.
    const willTurnOff = status?.enabled === true;
    portSaving = true;
    serverSaveBtn.disabled = true;
    serverSaveMsg.classList.remove("gateway-surface__server-save-msg--error");
    serverSaveMsg.textContent = "Đang lưu…";
    void setGatewayServerPort(client, port)
      .then(() => {
        portFieldDirty = false;
        portSaving = false; // reset before load()'s render pass so it shows the fresh hint now
        portTurnedOffNotice = willTurnOff;
        serverSaveMsg.textContent = willTurnOff
          ? "Đã lưu — Gateway đã được TẮT vì đổi cổng (bật lại sau khi khởi động lại app)."
          : ""; // let that render recompute the real "pending restart" hint
        return load();
      })
      .catch((err: unknown) => {
        serverSaveMsg.classList.add("gateway-surface__server-save-msg--error");
        serverSaveMsg.textContent = `Lỗi: ${err instanceof Error ? err.message : "Không lưu được."}`;
      })
      .finally(() => {
        portSaving = false;
        serverSaveBtn.disabled = false;
      });
  });

  // ── Render ──

  function renderHealthBadge(health: GatewayHealth): void {
    healthBadge.dataset["health"] = health;
    healthText.textContent = healthLabel(health);
  }

  function renderChecklist(): void {
    checklistBody.replaceChildren();
    if (profiles.length === 0) {
      const empty = el(
        "p",
        "gateway-surface__saved-empty",
        "Chưa có kết nối nào ở Cài đặt → Nhà cung cấp. Thêm một kết nối ở đó trước.",
      );
      checklistBody.append(empty);
      return;
    }

    for (const profile of profiles) {
      const row = el("label", "gateway-surface__checklist-row");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "gateway-surface__checklist-box";

      const linkedAccount =
        status?.accounts.find((a) => a.linked && a.providerId === profile.id) ?? undefined;
      checkbox.checked = linkedAccount !== undefined;
      checkbox.disabled = !profile.credentialConfigured || pendingProfileId === profile.id;

      const nameSpan = el("span", "gateway-surface__checklist-name", profile.displayName);
      const typeBadge = el(
        "span",
        "gateway-surface__provider-badge",
        providerTypeLabel(profile.providerType),
      );
      const noteSpan = el(
        "span",
        "gateway-surface__checklist-note",
        profile.credentialConfigured ? "" : "Chưa cấu hình key",
      );
      noteSpan.hidden = profile.credentialConfigured;

      row.append(checkbox, nameSpan, typeBadge, noteSpan);
      checklistBody.append(row);

      checkbox.addEventListener("change", () => {
        const wantsOn = checkbox.checked;
        pendingProfileId = profile.id;
        renderChecklist();
        const task = wantsOn
          ? linkAccount(client, profile.id, profile.displayName, profile.credentialAccount ?? "")
          : linkedAccount !== undefined
            ? removeAccount(client, linkedAccount.id)
            : Promise.resolve();
        void task
          .then(() => load())
          .catch((err: unknown) => {
            statusMsg.textContent = `Lỗi: ${err instanceof Error ? err.message : "Không cập nhật được."}`;
          })
          .finally(() => {
            pendingProfileId = null;
          });
      });
    }
  }

  function renderActiveAccounts(accounts: GatewayAccountView[]): void {
    activeArea.replaceChildren();
    if (accounts.length === 0) {
      const empty = el(
        "p",
        "gateway-surface__empty",
        "Chưa có kết nối nào đang bật cho gateway. Tick chọn bên dưới để bắt đầu.",
      );
      activeArea.append(empty);
      return;
    }

    for (const account of accounts) {
      const row = el("div", "gateway-surface__account-row");
      const labelSpan = el("span", "gateway-surface__account-label", account.label);
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

      row.append(labelSpan, activeBadge, actions);
      activeArea.append(row);
    }
  }

  function renderLogDetail(entry: GatewayRequestLogEntry): HTMLElement {
    const detail = el("div", "gateway-surface__log-detail");
    const rows: [string, string][] = [
      ["Thời gian", formatLogTime(entry.at)],
      ["Kết nối", entry.profileLabel ?? "(không rõ)"],
      ["Model", entry.modelId ?? "(không rõ)"],
      ["Mã phiên", entry.sessionId ?? "(không rõ)"],
      ["Gateway lúc gửi", entry.gatewayEnabled ? "Đang bật" : "Đang tắt"],
      ["Kết quả", entry.outcome === "allowed" ? "Cho phép" : "Bị chặn"],
    ];
    if (entry.httpStatus !== undefined) rows.push(["HTTP status", String(entry.httpStatus)]);
    if (entry.ttfbMs !== undefined) rows.push(["Thời gian tới byte đầu (TTFB)", `${entry.ttfbMs} ms`]);
    if (entry.totalMs !== undefined) rows.push(["Tổng thời gian", `${entry.totalMs} ms`]);
    if (entry.reason !== undefined) rows.push(["Lý do", entry.reason]);
    for (const [label, value] of rows) {
      const line = el("div", "gateway-surface__log-detail-line");
      line.append(
        el("span", "gateway-surface__log-detail-key", label),
        el("span", "gateway-surface__log-detail-value", value),
      );
      detail.append(line);
    }
    const promptBlock = el("div", "gateway-surface__log-detail-prompt-wrap");
    promptBlock.append(el("span", "gateway-surface__log-detail-key", "Prompt"));
    const promptText = el(
      "pre",
      "gateway-surface__log-detail-prompt",
      entry.promptPreview ?? "(không ghi nhận nội dung)",
    );
    promptBlock.append(promptText);
    detail.append(promptBlock);
    return detail;
  }

  function renderLogs(): void {
    logBody.replaceChildren();
    if (logs.length === 0) {
      const empty = el(
        "p",
        "gateway-surface__saved-empty",
        "Chưa có lượt gửi nào được ghi nhận.",
      );
      logBody.append(empty);
      return;
    }

    for (const entry of logs) {
      const row = el("button", "gateway-surface__log-row") as HTMLButtonElement;
      row.type = "button";
      const timeSpan = el("span", "gateway-surface__log-time", formatLogTime(entry.at));
      const labelSpan = el(
        "span",
        "gateway-surface__log-label",
        entry.profileLabel ?? "(không rõ kết nối)",
      );
      row.append(timeSpan, labelSpan);
      if (entry.modelId !== undefined) {
        const modelSpan = el("span", "gateway-surface__log-model", entry.modelId);
        row.append(modelSpan);
      }
      // Only the exception (blocked) gets a badge — an "allowed" row on every line added no
      // information since that's the default outcome.
      if (entry.outcome === "blocked") {
        const outcomeBadge = el("span", "gateway-surface__log-outcome", "Bị chặn");
        outcomeBadge.dataset["outcome"] = entry.outcome;
        row.append(outcomeBadge);
      }
      const previewSpan = el(
        "span",
        "gateway-surface__log-preview",
        entry.promptPreview ?? "(không có nội dung prompt)",
      );
      row.append(previewSpan);

      row.addEventListener("click", () => {
        expandedLogId = expandedLogId === entry.id ? null : entry.id;
        renderLogs();
      });
      logBody.append(row);

      if (expandedLogId === entry.id) {
        logBody.append(renderLogDetail(entry));
      }
    }
  }

  function render(): void {
    if (loading) {
      statusMsg.textContent = "Đang tải…";
      renderHealthBadge("unknown");
      return;
    }
    if (errorMsg !== null) {
      statusMsg.textContent = `Lỗi kết nối: ${errorMsg}`;
      renderHealthBadge("unknown");
      return;
    }
    if (status === null) return;
    // Skip while a toggle change is in flight (`masterPending`) — a background poll's `render()`
    // must not stomp the "Đang khởi động lại…" progress text the toggle handler is showing.
    if (!masterPending) statusMsg.textContent = "";
    renderHealthBadge(status.health);
    if (!masterPending) masterToggle.checked = status.enabled;
    if (!portFieldDirty && !portSaving) {
      serverPortInput.value = String(status.configuredPort);
    }
    // Skip while the user is mid-edit/mid-save, while an error from THIS field is showing, or
    // while the sticky "Gateway turned OFF" notice hasn't been dismissed yet — otherwise always
    // keep the hint in sync with reality (e.g. clear it once a restart lands).
    const showingError = serverSaveMsg.classList.contains("gateway-surface__server-save-msg--error");
    if (!portFieldDirty && !portSaving && !showingError && !portTurnedOffNotice) {
      const boundPortMatch = /:(\d+)\/v1$/u.exec(status.serverAddress);
      const boundPort = boundPortMatch !== null ? Number.parseInt(boundPortMatch[1]!, 10) : undefined;
      const pendingRestart = boundPort !== undefined && boundPort !== status.configuredPort;
      serverSaveMsg.textContent = pendingRestart
        ? `Cổng đang chạy: ${boundPort} — khởi động lại để dùng ${status.configuredPort}.`
        : "";
    }
    serverWarning.hidden = status.proxyAvailable;
    if (!status.proxyAvailable) {
      serverWarning.textContent =
        "Gateway proxy server không khả dụng (không mở được cổng) — không thể bật Gateway. Kiểm tra xung đột cổng rồi khởi động lại ứng dụng.";
      // Refusing to even try turning ON avoids a round-trip error for an outcome we already know.
      if (!masterPending) masterToggle.disabled = true;
    } else if (!masterPending) {
      masterToggle.disabled = false;
    }
    renderActiveAccounts(status.accounts);
    renderChecklist();
    renderLogs();
  }

  async function load(options?: { silent?: boolean }): Promise<void> {
    if (destroyed) return;
    const silent = options?.silent === true;
    // Background polling ticks must not flash "Đang tải…" over a screen the user is reading —
    // only a manual refresh or the very first load shows the loading state.
    if (!silent) {
      loading = true;
      errorMsg = null;
      render();
    }
    try {
      const [nextStatus, nextProfiles, nextLogs] = await Promise.all([
        fetchGatewayStatus(client),
        client.listProfiles().catch(() => []),
        fetchGatewayLogs(client).catch(() => []),
      ]);
      status = nextStatus;
      profiles = nextProfiles;
      logs = nextLogs;
      errorMsg = null;
    } catch (err) {
      if (!silent) errorMsg = err instanceof Error ? err.message : "Không kết nối được tới gateway service.";
    } finally {
      loading = false;
    }
    if (!destroyed) render();
  }

  async function loadLogsOnly(): Promise<void> {
    if (destroyed || logRefreshing) return;
    logRefreshing = true;
    logRefreshBtn.disabled = true;
    try {
      logs = await fetchGatewayLogs(client);
    } catch (err) {
      statusMsg.textContent = `Lỗi: ${err instanceof Error ? err.message : "Không tải được nhật ký."}`;
    } finally {
      logRefreshing = false;
      logRefreshBtn.disabled = false;
    }
    if (!destroyed) renderLogs();
  }

  refreshBtn.addEventListener("click", () => void load());
  logRefreshBtn.addEventListener("click", () => void loadLogsOnly());

  // Initial load
  void load();

  // Poll in the background so a send from the chat composer shows up here without the user
  // having to click the refresh button — the log's whole value is seeing it happen live.
  const pollTimer = setInterval(() => {
    if (loading) return; // don't overlap with an in-flight fetch (manual refresh or toggle)
    void load({ silent: true });
  }, AUTO_REFRESH_MS);

  return {
    destroy(): void {
      destroyed = true;
      clearInterval(pollTimer);
      rootEl.replaceChildren();
    },
  };
}
