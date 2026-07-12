/**
 * Renderer entry.
 *
 * Drives a PROGRESSIVE, honest cold-start (CGHC-025): the readiness controller owns the shell
 * handshake and health polling with bounded backoff, and the readiness view reflects the true
 * boot phase (starting → connecting → ready, or an honest not_connected / unreachable with Retry
 * + diagnostics). Nothing is ever a fabricated "ready" — the feature views mount ONLY after a real
 * successful `health()`. No business logic, no filesystem/credential access, no secret in the DOM.
 * The live multi-process supervisor (spawn + crash/restart) is Tier-2 (CGHC-028).
 */

import { initialSessionView } from "@cowork-ghc/service/execution";
import { getShellBridge } from "./bridge.js";
import { createServiceClient, type ServiceClient } from "./service-client.js";
import { createReadinessController } from "./readiness-controller.js";
import { createReadinessView } from "./readiness-view.js";
import { mountWorkspacePicker } from "./workspace-picker.js";
import { mountSettingsView } from "./settings-view.js";
import { createTimelineView } from "./timeline-view.js";
import { createPermissionController } from "./permission-controller.js";

function main(): void {
  const root = document.getElementById("app");
  if (!(root instanceof HTMLElement)) {
    return;
  }
  root.replaceChildren();

  const title = document.createElement("h1");
  title.className = "scaffold-title";
  title.textContent = "Cowork GHC";
  const note = document.createElement("p");
  note.className = "scaffold-note";
  note.textContent =
    "Kết nối local service, chọn workspace, cấu hình provider, rồi khởi động phiên Cowork.";
  root.append(title, note);

  // The readiness surface renders into its OWN container so health re-polls never wipe the
  // mounted feature views below it.
  const readinessRoot = document.createElement("div");
  readinessRoot.className = "readiness-root";
  root.append(readinessRoot);

  // Capture the live client the controller builds from the handshake, so the feature views
  // (which need the full client surface) reuse it once we are truthfully ready.
  let activeClient: ServiceClient | null = null;
  let featuresMounted = false;

  const readiness = createReadinessController({
    getBootstrap: () => getShellBridge().getBootstrap(),
    createClient: (baseUrl, clientToken) => {
      activeClient = createServiceClient(baseUrl, clientToken);
      return activeClient;
    },
    onState: (state) => {
      view.update(state);
      if (state.phase === "ready" && !featuresMounted && activeClient !== null) {
        featuresMounted = true;
        mountFeatures(root, activeClient);
      }
    },
  });

  const view = createReadinessView(readinessRoot, { onRetry: () => readiness.retry() });
  readiness.start();
}

/** Mount the feature views once, after a real successful health response. */
function mountFeatures(root: HTMLElement, client: ServiceClient): void {
  const bridge = getShellBridge();
  const sessionHint = document.createElement("p");
  sessionHint.className = "workspace-session-hint";
  sessionHint.textContent = "Chọn một workspace hợp lệ trước khi bắt đầu phiên làm việc.";

  // W1/W2/W3: native folder picker + server-validated grant + recent list.
  mountWorkspacePicker(root, {
    bridge,
    client,
    onActivated: () => {
      sessionHint.hidden = true;
    },
    onDeactivated: () => {
      sessionHint.hidden = false;
    },
  });
  root.append(sessionHint);
  // CGHC-022: settings view — a client of the service.
  mountSettingsView(root, { client });
  // CGHC-015: honest EV timeline. It mounts idle now; the live stream is wired once a session
  // exists (a later task). No fabricated activity.
  const timeline = createTimelineView(root);
  timeline.update(initialSessionView(""));
  // CGHC-017: Allow/Deny permission modal. It polls the real pending list; a Deny maps to a real
  // server-side block at the execution boundary.
  const permissions = createPermissionController({ client, container: root });
  permissions.start();
}

main();
