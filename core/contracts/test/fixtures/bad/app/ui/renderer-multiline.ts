// FIXTURE (forbidden direction, MULTI-LINE): proves the lint catches imports that
// span multiple lines (the single-line renderer.ts alone would give false green).
// NOT compiled by tsc (test/fixtures excluded); scanned only as text.
import {
  app,
  BrowserWindow,
} from "electron";

export async function bootBadlyMultiline(): Promise<void> {
  const shell = await import(
    "@cowork-ghc/shell"
  );
  const supervisor = require(
    "../../../app/shell/supervisor.js"
  );
  void app;
  void BrowserWindow;
  void shell;
  void supervisor;
}
