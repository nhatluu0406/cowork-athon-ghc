/**
 * ADR 0010 — download source resolution tests. Fetch is faked; no real network call. Covers the
 * "fetch checksum fresh from vendor" contract and its failure modes (malformed/missing checksum).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolvePostgresArtifact,
  resolveNeo4jArtifact,
  resolveTemurinJreArtifact,
} from "../../src/knowledge/stack/sources.js";
import type { FetchLike } from "../../src/knowledge/stack/provisioning.js";

function textFetch(status: number, text: string): FetchLike {
  return async () => ({ ok: status >= 200 && status < 300, status, body: null, text: async () => text });
}

test("resolvePostgresArtifact: pinned URL, null checksum (no vendor hash exists)", () => {
  const artifact = resolvePostgresArtifact();
  assert.equal(artifact.name, "postgresql");
  assert.match(artifact.url, /^https:\/\/get\.enterprisedb\.com\/.*\.zip$/);
  assert.equal(artifact.expectedSha256, null);
});

test("resolveNeo4jArtifact: parses the sibling .sha256 file", async () => {
  const hash = "a".repeat(64);
  const artifact = await resolveNeo4jArtifact(textFetch(200, `${hash}  neo4j-community-x-windows.zip\n`));
  assert.equal(artifact.expectedSha256, hash);
  assert.match(artifact.url, /^https:\/\/dist\.neo4j\.org\/.*\.zip$/);
});

test("resolveNeo4jArtifact: throws when the checksum endpoint 404s", async () => {
  await assert.rejects(() => resolveNeo4jArtifact(textFetch(404, "")));
});

test("resolveNeo4jArtifact: throws on a malformed checksum body", async () => {
  await assert.rejects(() => resolveNeo4jArtifact(textFetch(200, "not-a-hash")));
});

test("resolveTemurinJreArtifact: parses binary.package.link/checksum from the Adoptium API shape", async () => {
  const hash = "b".repeat(64);
  const body = JSON.stringify([{ binary: { package: { link: "https://github.com/adoptium/x.zip", checksum: hash } } }]);
  const artifact = await resolveTemurinJreArtifact(textFetch(200, body));
  assert.equal(artifact.expectedSha256, hash);
  assert.equal(artifact.url, "https://github.com/adoptium/x.zip");
});

test("resolveTemurinJreArtifact: throws when the response has no binary.package", async () => {
  await assert.rejects(() => resolveTemurinJreArtifact(textFetch(200, "[]")));
});
