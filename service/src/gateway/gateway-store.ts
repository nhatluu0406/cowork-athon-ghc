import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { GatewayAccount, GatewayRequestLogEntry } from "./types.js";
import { DEFAULT_GATEWAY_PROXY_PORT } from "./gateway-proxy-url.js";

/** Oldest entries beyond this count are dropped on write — a bounded local log, not a database. */
const MAX_LOG_ENTRIES = 200;

/** Entries older than this are dropped regardless of count — the short-term retention policy. */
const LOG_RETENTION_DAYS = 30;
const LOG_RETENTION_MS = LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;

function withinRetention(entry: GatewayRequestLogEntry, nowMs: number): boolean {
  const at = Date.parse(entry.at);
  if (Number.isNaN(at)) return true; // keep anything with an unparsable timestamp, don't guess
  return nowMs - at <= LOG_RETENTION_MS;
}

export interface GatewayStoreFs {
  read(): Promise<string | undefined>;
  write(data: string): Promise<void>;
}

export interface GatewayStore {
  listAccounts(): readonly GatewayAccount[];
  saveAccount(a: GatewayAccount): void;
  deleteAccount(id: string): void;
  setActiveAccount(providerId: string, accountId: string): void;
  getActiveAccountId(providerId: string): string | undefined;
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  /** Newest-first. */
  listLogs(): readonly GatewayRequestLogEntry[];
  appendLog(entry: GatewayRequestLogEntry): void;
  /**
   * User-configured Gateway proxy port (host stays the fixed loopback constant — never
   * user-editable, see `gateway-proxy-url.ts`). `undefined` means "never configured, use the
   * default." Takes effect on the NEXT bind (composition reads this once at construction).
   */
  getServerPort(): number | undefined;
  setServerPort(port: number): void;
  flush(): Promise<void>;
  /**
   * Re-read `gateway.json` from disk and replace in-memory state with it. The Tier 1
   * (settings-only) and Tier 2 (live) compositions each construct their OWN `GatewayStore`
   * instance — a chat send routes through whichever is live and writes there, but the
   * renderer's next status/log fetch may still land on the OTHER instance's stale in-memory
   * copy. Call this before any read the UI depends on being current.
   */
  reload(): Promise<void>;
}

interface GatewayData {
  readonly accounts: GatewayAccount[];
  readonly activeByProvider: Record<string, string>;
  readonly enabled: boolean;
  readonly logs: GatewayRequestLogEntry[];
  readonly serverPort?: number;
}

/** A valid, non-privileged TCP port for the Gateway proxy to bind. */
function isValidServerPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1024 && value <= 65535;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function parseGatewayData(raw: string | undefined): GatewayData {
  if (raw === undefined) {
    return { accounts: [], activeByProvider: {}, enabled: false, logs: [] };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      Array.isArray((parsed as GatewayData).accounts)
    ) {
      const data = parsed as GatewayData;
      return {
        accounts: data.accounts ?? [],
        activeByProvider: data.activeByProvider ?? {},
        // Default OFF: the gateway must be explicitly opted into.
        enabled: data.enabled === true,
        logs: Array.isArray(data.logs) ? data.logs : [],
        ...(isValidServerPort(data.serverPort) ? { serverPort: data.serverPort } : {}),
      };
    }
  } catch {
    // Corrupt file: recover to empty state.
  }
  return { accounts: [], activeByProvider: {}, enabled: false, logs: [] };
}

/**
 * Build a {@link GatewayStore} already loaded from `data` — never a two-step "construct empty,
 * then inject state" dance. The only caller is {@link openGatewayStore}, which reads the file
 * first; there is no scenario where a store needs to exist before its initial state is known.
 */
