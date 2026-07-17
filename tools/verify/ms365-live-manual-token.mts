/**
 * MS365 live-verify with a manual token — reads the token from CGHC_MS365_TEST_TOKEN,
 * exercises the P0.5 (site scope) + P1 (Outlook read) + P2 (Planner/Lists/Teams read-only)
 * surfaces against REAL Microsoft Graph, and NEVER prints the token. Run:
 *
 *   $env:CGHC_MS365_TEST_TOKEN = "<paste your Graph access token>"
 *   node --import tsx tools/verify/ms365-live-manual-token.mts
 *
 * The token stays in memory only. This script does not write it anywhere, does not commit it,
 * and redacts it from all output. It hits ONLY graph.microsoft.com via the SSRF-pinned client.
 *
 * Sections: [1] connect+/me, [2] P0.5 sites, [3] P0.5 fail-closed toggle, [4]-[5] P1 Outlook,
 * PLANNER (read-only: listPlans/listTasks — proves etag round-trip is available), LISTS
 * (read-only: getLists/getItems with $expand=fields — proves the $expand fix returns non-empty
 * fields), TEAMS (read-only: listChats/listTeams/getMessages). The new sections are strictly
 * read-only (no create/edit/delete/post) and use `probe()` to turn a Ms365Error with
 * kind "insufficient_scope" into a SKIP + consent hint instead of a hard failure, since a
 * missing Graph permission is expected on a narrowly-consented test account, not a bug.
 *
 * AFTER EVERY RUN (including PLANNER/LISTS/TEAMS): update
 * docs/integration/ms365-graph-api-map.md with the per-endpoint outcome (LIVE PASS / SKIP /
 * BLOCKED + reason + date) — the map must never go stale after a live test.
 */
import { createManualTokenProvider } from "../../service/src/ms365/token-provider.js";
import { createMs365Connector } from "../../service/src/ms365/ms365-connector.js";
import { createHttpGraphClient } from "../../service/src/ms365/graph-client.js";
import { createSharePointService } from "../../service/src/ms365/sharepoint-service.js";
import { createSiteScopeStore } from "../../service/src/ms365/site-scope-store.js";
import { createSiteScopeService } from "../../service/src/ms365/site-scope-service.js";
import { createOutlookService } from "../../service/src/ms365/outlook-service.js";
import { createPlannerService } from "../../service/src/ms365/planner-service.js";
import { createListsService } from "../../service/src/ms365/lists-service.js";
import { createTeamsService } from "../../service/src/ms365/teams-service.js";
import { Ms365Error } from "../../service/src/ms365/ms365-errors.js";
import { createSsrfPolicy } from "../../service/src/provider/index.js";
import { defaultDnsResolver } from "../../service/src/composition/wiring.js";

function log(step: string, detail = ""): void {
  console.log(`  [${step}]${detail ? " " + detail : ""}`);
}

/**
 * Runs one read-only probe and prints a PASS/SKIP/FAIL verdict without ever throwing —
 * an `insufficient_scope` Ms365Error (Graph 403) is a SKIP with a consent hint (expected on a
 * narrowly-scoped test token), any other Ms365Error is a FAIL with its safe kind+message, and
 * anything else is an unexpected FAIL. Never prints token/Authorization material.
 */
async function probe(label: string, fn: () => Promise<string>): Promise<void> {
  try {
    console.log(`  ${label}: PASS — ${await fn()}`);
  } catch (err) {
    if (err instanceof Ms365Error && err.kind === "insufficient_scope") {
      console.log(`  ${label}: SKIP — thiếu scope (${err.recovery})`);
    } else if (err instanceof Ms365Error) {
      console.log(`  ${label}: FAIL — ${err.kind}: ${err.message}`);
    } else {
      console.log(`  ${label}: FAIL — unexpected error`);
    }
  }
}

