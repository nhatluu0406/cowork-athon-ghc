import type {
  Ms365ViewData,
  Ms365DeviceBeginResult,
  Ms365DevicePollResult,
  Ms365SiteView,
  Ms365FlowView,
} from "../../service-client.js";
import { el } from "../dom-utils.js";
import { createMicrosoftLogo } from "./ms-logo.js";
import { renderDevicePendingCard } from "./ms-connect-device.js";
import { openFlowDialog } from "./ms-flow-dialog.js";

/** Nơi lấy access token thủ công (Graph Explorer → "Access token"). */
const GRAPH_EXPLORER_URL = "https://developer.microsoft.com/en-us/graph/graph-explorer";

/** Minimal service-client slice the connect view needs (structural — real ServiceClient satisfies it). */
export interface Ms365ConnectClient {
  connectMs365Token(token: string): Promise<Ms365ViewData>;
  fetchMs365View(): Promise<Ms365ViewData>;
  beginMs365Device(): Promise<Ms365DeviceBeginResult>;
  pollMs365Device(): Promise<Ms365DevicePollResult>;
  disconnectMs365(): Promise<Ms365ViewData>;
  listMs365Sites(): Promise<readonly Ms365SiteView[]>;
  setMs365SiteEnabled(siteId: string, enabled: boolean): Promise<readonly Ms365SiteView[]>;
  listMs365Flows(): Promise<readonly Ms365FlowView[]>;
  addMs365Flow(name: string, url: string, description: string, payloadSchema: string, timeoutMs?: number): Promise<readonly Ms365FlowView[]>;
  updateMs365Flow(name: string, fields: { description: string; timeoutMs: number; payloadSchema: string; url?: string }): Promise<readonly Ms365FlowView[]>;
  deleteMs365Flow(name: string): Promise<readonly Ms365FlowView[]>;
  setMs365FlowEnabled(name: string, enabled: boolean): Promise<readonly Ms365FlowView[]>;
  setMs365FlowTimeout(name: string, timeoutMs: number): Promise<readonly Ms365FlowView[]>;
}

export interface RenderMsConnectDeps {
  readonly view: Ms365ViewData;
  readonly client: Ms365ConnectClient;
  readonly onViewChange: (view: Ms365ViewData) => void;
  /** Poll interval in ms; defaults to 5000. Injectable so tests don't wait on a real 5s timer. */
  readonly pollIntervalMs?: number;
}

type LocalMode = "idle" | "device_pending";

interface ViewState {
  mode: LocalMode;
  deviceCode: string | null;
  verificationUri: string | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  pollInFlight: boolean;
}

/** Per-container local state so a re-render can find and clear any prior poll timer. */
const stateByContainer = new WeakMap<HTMLElement, ViewState>();

export function renderMsConnect(container: HTMLElement, deps: RenderMsConnectDeps): void {
  const prior = stateByContainer.get(container);
  if (prior?.pollTimer !== null && prior?.pollTimer !== undefined) clearInterval(prior.pollTimer);

  const state: ViewState = {
    mode: "idle",
    deviceCode: null,
    verificationUri: null,
    pollTimer: null,
    pollInFlight: false,
  };
  stateByContainer.set(container, state);

  paint(container, deps, state);
}

function paint(container: HTMLElement, deps: RenderMsConnectDeps, state: ViewState): void {
  container.replaceChildren();
  const wrap = el("div", "ms-connect");
  if (deps.view.connectionState === "connected") {
    wrap.append(renderConnectedSummary(container, deps));
  } else if (state.mode === "device_pending" && state.deviceCode !== null && state.verificationUri !== null) {
    wrap.append(renderDevicePendingCard(state.deviceCode, state.verificationUri));
  } else {
    wrap.append(renderSignInCard(container, deps, state));
  }
  container.append(wrap);
}

