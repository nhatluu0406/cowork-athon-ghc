import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyMention,
  buildMentionIndex,
  filterMentionCandidates,
  findMentionToken,
  MENTION_INDEX_MAX_FILES,
} from "../src/mention-typeahead.js";

test("findMentionToken detects @ at start and after whitespace only", () => {
  assert.deepEqual(findMentionToken("@rea", 4), { start: 0, fragment: "rea" });
  assert.deepEqual(findMentionToken("sửa @doc", 8), { start: 4, fragment: "doc" });
  assert.equal(findMentionToken("user@host", 9), null);
  assert.equal(findMentionToken("không có mention", 10), null);
  assert.equal(findMentionToken("@a b", 4), null);
});

test("findMentionToken only tracks the token containing the caret", () => {
  const text = "@one xong @two";
  assert.deepEqual(findMentionToken(text, 14), { start: 10, fragment: "two" });
  assert.deepEqual(findMentionToken(text, 4), { start: 0, fragment: "one" });
  assert.equal(findMentionToken(text, 8), null);
});

test("filterMentionCandidates ranks basename prefix over path hits", () => {
  const paths = [
    "docs/guide-readme.md",
    "README.md",
    "src/unrelated.ts",
  ];
  // README.md's basename starts with "rea" (score 0); guide-readme.md only contains it in the
  // basename (score 2); unrelated.ts has no hit and is dropped.
  const result = filterMentionCandidates(paths, "rea");
  assert.deepEqual(result, ["README.md", "docs/guide-readme.md"]);
  assert.deepEqual(filterMentionCandidates(paths, ""), paths);
  assert.deepEqual(filterMentionCandidates(paths, "zzz"), []);
});

test("applyMention replaces the token and places the caret after the space", () => {
  const text = "sửa @rea giúp tôi";
  const token = { start: 4, fragment: "rea" };
  const applied = applyMention(text, token, 8, "README.md");
  assert.equal(applied.text, "sửa @README.md  giúp tôi");
  assert.equal(applied.caret, "sửa @README.md ".length);
});

test("buildMentionIndex walks folders breadth-first with bounded depth and skips junk dirs", async () => {
  const listings = new Map<string, { name: string; relativePath: string; kind: "file" | "folder" }[]>([
    ["", [
      { name: "a.txt", relativePath: "a.txt", kind: "file" },
      { name: "node_modules", relativePath: "node_modules", kind: "folder" },
      { name: "src", relativePath: "src", kind: "folder" },
    ]],
    ["src", [
      { name: "b.ts", relativePath: "src/b.ts", kind: "file" },
      { name: "deep", relativePath: "src/deep", kind: "folder" },
    ]],
    ["src/deep", [
      { name: "c.ts", relativePath: "src/deep/c.ts", kind: "file" },
      { name: "deeper", relativePath: "src/deep/deeper", kind: "folder" },
    ]],
    ["src/deep/deeper", [
      { name: "d.ts", relativePath: "src/deep/deeper/d.ts", kind: "file" },
      { name: "past-depth", relativePath: "src/deep/deeper/past-depth", kind: "folder" },
    ]],
  ]);
  const requested: string[] = [];
  const files = await buildMentionIndex({
    listWorkspaceChildren: async (relativePath = "") => {
      requested.push(relativePath);
      return { entries: listings.get(relativePath) ?? [] };
    },
  });
  assert.deepEqual(files, ["a.txt", "src/b.ts", "src/deep/c.ts", "src/deep/deeper/d.ts"]);
  assert.ok(!requested.includes("node_modules"));
  assert.ok(!requested.includes("src/deep/deeper/past-depth"));
});

test("buildMentionIndex caps the file count", async () => {
  const many = Array.from({ length: MENTION_INDEX_MAX_FILES + 50 }, (_, i) => ({
    name: `f${i}.txt`,
    relativePath: `f${i}.txt`,
    kind: "file" as const,
  }));
  const files = await buildMentionIndex({
    listWorkspaceChildren: async () => ({ entries: many }),
  });
  assert.equal(files.length, MENTION_INDEX_MAX_FILES);
});

test("a rebuild reflects newly added files (issue #24 — @ cache invalidation)", async () => {
  // The typeahead caches the file index; invalidate() drops it so the NEXT scan rebuilds. Prove the
  // rebuild actually surfaces a file added after the first scan (the reported bug: added file, but
  // `@` still didn't list it).
  let current = ["a.md"];
  const source = {
    listWorkspaceChildren: async () => ({
      entries: current.map((relativePath) => ({
        name: relativePath,
        relativePath,
        kind: "file" as const,
      })),
    }),
  };
  const first = await buildMentionIndex(source);
  assert.deepEqual([...first], ["a.md"]);
  current = ["a.md", "notes/new.md"]; // user adds a file into the same workspace
  const rebuilt = await buildMentionIndex(source);
  assert.deepEqual([...rebuilt].sort(), ["a.md", "notes/new.md"]);
});
