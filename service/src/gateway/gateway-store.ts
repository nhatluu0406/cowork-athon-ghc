import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { GatewayAccount } from "./types.js";

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
  flush(): Promise<void>;
}

interface GatewayData {
  readonly accounts: GatewayAccount[];
  readonly activeByProvider: Record<string, string>;
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
    return { accounts: [], activeByProvider: {} };
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
      };
    }
  } catch {
    // Corrupt file: recover to empty state.
  }
  return { accounts: [], activeByProvider: {} };
}

export function createGatewayStore(fs: GatewayStoreFs): GatewayStore {
  let accounts: GatewayAccount[] = [];
  let activeByProvider: Record<string, string> = {};
  let loaded = false;

  function ensureLoaded(): void {
    // Synchronous access after async init; the store must be pre-loaded via loadInitial().
    if (!loaded) {
      loaded = true;
    }
  }

  // Load initial state synchronously from the parsed data.
  function init(data: GatewayData): void {
    accounts = [...data.accounts];
    activeByProvider = { ...data.activeByProvider };
    loaded = true;
  }

  const store: GatewayStore = {
    listAccounts(): readonly GatewayAccount[] {
      ensureLoaded();
      return accounts;
    },

    saveAccount(a: GatewayAccount): void {
      ensureLoaded();
      const idx = accounts.findIndex((x) => x.id === a.id);
      if (idx >= 0) {
        accounts[idx] = a;
      } else {
        accounts.push(a);
      }
    },

    deleteAccount(id: string): void {
      ensureLoaded();
      accounts = accounts.filter((x) => x.id !== id);
      // Clean up active mapping.
      for (const [pid, aid] of Object.entries(activeByProvider)) {
        if (aid === id) {
          delete activeByProvider[pid];
        }
      }
    },

    setActiveAccount(providerId: string, accountId: string): void {
      ensureLoaded();
      activeByProvider[providerId] = accountId;
    },

    getActiveAccountId(providerId: string): string | undefined {
      ensureLoaded();
      return activeByProvider[providerId];
    },

    async flush(): Promise<void> {
      const data: GatewayData = { accounts, activeByProvider };
      await fs.write(JSON.stringify(data, null, 2));
    },
  };

  // Return an object that carries the init function for the factory.
  (store as unknown as { _init: (d: GatewayData) => void })._init = init;
  return store;
}

/**
 * Build a {@link GatewayStore} fully loaded from disk. The async step is necessary so the
 * store is ready before any service method is called.
 */
export async function openGatewayStore(fs: GatewayStoreFs): Promise<GatewayStore> {
  const raw = await fs.read();
  const data = parseGatewayData(raw);
  const store = createGatewayStore(fs);
  (store as unknown as { _init: (d: GatewayData) => void })._init(data);
  return store;
}

/** Build the Node filesystem seam for the gateway store, writing to `<dataDir>/gateway.json`. */
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
      await rename(tmpPath, filePath);
    },
  };
}