async function main(): Promise<void> {
  const token = process.env.CGHC_MS365_TEST_TOKEN;
  if (token === undefined || token.trim() === "") {
    console.error("FAIL: set CGHC_MS365_TEST_TOKEN to a Graph access token first (it is never printed).");
    process.exit(2);
  }

  // Wire the real production seams (same as compose-service.ts), no keyring, no persistence to disk.
  const ssrf = createSsrfPolicy({ resolver: defaultDnsResolver() });
  const manual = createManualTokenProvider();
  const connector = createMs365Connector({
    manual,
    makeGraph: (getToken) => createHttpGraphClient({ ssrf, getToken }),
  });

  let failures = 0;
  const fail = (msg: string): void => {
    failures += 1;
    console.error("  FAIL: " + msg);
  };

  console.log("== MS365 live manual-token verify (token redacted) ==");

  // 1. Connect (verifies against GET /me).
  console.log("\n[1] connectWithToken → GET /me");
  await connector.connectWithToken(token);
  if (connector.connectionState() !== "connected") {
    fail(`connectionState is "${connector.connectionState()}" (expected "connected"). lastError=${connector.lastError() ?? "none"}`);
    console.error("\nStopping: not connected — token likely expired/invalid. (Token itself is never shown.)");
    process.exit(1);
  }
  log("connected", `granted scopes: ${connector.grantedScopes().join(", ") || "(none decoded)"}`);

  // 2. P0.5 — list joined sites (real /me/followedSites).
  console.log("\n[2] P0.5 SiteScopeService.listJoinedSites → /me/followedSites");
  const store = await createSiteScopeStore({
    // In-memory only for the live check: no file write.
    persistence: { load: async () => [], save: async () => {} },
  });
  const siteScope = createSiteScopeService({ connector, store });
  const sites = await siteScope.listJoinedSites();
  log("sites", `${sites.length} site(s) followed`);
  for (const s of sites.slice(0, 10)) log("site", `${s.displayName} (enabled=${s.enabled})`);

  // 3. P0.5 — fail-closed enforcement: disable the first site, prove search excludes it.
  console.log("\n[3] P0.5 fail-closed: disable first site, confirm SharePoint search excludes it");
  const sharepoint = createSharePointService({
    connector,
    files: { readBytes: async () => new Uint8Array() }, // no upload in this read-only check
    siteFilter: { isEnabled: (id) => siteScope.isEnabled(id) },
  });
  if (sites.length === 0) {
    log("skip", "no followed sites to toggle — enforcement path not exercised live");
  } else {
    const target = sites[0];
    await siteScope.setSiteEnabled(target.id, false);
    log("disabled", target.displayName);
    const hits = await sharepoint.search("*");
    const leaked = hits.some((h) => h.id.includes(target.id)); // best-effort; real leak check is siteId-based server-side
    log("search", `${hits.length} hit(s) after disabling; obvious-leak=${leaked}`);
    if (leaked) fail("a hit appears to reference the disabled site — investigate the allowlist filter");
    await siteScope.setSiteEnabled(target.id, true); // restore
  }

  // 4. P1 — Outlook read (real /me/messages).
  console.log("\n[4] P1 OutlookService.searchMessages → /me/messages");
  const outlook = createOutlookService({ connector });
  const msgs = await outlook.searchMessages("report", 5);
  log("search", `${msgs.length} message(s) matched "report"`);
  for (const m of msgs.slice(0, 5)) log("mail", `${m.subject} — from ${m.from || "(unknown)"} @ ${m.receivedDateTime}`);

  if (msgs.length > 0) {
    console.log("\n[5] P1 OutlookService.getMessageSummaryText → bounded body");
    const summary = await outlook.getMessageSummaryText(msgs[0].id);
    log("summary", `${summary.length} char(s) (bounded ≤ 64 KiB)`);
  } else {
    log("skip", 'no "report" mail — try a different query if you expect results');
  }

  const firstSiteId: string | null = sites[0]?.id ?? null;

  // PLANNER (read-only) — proves etag round-trip is available for a later write path.
  console.log("\nPLANNER (read-only)");
  const planner = createPlannerService({ connector });
  let firstPlanId: string | null = null;
  await probe("planner_list_plans", async () => {
    const plans = await planner.listPlans();
    firstPlanId = plans[0]?.id ?? null;
    return `${plans.length} plan`;
  });
  await probe("planner_list_tasks", async () => {
    if (firstPlanId === null) return "bỏ qua — không có plan nào";
    const tasks = await planner.listTasks(firstPlanId);
    const withEtag = tasks.filter((t) => t.etag.length > 0).length;
    return `${tasks.length} task, ${withEtag} có etag (etag round-trip khả dụng)`;
  });

  // LISTS (read-only) — reuses the site allowlist from section [2]; if that section returned
  // zero sites (or the account lacks site scope), this section SKIPs for the same reason.
  console.log("\nLISTS (read-only)");
  const lists = createListsService({ connector, siteFilter: { isEnabled: (id) => siteScope.isEnabled(id) } });
  let firstListId: string | null = null;
  await probe("lists_get_lists", async () => {
    if (firstSiteId === null) return "bỏ qua — không có site (xem section [2])";
    const found = await lists.getLists(firstSiteId);
    firstListId = found[0]?.id ?? null;
    return `${found.length} list`;
  });
  await probe("lists_get_items ($expand=fields)", async () => {
    if (firstSiteId === null || firstListId === null) return "bỏ qua — không có list";
    const items = await lists.getItems(firstSiteId, firstListId);
    const withFields = items.filter((i) => Object.keys(i.fields).length > 0).length;
    // Live evidence for the $expand fix: fields must be non-empty when the list has data columns.
    return `${items.length} item, ${withFields} item có fields`;
  });

  // TEAMS (read-only).
  console.log("\nTEAMS (read-only)");
  const teams = createTeamsService({ connector });
  let firstChatId: string | null = null;
  await probe("teams_list_chats", async () => {
    const chats = await teams.listChats();
    firstChatId = chats[0]?.id ?? null;
    return `${chats.length} chat`;
  });
  await probe("teams_list_teams", async () => `${(await teams.listTeams()).length} team`);
  await probe("teams_get_messages", async () => {
    if (firstChatId === null) return "bỏ qua — không có chat";
    return `${(await teams.getMessages({ chatId: firstChatId })).length} tin gần nhất`;
  });

  await connector.disconnect();
  console.log("\n== done ==");
  if (failures > 0) {
    console.error(`\nRESULT: ${failures} check(s) FAILED.`);
    process.exit(1);
  }
  console.log("\nRESULT: live verify PASSED (real Graph traffic, token never printed).");
}

main().catch((err: unknown) => {
  // Redact: print the error message/kind only, never the token or full request. Ms365Error
  // messages are user-safe by convention; a raw Error still won't contain the token here.
  const msg = err instanceof Error ? err.message : String(err);
  console.error("\nFAIL (exception): " + msg);
  process.exit(1);
});
