/**
 * In-memory unlock session for the Electron main process (ADR 0007).
 * Password never touches disk, logs, or the renderer after the unlock response.
 * Cleared on quit; used to re-unlock the SQLite vault after settings-only → live restart.
 */

export interface RememberedUnlock {
  readonly username: string;
  readonly password: string;
}

let remembered: RememberedUnlock | null = null;

export function rememberUnlock(username: string, password: string): void {
  const user = username.trim();
  if (user.length === 0 || password.length === 0) return;
  remembered = { username: user, password };
}

export function clearRememberedUnlock(): void {
  remembered = null;
}

export function peekRememberedUnlock(): RememberedUnlock | null {
  return remembered;
}
