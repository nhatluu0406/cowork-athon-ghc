import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSurfaceRegistry,
  visibleProductSurfaces,
  PRODUCT_SURFACES,
  type ProductSurfaceId,
} from "../src/surface-registry.js";
import type {
  DispatchTaskSummary,
  GatewayIntegrationView,
  KnowledgeIntegrationView,
  MicrosoftIntegrationView,
} from "../src/integration-slots.js";
import { getIntegrationSurfaceAdapter } from "../src/integration-surface-adapters.js";
import { createAppFrame } from "../src/ui-shell/create-app-frame.js";
import { renderIntegrationSurface } from "../src/ui-shell/integration-view.js";

test("surface registry declares the seven top-level product surfaces", () => {
  const registry = createSurfaceRegistry();
  const ids = registry.map((surface) => surface.id);
  assert.deepEqual(ids, [
    "cowork",
    "skills-mcp",
    "dispatch",
    "gateway",
    "knowledge",
    "microsoft",
    "code",
  ] satisfies ProductSurfaceId[]);
  for (const surface of registry) {
    assert.ok(surface.label.length > 0);
    assert.ok(surface.icon.length > 0);
    assert.ok(surface.featureFlag.length > 0);
    assert.ok(surface.requiredCapability.length > 0);
    assert.ok(surface.component.length > 0);
  }
});

test("production default exposes all navigable product rail surfaces", () => {
  const visible = visibleProductSurfaces(createSurfaceRegistry());
  assert.deepEqual(visible.map((surface) => [surface.id, surface.availability]), [
    ["cowork", "available"],
    ["skills-mcp", "available"],
    ["dispatch", "awaiting_integration"],
    // Gateway backend (PR #16 multi-account proxy) is now integrated — no longer a mount boundary.
    ["gateway", "available"],
    ["knowledge", "awaiting_integration"],
    ["microsoft", "awaiting_integration"],
    ["code", "available"],
  ]);
});

test("skills-mcp surface sits directly below Cowork in the rail", () => {
  const visible = visibleProductSurfaces(createSurfaceRegistry());
  assert.equal(visible[0]?.id, "cowork");
  assert.equal(visible[1]?.id, "skills-mcp");
  assert.equal(visible[1]?.label, "Skill & MCP");
  assert.equal(visible[1]?.icon, "skills");
});

test("onlyAvailable hides awaiting integration and planned slots for demo mode", () => {
  const visible = visibleProductSurfaces(createSurfaceRegistry(), { onlyAvailable: true });
  assert.deepEqual(visible.map((surface) => surface.id), [
    "cowork",
    "skills-mcp",
    "gateway",
    "code",
  ]);
});

test("external surfaces carry dependency-specific awaiting integration copy", () => {
  const visible = visibleProductSurfaces(createSurfaceRegistry());
  assert.equal(visible.find((surface) => surface.id === "dispatch")?.dependency, "D1");
  assert.equal(visible.find((surface) => surface.id === "microsoft")?.dependency, "D2");
  assert.equal(visible.find((surface) => surface.id === "knowledge")?.dependency, "D3");
  // Gateway keeps its D4 origin tag, but PR #16's backend is integrated so it is now `available`
  // and no longer carries "chưa được tích hợp" copy.
  const gateway = visible.find((surface) => surface.id === "gateway");
  assert.equal(gateway?.dependency, "D4");
  assert.equal(gateway?.availability, "available");
  assert.doesNotMatch(gateway?.description ?? "", /chưa được tích hợp/u);
});

test("integration adapters declare stable mount boundaries", () => {
  assert.equal(getIntegrationSurfaceAdapter("dispatch")?.statusLabel, "Chờ tích hợp D1");
  assert.equal(getIntegrationSurfaceAdapter("gateway")?.statusLabel, "Chờ tích hợp D4");
  assert.equal(getIntegrationSurfaceAdapter("knowledge")?.statusLabel, "Chờ tích hợp D3");
  assert.equal(getIntegrationSurfaceAdapter("microsoft")?.statusLabel, "Chờ tích hợp D2");
  assert.equal(getIntegrationSurfaceAdapter("code")?.statusLabel, "Đã lên kế hoạch");
  assert.equal(getIntegrationSurfaceAdapter("dispatch")?.mountId, "d1-dispatch-root");
  assert.equal(getIntegrationSurfaceAdapter("cowork"), null);
});

test("product rail renders seven surface buttons with mount-ready integration placeholders", () => {
  const root = document.createElement("main");
  const frame = createAppFrame(root);
  assert.equal(frame.surfaceButtons.size, 7);
  assert.ok(frame.surfaceButtons.has("dispatch"));
  assert.ok(frame.surfaceButtons.has("gateway"));
  assert.equal(frame.knowledgeView.root.id, "d3-knowledge-root");

  const dispatch = createSurfaceRegistry().find((surface) => surface.id === "dispatch")!;
  renderIntegrationSurface(frame.integrationSurface, dispatch);
  const mount = frame.integrationSurface.querySelector("#d1-dispatch-root");
  assert.ok(mount instanceof HTMLElement);
  assert.equal(mount.dataset["integrationComponent"], "DispatchIntegrationSlot");
  assert.match(mount.textContent ?? "", /Chờ tích hợp D1/u);
  assert.doesNotMatch(mount.textContent ?? "", /metric|bản ghi mẫu|fake/i);
});

test("D1-D4 integration slots are passive UI contracts", () => {
  const dispatch: DispatchTaskSummary = {
    id: "task-1",
    title: "Bounded task",
    state: "permission_wait",
    childTaskCount: 2,
    permissionWaitCount: 1,
    canCancel: true,
    provenance: [{ label: "User request", source: "conversation" }],
  };
  const microsoft: MicrosoftIntegrationView = {
    connectionState: "disconnected",
    services: [],
    scopes: [],
    actionHistory: [],
  };
  const knowledge: KnowledgeIntegrationView = {
    indexState: "not_indexed",
    sources: [],
    queryResults: [],
  };
  const gateway: GatewayIntegrationView = {
    health: "unknown",
    routes: [],
  };
  assert.equal(dispatch.state, "permission_wait");
  assert.equal(microsoft.connectionState, "disconnected");
  assert.equal(knowledge.indexState, "not_indexed");
  assert.equal(gateway.health, "unknown");
});

test("code surface is available and labelled Code (not Claude Code)", () => {
  const code = PRODUCT_SURFACES.find((s) => s.id === "code");
  assert.equal(code?.availability, "available");
  assert.equal(code?.label, "Code");
  assert.equal(code?.component, "ClaudeCodeSurface");
});

test("microsoft surface keeps awaiting_integration with its own view component", () => {
  const ms = PRODUCT_SURFACES.find((s) => s.id === "microsoft");
  assert.equal(ms?.availability, "awaiting_integration");
  assert.equal(ms?.component, "MicrosoftSurfaceView");
});
