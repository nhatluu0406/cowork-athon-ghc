/**
 * Secret-like attachment path policy tests.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { isSecretLikeAttachmentPath } from "../src/workspace/attachment-secret-policy.js";

test("blocks .env and .env.*", () => {
  assert.equal(isSecretLikeAttachmentPath(".env"), true);
  assert.equal(isSecretLikeAttachmentPath("config/.env"), true);
  assert.equal(isSecretLikeAttachmentPath(".env.local"), true);
  assert.equal(isSecretLikeAttachmentPath("secrets/.env.production"), true);
});

test("blocks pem, key, and ssh key basenames", () => {
  assert.equal(isSecretLikeAttachmentPath("certs/test.pem"), true);
  assert.equal(isSecretLikeAttachmentPath("test.key"), true);
  assert.equal(isSecretLikeAttachmentPath("id_rsa"), true);
  assert.equal(isSecretLikeAttachmentPath("id_ed25519"), true);
});

test("blocks credential-like filenames", () => {
  assert.equal(isSecretLikeAttachmentPath("credentials.json"), true);
  assert.equal(isSecretLikeAttachmentPath("keys/service-account-prod.json"), true);
  assert.equal(isSecretLikeAttachmentPath(".npmrc"), true);
  assert.equal(isSecretLikeAttachmentPath(".pypirc"), true);
});

test("allows ordinary text files including .gitignore", () => {
  assert.equal(isSecretLikeAttachmentPath(".gitignore"), false);
  assert.equal(isSecretLikeAttachmentPath("src/app.ts"), false);
  assert.equal(isSecretLikeAttachmentPath("notes.txt"), false);
});
