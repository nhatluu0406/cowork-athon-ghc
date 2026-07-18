/**
 * MCP panel tests (#28) — compact rows like the Skill list: external ON/OFF toggle, overflow menu
 * (edit/delete), health badge, tool count, built-in stdio preset combobox.
 */

import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mountMcpSettingsPanel, type McpServerView } from "../src/mcp-panel.js";

function server(over: Partial<McpServerView> = {}): McpServerView {
  return {
    id: "s1",
    name: "Filesystem",
    transport: "stdio",
    command: "npx -y @modelcontextprotocol/server-filesystem",
    hasHeaderSecret: false,
    enabled: false,
    health: "unknown",
    toolCount: 0,
    lastChecked: "2026-07-18T10:00:00.000Z",
    ...over,
  };
}

function host(): HTMLElement {
  const root = document.createElement("div");
  document.body.replaceChildren(root);
  return root;
}

test("renders a compact row with name, tool count, health badge, and an external toggle (#28)", async () => {
  const root = host();
  const handle = mountMcpSettingsPanel(root, {
    listMcpServers: async () => [server({ enabled: true, health: "ok", toolCount: 3 })],
  });
  await handle.refresh();
  const row = root.querySelector(".mcp-row");
  assert.ok(row, "row rendered");
  assert.equal(root.querySelector(".mcp-row__name")?.textContent, "Filesystem");
  assert.match(root.querySelector(".mcp-row__meta")?.textContent ?? "", /3 tool/);
  const badge = root.querySelector<HTMLElement>(".mcp-row__badge");
  assert.equal(badge?.textContent, "Sẵn sàng");
  assert.equal(badge?.dataset["tone"], "ok");
  const toggle = root.querySelector<HTMLButtonElement>(".mcp-row__toggle");
  assert.equal(toggle?.getAttribute("role"), "switch");
  assert.equal(toggle?.dataset["on"], "true");
});

test("the external toggle flips enable state via the backend (#28)", async () => {
  const root = host();
  const calls: Array<{ id: string; enabled: boolean }> = [];
  let enabled = false;
  const handle = mountMcpSettingsPanel(root, {
    listMcpServers: async () => [server({ enabled })],
    setMcpServerEnabled: async (id, next) => {
      calls.push({ id, enabled: next });
      enabled = next;
      return server({ enabled: next });
    },
  });
  await handle.refresh();
  root.querySelector<HTMLButtonElement>(".mcp-row__toggle")?.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls, [{ id: "s1", enabled: true }]);
});

test("overflow menu offers Sửa / Kiểm tra / Xóa; delete calls the backend (#28)", async () => {
  const root = host();
  const deleted: string[] = [];
  const originalConfirm = window.confirm;
  window.confirm = () => true;
  try {
    const handle = mountMcpSettingsPanel(root, {
      listMcpServers: async () => [server()],
      deleteMcpServer: async (id) => {
        deleted.push(id);
      },
      checkMcpServerHealth: async () => server({ health: "ok" }),
    });
    await handle.refresh();
    root.querySelector<HTMLButtonElement>(".mcp-row__menu-btn")?.click();
    const items = [...document.querySelectorAll<HTMLButtonElement>(".mcp-row__menu-item")].map(
      (b) => b.textContent,
    );
    assert.deepEqual(items, ["Sửa", "Kiểm tra", "Xóa"]);
    [...document.querySelectorAll<HTMLButtonElement>(".mcp-row__menu-item")]
      .find((b) => b.textContent === "Xóa")
      ?.click();
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(deleted, ["s1"]);
  } finally {
    window.confirm = originalConfirm;
  }
});

test("built-in stdio preset combobox fills the command field (#28)", async () => {
  const root = host();
  const handle = mountMcpSettingsPanel(root, { listMcpServers: async () => [] });
  await handle.refresh();
  root.querySelector<HTMLButtonElement>(".mcp-panel__add")?.click();
  const preset = root.querySelector<HTMLSelectElement>('select[aria-label="Máy chủ MCP dựng sẵn"]');
  assert.ok(preset, "preset combobox present");
  assert.ok(preset.options.length > 1, "has preset options");
  preset.value = "git";
  preset.dispatchEvent(new Event("change"));
  const command = root.querySelector<HTMLInputElement>('input[aria-label="Lệnh khởi động MCP"]');
  assert.match(command?.value ?? "", /server-git/);
});
