/**
 * DOM environment for the renderer unit tests.
 *
 * Registers happy-dom's globals (`document`/`window`/`HTMLElement`/…) so the timeline view
 * — which builds real DOM via `document.createElement` — can be asserted against without a
 * browser. Imported for its side effect at the top of each `*.test.ts`. Idempotent: a second
 * import (node runs each test file in its own process, but the guard keeps this safe) is a
 * no-op. No network, no timers — purely a synchronous DOM shim.
 */

import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register();
}

// Lets React's `act()` (used by React-component tests) know it's running in a test
// environment, so it flushes effects/state updates synchronously instead of warning.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
