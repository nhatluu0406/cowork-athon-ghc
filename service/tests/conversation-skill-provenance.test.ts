import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createConversationStore } from "../src/conversation/store.js";

test("conversation persists immutable Skill provenance without raw Skill content", async () => {
  const root = await mkdtemp(join(tmpdir(), "cghc-conv-skills-"));
  const store = createConversationStore({ rootDir: root });
  const conversation = await store.create({ workspacePath: "C:\\workspace" });
  await store.appendMessage(conversation.id, {
    role: "user",
    text: "Visible prompt",
    skills: [
      {
        id: "concise-notes",
        name: "Concise Notes",
        version: "1.0.0",
        source: "built_in",
        contentHash: "c".repeat(64),
        modifiedAt: "2026-07-12T00:00:00.000Z",
      },
    ],
  });
  const record = await store.get(conversation.id);
  assert.equal(record?.messages[0]?.skills?.[0]?.id, "concise-notes");
  const raw = await readFile(join(root, `${conversation.id}.json`), "utf8");
  assert.doesNotMatch(raw, /SKILL-CYAN-582|RAW-SKILL-CONTENT/u);
});
