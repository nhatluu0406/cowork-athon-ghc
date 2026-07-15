/**
 * afterPack: embed cowork-ghc.ico into the Windows main executable.
 *
 * electron-builder's `signAndEditExecutable: true` path downloads winCodeSign and fails on
 * Windows without symlink privileges (Darwin dylib links in the archive). This hook uses
 * `rcedit` directly so Explorer shows the product icon without that toolset.
 */

const { join } = require("node:path");
const { existsSync } = require("node:fs");
const { rcedit } = require("rcedit");

/**
 * @param {import("electron-builder").AfterPackContext} context
 */
exports.default = async function afterPackWinIcon(context) {
  if (context.electronPlatformName !== "win32") return;

  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = join(context.appOutDir, exeName);
  const iconPath = join(context.packager.projectDir, "app", "shell", "assets", "cowork-ghc.ico");

  if (!existsSync(exePath)) {
    throw new Error(`afterPack icon: missing executable ${exePath}`);
  }
  if (!existsSync(iconPath)) {
    throw new Error(`afterPack icon: missing icon ${iconPath}`);
  }

  await rcedit(exePath, {
    icon: iconPath,
    "version-string": {
      CompanyName: "Cowork GHC",
      FileDescription: "Cowork GHC",
      ProductName: "Cowork GHC",
      LegalCopyright: "Copyright (c) 2026 Cowork GHC",
    },
  });
  console.log(`afterPack: embedded icon into ${exeName}`);
};
