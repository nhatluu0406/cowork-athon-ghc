/**
 * Typed MS365 errors. Messages/recovery are non-secret and user-safe (no token, no raw
 * Graph body). Mirrors the provider error discipline (kind + retryable + recovery).
 */
export type Ms365ErrorKind =
  | "not_connected"
  | "not_configured"
  | "auth_expired"
  | "insufficient_scope"
  | "precondition_failed"
  | "rate_limited"
  | "not_found"
  | "endpoint_blocked"
  | "timeout"
  | "graph_error";

export class Ms365Error extends Error {
  readonly kind: Ms365ErrorKind;
  readonly retryable: boolean;
  readonly recovery: string;
  readonly retryAfterMs?: number;
  constructor(kind: Ms365ErrorKind, message: string, recovery: string, retryable: boolean, retryAfterMs?: number) {
    super(message);
    this.name = "Ms365Error";
    this.kind = kind;
    this.recovery = recovery;
    this.retryable = retryable;
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
  }
}

export function mapGraphStatus(status: number, retryAfterHeader?: string | null): Ms365Error {
  if (status === 401) {
    return new Ms365Error("auth_expired", "Microsoft 365 authorization failed.", "Kết nối lại Microsoft 365.", false);
  }
  if (status === 403) {
    return new Ms365Error(
      "insufficient_scope",
      "The account lacks a required Microsoft Graph permission.",
      "Tài khoản thiếu quyền (scope) cho thao tác này — consent thêm quyền trong Graph Explorer hoặc nhờ admin, rồi lấy token mới.",
      false,
    );
  }
  if (status === 412) {
    return new Ms365Error(
      "precondition_failed",
      "The item changed since it was read (ETag mismatch).",
      "Đọc lại đối tượng (ví dụ planner_list_tasks) để lấy etag mới nhất rồi thử lại.",
      false,
    );
  }
  if (status === 404) {
    return new Ms365Error("not_found", "The requested Microsoft 365 resource was not found.", "Kiểm tra lại tên/đường dẫn.", false);
  }
  if (status === 429) {
    const secs = Number.parseInt(retryAfterHeader ?? "", 10);
    const retryAfterMs = Number.isFinite(secs) && secs > 0 ? secs * 1000 : 5000;
    return new Ms365Error("rate_limited", "Microsoft Graph rate limit reached.", "Thử lại sau ít phút.", true, retryAfterMs);
  }
  return new Ms365Error("graph_error", `Microsoft Graph request failed (status ${status}).`, "Thử lại; nếu tiếp diễn hãy kết nối lại.", status >= 500);
}
