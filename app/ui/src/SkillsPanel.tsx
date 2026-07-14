/**
 * Minimal functional Skills UI: service-owned discovery, enable/disable, bounded preview.
 *
 * React port of the former `mountSkillsPanel` DOM builder — markup, classnames, and copy are
 * unchanged. Mounted via the `mountSkillsPanel` shim in `skills-panel.ts`, which bridges the old
 * imperative `SkillsPanelHandle` contract onto this component through `useImperativeHandle`.
 */

import { useCallback, useEffect, useImperativeHandle, useState, type Ref } from "react";
import type { ServiceClient, SkillView } from "./service-client.js";

export interface SkillsPanelHandle {
  refresh(): Promise<void>;
}

export interface SkillsPanelProps {
  client: ServiceClient;
  onChanged: (skills: readonly SkillView[]) => void;
  ref?: Ref<SkillsPanelHandle>;
}

export function SkillsPanel({ client, onChanged, ref }: SkillsPanelProps) {
  const [skills, setSkills] = useState<readonly SkillView[]>([]);
  const [status, setStatus] = useState("Đang tải Skills…");

  const refresh = useCallback(
    async (discover: boolean): Promise<void> => {
      setStatus("Đang tải Skills…");
      try {
        const next = discover ? await client.refreshSkills() : await client.listSkills();
        setSkills(next);
        onChanged(next);
        setStatus(`${next.length} Skill được phát hiện.`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Không tải được Skills.");
      }
    },
    [client, onChanged],
  );

  useImperativeHandle(ref, () => ({ refresh: () => refresh(true) }), [refresh]);

  useEffect(() => {
    void refresh(false);
  }, [refresh]);

  return (
    <>
      <h2 className="skills-panel__title">Skills</h2>
      <p className="skills-panel__copy">
        Skill là hướng dẫn local cho lượt gửi. Skill không cấp quyền mới và không chạy code.
      </p>
      <button type="button" className="label-btn skills-refresh" onClick={() => void refresh(true)}>
        Làm mới
      </button>
      <p className="skills-panel__status" role="status">
        {status}
      </p>
      <div className="skills-list">
        {skills.length === 0 ? (
          <p className="skills-empty">Chưa có Skill khả dụng</p>
        ) : (
          skills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              client={client}
              onToggled={() => void refresh(false)}
              onError={setStatus}
            />
          ))
        )}
      </div>
    </>
  );
}

interface SkillCardProps {
  skill: SkillView;
  client: ServiceClient;
  onToggled: () => void;
  onError: (message: string) => void;
}

function SkillCard({ skill, client, onToggled, onError }: SkillCardProps) {
  const [toggleBusy, setToggleBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewText, setPreviewText] = useState<string | null>(null);

  const handleToggle = useCallback(() => {
    setToggleBusy(true);
    void client
      .setSkillEnabled(skill.id, skill.status !== "enabled")
      .then(() => onToggled())
      .catch((error: unknown) => {
        onError(error instanceof Error ? error.message : "Không cập nhật được Skill.");
      })
      .finally(() => setToggleBusy(false));
  }, [client, skill.id, skill.status, onToggled, onError]);

  const handlePreview = useCallback(() => {
    setPreviewBusy(true);
    void client
      .previewSkill(skill.id)
      .then((preview) => {
        setPreviewText(preview.content + (preview.truncated ? "\n… (preview đã cắt)" : ""));
      })
      .catch((error: unknown) => {
        onError(error instanceof Error ? error.message : "Không đọc được preview.");
      })
      .finally(() => setPreviewBusy(false));
  }, [client, skill.id, onError]);

  const source = skill.source === "built_in" ? "Built-in" : "User local";

  return (
    <article className="skill-card" data-skill-id={skill.id}>
      <h3 className="skill-card__name">{skill.name}</h3>
      <p className="skill-card__description">{skill.description}</p>
      <p className="skill-card__meta">{`${source} · v${skill.version} · ${skill.status}`}</p>
      {skill.validationStatus === "invalid" ? (
        <>
          <p className="skill-card__error" role="status">
            {skill.invalidReason ?? "Skill không hợp lệ."}
          </p>
          <button type="button" className="label-btn" disabled>
            Không thể bật
          </button>
        </>
      ) : (
        <>
          <div className="skill-card__actions">
            <button
              type="button"
              className="label-btn skill-toggle"
              aria-pressed={skill.status === "enabled"}
              disabled={toggleBusy}
              onClick={handleToggle}
            >
              {skill.status === "enabled" ? "Disable" : "Enable"}
            </button>
            <button
              type="button"
              className="text-btn skill-preview-btn"
              disabled={previewBusy}
              onClick={handlePreview}
            >
              Xem nội dung
            </button>
          </div>
          {previewText !== null ? <pre className="skill-card__preview">{previewText}</pre> : null}
        </>
      )}
    </article>
  );
}
