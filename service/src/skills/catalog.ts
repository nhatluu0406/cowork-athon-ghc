/**
 * Deterministic, bounded filesystem discovery for local instruction-only Skills.
 */

import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { isInsideRoot } from "../workspace/path-safety.js";
import type {
  EnabledSkillSnapshot,
  SkillCatalog,
  SkillRoot,
  SkillSource,
  SkillUseMetadata,
  SkillView,
} from "./types.js";

export const SKILL_FILE_NAME = "SKILL.md";
export const SKILL_MAX_COUNT = 64;
export const SKILL_MAX_FILE_BYTES = 32 * 1024;
export const SKILL_PREVIEW_CHARS = 6_000;
export const SKILL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/u;
const INTERNAL_MARKER = /<<<(?:END_)?CGHC_/u;

interface ParsedSkill {
  readonly view: SkillView;
  readonly content?: string;
}

interface RegistryFile {
  readonly version: 1;
  readonly enabledIds: readonly string[];
}

export interface SkillCatalogOptions {
  readonly roots: readonly SkillRoot[];
  readonly stateFilePath: string;
}

function invalidView(
  source: SkillSource,
  folder: string,
  reason: string,
  fields: Partial<Pick<SkillView, "id" | "name" | "description" | "version">> = {},
): SkillView {
  return {
    id: fields.id ?? `invalid.${source}.${folder.toLowerCase().replace(/[^a-z0-9._-]+/gu, "-")}`,
    name: fields.name ?? folder,
    description: fields.description ?? "Skill không hợp lệ.",
    version: fields.version ?? "unknown",
    source,
    status: "invalid",
    validationStatus: "invalid",
    invalidReason: reason,
  };
}

function parseFrontmatter(text: string): {
  readonly metadata: Readonly<Record<string, string>>;
  readonly body: string;
} {
  const normalized = text.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n");
  if (!normalized.startsWith("---\n")) throw new Error("Thiếu YAML frontmatter mở đầu.");
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) throw new Error("Thiếu YAML frontmatter kết thúc.");
  const metadata: Record<string, string> = {};
  for (const rawLine of normalized.slice(4, end).split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) throw new Error(`Metadata không hợp lệ: ${line}`);
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (metadata[key] !== undefined) throw new Error(`Metadata trùng lặp: ${key}`);
    metadata[key] = value;
  }
  return { metadata, body: normalized.slice(end + 5).trim() };
}

async function readRegistry(path: string): Promise<Set<string>> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as RegistryFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.enabledIds)) return new Set();
    return new Set(parsed.enabledIds.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

async function writeRegistry(path: string, enabledIds: ReadonlySet<string>): Promise<void> {
  await mkdir(resolve(path, ".."), { recursive: true });
  const temp = `${path}.tmp`;
  const payload: RegistryFile = { version: 1, enabledIds: [...enabledIds].sort() };
  await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(temp, path);
}

async function parseSkill(
  rootReal: string,
  folderPath: string,
  source: SkillSource,
): Promise<ParsedSkill> {
  const folder = basename(folderPath);
  try {
    const folderStat = await lstat(folderPath);
    if (folderStat.isSymbolicLink()) {
      return { view: invalidView(source, folder, "Symlink/reparse Skill không được hỗ trợ.") };
    }
    if (!folderStat.isDirectory()) {
      return { view: invalidView(source, folder, "Mỗi Skill phải là một thư mục.") };
    }
    const filePath = join(folderPath, SKILL_FILE_NAME);
    const fileStat = await lstat(filePath);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      return { view: invalidView(source, folder, "SKILL.md phải là regular file.") };
    }
    const fileReal = await realpath(filePath);
    if (!isInsideRoot(rootReal, fileReal)) {
      return { view: invalidView(source, folder, "SKILL.md thoát khỏi allowed root.") };
    }
    if (fileStat.size <= 0 || fileStat.size > SKILL_MAX_FILE_BYTES) {
      return {
        view: invalidView(
          source,
          folder,
          `SKILL.md phải từ 1 đến ${SKILL_MAX_FILE_BYTES} byte.`,
        ),
      };
    }
    const bytes = await readFile(fileReal);
    if (bytes.includes(0)) {
      return { view: invalidView(source, folder, "SKILL.md phải là text UTF-8, không phải binary.") };
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return { view: invalidView(source, folder, "SKILL.md không phải UTF-8 hợp lệ.") };
    }
    const { metadata, body } = parseFrontmatter(text);
    const id = metadata["id"] ?? "";
    const name = metadata["name"] ?? "";
    const description = metadata["description"] ?? "";
    const version = metadata["version"] ?? "1";
    if (!SKILL_ID_PATTERN.test(id)) {
      return {
        view: invalidView(
          source,
          folder,
          "Skill id không hợp lệ.",
          id.length > 0 ? { id } : {},
        ),
      };
    }
    if (name.length === 0 || name.length > 100) {
      return { view: invalidView(source, folder, "Skill name là bắt buộc (tối đa 100 ký tự).", { id }) };
    }
    if (description.length === 0 || description.length > 300) {
      return {
        view: invalidView(source, folder, "Skill description là bắt buộc (tối đa 300 ký tự).", {
          id,
          name,
        }),
      };
    }
    if (version.length === 0 || version.length > 40) {
      return { view: invalidView(source, folder, "Skill version không hợp lệ.", { id, name, description }) };
    }
    if (body.length === 0) {
      return { view: invalidView(source, folder, "Nội dung hướng dẫn Skill không được rỗng.", { id, name, description, version }) };
    }
    if (INTERNAL_MARKER.test(body)) {
      return { view: invalidView(source, folder, "Skill chứa internal transport marker bị cấm.", { id, name, description, version }) };
    }
    const contentHash = createHash("sha256").update(body, "utf8").digest("hex");
    const details = await stat(fileReal);
    return {
      view: {
        id,
        name,
        description,
        version,
        source,
        status: "disabled",
        validationStatus: "valid",
        contentHash,
        modifiedAt: details.mtime.toISOString(),
        sizeBytes: bytes.byteLength,
      },
      content: body,
    };
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
    return {
      view: invalidView(
        source,
        folder,
        code === "ENOENT" ? "Thiếu SKILL.md." : "Không thể đọc hoặc parse Skill.",
      ),
    };
  }
}