function renderSignInCard(container: HTMLElement, deps: RenderMsConnectDeps, state: ViewState): HTMLElement {
  const card = el("section", "ms-card ms-connect__signin-card");
  const logoWrap = el("div", "ms-connect__logo");
  logoWrap.append(createMicrosoftLogo(34));
  const signIn = el("button", "ms-connect__signin", "Đăng nhập với Microsoft") as HTMLButtonElement;
  signIn.type = "button";
  signIn.disabled = false;

  const noteSlot = el("p", "ms-connect__note", "");
  noteSlot.hidden = true;

  signIn.addEventListener("click", () => {
    signIn.disabled = true;
    void deps.client.beginMs365Device().then((result) => {
      if ("error" in result) {
        noteSlot.textContent = "Cần app registration — nhờ IT cấu hình CGHC_MS365_CLIENT_ID.";
        noteSlot.hidden = false;
        signIn.disabled = true;
        return;
      }
      state.mode = "device_pending";
      state.deviceCode = result.userCode;
      state.verificationUri = result.verificationUri;
      paint(container, deps, state);
      startPolling(container, deps, state);
    }).catch(() => {
      noteSlot.textContent = "Không thể bắt đầu đăng nhập. Kiểm tra kết nối và thử lại.";
      noteSlot.hidden = false;
      signIn.disabled = false;
    });
  });

  const oauthNote = el(
    "p",
    "ms-connect__oauth-note",
    "Đăng nhập dùng OAuth loopback; token chỉ giữ trong bộ nhớ phiên làm việc (in-memory), không ghi ra đĩa và không nằm trong trạng thái UI.",
  );

  const manual = renderManualFallback(container, deps, state);

  card.append(
    logoWrap,
    el("h2", "ms-card__title", "Kết nối Microsoft 365"),
    signIn,
    noteSlot,
    manual,
    oauthNote,
  );
  return card;
}

function renderManualFallback(container: HTMLElement, deps: RenderMsConnectDeps, state: ViewState): HTMLElement {
  const wrap = el("div", "ms-connect__manual");
  const toggle = el("button", "ms-connect__manual-toggle", "Kết nối thủ công bằng token") as HTMLButtonElement;
  toggle.type = "button";
  const body = el("div", "ms-connect__manual-body");
  body.hidden = true;

  // Hướng dẫn lấy token: mở Graph Explorer, đăng nhập, rồi copy ở tab "Access token".
  const guide = el("p", "ms-connect__manual-guide");
  guide.append(
    document.createTextNode("Chưa có token? Mở "),
  );
  const guideLink = el("a", "ms-connect__manual-guide-link", "Microsoft Graph Explorer") as HTMLAnchorElement;
  guideLink.href = GRAPH_EXPLORER_URL;
  guideLink.target = "_blank";
  guideLink.rel = "noopener noreferrer";
  guide.append(
    guideLink,
    document.createTextNode(", đăng nhập tài khoản của bạn, chuyển sang tab “Access token”, sao chép rồi dán vào ô bên dưới."),
  );

  // A real Graph access token is a long JWT, so use a full-width multi-line textarea rather than
  // a short single-line input. `autocomplete`/`spellcheck` off; the value is never serialized to
  // the DOM/attributes and is cleared on success.
  const input = el("textarea", "ms-connect__manual-input") as HTMLTextAreaElement;
  input.rows = 3;
  input.placeholder = "Dán access token (Bearer) tại đây";
  input.setAttribute("aria-label", "Token Microsoft 365");
  input.autocomplete = "off";
  input.spellcheck = false;
  input.classList.add("ms-connect__manual-input--masked");

  const submit = el("button", "ms-connect__manual-submit", "Kết nối bằng token") as HTMLButtonElement;
  submit.type = "button";
  const errorSlot = el("p", "ms-connect__manual-error", "");
  errorSlot.hidden = true;

  toggle.addEventListener("click", () => {
    body.hidden = !body.hidden;
  });

  submit.addEventListener("click", () => {
    const token = input.value.trim();
    if (token.length === 0) return;
    submit.disabled = true;
    errorSlot.hidden = true;
    void deps.client
      .connectMs365Token(token)
      .then((view) => {
        input.value = "";
        // `connectWithToken` never throws: an invalid/expired token (or one lacking the verify
        // scope) resolves to a NON-"connected" state (`error`/`needs_reconnect`) instead of a
        // rejection. Surface that here and keep the panel open — otherwise the view silently
        // repaints the same sign-in card and the click appears to do nothing.
        if (view.connectionState === "connected") {
          deps.onViewChange(view);
          return;
        }
        errorSlot.textContent =
          view.error ??
          "Token bị Microsoft từ chối (hết hạn, sai định dạng, hoặc thiếu quyền). Lấy token mới rồi thử lại.";
        errorSlot.hidden = false;
      })
      .catch(() => {
        input.value = "";
        errorSlot.textContent = "Không thể kết nối bằng token này. Kiểm tra lại và thử lại.";
        errorSlot.hidden = false;
      })
      .finally(() => {
        submit.disabled = false;
      });
  });

  body.append(guide, input, submit, errorSlot);
  wrap.append(toggle, body);
  return wrap;
}

