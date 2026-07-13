import type { ThemePreference } from "./service-client.js";

let media: MediaQueryList | null = null;
let mediaHandler: (() => void) | null = null;
let currentPreference: ThemePreference = "system";

function resolvedTheme(preference: ThemePreference): "light" | "dark" {
  if (preference === "light" || preference === "dark") return preference;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function commitTheme(preference: ThemePreference): void {
  const theme = resolvedTheme(preference);
  document.documentElement.dataset["theme"] = theme;
  document.documentElement.style.colorScheme = theme;
}

/** Apply a persisted theme and keep system mode live when the OS appearance changes. */
export function applyThemePreference(preference: ThemePreference): void {
  currentPreference = preference;
  if (media !== null && mediaHandler !== null) media.removeEventListener("change", mediaHandler);
  media = null;
  mediaHandler = null;

  commitTheme(preference);
  if (preference !== "system" || typeof window.matchMedia !== "function") return;

  media = window.matchMedia("(prefers-color-scheme: dark)");
  mediaHandler = () => commitTheme(currentPreference);
  media.addEventListener("change", mediaHandler);
}