function createGatewayStore(fs: GatewayStoreFs, data: GatewayData): GatewayStore {
  let accounts: GatewayAccount[] = [...data.accounts];
  let activeByProvider: Record<string, string> = { ...data.activeByProvider };
  let enabled = data.enabled;
  let logs: GatewayRequestLogEntry[] = [...data.logs];
  let serverPort: number | undefined = data.serverPort;

  return {
    listAccounts(): readonly GatewayAccount[] {
      return accounts;
    },

    saveAccount(a: GatewayAccount): void {
      const idx = accounts.findIndex((x) => x.id === a.id);
      if (idx >= 0) {
        accounts[idx] = a;
      } else {
        accounts.push(a);
      }
    },

    deleteAccount(id: string): void {
      accounts = accounts.filter((x) => x.id !== id);
      // Clean up active mapping.
      for (const [pid, aid] of Object.entries(activeByProvider)) {
        if (aid === id) {
          delete activeByProvider[pid];
        }
      }
    },

    setActiveAccount(providerId: string, accountId: string): void {
      activeByProvider[providerId] = accountId;
    },

    getActiveAccountId(providerId: string): string | undefined {
      return activeByProvider[providerId];
    },

    isEnabled(): boolean {
      return enabled;
    },

    setEnabled(next: boolean): void {
      enabled = next;
    },

    listLogs(): readonly GatewayRequestLogEntry[] {
      // Newest first for display; stored oldest-first internally (append order).
      return [...logs].reverse();
    },

    appendLog(entry: GatewayRequestLogEntry): void {
      logs.push(entry);
      const nowMs = Date.now();
      logs = logs.filter((e) => withinRetention(e, nowMs));
      if (logs.length > MAX_LOG_ENTRIES) {
        logs = logs.slice(logs.length - MAX_LOG_ENTRIES);
      }
    },

    getServerPort(): number | undefined {
      return serverPort;
    },

    setServerPort(port: number): void {
      if (!isValidServerPort(port)) {
        throw new Error(`Invalid Gateway server port: ${JSON.stringify(port)} (must be 1024-65535).`);
      }
      serverPort = port;
    },

    async flush(): Promise<void> {
      const next: GatewayData = {
        accounts,
        activeByProvider,
        enabled,
        logs,
        ...(serverPort !== undefined ? { serverPort } : {}),
      };
      await fs.write(JSON.stringify(next, null, 2));
    },

    async reload(): Promise<void> {
      const raw = await fs.read();
      const fresh = parseGatewayData(raw);
      accounts = [...fresh.accounts];
      activeByProvider = { ...fresh.activeByProvider };
      enabled = fresh.enabled;
      logs = [...fresh.logs];
      serverPort = fresh.serverPort;
    },
  };
}

/** Build a {@link GatewayStore} fully loaded from disk before any service method is called. */
export async function openGatewayStore(fs: GatewayStoreFs): Promise<GatewayStore> {
  const raw = await fs.read();
  const data = parseGatewayData(raw);
  return createGatewayStore(fs, data);
}

/**
 * Peek the persisted Gateway proxy port WITHOUT constructing a full store (no in-memory
 * mutation, no lock on the file for a write later). The shell reads this once at launch — before
 * `createCoworkService` composes anything — to decide the fixed port it binds this session,
 * so a value the user saved in a PRIOR session actually takes effect on the next restart.
 */
export async function readGatewayServerPort(fs: GatewayStoreFs): Promise<number> {
  const raw = await fs.read();
  const data = parseGatewayData(raw);
  return data.serverPort ?? DEFAULT_GATEWAY_PROXY_PORT;
}

/** Build the Node filesystem seam for the gateway store, writing to `<dataDir>/gateway.json`. */
/** True for the transient Windows rename-over-open-handle error (never on POSIX). */
function isWindowsRenameRace(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "EPERM" || code === "EBUSY";
}

const RENAME_RETRY_ATTEMPTS = 5;
const RENAME_RETRY_DELAY_MS = 20;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Rename with a few short retries. Windows refuses to replace a file that another handle has
 * open for reading at that exact instant (`EPERM`/`EBUSY`) — POSIX allows this unconditionally,
 * so the failure is Windows-only and self-resolves within a handful of milliseconds once the
 * concurrent reader (e.g. a status/log poll reading `gateway.json` while a request just got
 * logged) releases its handle. Retrying a few times is simpler and safer than coordinating every
 * reader/writer of this file with an explicit lock.
 */
async function renameWithRetry(tmpPath: string, filePath: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(tmpPath, filePath);
      return;
    } catch (error) {
      if (!isWindowsRenameRace(error) || attempt >= RENAME_RETRY_ATTEMPTS) throw error;
      await sleep(RENAME_RETRY_DELAY_MS);
    }
  }
}

export function createNodeGatewayStoreFs(dataDir: string): GatewayStoreFs {
  const filePath = `${dataDir}/gateway.json`;
  const tmpPath = `${filePath}.tmp`;
  return {
    async read(): Promise<string | undefined> {
      try {
        return await readFile(filePath, "utf8");
      } catch (error) {
        if (isNotFound(error)) return undefined;
        throw error;
      }
    },
    async write(data: string): Promise<void> {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(tmpPath, data, "utf8");
      await renameWithRetry(tmpPath, filePath);
    },
  };
}
