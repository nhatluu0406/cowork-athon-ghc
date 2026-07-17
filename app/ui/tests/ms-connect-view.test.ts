import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMsConnect, type Ms365ConnectClient } from "../src/ui-shell/microsoft/ms-connect-view.js";
import type {
  Ms365ViewData,
  Ms365DeviceBeginResult,
  Ms365DevicePollResult,
} from "../src/service-client.js";

function fakeClient(over: Partial<Ms365ConnectClient> = {}): Ms365ConnectClient {
  return {
    connectMs365Token: async () =>
      ({ connectionState: "connected", services: [], scopes: [], actionHistory: [] }) as Ms365ViewData,
    beginMs365Device: async () =>
      ({ userCode: "ABCD", verificationUri: "https://microsoft.com/devicelogin", expiresInSec: 900 }) as Ms365DeviceBeginResult,
    pollMs365Device: async () => ({ status: "pending" }) as Ms365DevicePollResult,
    fetchMs365View: async () =>
      ({ connectionState: "disconnected", services: [], scopes: [], actionHistory: [] }) as Ms365ViewData,
    disconnectMs365: async () =>
      ({ connectionState: "disconnected", services: [], scopes: [], actionHistory: [] }) as Ms365ViewData,
    listMs365Sites: async () => [],
    setMs365SiteEnabled: async () => [],
    ...over,
  };
}

function container(): HTMLElement {
  return document.createElement("div");
}

const DISCONNECTED: Ms365ViewData = { connectionState: "disconnected", services: [], scopes: [], actionHistory: [] };

function disconnectedView(over: Partial<Ms365ViewData> = {}): Ms365ViewData {
  return { ...DISCONNECTED, ...over };
}

test("disconnected renders device sign-in button enabled + manual fallback", () => {
  const c = container();
  renderMsConnect(c, { view: DISCONNECTED, client: fakeClient(), onViewChange: () => {} });
  assert.ok(c.querySelector(".ms-connect__signin"));
  assert.equal((c.querySelector(".ms-connect__signin") as HTMLButtonElement).disabled, false);
  assert.ok(c.querySelector(".ms-connect__manual"));
});

test("device begin returning not_configured disables the button with a note", async () => {
  const c = container();
  renderMsConnect(c, {
    view: DISCONNECTED,
    client: fakeClient({ beginMs365Device: async () => ({ error: "not_configured" }) }),
    onViewChange: () => {},
  });
  (c.querySelector(".ms-connect__signin") as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 0));
  assert.match(c.textContent ?? "", /app registration|nhờ IT|chưa cấu hình/i);
  assert.equal((c.querySelector(".ms-connect__signin") as HTMLButtonElement).disabled, true);
});

test("connected view shows the connected summary", () => {
  const c = container();
  renderMsConnect(c, {
    view: {
      connectionState: "connected",
      services: [{ id: "sharepoint", label: "SharePoint", connected: true }],
      scopes: ["Sites.Read.All"],
      actionHistory: [],
    },
    client: fakeClient(),
    onViewChange: () => {},
  });
  assert.ok(c.querySelector(".ms-connect__summary"));
});

test("manual token box is a textarea, hidden until the toggle is clicked", () => {
  const c = container();
  renderMsConnect(c, { view: DISCONNECTED, client: fakeClient(), onViewChange: () => {} });
  const body = c.querySelector(".ms-connect__manual-body") as HTMLElement;
  assert.ok(body);
  assert.equal(body.hidden, true, "manual body hidden by default");
  const input = c.querySelector(".ms-connect__manual-input");
  assert.equal((input as HTMLElement)?.tagName, "TEXTAREA", "token box is a textarea for long JWTs");
  (c.querySelector(".ms-connect__manual-toggle") as HTMLButtonElement).click();
  assert.equal(body.hidden, false, "toggle reveals the token box");
});

test("connected view shows the account's real granted scopes as pills", () => {
  const c = container();
  renderMsConnect(c, {
    view: {
      connectionState: "connected",
      services: [{ id: "sharepoint", label: "SharePoint", connected: true }],
      scopes: ["User.Read", "Sites.Read.All", "Files.ReadWrite.All"],
      actionHistory: [],
    },
    client: fakeClient(),
    onViewChange: () => {},
  });
  const pills = [...c.querySelectorAll(".ms-scope-pill")].map((p) => p.textContent);
  assert.deepEqual(pills, ["User.Read", "Sites.Read.All", "Files.ReadWrite.All"]);
});

test("connected view with no scopes shows an honest empty note", () => {
  const c = container();
  renderMsConnect(c, {
    view: { connectionState: "connected", services: [], scopes: [], actionHistory: [] },
    client: fakeClient(),
    onViewChange: () => {},
  });
  assert.ok(c.querySelector(".ms-connect__scopes-empty"));
  assert.equal(c.querySelector(".ms-scope-pill"), null);
});

