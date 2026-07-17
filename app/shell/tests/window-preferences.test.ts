/**
 * GATE 3 (3): the main-window `webPreferences` enforce the hardening baseline —
 * sandbox on, node integration off, context isolation on, web security on. Asserted on
 * the pure config object so no real BrowserWindow is constructed.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { buildMainWindowWebPreferences } from "../src/security/window-preferences.js";

test("webPreferences enforce the renderer sandbox baseline", () => {
  const prefs = buildMainWindowWebPreferences("/abs/preload.js");

  assert.equal(prefs.sandbox, true, "sandbox must be true");
  assert.equal(prefs.nodeIntegration, false, "nodeIntegration must be false");
  assert.equal(prefs.contextIsolation, true, "contextIsolation must be true");
  assert.equal(prefs.webSecurity, true, "webSecurity must be true (never disabled)");
});

test("webPreferences also close the adjacent node-integration escape hatches", () => {
  const prefs = buildMainWindowWebPreferences("/abs/preload.js");

  assert.equal(prefs.nodeIntegrationInWorker, false);
  assert.equal(prefs.nodeIntegrationInSubFrames, false);
  assert.equal(prefs.allowRunningInsecureContent, false);
  assert.equal(prefs.experimentalFeatures, false);
});

test("webPreferences enable the built-in PDF viewer plugin (packaged PDF preview)", () => {
  const prefs = buildMainWindowWebPreferences("/abs/preload.js");
  // Chromium's PDFium viewer is gated behind `plugins`; the blob: PDF iframe stays blank
  // in the packaged window without it. Hardening flags are unchanged (asserted above).
  assert.equal(prefs.plugins, true, "plugins must be true so PDF renders packaged");
  assert.equal(prefs.sandbox, true, "sandbox stays true even with plugins enabled");
});

test("webPreferences wire in the provided preload path", () => {
  const prefs = buildMainWindowWebPreferences("/abs/preload.js");
  assert.equal(prefs.preload, "/abs/preload.js");
});
