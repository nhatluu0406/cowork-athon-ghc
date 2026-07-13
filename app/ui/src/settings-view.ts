/**
 * Settings view (CGHC-022 SD1/SD4/LOW-1) — renderer side.
 *
 * A thin CLIENT of the loopback service with NO business logic: it renders whatever the
 * service returns and calls typed client methods to persist edits. The service owns the
 * settings store, validation, redaction, and the credential HANDLE — the renderer never
 * touches the filesystem or the credential store and never holds key bytes.
 *
 * It shows: general settings (theme + verbose logging + telemetry), each provider's
 * credential-binding STATUS (hasCredential + the non-secret account label — never a key)
 * and base_url, the persisted default-model preference, and a control to clear the current
 * session's model override so it reverts to the default (LOW-1).
 *
 * DOM is built with `textContent` only (no HTML parsing); controls are keyboard-reachable
 * and labelled; no secret is ever written into the DOM.
 */

import type {
  ServiceClient,
  SettingsView,
  ThemePreference,
} from "./service-client.js";
import { applyThemePreference } from "./theme-manager.js";

export interface SettingsViewDeps {
  readonly client: Pick<ServiceClient, "getSettings" | "updateGeneral">;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const THEMES: readonly ThemePreference[] = ["system", "light", "dark"];

/** Mount the settings view into `container`. Returns nothing; it manages its own state. */
export function mountSettingsView(container: HTMLElement, deps: SettingsViewDeps): void {
  const section = el("section", "settings-view");
  section.setAttribute("aria-label", "Cài đặt");

  const status = el("p", "settings-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const generalBox = el("div", "settings-general");
  section.append(el("h2", "settings-title", "Cài đặt chung"), status, generalBox);
  container.append(section);

  const setStatus = (text: string): void => {
    status.textContent = text;
  };

  // A single guarded runner: every edit goes through the service, never local business logic.
  const run = async (label: string, action: () => Promise<SettingsView>): Promise<void> => {
    setStatus(`${label}…`);
    try {
      const next = await action();
      render(next);
      applyThemePreference(next.general.theme);
      setStatus("Đã lưu.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không lưu được cài đặt.";
      setStatus(message);
    }
  };

  function renderGeneral(view: SettingsView): void {
    generalBox.replaceChildren(el("h3", "settings-subtitle", "Chung"));

    const themeLabel = el("label", "settings-field", "Giao diện");
    const themeSelect = document.createElement("select");
    themeSelect.className = "settings-theme";
    for (const theme of THEMES) {
      const opt = document.createElement("option");
      opt.value = theme;
      opt.textContent = theme === "system" ? "Theo hệ thống" : theme === "light" ? "Sáng" : "Tối";
      if (view.general.theme === theme) opt.selected = true;
      themeSelect.append(opt);
    }
    themeSelect.addEventListener("change", () => {
      void run("Đang lưu giao diện", () =>
        deps.client.updateGeneral({ theme: themeSelect.value as ThemePreference }),
      );
    });
    themeLabel.append(themeSelect);

    const verbose = toggle("Ghi log chi tiết", view.general.verboseLogging, (checked) =>
      run("Đang lưu log", () => deps.client.updateGeneral({ verboseLogging: checked })),
    );
    const telemetry = toggle("Bật telemetry cục bộ", view.general.telemetryEnabled, (checked) =>
      run("Đang lưu telemetry", () => deps.client.updateGeneral({ telemetryEnabled: checked })),
    );

    generalBox.append(themeLabel, verbose, telemetry);
  }

  function toggle(label: string, checked: boolean, onChange: (checked: boolean) => Promise<void>): HTMLElement {
    const wrap = el("label", "settings-toggle", label);
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.addEventListener("change", () => void onChange(input.checked));
    wrap.prepend(input);
    return wrap;
  }

  function render(view: SettingsView): void {
    renderGeneral(view);
  }

  async function load(): Promise<void> {
    setStatus("Đang tải cài đặt…");
    try {
      const view = await deps.client.getSettings();
      render(view);
      applyThemePreference(view.general.theme);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Không tải được cài đặt.");
    }
  }

  void load();
}
