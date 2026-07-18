/**
 * Real .docx document generation (issue #25).
 *
 * The supervised OpenCode agent's only native mutation tool is a text `write`/`edit`; it cannot
 * emit a binary OOXML Word file, so "tạo file docx" used to produce a mislabeled text file that
 * Word/preview then failed to open. This service is the explicit, deterministic contract the agent
 * calls instead of guessing: it takes a BOUNDED structured document spec + a workspace-relative
 * path and synthesizes a genuine `.docx` (via `docx`/docx-js, pure JS, running in THIS service
 * process — nothing runs in the OpenCode child, so no `bash` and no runtime dependency-seeding).
 *
 * Honesty invariants (mirrors verify-file-evidence): never returns ok without real evidence —
 * every success is a file that (a) is inside the active workspace, (b) passed size caps, and
 * (c) re-opens as a valid OOXML package (`[Content_Types].xml` + `word/document.xml`). Anything
 * else deletes the partial file and returns a typed error. No macros: output is always `.docx`
 * (never `.docm`) and every user string is placed only as `TextRun`/table-cell text via the docx
 * API — there is no raw-XML injection point.
 */

import { writeFile, mkdir, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import JSZip from "jszip";
import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
} from "docx";
import { validateWorkspaceSelection, nodeFsProbe } from "../workspace/validate.js";
import { createWorkspaceGuard } from "../workspace/guard.js";

// ── Bounded structured spec (the agent-facing contract) ──────────────────────────────────────

export interface DocxParagraphSpec {
  readonly text: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
}
export interface DocxListSpec {
  readonly ordered: boolean;
  readonly items: readonly string[];
}
export interface DocxTableSpec {
  readonly rows: readonly (readonly string[])[];
}
export type DocxHeadingLevel = 1 | 2 | 3;
export interface DocxSectionSpec {
  readonly heading?: { readonly text: string; readonly level: DocxHeadingLevel };
  readonly paragraphs?: readonly DocxParagraphSpec[];
  readonly list?: DocxListSpec;
  readonly table?: DocxTableSpec;
}
export interface CreateDocxInput {
  readonly title?: string;
  readonly sections: readonly DocxSectionSpec[];
  /** Workspace-relative target path; MUST end in `.docx`. */
  readonly relativePath: string;
}

export type CreateDocxError =
  | { readonly kind: "invalid_spec"; readonly message: string }
  | { readonly kind: "invalid_extension"; readonly message: string }
  | { readonly kind: "path_escape"; readonly message: string }
  | { readonly kind: "no_workspace"; readonly message: string }
  | { readonly kind: "size_cap_exceeded"; readonly message: string }
  | { readonly kind: "write_failed"; readonly message: string }
  | { readonly kind: "verification_failed"; readonly message: string };

export interface CreateDocxResult {
  readonly ok: true;
  readonly relativePath: string;
  readonly sizeBytes: number;
  /** Only ever present when the produced bytes re-opened as a valid OOXML package. Never faked. */
  readonly verifiedOoxml: true;
}

export interface DocxServiceDeps {
  readonly workspaceRoot: () => string | undefined;
}

// Bounds — conservative caps so a runaway/hostile spec cannot exhaust memory or disk.
const MAX_TITLE_CHARS = 300;
const MAX_SECTIONS = 100;
const MAX_PARAGRAPHS_PER_SECTION = 500;
const MAX_PARAGRAPH_CHARS = 20_000;
const MAX_LIST_ITEMS = 500;
const MAX_LIST_ITEM_CHARS = 2_000;
const MAX_TABLE_ROWS = 200;
const MAX_TABLE_COLS = 30;
const MAX_CELL_CHARS = 2_000;
const MAX_TOTAL_TEXT_CHARS = 2_000_000; // ~2M chars across the whole document
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024; // 10 MB produced .docx

type Ok = { ok: true; data: CreateDocxResult };
type Err = { ok: false; error: CreateDocxError };

function invalid(message: string): Err {
  return { ok: false, error: { kind: "invalid_spec", message } };
}

