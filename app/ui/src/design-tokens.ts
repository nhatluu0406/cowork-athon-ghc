/**
 * Central design tokens for the integration-ready Cowork shell.
 *
 * The CSS variables remain the runtime source for styling; this typed map keeps top-level
 * surfaces/tests from hardcoding semantic color names.
 */

export const DESIGN_TOKENS = Object.freeze({
  color: {
    background: "var(--cghc-bg)",
    surface: "var(--cghc-surface)",
    surfaceElevated: "var(--cghc-surface-elevated)",
    border: "var(--cghc-border)",
    textPrimary: "var(--cghc-text-primary)",
    textSecondary: "var(--cghc-text-secondary)",
    accent: "var(--cghc-accent)",
    success: "var(--cghc-success)",
    warning: "var(--cghc-warning)",
    error: "var(--cghc-error)",
    info: "var(--cghc-info)",
  },
  spacing: {
    xs: "4px",
    sm: "8px",
    md: "12px",
    lg: "16px",
    xl: "24px",
    "2xl": "32px",
  },
  typography: {
    sans: "var(--font-sans)",
    mono: "var(--font-mono)",
    body: "14px",
    small: "12px",
    title: "18px",
  },
  radius: {
    sm: "8px",
    md: "12px",
    lg: "18px",
    xl: "24px",
  },
  shadow: {
    sm: "var(--cghc-shadow-sm)",
    md: "var(--cghc-shadow-md)",
    lg: "var(--cghc-shadow-lg)",
  },
  transition: {
    fast: "120ms ease",
    normal: "180ms ease",
  },
});

export type DesignTokens = typeof DESIGN_TOKENS;
