/**
 * Deterministic renderer-side parser for the service-produced unified diff
 * (FileReviewArtifact.unifiedDiff). Pure; no DOM, no service access.
 */

export type DiffLineType = "ctx" | "add" | "del";

export interface DiffLine {
  readonly type: DiffLineType;
  readonly oldN: number | null;
  readonly newN: number | null;
  readonly text: string;
}

export interface DiffStats {
  readonly adds: number;
  readonly dels: number;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseUnifiedDiff(unified: string): readonly DiffLine[] {
  const out: DiffLine[] = [];
  let oldN = 0;
  let newN = 0;
  let inHunk = false;
  for (const raw of unified.split("\n")) {
    const hunk = HUNK_HEADER.exec(raw);
    if (hunk !== null) {
      oldN = Number(hunk[1]);
      newN = Number(hunk[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk || raw.startsWith("\\")) continue;
    if (raw.startsWith("+")) {
      out.push({ type: "add", oldN: null, newN: newN++, text: raw.slice(1) });
    } else if (raw.startsWith("-")) {
      out.push({ type: "del", oldN: oldN++, newN: null, text: raw.slice(1) });
    } else {
      out.push({ type: "ctx", oldN: oldN++, newN: newN++, text: raw.startsWith(" ") ? raw.slice(1) : raw });
    }
  }
  return out;
}

export function diffStats(unified: string | undefined): DiffStats {
  if (unified === undefined || unified.length === 0) return { adds: 0, dels: 0 };
  let adds = 0;
  let dels = 0;
  for (const line of parseUnifiedDiff(unified)) {
    if (line.type === "add") adds += 1;
    else if (line.type === "del") dels += 1;
  }
  return { adds, dels };
}
