/**
 * Hidden interactive secret prompt (CGHC provider-key ingestion, SEC-1/SEC-2).
 *
 * Reads a secret from an interactive terminal with NO echo: the value never appears on
 * screen, in the shell scroll-back, in argv, in an env var, or in a file. Stdin is put in
 * raw mode and read character-by-character so we control every byte — Enter submits,
 * Backspace edits, and Ctrl+C / Ctrl+D abort cleanly (the terminal is always restored out
 * of raw mode, even on error). This is the ONLY production `PromptSecret`; tests inject a
 * fake so they never touch a real TTY.
 */

import type { PromptSecret } from "./cli-commands.js";

/** The user aborted the prompt (Ctrl+C / EOF). The caller must store nothing and exit non-zero. */
export class SecretPromptAbortedError extends Error {
  constructor() {
    super("Secret entry aborted by the user.");
    this.name = "SecretPromptAbortedError";
  }
}

/** The environment cannot provide a hidden prompt (no interactive TTY to disable echo on). */
export class HiddenPromptUnavailableError extends Error {
  constructor() {
    super(
      "A hidden secret prompt requires an interactive terminal (TTY). Run this in a real " +
        "console window, not a pipe or non-interactive shell.",
    );
    this.name = "HiddenPromptUnavailableError";
  }
}

const CTRL_C = String.fromCharCode(3); // ETX (Ctrl+C)
const CTRL_D = String.fromCharCode(4); // EOT (Ctrl+D)
const BACKSPACE_DEL = String.fromCharCode(127); // DEL: Backspace on most terminals
const BACKSPACE_BS = String.fromCharCode(8); // 0x08 backspace
const ESC = String.fromCharCode(27); // 0x1B: start of an escape / CSI / SS3 sequence

/** What a keystroke means once processed. */
export type HiddenKeySignal = "continue" | "submit" | "abort";

/**
 * The hidden-input state machine. `esc`: 0 = normal, 1 = just saw ESC, 2 = inside a
 * CSI/SS3 sequence being consumed. Persisted across keystrokes AND stdin chunks so a paste
 * that splits a sequence across reads is still handled.
 */
export interface HiddenInputState {
  readonly buffer: string;
  readonly esc: 0 | 1 | 2;
}

export const initialHiddenInputState: HiddenInputState = { buffer: "", esc: 0 };

/**
 * Fold ONE character into the hidden-input state (pure, so it is unit-testable without a
 * real TTY). Crucially it DROPS terminal escape sequences — arrow/Home/End keys (`ESC[…`),
 * SS3 (`ESC O…`), and bracketed-paste wrappers (`ESC[200~` / `ESC[201~`) — instead of
 * letting their printable tail (`[D`, `[200~`) corrupt the hidden secret (review LOW-1).
 * The real pasted text BETWEEN bracketed-paste wrappers is preserved as normal input.
 */
export function applyHiddenKey(
  state: HiddenInputState,
  ch: string,
): { readonly state: HiddenInputState; readonly signal: HiddenKeySignal } {
  const { buffer, esc } = state;
  const code = ch.codePointAt(0) ?? 0;
  if (esc === 1) {
    // The byte right after ESC: `[` (CSI) or `O` (SS3) opens a multi-byte sequence to
    // consume; anything else is a 2-char ESC-x sequence whose second byte we drop.
    return { state: { buffer, esc: ch === "[" || ch === "O" ? 2 : 0 }, signal: "continue" };
  }
  if (esc === 2) {
    // Consume params/intermediates until a CSI final byte (0x40–0x7E), then exit the sequence.
    return { state: { buffer, esc: code >= 0x40 && code <= 0x7e ? 0 : 2 }, signal: "continue" };
  }
  if (ch === CTRL_C) return { state, signal: "abort" };
  if (ch === CTRL_D) return { state, signal: buffer.length > 0 ? "submit" : "abort" };
  if (ch === "\r" || ch === "\n") return { state, signal: "submit" };
  if (ch === BACKSPACE_DEL || ch === BACKSPACE_BS) {
    return { state: { buffer: buffer.slice(0, -1), esc: 0 }, signal: "continue" };
  }
  if (ch === ESC) return { state: { buffer, esc: 1 }, signal: "continue" };
  // Accept any printable character (incl. Unicode); ignore other C0 control bytes.
  if (ch >= " ") return { state: { buffer: buffer + ch, esc: 0 }, signal: "continue" };
  return { state, signal: "continue" };
}

/**
 * Prompt for a secret on the real terminal with echo disabled. Resolves with the raw
 * entered value (a single trailing CR/LF is never included because Enter ends input).
 * Rejects with {@link SecretPromptAbortedError} on Ctrl+C / empty-EOF and
 * {@link HiddenPromptUnavailableError} when stdin is not an interactive TTY.
 */
export const promptHiddenSecret: PromptSecret = (promptText: string): Promise<string> => {
  const input = process.stdin;
  const output = process.stderr; // prompt goes to stderr; stdout stays clean for confirmations
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    return Promise.reject(new HiddenPromptUnavailableError());
  }

  return new Promise<string>((resolve, reject) => {
    let state = initialHiddenInputState;
    let settled = false;

    const restore = (): void => {
      if (settled) return;
      settled = true;
      input.removeListener("data", onData);
      try {
        input.setRawMode(false);
      } catch {
        // Best effort: never throw out of the restore path.
      }
      input.pause();
      output.write("\n"); // move past the (hidden) prompt line
    };

    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        const next = applyHiddenKey(state, ch);
        state = next.state;
        if (next.signal === "submit") {
          restore();
          resolve(state.buffer);
          return;
        }
        if (next.signal === "abort") {
          restore();
          reject(new SecretPromptAbortedError());
          return;
        }
      }
    };

    output.write(promptText);
    try {
      input.setRawMode(true);
    } catch {
      settled = true;
      reject(new HiddenPromptUnavailableError());
      return;
    }
    input.resume();
    input.setEncoding("utf8");
    input.on("data", onData);
  });
};
