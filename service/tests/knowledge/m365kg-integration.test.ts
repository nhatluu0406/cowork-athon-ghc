/**
 * REQ-205 Phase 3 (T3.1-T3.4) — the ONLY test file in this workspace that talks to the REAL
 * M365 Knowledge Graph stack: real PostgreSQL, real Neo4j, the real Go backend process, and the
 * real Rust llm-svc process (all started by `scripts/system-test/run.sh`). No fake server, no
 * mock, no proxy sits between the `KnowledgeSourceClient` under test and the real backend —
 * `createM365KgClient` here is the exact same production factory used by `service/src/knowledge`.
 *
 * Gated behind `M365KG_INTEGRATION_TESTS=1` (unset by default): every test is registered as
 * `{ skip: true }` when the flag is absent, so this file never runs — and never hangs waiting
 * for a stack that isn't there — as part of default `npm test` (tasks.md T3.1's "Done when").
 *
 * T3.3/T3.4 manipulate the REAL backend OS process directly (SIGSTOP/SIGCONT/SIGTERM via its PID,
 * written by run.sh to `M365KG_BACKEND_PID_FILE`) to produce a genuinely unreachable / genuinely
 * slow backend — not a simulated one.
 *
 * Neo4j is a real local `cypher-shell`/`neo4j` install (run.sh does not use Docker for
 * Postgres/Neo4j either) — `runCypher` below shells out to the real `cypher-shell` binary
 * directly, no `docker exec`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createM365KgClient } from "../../src/knowledge/m365kg-client.js";

const RUN = process.env.M365KG_INTEGRATION_TESTS === "1";

const BASE_URL = process.env.M365KG_BASE_URL ?? "http://localhost:8080";
const DEV_USERNAME = process.env.M365KG_DEV_USERNAME ?? "system-test";
const DEV_PASSWORD = process.env.M365KG_DEV_PASSWORD ?? "system-test-password";
const NEO4J_PASSWORD = process.env.M365KG_NEO4J_PASSWORD ?? "m365kg_dev_password";
const BACKEND_PID_FILE = process.env.M365KG_BACKEND_PID_FILE ?? "/tmp/m365kg-systest-backend.pid";

const PG_HOST = process.env.M365KG_PG_HOST ?? "localhost";
const PG_PORT = process.env.M365KG_PG_PORT ?? "5432";
const PG_USER = process.env.M365KG_PG_USER ?? "m365kg";
const PG_PASSWORD = process.env.M365KG_PG_PASSWORD ?? "m365kg_dev_password";
const PG_DB = process.env.M365KG_PG_DB ?? "m365kg";

const marker = `systest-${Date.now()}`;

function runCypher(cypher: string): void {
  const result = spawnSync(
    "cypher-shell",
    ["-a", "bolt://localhost:7687", "-u", "neo4j", "-p", NEO4J_PASSWORD],
    { input: cypher, encoding: "utf-8" },
  );
  if (result.status !== 0) {
    throw new Error(`cypher-shell failed (status ${result.status}): ${result.stderr}`);
  }
}

// Runs with `-t -A` (tuples-only, unaligned) so a single-column, single-row
// query (e.g. `RETURNING id`) yields just the value on its own line — but
// psql still emits a trailing command tag ("INSERT 0 1") on the next line
// even in tuples-only mode, so only the first line is the actual result.
function runPsql(sql: string): string {
  const result = spawnSync(
    "psql",
    ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DB, "-t", "-A", "-c", sql],
    { encoding: "utf-8", env: { ...process.env, PGPASSWORD: PG_PASSWORD } },
  );
  if (result.status !== 0) {
    throw new Error(`psql failed (status ${result.status}): ${result.stderr}`);
  }
  return (result.stdout.split("\n")[0] ?? "").trim();
}

function readBackendPid(): number {
  const raw = readFileSync(BACKEND_PID_FILE, "utf-8").trim();
  const pid = Number.parseInt(raw, 10);
  if (!Number.isFinite(pid)) throw new Error(`invalid backend PID in ${BACKEND_PID_FILE}: ${raw}`);
  return pid;
}

async function login(): Promise<string> {
  const res = await fetch(new URL("/api/auth/login", BASE_URL), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: DEV_USERNAME, password: DEV_PASSWORD }),
  });
  if (!res.ok) throw new Error(`real login failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isPortOpen(port: number): Promise<boolean> {
  try {
    const res = await fetch(new URL("/health", BASE_URL), { signal: AbortSignal.timeout(1000) });
    void port;
    return res.ok;
  } catch {
    return false;
  }
}

if (!RUN) {
  test("M365KG integration tests skipped (M365KG_INTEGRATION_TESTS unset)", { skip: true }, () => {});
} else {
  let token: string;

  test("setup: real login against the real backend", async () => {
    token = await login();
    assert.ok(token.length > 0, "expected a real, non-empty access token");
  });

  test("T3.1: checkHealth() against the real running backend reports connected", async () => {
    const client = createM365KgClient({ baseUrl: BASE_URL, getToken: async () => token });
    const status = await client.checkHealth();
    assert.equal(status, "connected");
  });

  test("T3.2: real query -> real Neo4j-seeded citation appears; getGraph() returns real nodes", async () => {
    const personName = `${marker}-Alice`;
    const projectName = `${marker}-ProjectX`;

    // Permission scoping is fail-closed (INVARIANT-1, handlers_graph.go): a
    // node is only visible to a user if its source_file_id is in that user's
    // permission_cache. Seed a real m365_files row + a permission_cache grant
    // for DEV_USERNAME, then stamp the same file_id onto the Neo4j fixture —
    // otherwise the (correct) deny-all-by-default behavior hides this test's
    // own fixture, independent of whether Neo4j has the data.
    const fileId = runPsql(
      `INSERT INTO m365_files (source_type, source_id, file_name, last_modified) ` +
        `VALUES ('systest', '${marker}', '${marker}.txt', now()) RETURNING id;`,
    );
    runPsql(
      `INSERT INTO permission_cache (user_id, file_id, permission) ` +
        `VALUES ('${DEV_USERNAME}', ${fileId}, 'read');`,
    );

    runCypher(`
      MERGE (p:Person {displayName: "${personName}"})
      SET p.source_file_id = ${fileId}
      MERGE (proj:Project {name: "${projectName}"})
      SET proj.source_file_id = ${fileId}
      MERGE (p)-[:OWNS]->(proj)
    `);
    try {
      const client = createM365KgClient({ baseUrl: BASE_URL, getToken: async () => token });

      const outcome = await client.query(`Who leads ${projectName}?`);
      assert.equal(outcome.outcome, "answered", `expected "answered", got ${JSON.stringify(outcome)}`);
      if (outcome.outcome === "answered") {
        assert.ok(outcome.answer.length > 0, "expected a non-empty real answer");
        assert.ok(
          outcome.citations.some((c) => c.displayName === projectName),
          `expected a real citation for ${projectName}, got ${JSON.stringify(outcome.citations)}`,
        );
      }

      const graph = await client.getGraph();
      assert.ok(graph.nodes.length > 0, "expected the real graph to return at least one node");
      assert.ok(
        graph.nodes.some((n) => n.label === projectName || n.label === personName),
        "expected the seeded node to be visible in the real graph nodes list",
      );
    } finally {
      runCypher(`
        MATCH (n) WHERE n.displayName = "${personName}" OR n.name = "${projectName}"
        DETACH DELETE n
      `);
      runPsql(`DELETE FROM permission_cache WHERE user_id = '${DEV_USERNAME}' AND file_id = ${fileId};`);
      runPsql(`DELETE FROM m365_files WHERE id = ${fileId};`);
    }
  });

  test(
    "T3.4: real backend paused past the 35s boundary -> clean timeout, no hang",
    { timeout: 50_000 },
    async () => {
      const pid = readBackendPid();
      const client = createM365KgClient({ baseUrl: BASE_URL, getToken: async () => token });

      const pending = client.query("this call will be starved by a real SIGSTOP");
      process.kill(pid, "SIGSTOP");
      try {
        await sleep(36_000); // > M365_KNOWLEDGE_QUERY_TIMEOUT_MS (35s)
      } finally {
        process.kill(pid, "SIGCONT");
      }

      const outcome = await pending;
      assert.equal(outcome.outcome, "timeout", `expected "timeout", got ${JSON.stringify(outcome)}`);

      // Prove the backend is genuinely back and serving after SIGCONT.
      assert.ok(await isPortOpen(8080), "expected the real backend to resume serving after SIGCONT");
    },
  );

  test("T3.3: real backend killed mid-session -> unavailable, no crash, no hang", async () => {
    const pid = readBackendPid();
    process.kill(pid, "SIGTERM");

    for (let i = 0; i < 30 && (await isPortOpen(8080)); i++) await sleep(500);
    assert.equal(await isPortOpen(8080), false, "expected the real backend port to actually close");

    const client = createM365KgClient({ baseUrl: BASE_URL, getToken: async () => token });
    const outcome = await client.query("is anyone still listening?");
    assert.equal(outcome.outcome, "unavailable", `expected "unavailable", got ${JSON.stringify(outcome)}`);
  });
}
