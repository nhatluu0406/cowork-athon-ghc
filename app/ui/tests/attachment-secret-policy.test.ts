/**
 * Secret-like attachment path policy tests (UI mirror).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { isSecretLikeAttachmentPath } from "../src/attachment-secret-policy.js";

test("blocks secret-like paths consistently with service policy", () => {
  assert.equal(isSecretLikeAttachmentPath(".env"), true);
  assert.equal(isSecretLikeAttachmentPath("test.pem"), true);
  assert.equal(isSecretLikeAttachmentPath("credentials.json"), true);
  assert.equal(isSecretLikeAttachmentPath(".gitignore"), false);
});