export async function createSkillCatalog(options: SkillCatalogOptions): Promise<SkillCatalog> {
  let enabledIds = await readRegistry(options.stateFilePath);
  let discovered = new Map<string, ParsedSkill>();

  async function refresh(): Promise<readonly SkillView[]> {
    const entries: ParsedSkill[] = [];
    for (const root of options.roots) {
      if (root.createIfMissing === true) await mkdir(root.path, { recursive: true });
      let rootReal: string;
      try {
        rootReal = await realpath(root.path);
      } catch {
        continue;
      }
      const children = (await readdir(rootReal, { withFileTypes: true }))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, SKILL_MAX_COUNT);
      for (const child of children) {
        entries.push(await parseSkill(rootReal, join(rootReal, child.name), root.source));
      }
    }

    const counts = new Map<string, number>();
    for (const entry of entries) {
      if (entry.view.validationStatus === "valid") {
        counts.set(entry.view.id, (counts.get(entry.view.id) ?? 0) + 1);
      }
    }
    const next = new Map<string, ParsedSkill>();
    for (const [index, entry] of entries.entries()) {
      const duplicate = (counts.get(entry.view.id) ?? 0) > 1;
      const normalized: ParsedSkill = duplicate
        ? {
            view: {
              ...entry.view,
              id: `${entry.view.id}#duplicate-${index + 1}`,
              status: "invalid",
              validationStatus: "invalid",
              invalidReason: `Duplicate Skill id: ${entry.view.id}`,
            },
          }
        : {
            ...entry,
            view: {
              ...entry.view,
              status:
                entry.view.validationStatus === "invalid"
                  ? "invalid"
                  : enabledIds.has(entry.view.id)
                    ? "enabled"
                    : "disabled",
            },
          };
      next.set(normalized.view.id, normalized);
    }
    discovered = next;
    const validIds = new Set(
      [...discovered.values()]
        .filter((entry) => entry.view.validationStatus === "valid")
        .map((entry) => entry.view.id),
    );
    enabledIds = new Set([...enabledIds].filter((id) => validIds.has(id)));
    await writeRegistry(options.stateFilePath, enabledIds);
    return [...discovered.values()].map((entry) => entry.view);
  }

  await refresh();

  return {
    refresh,
    list: () => [...discovered.values()].map((entry) => entry.view),
    async setEnabled(id, enabled) {
      const entry = discovered.get(id);
      if (entry === undefined) throw new Error(`Unknown Skill: ${id}`);
      if (entry.view.validationStatus !== "valid") {
        throw new Error(entry.view.invalidReason ?? "Skill không hợp lệ.");
      }
      if (enabled) enabledIds.add(id);
      else enabledIds.delete(id);
      await writeRegistry(options.stateFilePath, enabledIds);
      await refresh();
      return discovered.get(id)!.view;
    },
    enabledSnapshots() {
      return [...discovered.values()]
        .filter((entry) => entry.view.status === "enabled" && entry.content !== undefined)
        .map((entry): EnabledSkillSnapshot => {
          const view = entry.view;
          const metadata: SkillUseMetadata = {
            id: view.id,
            name: view.name,
            version: view.version,
            source: view.source,
            contentHash: view.contentHash!,
            modifiedAt: view.modifiedAt!,
          };
          return { metadata, content: entry.content! };
        });
    },
    preview(id) {
      const entry = discovered.get(id);
      if (entry === undefined || entry.content === undefined) throw new Error(`Skill không khả dụng: ${id}`);
      return {
        content: entry.content.slice(0, SKILL_PREVIEW_CHARS),
        truncated: entry.content.length > SKILL_PREVIEW_CHARS,
      };
    },
  };
}
