import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSurfaceRegistry,
  visibleProductSurfaces,
  type ProductSurfaceId,
} from "../src/surface-registry.js";
import type {
  DispatchTaskSummary,
  GatewayIntegrationView,
  KnowledgeIntegrationView,
  MicrosoftIntegrationView,
} from "../src/integration-slots.js";

test("surface registry declares the seven top-level product surfaces", () => {
  const registry = createSurfaceRegistry();
  const ids = registry.map((surface) => surface.id);
  assert.deepEqual(ids, [
    "cowork",
    "dispatch",
    "gateway",
    "knowledge",
    "knowledge-graph",
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

test("production default exposes only the available Cowork surface", () => {
  const visible = visibleProductSurfaces(createSurfaceRegistry());
  assert.deepEqual(visible.map((surface) => [surface.id, surface.availability]), [
    ["cowork", "available"],
  ]);
});

test("future surface reveal marks D1-D4 slots as coming later, not available", () => {
  const visible = visibleProductSurfaces(createSurfaceRegistry({ revealFutureSurfaces: true }));
  assert.equal(visible.find((surface) => surface.id === "cowork")?.availability, "available");
  for (const id of ["dispatch", "gateway", "knowledge", "knowledge-graph", "microsoft", "code"] as const) {
    assert.equal(visible.find((surface) => surface.id === id)?.availability, "coming_later");
  }
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