function startPolling(container: HTMLElement, deps: RenderMsConnectDeps, state: ViewState): void {
  const intervalMs = deps.pollIntervalMs ?? 5000;
  const tick = (): void => {
    if (state.pollInFlight) return;
    state.pollInFlight = true;
    void deps.client
      .pollMs365Device()
      .then((result) => {
        if (result.status === "connected" && result.view !== undefined) {
          stopPolling(state);
          state.mode = "idle";
          state.deviceCode = null;
          state.verificationUri = null;
          deps.onViewChange(result.view);
        } else if (result.status === "expired") {
          stopPolling(state);
          state.mode = "idle";
          state.deviceCode = null;
          state.verificationUri = null;
          paint(container, deps, state);
          const wrap = container.querySelector(".ms-connect");
          if (wrap !== null) wrap.append(el("p", "ms-connect__expired-note", "Mã đã hết hạn, thử lại."));
        }
        // "pending" keeps polling.
      })
      .catch(() => {
        stopPolling(state);
        state.mode = "idle";
        state.deviceCode = null;
        state.verificationUri = null;
        paint(container, deps, state);
        const wrap = container.querySelector(".ms-connect");
        if (wrap !== null) wrap.append(el("p", "ms-connect__poll-error-note", "Không thể xác nhận đăng nhập, thử lại."));
      })
      .finally(() => {
        state.pollInFlight = false;
      });
  };
  state.pollTimer = setInterval(tick, intervalMs);
}