/** Validate spec bounds; returns the running total text length or an error. */
function validateSpec(input: CreateDocxInput): { ok: true; totalChars: number } | Err {
  if (!Array.isArray(input.sections)) return invalid("sections phải là một mảng.");
  if (input.sections.length === 0) return invalid("Cần ít nhất một section.");
  if (input.sections.length > MAX_SECTIONS) return invalid(`Tối đa ${MAX_SECTIONS} section.`);
  let total = 0;
  const add = (s: string): void => {
    total += s.length;
  };
  if (input.title !== undefined) {
    if (typeof input.title !== "string") return invalid("title phải là chuỗi.");
    if (input.title.length > MAX_TITLE_CHARS) return invalid(`title tối đa ${MAX_TITLE_CHARS} ký tự.`);
    add(input.title);
  }
  for (const section of input.sections) {
    if (section.heading !== undefined) {
      if (typeof section.heading.text !== "string") return invalid("heading.text phải là chuỗi.");
      if (![1, 2, 3].includes(section.heading.level)) return invalid("heading.level phải là 1, 2 hoặc 3.");
      if (section.heading.text.length > MAX_PARAGRAPH_CHARS) return invalid("heading quá dài.");
      add(section.heading.text);
    }
    if (section.paragraphs !== undefined) {
      if (section.paragraphs.length > MAX_PARAGRAPHS_PER_SECTION) {
        return invalid(`Tối đa ${MAX_PARAGRAPHS_PER_SECTION} đoạn văn mỗi section.`);
      }
      for (const p of section.paragraphs) {
        if (typeof p.text !== "string") return invalid("paragraph.text phải là chuỗi.");
        if (p.text.length > MAX_PARAGRAPH_CHARS) return invalid(`Đoạn văn tối đa ${MAX_PARAGRAPH_CHARS} ký tự.`);
        add(p.text);
      }
    }
    if (section.list !== undefined) {
      if (!Array.isArray(section.list.items)) return invalid("list.items phải là mảng.");
      if (section.list.items.length > MAX_LIST_ITEMS) return invalid(`Tối đa ${MAX_LIST_ITEMS} mục trong danh sách.`);
      for (const item of section.list.items) {
        if (typeof item !== "string") return invalid("Mỗi mục danh sách phải là chuỗi.");
        if (item.length > MAX_LIST_ITEM_CHARS) return invalid(`Mục danh sách tối đa ${MAX_LIST_ITEM_CHARS} ký tự.`);
        add(item);
      }
    }
    if (section.table !== undefined) {
      if (!Array.isArray(section.table.rows)) return invalid("table.rows phải là mảng.");
      if (section.table.rows.length > MAX_TABLE_ROWS) return invalid(`Bảng tối đa ${MAX_TABLE_ROWS} hàng.`);
      for (const row of section.table.rows) {
        if (!Array.isArray(row)) return invalid("Mỗi hàng bảng phải là mảng ô.");
        if (row.length > MAX_TABLE_COLS) return invalid(`Bảng tối đa ${MAX_TABLE_COLS} cột.`);
        for (const cell of row) {
          if (typeof cell !== "string") return invalid("Mỗi ô bảng phải là chuỗi.");
          if (cell.length > MAX_CELL_CHARS) return invalid(`Ô bảng tối đa ${MAX_CELL_CHARS} ký tự.`);
          add(cell);
        }
      }
    }
    if (
      section.heading === undefined &&
      section.paragraphs === undefined &&
      section.list === undefined &&
      section.table === undefined
    ) {
      return invalid("Mỗi section cần ít nhất một nội dung (heading/paragraphs/list/table).");
    }
  }
  if (total > MAX_TOTAL_TEXT_CHARS) {
    return { ok: false, error: { kind: "size_cap_exceeded", message: "Nội dung tài liệu vượt giới hạn." } };
  }
  return { ok: true, totalChars: total };
}

const HEADING_FOR: Record<DocxHeadingLevel, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
};

/** Build the docx children from the validated spec (strings only ever become TextRun/cell text). */
function buildChildren(input: CreateDocxInput): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = [];
  if (input.title !== undefined && input.title.length > 0) {
    children.push(new Paragraph({ text: input.title, heading: HeadingLevel.TITLE }));
  }
  for (const section of input.sections) {
    if (section.heading !== undefined) {
      children.push(new Paragraph({ text: section.heading.text, heading: HEADING_FOR[section.heading.level] }));
    }
    for (const p of section.paragraphs ?? []) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: p.text, bold: p.bold === true, italics: p.italic === true })],
        }),
      );
    }
    if (section.list !== undefined) {
      section.list.items.forEach((item) => {
        children.push(
          new Paragraph(
            section.list!.ordered
              ? { text: item, numbering: { reference: "cghc-ordered", level: 0 } }
              : { text: item, bullet: { level: 0 } },
          ),
        );
      });
    }
    if (section.table !== undefined && section.table.rows.length > 0) {
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: section.table.rows.map(
            (row) =>
              new TableRow({
                children: row.map(
                  (cell) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: cell })] })] }),
                ),
              }),
          ),
        }),
      );
    }
  }
  if (children.length === 0) children.push(new Paragraph({ text: "" }));
  return children;
}

