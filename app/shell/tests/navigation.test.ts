/**
 * GATE 3 (2): `hardenWebContents` registers ALL FOUR navigation denials, denies an
 * off-origin attempt, and allows the legitimate app origin. Verified against a fake
 * WebContents so no real window is launched.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { WebContents } from "electron";

import { hardenWebContents } from "../src/security/navigation.js";
import { APP_ORIGIN } from "../src/security/app-protocol.js";

type Listener = (event: { preventDefault: () => void }, url: string) => void;

interface FakeContents {
  contents: WebContents;
  listeners: Map<string, Listener>;
  windowOpenHandler?: () => { action: string };
}

function makeFakeContents(): FakeContents {
  const listeners = new Map<string, Listener>();
  const fake: FakeContents = { listeners } as FakeContents;
  const contents = {
    on(event: string, listener: Listener) {
      listeners.set(event, listener);
      return contents;
    },
    setWindowOpenHandler(handler: () => { action: string }) {
      fake.windowOpenHandler = handler;
    },
  };
  fake.contents = contents as unknown as WebContents;
  return fake;
}

/** Fire a recorded listener with a fake event and return whether it was prevented. */
function fire(listeners: Map<string, Listener>, event: string, url: string): boolean {
  let prevented = false;
  const listener = listeners.get(event);
  assert.ok(listener, `listener for "${event}" must be registered`);
  listener({ preventDefault: () => (prevented = true) }, url);
  return prevented;
}

const OFF_ORIGIN = "https://evil.example.com/x";
const APP_URL = `${APP_ORIGIN}/some/route`;

test("all four navigation denials are registered", () => {
  const fake = makeFakeContents();
  hardenWebContents(fake.contents);

  assert.ok(fake.listeners.has("will-navigate"), "will-navigate must be registered");
  assert.ok(fake.listeners.has("will-redirect"), "will-redirect must be registered");
  assert.ok(fake.listeners.has("will-attach-webview"), "will-attach-webview must be registered");
  assert.ok(fake.windowOpenHandler, "setWindowOpenHandler must be registered");
});

test("will-navigate denies off-origin and allows the app origin", () => {
  const fake = makeFakeContents();
  hardenWebContents(fake.contents);

  assert.equal(fire(fake.listeners, "will-navigate", OFF_ORIGIN), true, "off-origin denied");
  assert.equal(fire(fake.listeners, "will-navigate", APP_URL), false, "app origin allowed");
  // A look-alike host on the same scheme is still denied.
  assert.equal(fire(fake.listeners, "will-navigate", "app://evil/x"), true, "look-alike denied");
});

test("will-redirect denies off-origin and allows the app origin", () => {
  const fake = makeFakeContents();
  hardenWebContents(fake.contents);

  assert.equal(fire(fake.listeners, "will-redirect", OFF_ORIGIN), true, "off-origin denied");
  assert.equal(fire(fake.listeners, "will-redirect", APP_URL), false, "app origin allowed");
});

test("setWindowOpenHandler always denies", () => {
  const fake = makeFakeContents();
  hardenWebContents(fake.contents);
  assert.deepEqual(fake.windowOpenHandler?.(), { action: "deny" });
});

test("will-attach-webview is always prevented", () => {
  const fake = makeFakeContents();
  hardenWebContents(fake.contents);
  // The webview URL is irrelevant — attachment is unconditionally denied.
  assert.equal(fire(fake.listeners, "will-attach-webview", APP_URL), true);
});
