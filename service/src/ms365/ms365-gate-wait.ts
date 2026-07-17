/**
 * Chờ quyết định thật của user cho một PermissionRequest đã submit. Sửa deny-loop: trước đây
 * proceed chạy cùng tick với submit nên state luôn "pending" → write không bao giờ hoàn tất.
 * Vòng poll đọc gate qua 2 API sẵn có (KHÔNG sửa PermissionGate core): `isAllowed` → allowed;
 * requestId rời `pending()` mà không allowed → denied (phủ cả Deny tay lẫn fail-closed timeout
 * của gate — timer tự deny làm pending biến mất). Hard cap chống treo nếu gate kẹt bất thường.
 */
import type { PermissionGate } from "../permission/index.js";

const POLL_INTERVAL_MS = 250;
const HARD_CAP_MS = 180_000;

export async function awaitGateDecision(
  gate: Pick<PermissionGate, "isAllowed" | "pending">,
  requestId: string,
  wait: (ms: number) => Promise<void>,
): Promise<"allowed" | "denied"> {
  const maxPolls = Math.ceil(HARD_CAP_MS / POLL_INTERVAL_MS);
  for (let i = 0; i <= maxPolls; i += 1) {
    if (gate.isAllowed(requestId)) return "allowed";
    if (!gate.pending().some((r) => r.requestId === requestId)) return "denied";
    if (i < maxPolls) await wait(POLL_INTERVAL_MS);
  }
  return "denied";
}

/** Default `wait` seam for {@link awaitGateDecision}: a real `setTimeout`. Lives here (not in
 * ms365-tools.ts) so both ms365-tools.ts and ms365-batch-tools.ts can import it without a
 * runtime import cycle between those two modules. Tests inject an instant `wait` via
 * `ToolDeps.wait` instead of waiting out `POLL_INTERVAL_MS` for real. */
export function defaultWait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