/** True when `buffer` is a real OOXML Word package (the authoritative "not mislabeled text" check). */
export async function isValidOoxmlDocx(buffer: Buffer): Promise<boolean> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const contentTypes = zip.file("[Content_Types].xml");
    const document = zip.file("word/document.xml");
    if (contentTypes === null || document === null) return false;
    const docXml = await document.async("string");
    return docXml.length > 0;
  } catch {
    return false;
  }
}

/**
 * Create a real `.docx` at `input.relativePath` inside the active workspace. Returns typed evidence
 * on success; never claims success for a file that failed OOXML verification.
 */
export async function createDocx(deps: DocxServiceDeps, input: CreateDocxInput): Promise<Ok | Err> {
  // 1) Extension gate (never write a non-.docx, never a macro-enabled .docm).
  if (!/\.docx$/i.test(input.relativePath)) {
    return { ok: false, error: { kind: "invalid_extension", message: "Đường dẫn phải kết thúc bằng .docx." } };
  }
  // 2) Spec bounds.
  const specCheck = validateSpec(input);
  if (!specCheck.ok) return specCheck;

  // 3) Active workspace + path safety (lexical first, then symlink-aware on the parent dir).
  const workspaceRoot = deps.workspaceRoot();
  if (workspaceRoot === undefined) {
    return { ok: false, error: { kind: "no_workspace", message: "Chưa chọn workspace." } };
  }
  const validation = await validateWorkspaceSelection({ rootPath: workspaceRoot }, nodeFsProbe());
  if (!validation.ok) {
    return { ok: false, error: { kind: "no_workspace", message: "Workspace không hợp lệ." } };
  }
  const guard = createWorkspaceGuard(validation.grant);
  let safePath: string;
  try {
    safePath = guard.resolveOrThrow(input.relativePath); // blocks .., absolute, UNC, drive-qualified
  } catch {
    return { ok: false, error: { kind: "path_escape", message: "Đường dẫn nằm ngoài workspace." } };
  }
  const parentDir = dirname(safePath);
  try {
    await mkdir(parentDir, { recursive: true });
    // Symlink-aware re-confinement of the (now-existing) parent so a symlinked subdir can't escape.
    await guard.assertRealPathInside(input.relativePath.replace(/[^\\/]+$/u, "").replace(/[\\/]+$/u, "") || ".");
  } catch {
    return { ok: false, error: { kind: "path_escape", message: "Thư mục đích nằm ngoài workspace." } };
  }

  // 4) Synthesize OOXML in-memory.
  let buffer: Buffer;
  try {
    const doc = new Document({
      numbering: {
        config: [
          {
            reference: "cghc-ordered",
            levels: [{ level: 0, format: "decimal", text: "%1.", alignment: "start" }],
          },
        ],
      },
      sections: [{ children: buildChildren(input) }],
    });
    buffer = await Packer.toBuffer(doc);
  } catch (error) {
    return {
      ok: false,
      error: { kind: "write_failed", message: error instanceof Error ? error.message : "Không tạo được nội dung." },
    };
  }

  // 5) Output size cap (real produced bytes).
  if (buffer.byteLength > MAX_OUTPUT_BYTES) {
    return { ok: false, error: { kind: "size_cap_exceeded", message: "Tệp .docx vượt giới hạn kích thước." } };
  }

  // 6) Write, then verify the ON-DISK bytes are a real OOXML package (delete + fail if not).
  try {
    await writeFile(safePath, buffer);
  } catch (error) {
    return {
      ok: false,
      error: { kind: "write_failed", message: error instanceof Error ? error.message : "Không ghi được tệp." },
    };
  }
  if (!(await isValidOoxmlDocx(buffer))) {
    await rm(safePath, { force: true }).catch(() => undefined);
    return {
      ok: false,
      error: { kind: "verification_failed", message: "Tệp tạo ra không phải gói OOXML hợp lệ." },
    };
  }

  const info = await stat(safePath);
  return {
    ok: true,
    data: { ok: true, relativePath: input.relativePath, sizeBytes: info.size, verifiedOoxml: true },
  };
}
