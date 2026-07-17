/**
 * Embedded runtime-preview surface (Code surface web preview).
 *
 * A hardened {@link WebContentsView} attached to the main window and floated over the renderer's
 * Preview pane. This is deliberately NOT an `<iframe>` (which would force relaxing the renderer
 * CSP `frame-src` to `http://localhost:*`) and NOT a `<webview>` (denied app-wide). Because it is
 * a separate WebContents:
 *  - the renderer CSP / sandbox / contextIsolation posture is untouched;
 *  - the preview loads UNTRUSTED dev-server content in its OWN process + in-memory session, with
 *    NO preload (no bridge), and its own navigation lockdown;
 *  - only `http(s)://` loopback URLs are accepted; off-loopback navigation, popups, downloads,
 *    and `<webview>` attach are all denied; every permission request is refused.
 *
 * The renderer owns geometry: it measures the pane and calls `setBounds`, and hides the view
 * whenever a modal/permission dialog would otherwise be occluded.
 */

import { WebContentsView, session, type BrowserWindow } from "electron";
import type { PreviewLoadResult, PreviewViewBounds } from "@cowork-ghc/contracts";
import { isLoopbackHttpUrl } from "./preview-url.js";

export { isLoopbackHttpUrl } from "./preview-url.js";

/** In-memory session (no `persist:` prefix) so preview cookies/storage never touch disk. */
const PREVIEW_PARTITION = "cowork-runtime-preview";

export interface PreviewViewController {
  load(url: string): PreviewLoadResult;
  setBounds(bounds: PreviewViewBounds): void;
  hide(): void;
  reload(): void;
  close(): void;
}

export function createPreviewViewController(window: BrowserWindow): PreviewViewController {
  let view: WebContentsView | null = null;
  let sessionHardened = false;

  function ensureView(): WebContentsView {
    if (view !== null) return view;

    const previewSession = session.fromPartition(PREVIEW_PARTITION);
    if (!sessionHardened) {
      // Untrusted content gets no downloads and no device/media/geolocation permissions.
      previewSession.on("will-download", (event) => event.preventDefault());
      previewSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
      previewSession.setPermissionCheckHandler(() => false);
      sessionHardened = true;
    }

    const created = new WebContentsView({
      webPreferences: {
        partition: PREVIEW_PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        webviewTag: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        experimentalFeatures: false,
        // No preload: the preview is 3rd-party content and must get NO bridge into the app.
      },
    });
    const wc = created.webContents;
    // Navigation lockdown: loopback only. A dev server that tries to redirect off-loopback
    // (or the user clicking an external link) is blocked.
    wc.on("will-navigate", (event, url) => {
      if (!isLoopbackHttpUrl(url)) event.preventDefault();
    });
    wc.on("will-redirect", (event, url) => {
      if (!isLoopbackHttpUrl(url)) event.preventDefault();
    });
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    wc.on("will-attach-webview", (event) => event.preventDefault());

    window.contentView.addChildView(created);
    created.setVisible(false);
    view = created;
    return created;
  }

  return {
    load(url: string): PreviewLoadResult {
      if (!isLoopbackHttpUrl(url)) return { ok: false, error: "not_loopback" };
      const v = ensureView();
      void v.webContents.loadURL(url).catch(() => {
        /* connection errors surface as the page's own error UI; state is polled from the service */
      });
      return { ok: true };
    },
    setBounds(bounds: PreviewViewBounds): void {
      const v = ensureView();
      const width = Math.max(0, Math.round(bounds.width));
      const height = Math.max(0, Math.round(bounds.height));
      v.setBounds({ x: Math.round(bounds.x), y: Math.round(bounds.y), width, height });
      v.setVisible(bounds.visible && width > 0 && height > 0);
    },
    hide(): void {
      view?.setVisible(false);
    },
    reload(): void {
      view?.webContents.reload();
    },
    close(): void {
      if (view === null) return;
      const closing = view;
      view = null;
      try {
        window.contentView.removeChildView(closing);
      } catch {
        /* window may already be gone */
      }
      try {
        closing.webContents.close();
      } catch {
        /* already destroyed */
      }
    },
  };
}
