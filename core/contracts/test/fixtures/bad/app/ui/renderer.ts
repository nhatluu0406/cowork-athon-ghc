// FIXTURE (forbidden direction): an app/ui file importing the Electron shell and
// electron directly. This MUST be flagged by the boundary lint. NOT compiled by tsc
// (test/fixtures is excluded); it exists only as text for the boundary lint to scan.
import { app } from "electron";
import { createWindow } from "@cowork-ghc/shell";
import { supervisor } from "../../../app/shell/supervisor.js";

export function bootBadly(): void {
  void app;
  void createWindow;
  void supervisor;
}