function stopPolling(state: ViewState): void {
  if (state.pollTimer !== null) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

function renderConnectedSummary(container: HTMLElement, deps: RenderMsConnectDeps): HTMLElement {
  const view = deps.view;
  const card = el("section", "ms-card ms-connect__summary");
  const header = el("div", "ms-connect__summary-header");
  header.append(el("h2", "ms-card__title", "Microsoft 365"), el("span", "ms-pill ms-pill--ok", "Đã kết nối"));
  card.append(header);

  const services = el("div", "ms-service-grid");
  for (const service of view.services) {
    const item = el("div", "ms-service-card");
    item.append(
      el("div", "ms-service-card__name", service.label),
      el("div", "ms-service-card__state", service.connected ? "Đang bật" : "Chờ quyền"),
    );
    services.append(item);
  }
  card.append(el("h3", "ms-section-label", "Dịch vụ khả dụng"), services);

  // Real granted permissions decoded from the connected account's token (scp/roles).
  card.append(el("h3", "ms-section-label", "Quyền đang có trên tài khoản này"));
  if (view.scopes.length > 0) {
    const scopeList = el("div", "ms-granted-scopes");
    for (const scope of view.scopes) scopeList.append(el("code", "ms-scope-pill", scope));
    card.append(scopeList);
  } else {
    card.append(el("p", "ms-connect__scopes-empty", "Không đọc được danh sách quyền từ token này."));
  }

  const disconnect = el("button", "ms-connect__disconnect", "Ngắt kết nối") as HTMLButtonElement;
  disconnect.type = "button";
  const disconnectError = el("p", "ms-connect__disconnect-error", "");
  disconnectError.hidden = true;
  disconnect.addEventListener("click", () => {
    disconnect.disabled = true;
    void deps.client
      .disconnectMs365()
      .then((next) => {
        deps.onViewChange(next);
      })
      .catch(() => {
        disconnectError.textContent = "Không thể ngắt kết nối, thử lại.";
        disconnectError.hidden = false;
        disconnect.disabled = false;
      });
  });
  card.append(disconnect, disconnectError);
  card.append(renderSiteScopeSection(deps));
  card.append(renderPowerAutomateSection(container, deps));
  return card;
}

/**
 * "Phạm vi tìm kiếm SharePoint" — lists the sites visible to the connected account, each with
 * a keyboard-navigable toggle. Loads on mount via `listMs365Sites()` and re-renders in place
 * from the refreshed list returned by `setMs365SiteEnabled` — no token/secret ever enters this
 * DOM, only id/displayName/webUrl/enabled (CGHC MS365 Site Scope, Task 7).
 */
function renderSiteScopeSection(deps: RenderMsConnectDeps): HTMLElement {
  const wrap = el("div", "ms-sites");
  wrap.append(el("h3", "ms-section-label", "Phạm vi tìm kiếm SharePoint"));

  const list = el("div", "ms-sites__list");
  const status = el("p", "ms-sites__status", "Đang tải danh sách site…");
  wrap.append(status, list);

  const paintSites = (sites: readonly Ms365SiteView[]): void => {
    status.hidden = true;
    list.replaceChildren();
    if (sites.length === 0) {
      status.textContent = "Không tìm thấy site SharePoint nào.";
      status.hidden = false;
      return;
    }
    for (const site of sites) {
      list.append(renderSiteRow(deps, site, paintSites));
    }
  };

  void deps.client
    .listMs365Sites()
    .then(paintSites)
    .catch(() => {
      status.textContent = "Không thể tải danh sách site, thử lại sau.";
    });

  return wrap;
}

function renderSiteRow(
  deps: RenderMsConnectDeps,
  site: Ms365SiteView,
  onRefresh: (sites: readonly Ms365SiteView[]) => void,
): HTMLElement {
  const row = el("label", "ms-sites__row");
  row.append(el("span", "ms-sites__name", site.displayName));

  const toggle = el("input", "ms-sites__toggle") as HTMLInputElement;
  toggle.type = "checkbox";
  toggle.checked = site.enabled;
  toggle.setAttribute("aria-label", site.displayName);

  toggle.addEventListener("change", () => {
    const next = toggle.checked;
    toggle.disabled = true;
    void deps.client
      .setMs365SiteEnabled(site.id, next)
      .then(onRefresh)
      .catch(() => {
        toggle.checked = !next;
        toggle.disabled = false;
      });
  });

  row.append(toggle);
  return row;
}

/**
 * "Power Automate (tùy chỉnh)" — read-only flow list (name + description + timeout badge +
 * schema badge + enable/disable toggle + Sửa/Xóa) plus a "＋ Thêm flow" button that opens the
 * add/edit modal (`openFlowDialog`). The flow URL is a bearer secret and is NEVER rendered back
 * — the list carries only name/description/enabled/timeoutMs/payloadSchema, and the edit dialog
 * never pre-fills the URL. Loads on mount via `listMs365Flows()` and re-renders in place from
 * each mutating call's refreshed list.
 */
function renderPowerAutomateSection(container: HTMLElement, deps: RenderMsConnectDeps): HTMLElement {
  const wrap = el("div", "ms-flows");
  const header = el("div", "ms-flows__header");
  header.append(el("h3", "ms-section-label", "Power Automate (tùy chỉnh)"));
  const addBtn = el("button", "ms-flows__add-btn", "＋ Thêm flow") as HTMLButtonElement;
  addBtn.type = "button";
  header.append(addBtn);
  wrap.append(header);

  const list = el("div", "ms-flows__list");
  const status = el("p", "ms-flows__status", "Đang tải danh sách flow…");
  wrap.append(status, list);

  const paint = (flows: readonly Ms365FlowView[]): void => {
    status.hidden = true;
    list.replaceChildren();
    if (flows.length === 0) {
      status.textContent = "Chưa có flow nào — bấm “Thêm flow”.";
      status.hidden = false;
      return;
    }
    for (const flow of flows) list.append(renderFlowRow(container, deps, flow, paint));
  };

  addBtn.addEventListener("click", () => {
    openFlowDialog(container, {
      mode: "add",
      onSubmit: async (v) => {
        paint(await deps.client.addMs365Flow(v.name, v.url, v.description, v.payloadSchema, v.timeoutSec * 1000));
      },
    });
  });

  void deps.client
    .listMs365Flows()
    .then(paint)
    .catch(() => {
      status.textContent = "Không thể tải danh sách flow, thử lại sau.";
      status.hidden = false;
    });

  return wrap;
}

function renderFlowRow(
  container: HTMLElement,
  deps: RenderMsConnectDeps,
  flow: Ms365FlowView,
  onRefresh: (flows: readonly Ms365FlowView[]) => void,
): HTMLElement {
  const row = el("div", "ms-flows__row");
  const info = el("div", "ms-flows__info");
  info.append(el("span", "ms-flows__name", flow.name));
  if (flow.description.length > 0) info.append(el("span", "ms-flows__desc", flow.description));
  info.append(el("span", "ms-flows__timeout-badge", `${Math.round(flow.timeoutMs / 1000)}s`));
  if (flow.payloadSchema.length > 0) info.append(el("span", "ms-flows__schema-badge", "schema"));

  const controls = el("div", "ms-flows__controls");
  const toggle = el("input", "ms-flows__toggle") as HTMLInputElement;
  toggle.type = "checkbox";
  toggle.checked = flow.enabled;
  toggle.setAttribute("aria-label", `Bật/tắt ${flow.name}`);
  toggle.addEventListener("change", () => {
    const next = toggle.checked;
    toggle.disabled = true;
    void deps.client
      .setMs365FlowEnabled(flow.name, next)
      .then(onRefresh)
      .catch(() => {
        toggle.checked = !next;
        toggle.disabled = false;
      });
  });

  const editBtn = el("button", "ms-flows__edit", "Sửa") as HTMLButtonElement;
  editBtn.type = "button";
  editBtn.addEventListener("click", () => {
    openFlowDialog(container, {
      mode: "edit",
      initial: {
        name: flow.name,
        description: flow.description,
        payloadSchema: flow.payloadSchema,
        timeoutSec: Math.round(flow.timeoutMs / 1000),
      },
      onSubmit: async (v) => {
        onRefresh(
          await deps.client.updateMs365Flow(v.name, {
            description: v.description,
            timeoutMs: v.timeoutSec * 1000,
            payloadSchema: v.payloadSchema,
            url: v.url,
          }),
        );
      },
    });
  });

  const delBtn = el("button", "ms-flows__delete", "Xóa") as HTMLButtonElement;
  delBtn.type = "button";
  delBtn.addEventListener("click", () => {
    delBtn.disabled = true;
    void deps.client.deleteMs365Flow(flow.name).then(onRefresh).catch(() => {
      delBtn.disabled = false;
    });
  });

  controls.append(toggle, editBtn, delBtn);
  row.append(info, controls);
  return row;
}
