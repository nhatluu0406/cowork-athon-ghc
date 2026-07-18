/**
 * Shared renderer for the Code runtime panes' "Vấn đề" (Problems) tab. Both the web-preview and the
 * desktop-app controllers keep an accumulating list of captured output lines and call this to
 * (re)render the parsed problems + update the tab's count badge. Pure DOM over the pure
 * {@link parseProblems} reducer — no process, no network, no secret.
 */

import type { RuntimePreviewOutputLine } from "@cowork-ghc/contracts";
import { el } from "../dom-utils.js";
import { parseProblems, problemLocation } from "./parse-problems.js";

/**
 * Render the parsed problems into `problemsBody` and label `tabProblems` with a count badge
 * (`Vấn đề` when clean, `Vấn đề (n)` when there are problems). Honest empty state when none.
 */
export function renderProblems(
  problemsBody: HTMLElement,
  tabProblems: HTMLElement,
  lines: readonly RuntimePreviewOutputLine[],
): void {
  const problems = parseProblems(lines);
  tabProblems.textContent = problems.length > 0 ? `Vấn đề (${problems.length})` : "Vấn đề";
  tabProblems.classList.toggle("code-preview__drawer-tab--has-problems", problems.length > 0);
  if (problems.length === 0) {
    problemsBody.replaceChildren(el("div", "code-preview__problems-empty", "Không có vấn đề nào."));
    return;
  }
  const rows = problems.map((problem) => {
    const row = el("div", `code-preview__problem code-preview__problem--${problem.severity}`);
    const loc = problemLocation(problem);
    if (loc.length > 0) row.append(el("span", "code-preview__problem-loc", loc));
    row.append(el("span", "code-preview__problem-msg", problem.message));
    return row;
  });
  problemsBody.replaceChildren(...rows);
}