test("disconnect button calls disconnectMs365 and passes the fresh view to onViewChange", async () => {
  const c = container();
  let received: Ms365ViewData | null = null;
  let calledDisconnect = false;
  renderMsConnect(c, {
    view: {
      connectionState: "connected",
      services: [{ id: "sharepoint", label: "SharePoint", connected: true }],
      scopes: ["User.Read"],
      actionHistory: [],
    },
    client: fakeClient({
      disconnectMs365: async () => {
        calledDisconnect = true;
        return { connectionState: "disconnected", services: [], scopes: [], actionHistory: [] };
      },
    }),
    onViewChange: (v) => {
      received = v;
    },
  });
  const btn = c.querySelector(".ms-connect__disconnect") as HTMLButtonElement;
  assert.ok(btn, "disconnect button present on a connected account");
  btn.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calledDisconnect, true);
  assert.equal((received as Ms365ViewData | null)?.connectionState, "disconnected");
});

test("manual token fallback connects and calls onViewChange", async () => {
  const c = container();
  const connectedView: Ms365ViewData = {
    connectionState: "connected",
    services: [{ id: "sharepoint", label: "SharePoint", connected: true }],
    scopes: ["Sites.Read.All"],
    actionHistory: [],
  };
  let received: Ms365ViewData | null = null;
  let capturedToken: string | null = null;
  renderMsConnect(c, {
    view: DISCONNECTED,
    client: fakeClient({
      connectMs365Token: async (token: string) => {
        capturedToken = token;
        return connectedView;
      },
    }),
    onViewChange: (view) => {
      received = view;
    },
  });
  const expander = c.querySelector<HTMLButtonElement>(".ms-connect__manual-toggle");
  expander?.click();
  const input = c.querySelector<HTMLInputElement>(".ms-connect__manual-input");
  assert.ok(input);
  input.value = "  fake-token  ";
  const submit = c.querySelector<HTMLButtonElement>(".ms-connect__manual-submit");
  submit?.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(capturedToken, "fake-token");
  assert.deepEqual(received, connectedView);
  // Token must never be serialized into the DOM.
  assert.doesNotMatch(c.innerHTML, /fake-token/);
});

test("manual token that the service rejects (state !== connected) shows an error, does NOT navigate", async () => {
  const c = container();
  // connectWithToken never throws — an invalid/expired token resolves to a non-"connected"
  // view (state "error"/"needs_reconnect"), carrying an error message. The panel must surface it.
  const rejectedView: Ms365ViewData = {
    connectionState: "error",
    services: [],
    scopes: [],
    actionHistory: [],
    error: "Token không hợp lệ hoặc đã hết hạn.",
  };
  let viewChangeCalls = 0;
  renderMsConnect(c, {
    view: DISCONNECTED,
    client: fakeClient({ connectMs365Token: async () => rejectedView }),
    onViewChange: () => {
      viewChangeCalls += 1;
    },
  });
  c.querySelector<HTMLButtonElement>(".ms-connect__manual-toggle")?.click();
  const input = c.querySelector<HTMLTextAreaElement>(".ms-connect__manual-input");
  assert.ok(input);
  input.value = "bad-token";
  c.querySelector<HTMLButtonElement>(".ms-connect__manual-submit")?.click();
  await new Promise((r) => setTimeout(r, 0));
  const errorEl = c.querySelector<HTMLElement>(".ms-connect__manual-error");
  assert.ok(errorEl && !errorEl.hidden, "error slot must be visible");
  assert.match(errorEl.textContent ?? "", /hết hạn|không hợp lệ|token/i);
  assert.equal(viewChangeCalls, 0, "must NOT navigate away on a non-connected result");
  // The panel stays open so the user can retry.
  const body = c.querySelector<HTMLElement>(".ms-connect__manual-body");
  assert.equal(body?.hidden, false, "manual panel stays open after a rejected token");
  assert.doesNotMatch(c.innerHTML, /bad-token/);
});

