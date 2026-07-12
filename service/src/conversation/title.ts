/**
 * Deterministic local conversation titles — no LLM calls.
 */

const MAX_TITLE_LEN = 80;

export function titleFromFirstMessage(text: string): string {
  const collapsed = text.replace(/\s+/gu, " ").trim();
  if (collapsed.length === 0) return "Cuộc trò chuyện mới";
  if (collapsed.length <= MAX_TITLE_LEN) return collapsed;
  return `${collapsed.slice(0, MAX_TITLE_LEN - 1)}…`;
}

export function normalizeTitle(title: string): string {
  const trimmed = title.replace(/\s+/gu, " ").trim();
  if (trimmed.length === 0) throw new Error("Tiêu đề không được để trống.");
  if (trimmed.length > MAX_TITLE_LEN) {
    throw new Error(`Tiêu đề tối đa ${MAX_TITLE_LEN} ký tự.`);
  }
  return trimmed;
}
