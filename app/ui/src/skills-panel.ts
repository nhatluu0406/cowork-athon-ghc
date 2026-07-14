/**
 * Mount shim: bridges the React `SkillsPanel` component onto the imperative
 * `mountSkillsPanel(root, client, onChanged) -> SkillsPanelHandle` contract still used by
 * `app-shell.ts`, so that call site needs no changes.
 */

import { createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { SkillsPanel, type SkillsPanelHandle } from "./SkillsPanel.js";
import type { ServiceClient, SkillView } from "./service-client.js";
import { el } from "./ui-shell/dom-utils.js";

export type { SkillsPanelHandle };

export function mountSkillsPanel(
  root: HTMLElement,
  client: ServiceClient,
  onChanged: (skills: readonly SkillView[]) => void,
): SkillsPanelHandle {
  const heading = el("h2", "skills-panel__title", "Skills");
  const copy = el(
    "p",
    "skills-panel__copy",
    "Skill là hướng dẫn local cho lượt gửi. Skill không cấp quyền mới và không chạy code.",
  );
  const refreshButton = el("button", "label-btn skills-refresh", "Làm mới") as HTMLButtonElement;
  refreshButton.type = "button";
  const status = el("p", "skills-panel__status");
  status.setAttribute("role", "status");
  const list = el("div", "skills-list");
  root.replaceChildren(heading, copy, refreshButton, status, list);

  async function render(skills: readonly SkillView[]): Promise<void> {
    list.replaceChildren();
    onChanged(skills);
    if (skills.length === 0) {
      list.append(el("p", "skills-empty", "Chưa có Skill khả dụng"));
      return;
    }
    for (const skill of skills) {
      const card = el("article", "skill-card");
      card.dataset["skillId"] = skill.id;
      const title = el("h3", "skill-card__name", skill.name);
      const description = el("p", "skill-card__description", skill.description);
      const source = skill.source === "built_in" ? "Tích hợp sẵn" : "Người dùng";
      const meta = el(
        "p",
        "skill-card__meta",
        `${source} · v${skill.version} · ${skill.status}`,
      );
      card.append(title, description, meta);
      if (skill.validationStatus === "invalid") {
        const reason = el("p", "skill-card__error", skill.invalidReason ?? "Skill không hợp lệ.");
        reason.setAttribute("role", "status");
        const disabled = el("button", "label-btn", "Không thể bật") as HTMLButtonElement;
        disabled.type = "button";
        disabled.disabled = true;
        card.append(reason, disabled);
      } else {
        const actions = el("div", "skill-card__actions");
        const toggle = el(
          "button",
          "label-btn skill-toggle",
          skill.status === "enabled" ? "Disable" : "Enable",
        ) as HTMLButtonElement;
        toggle.type = "button";
        toggle.setAttribute("aria-pressed", skill.status === "enabled" ? "true" : "false");
        toggle.addEventListener("click", () => {
          toggle.disabled = true;
          void client
            .setSkillEnabled(skill.id, skill.status !== "enabled")
            .then(() => refresh(false))
            .catch((error) => {
              status.textContent = error instanceof Error ? error.message : "Không cập nhật được Skill.";
              toggle.disabled = false;
            });
        });
        const previewButton = el("button", "text-btn skill-preview-btn", "Xem nội dung") as HTMLButtonElement;
        previewButton.type = "button";
        previewButton.addEventListener("click", () => {
          previewButton.disabled = true;
          void client
            .previewSkill(skill.id)
            .then((preview) => {
              let pre = card.querySelector<HTMLPreElement>(".skill-card__preview");
              if (pre === null) {
                pre = el("pre", "skill-card__preview") as HTMLPreElement;
                card.append(pre);
              }
              pre.textContent = preview.content + (preview.truncated ? "\n… (preview đã cắt)" : "");
            })
            .catch((error) => {
              status.textContent = error instanceof Error ? error.message : "Không đọc được preview.";
            })
            .finally(() => {
              previewButton.disabled = false;
            });
        });
        actions.append(toggle, previewButton);
        card.append(actions);
      }
      list.append(card);
    }
  }

  async function refresh(discover = true): Promise<void> {
    status.textContent = "Đang tải Skills…";
    try {
      const skills = discover ? await client.refreshSkills() : await client.listSkills();
      await render(skills);
      status.textContent = `${skills.length} Skill được phát hiện.`;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Không tải được Skills.";
    }
  }

  refreshButton.addEventListener("click", () => void refresh(true));
  void refresh(false);
  return { refresh: () => refresh(true) };
}
