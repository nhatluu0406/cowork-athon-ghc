/**
 * Pinned download sources for the M365KG stack's bundled dependencies (ADR 0010). Each pin was
 * checked live against the real vendor endpoint while authoring this module (see ADR 0010
 * §Decision 1) — nothing here is a guessed URL.
 *
 * Neo4j and the Temurin JRE fetch their checksum FRESH from the vendor on every provision (never
 * hardcoded, so it can never go stale). PostgreSQL has no vendor checksum to fetch — see
 * {@link resolvePostgresArtifact}'s doc comment.
 */

import type { DownloadArtifact, FetchLike } from "./provisioning.js";

/** Bump this when moving to a newer Neo4j LTS; re-verify the Windows zip still exists at this URL. */
export const NEO4J_VERSION = "5.26.28";

/**
 * PostgreSQL 16.14 Windows x64 zip, resolved via EDB's `sbp.enterprisedb.com/getfile.jsp?fileid=…`
 * indirection (confirmed live: `curl -I` 302s to this exact URL, `content-type: application/zip`,
 * ~325MB). EDB does not publish a checksum for this artifact (checked directly, and via a
 * community install script that scrapes the same page rather than trusting a hash) — this pin is
 * a manually-updated constant (like `OPENCODE_PIN`), not scraped HTML, specifically so a bump
 * requires a deliberate code change + re-verification, not a runtime guess.
 */
const POSTGRES_ZIP_URL =
  "https://get.enterprisedb.com/postgresql/postgresql-16.14-2-windows-x64-binaries.zip";
export const POSTGRES_VERSION = "16.14";

export function resolvePostgresArtifact(): DownloadArtifact {
  return { name: "postgresql", url: POSTGRES_ZIP_URL, expectedSha256: null };
}

/** Fetch Neo4j's own sibling `.sha256` file fresh — never hardcode this value. */
export async function resolveNeo4jArtifact(fetchImpl: FetchLike): Promise<DownloadArtifact> {
  const url = `https://dist.neo4j.org/neo4j-community-${NEO4J_VERSION}-windows.zip`;
  const res = await fetchImpl(`${url}.sha256`);
  if (!res.ok) {
    throw new Error(`Could not fetch Neo4j's published checksum (${url}.sha256): HTTP ${res.status}`);
  }
  const expectedSha256 = (await res.text()).trim().split(/\s+/)[0];
  if (!expectedSha256 || !/^[0-9a-f]{64}$/i.test(expectedSha256)) {
    throw new Error(`Neo4j checksum file did not contain a SHA-256 hex digest: "${expectedSha256}"`);
  }
  return { name: "neo4j", url, expectedSha256 };
}

interface AdoptiumBinary {
  readonly package?: { readonly link?: unknown; readonly checksum?: unknown };
}
interface AdoptiumAsset {
  readonly binary?: AdoptiumBinary;
}

/**
 * Temurin JRE 21 (Neo4j 5.26.x's stated Windows requirement — corrected from an earlier draft
 * that assumed Java 17), resolved via Adoptium's versioned API, which returns the download URL
 * AND an inline SHA-256 in the same JSON response — no scraping, no second fetch.
 */
export async function resolveTemurinJreArtifact(fetchImpl: FetchLike): Promise<DownloadArtifact> {
  const apiUrl =
    "https://api.adoptium.net/v3/assets/latest/21/hotspot?image_type=jre&os=windows&architecture=x64";
  const res = await fetchImpl(apiUrl);
  if (!res.ok) throw new Error(`Adoptium API request failed: HTTP ${res.status}`);
  const assets = JSON.parse(await res.text()) as readonly AdoptiumAsset[];
  const first = assets[0];
  const link = first?.binary?.package?.link;
  const checksum = first?.binary?.package?.checksum;
  if (typeof link !== "string" || typeof checksum !== "string") {
    throw new Error("Adoptium API response did not contain the expected binary.package.link/checksum");
  }
  return { name: "temurin-jre-21", url: link, expectedSha256: checksum };
}
