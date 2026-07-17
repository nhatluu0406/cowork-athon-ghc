import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeTokenScopes } from "../src/ms365/token-scopes.js";

/** Build a fake JWT (header.payload.signature) with the given payload object. */
function fakeJwt(payload: Record<string, unknown>): string {
  const b64url = (obj: unknown): string =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64url({ alg: "none", typ: "JWT" })}.${b64url(payload)}.sig`;
}

test("decodes space-separated scp claim into a scope array", () => {
  const token = fakeJwt({ scp: "User.Read Sites.Read.All Files.ReadWrite.All" });
  assert.deepEqual(decodeTokenScopes(token), ["User.Read", "Sites.Read.All", "Files.ReadWrite.All"]);
});

test("merges roles (app permissions) when present", () => {
  const token = fakeJwt({ scp: "User.Read", roles: ["Sites.FullControl.All"] });
  assert.deepEqual(decodeTokenScopes(token), ["User.Read", "Sites.FullControl.All"]);
});

test("non-JWT input returns empty array (no throw)", () => {
  assert.deepEqual(decodeTokenScopes("not-a-jwt"), []);
  assert.deepEqual(decodeTokenScopes(""), []);
  assert.deepEqual(decodeTokenScopes("a.b"), []);
});

test("JWT without scp/roles returns empty array", () => {
  const token = fakeJwt({ aud: "https://graph.microsoft.com", sub: "abc" });
  assert.deepEqual(decodeTokenScopes(token), []);
});

test("malformed base64 payload returns empty array (no throw)", () => {
  assert.deepEqual(decodeTokenScopes("header.!!!not-base64!!!.sig"), []);
});
