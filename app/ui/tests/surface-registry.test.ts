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

test("surface registry declares the six top-level product surfaces", () => {
  const registry = createSurfaceRegistry();
  const ids = registry.map((surface) => surface.id);
  assert.deepEqual(ids, [
    "cowork",
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

test("production default exposes product rail surfaces with honest availability", () => {
  const visible = visibleProductSurfaces(createSurfaceRegistry());
  assert.deepEqual(visible.map((surface) => [surface.id, surface.availability]), [
    ["cowork", "available"],
    ["dispatch", "awaiting_integration"],
    ["gateway", "awaiting_integration"],
    ["knowledge", "awaiting_integration"],
    ["microsoft", "awaiting_integration"],
    ["code", "available"],
  ]);
});

test("external surfaces carry dependency-specific awaiting integration copy", () => {
  const visible = visibleProductSurfaces(createSurfaceRegistry());
  assert.equal(visible.find((surface) => surface.id === "dispatch")?.dependency, "D1");
  assert.equal(visible.find((surface) => surface.id === "microsoft")?.dependency, "D2");
  assert.equal(visible.find((surface) => surface.id === "knowledge")?.dependency, "D3");
  assert.equal(visible.find((surface) => surface.id === "gateway")?.dependency, "D4");
  assert.match(visible.find((surface) => surface.id === "gateway")?.description ?? "", /Backend Gateway chưa được merge/u);
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

test("code surface is available as Claude Code", () => {
  const code = PRODUCT_SURFACES.find((s) => s.id === "code");
  assert.equal(code?.availability, "available");
  assert.equal(code?.label, "Claude Code");
  assert.equal(code?.component, "ClaudeCodeSurface");
});

test("microsoft surface keeps awaiting_integration with its own view component", () => {
  const ms = PRODUCT_SURFACES.find((s) => s.id === "microsoft");
  assert.equal(ms?.availability, "awaiting_integration");
  assert.equal(ms?.component, "MicrosoftSurfaceView");
});