test("device flow: begin then poll pending -> connected calls onViewChange and stops polling", async () => {
  const c = container();
  const connectedView: Ms365ViewData = {
    connectionState: "connected",
    services: [],
    scopes: [],
    actionHistory: [],
  };
  let pollCount = 0;
  let received: Ms365ViewData | null = null;
  renderMsConnect(c, {
    view: DISCONNECTED,
    client: fakeClient({
      pollMs365Device: async () => {
        pollCount += 1;
        if (pollCount === 1) return { status: "pending" };
        return { status: "connected", view: connectedView };
      },
    }),
    onViewChange: (view) => {
      received = view;
    },
    pollIntervalMs: 0,
  });
  (c.querySelector(".ms-connect__signin") as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(c.querySelector(".ms-connect__device-code"));

  // Drive polling manually by waiting for the injected (0ms) interval to fire twice.
  await new Promise((r) => setTimeout(r, 10));
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(pollCount >= 2, true);
  assert.deepEqual(received, connectedView);
});

test("device flow: poll expired shows retry note and returns to disconnected", async () => {
  const c = container();
  renderMsConnect(c, {
    view: DISCONNECTED,
    client: fakeClient({
      pollMs365Device: async () => ({ status: "expired" }),
    }),
    onViewChange: () => {},
    pollIntervalMs: 0,
  });
  (c.querySelector(".ms-connect__signin") as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 10));
  assert.match(c.textContent ?? "", /hết hạn/i);
  assert.ok(c.querySelector(".ms-connect__signin"));
});

test("device flow: poll rejection stops the timer and returns to a retry-able disconnected state", async () => {
  const c = container();
  let pollCount = 0;
  renderMsConnect(c, {
    view: DISCONNECTED,
    client: fakeClient({
      pollMs365Device: async () => {
        pollCount += 1;
        throw new Error("verify failed");
      },
    }),
    onViewChange: () => {},
    pollIntervalMs: 0,
  });
  (c.querySelector(".ms-connect__signin") as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(c.querySelector(".ms-connect__device-code"));

  await new Promise((r) => setTimeout(r, 10));
  const countAfterFirstFire = pollCount;
  assert.ok(countAfterFirstFire >= 1);

  // Give the (0ms) interval more chances to fire; it must NOT keep polling after rejection.
  await new Promise((r) => setTimeout(r, 10));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(pollCount, countAfterFirstFire);

  assert.ok(c.querySelector(".ms-connect__signin"));
  assert.equal((c.querySelector(".ms-connect__signin") as HTMLButtonElement).disabled, false);
  assert.match(c.textContent ?? "", /không thể xác nhận|thử lại/i);
});

test("sign-in begin rejection re-enables the button and shows an error note", async () => {
  const c = container();
  renderMsConnect(c, {
    view: DISCONNECTED,
    client: fakeClient({
      beginMs365Device: async () => {
        throw new Error("service_not_ready");
      },
    }),
    onViewChange: () => {},
  });
  const signIn = c.querySelector(".ms-connect__signin") as HTMLButtonElement;
  signIn.click();
  assert.equal(signIn.disabled, true);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(signIn.disabled, false);
  assert.match(c.textContent ?? "", /không thể bắt đầu|thử lại/i);
});

test("sign-in card no longer lists requested scopes", () => {
  const c = container();
  const view = disconnectedView({ scopes: ["Files.ReadWrite.All", "Tasks.ReadWrite"] });
  renderMsConnect(c, { view, client: fakeClient(), onViewChange: () => {} });
  assert.equal(c.querySelector(".ms-scope-list"), null, "the 'quyền sẽ xin' list must be gone");
  assert.ok(!/Quyền sẽ xin khi kết nối/i.test(c.textContent ?? ""));
});

test("manual fallback shows a Graph Explorer guide link with the correct URL", () => {
  const c = container();
  renderMsConnect(c, { view: disconnectedView({}), client: fakeClient(), onViewChange: () => {} });
  const link = c.querySelector<HTMLAnchorElement>(".ms-connect__manual-guide-link");
  assert.ok(link, "guide link present");
  assert.equal(link.href, "https://developer.microsoft.com/en-us/graph/graph-explorer");
  assert.equal(link.target, "_blank");
  assert.match(link.rel, /noopener/);
});

test("storage copy says in-memory, not Windows Credential Manager", () => {
  const c = container();
  renderMsConnect(c, { view: disconnectedView({}), client: fakeClient(), onViewChange: () => {} });
  const note = c.querySelector(".ms-connect__oauth-note")?.textContent ?? "";
  assert.ok(!/Credential Manager/i.test(note));
  assert.match(note, /bộ nhớ|in-memory/i);
});

test("manual token textarea is masked and cleared when connect FAILS", async () => {
  const c = container();
  const client = fakeClient({ connectMs365Token: () => Promise.reject(new Error("bad")) });
  renderMsConnect(c, { view: disconnectedView({}), client, onViewChange: () => {} });
  const expander = c.querySelector<HTMLButtonElement>(".ms-connect__manual-toggle");
  expander?.click();
  const input = c.querySelector(".ms-connect__manual-input") as HTMLTextAreaElement;
  assert.ok(input.classList.contains("ms-connect__manual-input--masked"));
  input.value = "eyJhbGciOi...";
  (c.querySelector(".ms-connect__manual-submit") as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(input.value, "", "token must not linger in the DOM after a failed connect");
});
