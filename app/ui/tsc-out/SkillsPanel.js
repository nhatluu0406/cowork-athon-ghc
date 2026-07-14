import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Minimal functional Skills UI: service-owned discovery, enable/disable, bounded preview.
 *
 * React port of the former `mountSkillsPanel` DOM builder — markup, classnames, and copy are
 * unchanged. Mounted via the `mountSkillsPanel` shim in `skills-panel.ts`, which bridges the old
 * imperative `SkillsPanelHandle` contract onto this component through `useImperativeHandle`.
 */
import { useCallback, useEffect, useImperativeHandle, useState } from "react";
export function SkillsPanel({ client, onChanged, ref }) {
    const [skills, setSkills] = useState([]);
    const [status, setStatus] = useState("Đang tải Skills…");
    const refresh = useCallback(async (discover) => {
        setStatus("Đang tải Skills…");
        try {
            const next = discover ? await client.refreshSkills() : await client.listSkills();
            setSkills(next);
            onChanged(next);
            setStatus(`${next.length} Skill được phát hiện.`);
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : "Không tải được Skills.");
        }
    }, [client, onChanged]);
    useImperativeHandle(ref, () => ({ refresh: () => refresh(true) }), [refresh]);
    useEffect(() => {
        void refresh(false);
    }, [refresh]);
    return (_jsxs(_Fragment, { children: [_jsx("h2", { className: "skills-panel__title", children: "Skills" }), _jsx("p", { className: "skills-panel__copy", children: "Skill l\u00E0 h\u01B0\u1EDBng d\u1EABn local cho l\u01B0\u1EE3t g\u1EEDi. Skill kh\u00F4ng c\u1EA5p quy\u1EC1n m\u1EDBi v\u00E0 kh\u00F4ng ch\u1EA1y code." }), _jsx("button", { type: "button", className: "label-btn skills-refresh", onClick: () => void refresh(true), children: "L\u00E0m m\u1EDBi" }), _jsx("p", { className: "skills-panel__status", role: "status", children: status }), _jsx("div", { className: "skills-list", children: skills.length === 0 ? (_jsx("p", { className: "skills-empty", children: "Ch\u01B0a c\u00F3 Skill kh\u1EA3 d\u1EE5ng" })) : (skills.map((skill) => (_jsx(SkillCard, { skill: skill, client: client, onToggled: () => void refresh(false), onError: setStatus }, skill.id)))) })] }));
}
function SkillCard({ skill, client, onToggled, onError }) {
    const [toggleBusy, setToggleBusy] = useState(false);
    const [previewBusy, setPreviewBusy] = useState(false);
    const [previewText, setPreviewText] = useState(null);
    const handleToggle = useCallback(() => {
        setToggleBusy(true);
        void client
            .setSkillEnabled(skill.id, skill.status !== "enabled")
            .then(() => onToggled())
            .catch((error) => {
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
            .catch((error) => {
            onError(error instanceof Error ? error.message : "Không đọc được preview.");
        })
            .finally(() => setPreviewBusy(false));
    }, [client, skill.id, onError]);
    const source = skill.source === "built_in" ? "Built-in" : "User local";
    return (_jsxs("article", { className: "skill-card", "data-skill-id": skill.id, children: [_jsx("h3", { className: "skill-card__name", children: skill.name }), _jsx("p", { className: "skill-card__description", children: skill.description }), _jsx("p", { className: "skill-card__meta", children: `${source} · v${skill.version} · ${skill.status}` }), skill.validationStatus === "invalid" ? (_jsxs(_Fragment, { children: [_jsx("p", { className: "skill-card__error", role: "status", children: skill.invalidReason ?? "Skill không hợp lệ." }), _jsx("button", { type: "button", className: "label-btn", disabled: true, children: "Kh\u00F4ng th\u1EC3 b\u1EADt" })] })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "skill-card__actions", children: [_jsx("button", { type: "button", className: "label-btn skill-toggle", "aria-pressed": skill.status === "enabled", disabled: toggleBusy, onClick: handleToggle, children: skill.status === "enabled" ? "Disable" : "Enable" }), _jsx("button", { type: "button", className: "text-btn skill-preview-btn", disabled: previewBusy, onClick: handlePreview, children: "Xem n\u1ED9i dung" })] }), previewText !== null ? _jsx("pre", { className: "skill-card__preview", children: previewText }) : null] }))] }));
}
//# sourceMappingURL=SkillsPanel.js.map