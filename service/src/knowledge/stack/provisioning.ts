/**
 * M365KG stack provisioning (ADR 0010) — download, verify, and extract the portable Windows
 * binaries for PostgreSQL, Neo4j, and the Temurin JRE Neo4j needs. Runs once (first launch, or
 * whenever a component is missing); `stack-supervisor.ts` handles start/stop of already-provisioned
 * binaries on every subsequent run.
 *
 * Verified sources (see ADR 0010 §Decision 1 — checked live, not guessed):
 *  - Neo4j Community: `dist.neo4j.org/neo4j-community-<version>-windows.zip` + sibling
 *    `…zip.sha256` (fetched fresh every provision — never hardcoded, so it can't go stale).
 *  - Temurin JRE: Adoptium's `v3/assets/latest` API returns the download URL AND an inline
 *    SHA-256 in the same JSON response — no separate fetch, no scraping.
 *  - PostgreSQL: EnterpriseDB publishes **no** checksum for the Windows zip (verified by direct
 *    lookup — see ADR 0010). This artifact is HTTPS-transport-verified only; that is a real,
 *    disclosed gap versus the other two, not an oversight. `expectedSha256: null` marks this.
 *
 * Zip extraction shells out to Windows' built-in `Expand-Archive` (PowerShell) — no new npm
 * dependency, matches the project's existing PowerShell-probe convention (`probes.ts`). After
 * extraction, every produced path is re-confined under the destination dir (defense in depth
 * against zip-slip, even though `Expand-Archive` itself is not naively vulnerable to it).
 */

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, realpath, rename, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { pipeline } from "node:stream/promises";

export interface DownloadArtifact {
  readonly name: string;
  readonly url: string;
  /** `null` when the vendor publishes no checksum for this artifact (see PostgreSQL note above). */
  readonly expectedSha256: string | null;
}

export interface FetchLike {
  (url: string): Promise<{
    readonly ok: boolean;
    readonly status: number;
    readonly body: ReadableStream<Uint8Array> | null;
    text(): Promise<string>;
  }>;
}

export class ChecksumMismatchError extends Error {
  readonly code = "checksum_mismatch" as const;
  constructor(name: string, expected: string, actual: string) {
    super(`"${name}" downloaded content does not match the expected SHA-256 (expected ${expected}, got ${actual})`);
    this.name = "ChecksumMismatchError";
  }
}

export class DownloadFailedError extends Error {
  readonly code = "download_failed" as const;
  constructor(name: string, url: string, status: number) {
    super(`Failed to download "${name}" from ${url} (HTTP ${status})`);
    this.name = "DownloadFailedError";
  }
}

export class ExtractionEscapeError extends Error {
  readonly code = "extraction_escape" as const;
  constructor(destDir: string, escapedPath: string) {
    super(`Zip extraction into "${destDir}" produced a path outside it: "${escapedPath}"`);
    this.name = "ExtractionEscapeError";
  }
}

/** Compute the SHA-256 hex digest of a file on disk, streaming (never loads the whole file). */
export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

/**
 * Download `artifact.url` to `destPath` (via a `.part` temp file, renamed on success), then
 * verify against `expectedSha256` when the vendor provides one. Throws {@link DownloadFailedError}
 * / {@link ChecksumMismatchError} rather than leaving a partial or unverified file at `destPath`.
 */
export async function downloadAndVerify(
  artifact: DownloadArtifact,
  destPath: string,
  deps: { readonly fetchImpl: FetchLike; readonly log?: (line: string) => void },
): Promise<void> {
  const log = deps.log ?? (() => {});
  log(`provisioning: downloading ${artifact.name} from ${artifact.url}`);
  const res = await deps.fetchImpl(artifact.url);
  if (!res.ok || res.body === null) throw new DownloadFailedError(artifact.name, artifact.url, res.status);

  const tmpPath = `${destPath}.part`;
  await mkdir(path.dirname(destPath), { recursive: true });
  // Node's fetch Response.body is a web ReadableStream; Readable.fromWeb bridges it to a node stream.
  const { Readable } = await import("node:stream");
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmpPath));

  if (artifact.expectedSha256 !== null) {
    const actual = await sha256File(tmpPath);
    if (actual.toLowerCase() !== artifact.expectedSha256.toLowerCase()) {
      await rm(tmpPath, { force: true });
      throw new ChecksumMismatchError(artifact.name, artifact.expectedSha256, actual);
    }
    log(`provisioning: ${artifact.name} SHA-256 verified`);
  } else {
    log(`provisioning: ${artifact.name} has no vendor-published checksum — HTTPS transport trust only`);
  }

  await rename(tmpPath, destPath);
}

/** Recursively list every file under `dir` (absolute paths), used by the post-extraction check. */
async function listFilesRecursive(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFilesRecursive(full)));
    else files.push(full);
  }
  return files;
}

/**
 * Verify every file actually extracted into `destDir` resolves (via realpath, symlink-aware) to
 * somewhere still inside `destDir`. Defense in depth against zip-slip/symlink escape, even though
 * the extractor used (`Expand-Archive`) is not a naive/vulnerable implementation.
 */
export async function assertExtractionConfined(destDir: string): Promise<void> {
  const realDest = await realpath(destDir);
  const files = await listFilesRecursive(destDir);
  for (const file of files) {
    const real = await realpath(file);
    const relative = path.relative(realDest, real);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new ExtractionEscapeError(destDir, real);
    }
  }
}

export interface ZipExtractor {
  (zipPath: string, destDir: string): Promise<void>;
}

/** Production extractor: Windows' built-in `Expand-Archive` — no new npm dependency. */
export function powershellZipExtractor(): ZipExtractor {
  return (zipPath, destDir) =>
    new Promise((resolve, reject) => {
      // Escape single quotes by doubling them (PowerShell escape sequence).
      const escapedZip = zipPath.replace(/'/g, "''");
      const escapedDir = destDir.replace(/'/g, "''");
      const script = `Expand-Archive -LiteralPath '${escapedZip}' -DestinationPath '${escapedDir}' -Force`;
      execFile(
        "powershell",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { windowsHide: true, timeout: 5 * 60_000 },
        (err) => (err ? reject(err) : resolve()),
      );
    });
}

/** Extract `zipPath` into `destDir`, then re-confine every produced file under `destDir`. */
export async function extractAndConfine(
  zipPath: string,
  destDir: string,
  extractor: ZipExtractor,
): Promise<void> {
  await mkdir(destDir, { recursive: true });
  await extractor(zipPath, destDir);
  await assertExtractionConfined(destDir);
}

/** `true` when `dirPath` exists and is non-empty — used to skip re-provisioning. */
export async function isAlreadyProvisioned(dirPath: string): Promise<boolean> {
  try {
    const entries = await readdir(dirPath);
    return entries.length > 0;
  } catch {
    return false;
  }
}
