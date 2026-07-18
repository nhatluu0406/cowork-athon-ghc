/**
 * Auth HTTP router — status / setup / unlock / lock (ADR 0007).
 * Never returns password verifier, vault key, or raw secrets.
 */

import type { BoundaryRouter, RouteContext, RouteResult } from "../boundary/contract.js";
import { BadRequestError } from "../server/http-util.js";
import { AuthError, type LocalAuthService } from "./local-auth.js";

export const AUTH_STATUS_PATH = "/v1/auth/status";
export const AUTH_SETUP_PATH = "/v1/auth/setup";
export const AUTH_UNLOCK_PATH = "/v1/auth/unlock";
export const AUTH_LOCK_PATH = "/v1/auth/lock";
export const AUTH_CHANGE_PASSWORD_PATH = "/v1/auth/change-password";
export const AUTH_AUTO_UNLOCK_STATUS_PATH = "/v1/auth/auto-unlock";
export const AUTH_AUTO_UNLOCK_ENABLE_PATH = "/v1/auth/auto-unlock/enable";
export const AUTH_AUTO_UNLOCK_DISABLE_PATH = "/v1/auth/auto-unlock/disable";

export class AuthRequestError extends BadRequestError {
  constructor(message: string) {
    super(message);
    this.name = "AuthRequestError";
  }
}

function parseCredentials(body: unknown): { username: string; password: string } {
  if (typeof body !== "object" || body === null) {
    throw new AuthRequestError("Request body must be a JSON object.");
  }
  const record = body as Record<string, unknown>;
  const username = record["username"];
  const password = record["password"];
  if (typeof username !== "string" || username.trim().length === 0) {
    throw new AuthRequestError("username is required.");
  }
  if (typeof password !== "string" || password.length === 0) {
    throw new AuthRequestError("password is required.");
  }
  return { username, password };
}

function rethrowAuth(err: unknown): never {
  if (err instanceof AuthRequestError) throw err;
  if (err instanceof AuthError) throw new AuthRequestError(err.message);
  throw err;
}

export interface AuthRouterOptions {
  readonly auth: LocalAuthService;
  /** Optional post-unlock hook (e.g. keyring → vault migration). Must not throw secrets. */
  readonly onUnlocked?: () => Promise<void>;
  /** Shell may remember credentials in-process for live-restart re-unlock. Never log. */
  readonly rememberUnlock?: (username: string, password: string) => void;
}

export function createAuthRouter(options: AuthRouterOptions): BoundaryRouter {
  const { auth, onUnlocked, rememberUnlock } = options;

  const status = (): RouteResult => ({
    status: 200,
    data: auth.status(),
  });

  const setup = async (ctx: RouteContext): Promise<RouteResult> => {
    try {
      const { username, password } = parseCredentials(ctx.body);
      const result = await auth.setup(username, password);
      rememberUnlock?.(username.trim(), password);
      if (onUnlocked !== undefined) await onUnlocked();
      return {
        status: 200,
        data: { state: "unlocked" as const, username: username.trim(), userId: result.userId },
      };
    } catch (err) {
      rethrowAuth(err);
    }
  };

  const unlock = async (ctx: RouteContext): Promise<RouteResult> => {
    try {
      const { username, password } = parseCredentials(ctx.body);
      const result = await auth.unlock(username, password);
      rememberUnlock?.(username.trim(), password);
      if (onUnlocked !== undefined) await onUnlocked();
      return {
        status: 200,
        data: { state: "unlocked" as const, username: username.trim(), userId: result.userId },
      };
    } catch (err) {
      rethrowAuth(err);
    }
  };

  const lock = (): RouteResult => {
    auth.lock();
    return { status: 200, data: auth.status() };
  };

  // --- Device-bound auto-unlock (login-not-required mode). Shell-orchestrated: the shell supplies
  // the user's password (confirmation) + a self-generated deviceSecret (which it seals with
  // safeStorage). The deviceSecret is never returned or logged. ---

  const autoUnlockStatus = (): RouteResult => ({
    status: 200,
    data: { hasEnvelope: auth.hasAutoUnlockEnvelope() },
  });

  const requireField = (body: unknown, field: string): string => {
    if (typeof body !== "object" || body === null) {
      throw new AuthRequestError("Request body must be a JSON object.");
    }
    const value = (body as Record<string, unknown>)[field];
    if (typeof value !== "string" || value.length === 0) {
      throw new AuthRequestError(`${field} is required.`);
    }
    return value;
  };

  const enableAutoUnlock = (ctx: RouteContext): RouteResult => {
    try {
      const password = requireField(ctx.body, "password");
      const deviceSecret = requireField(ctx.body, "deviceSecret");
      if (!auth.verifyCurrentPassword(password)) {
        throw new AuthRequestError("Invalid password.");
      }
      auth.enableAutoUnlock(deviceSecret);
      return { status: 200, data: { ok: true, hasEnvelope: true } };
    } catch (err) {
      rethrowAuth(err);
    }
  };

  const disableAutoUnlock = (ctx: RouteContext): RouteResult => {
    try {
      const password = requireField(ctx.body, "password");
      if (!auth.verifyCurrentPassword(password)) {
        throw new AuthRequestError("Invalid password.");
      }
      auth.disableAutoUnlock();
      return { status: 200, data: { ok: true, hasEnvelope: false } };
    } catch (err) {
      rethrowAuth(err);
    }
  };

  const changePassword = (ctx: RouteContext): RouteResult => {
    try {
      const currentPassword = requireField(ctx.body, "currentPassword");
      const newPassword = requireField(ctx.body, "newPassword");
      auth.changePassword(currentPassword, newPassword);
      return { status: 200, data: { ok: true } };
    } catch (err) {
      rethrowAuth(err);
    }
  };

  return {
    name: "auth",
    routes: [
      { method: "GET", path: AUTH_STATUS_PATH, handler: status },
      { method: "POST", path: AUTH_SETUP_PATH, handler: setup },
      { method: "POST", path: AUTH_UNLOCK_PATH, handler: unlock },
      { method: "POST", path: AUTH_LOCK_PATH, handler: lock },
      { method: "POST", path: AUTH_CHANGE_PASSWORD_PATH, handler: changePassword },
      { method: "GET", path: AUTH_AUTO_UNLOCK_STATUS_PATH, handler: autoUnlockStatus },
      { method: "POST", path: AUTH_AUTO_UNLOCK_ENABLE_PATH, handler: enableAutoUnlock },
      { method: "POST", path: AUTH_AUTO_UNLOCK_DISABLE_PATH, handler: disableAutoUnlock },
    ],
  };
}
