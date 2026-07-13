/**
 * SharePointService: the first concrete MS365 service on top of Ms365Connector. Search
 * (name+content via Graph search/query), list site files, bounded file-summary text, and
 * upload a workspace file. Does NOT do path confinement itself — `upload` delegates to the
 * injected `LocalFileReader`, which in production is backed by the workspace-guarded file
 * service so the workspace-boundary check stays in the one place it already lives.
 */
import type { Ms365Connector } from "./ms365-connector.js";

const DEFAULT_MAX_RESULTS = 25;
const DEFAULT_MAX_SUMMARY_BYTES = 65536; // 64 KiB, matching File Review.

export interface SharePointHit {
  id: string;
  name: string;
  webUrl: string;
}

export interface SharePointService {
  search(query: string, limit?: number): Promise<SharePointHit[]>;
  listSiteFiles(siteId: string): Promise<SharePointHit[]>;
  getFileSummaryText(driveItemId: string): Promise<string>;
  upload(input: { siteId: string; relativeLocalPath: string; targetName: string }): Promise<{
    id: string;
    webUrl: string;
  }>;
}

/** Workspace-confined local file reader port. Injected; a fake in tests. */
export interface LocalFileReader {
  readBytes(relativePath: string): Promise<Uint8Array>;
}

export interface SharePointServiceDeps {
  connector: Ms365Connector;
  files: LocalFileReader;
  maxResults?: number;
  maxSummaryBytes?: number;
}

/** Minimal shape we read from a Graph `/search/query` response, everything optional. */
interface SearchResource {
  id?: unknown;
  name?: unknown;
  webUrl?: unknown;
}
interface SearchHit {
  resource?: SearchResource;
}
interface SearchHitsContainer {
  hits?: SearchHit[];
}
interface SearchResultValue {
  hitsContainers?: SearchHitsContainer[];
}
interface SearchResponse {
  value?: SearchResultValue[];
}

/** Minimal shape of a Graph driveItem, as returned by children listing. */
interface DriveItem {
  id?: unknown;
  name?: unknown;
  webUrl?: unknown;
}
interface DriveChildrenResponse {
  value?: DriveItem[];
}

interface UploadResponse {
  id?: unknown;
  webUrl?: unknown;
}

function isSearchResponse(value: unknown): value is SearchResponse {
  return typeof value === "object" && value !== null;
}

function isDriveChildrenResponse(value: unknown): value is DriveChildrenResponse {
  return typeof value === "object" && value !== null;
}

function isUploadResponse(value: unknown): value is UploadResponse {
  return typeof value === "object" && value !== null;
}

function toHit(id: unknown, name: unknown, webUrl: unknown): SharePointHit | null {
  if (typeof id !== "string" || typeof name !== "string" || typeof webUrl !== "string") return null;
  return { id, name, webUrl };
}

/** Defensively flattens the nested search response shape into hits, dropping malformed entries. */
function flattenSearchHits(response: unknown): SharePointHit[] {
  if (!isSearchResponse(response)) return [];
  const hits: SharePointHit[] = [];
  for (const value of response.value ?? []) {
    for (const container of value.hitsContainers ?? []) {
      for (const hit of container.hits ?? []) {
        const resource = hit.resource;
        if (resource === undefined) continue;
        const mapped = toHit(resource.id, resource.name, resource.webUrl);
        if (mapped !== null) hits.push(mapped);
      }
    }
  }
  return hits;
}

function flattenDriveChildren(response: unknown): SharePointHit[] {
  if (!isDriveChildrenResponse(response)) return [];
  const hits: SharePointHit[] = [];
  for (const item of response.value ?? []) {
    const mapped = toHit(item.id, item.name, item.webUrl);
    if (mapped !== null) hits.push(mapped);
  }
  return hits;
}

export function createSharePointService(deps: SharePointServiceDeps): SharePointService {
  const maxResults = deps.maxResults ?? DEFAULT_MAX_RESULTS;
  const maxSummaryBytes = deps.maxSummaryBytes ?? DEFAULT_MAX_SUMMARY_BYTES;

  return {
    async search(query: string, limit?: number): Promise<SharePointHit[]> {
      const graph = deps.connector.graph();
      const response = await graph.json<unknown>({
        method: "POST",
        path: "/search/query",
        body: {
          requests: [
            {
              entityTypes: ["driveItem"],
              query: { queryString: query },
            },
          ],
        },
      });
      const hits = flattenSearchHits(response);
      return hits.slice(0, limit ?? maxResults);
    },

    async listSiteFiles(siteId: string): Promise<SharePointHit[]> {
      const graph = deps.connector.graph();
      const response = await graph.json<unknown>({
        method: "GET",
        path: `/sites/${encodeURIComponent(siteId)}/drive/root/children`,
      });
      return flattenDriveChildren(response).slice(0, maxResults);
    },

    async getFileSummaryText(driveItemId: string): Promise<string> {
      const graph = deps.connector.graph();
      const bytes = await graph.bytes({
        method: "GET",
        path: `/drive/items/${encodeURIComponent(driveItemId)}/content`,
      });
      const truncated = bytes.length > maxSummaryBytes ? bytes.slice(0, maxSummaryBytes) : bytes;
      return new TextDecoder("utf-8").decode(truncated);
    },

    async upload(input: {
      siteId: string;
      relativeLocalPath: string;
      targetName: string;
    }): Promise<{ id: string; webUrl: string }> {
      // Read the workspace-confined file FIRST — LocalFileReader owns the boundary check.
      const bytes = await deps.files.readBytes(input.relativeLocalPath);
      const graph = deps.connector.graph();
      const response = await graph.json<unknown>({
        method: "PUT",
        path: `/sites/${encodeURIComponent(input.siteId)}/drive/root:/${encodeURIComponent(input.targetName)}:/content`,
        bodyBytes: bytes,
      });
      if (!isUploadResponse(response) || typeof response.id !== "string" || typeof response.webUrl !== "string") {
        throw new Error("Microsoft Graph upload response missing id/webUrl.");
      }
      return { id: response.id, webUrl: response.webUrl };
    },
  };
}
