// electron-builder.config.cjs
// Dynamic config: conditionally includes M365KG vendor ZIPs only if they exist.
// This allows iterative dev builds without the ~600 MB vendor download.
// For a full release build, run scripts\vendor-download.ps1 first.
//
// Must be .cjs (not .js) because package.json has "type": "module" and
// electron-builder loads this file with require().
const { existsSync } = require("fs");
const { join } = require("path");

const root = __dirname;

function vendorResource(zipFile, dest) {
  const from = join(root, "vendor", zipFile);
  if (!existsSync(from)) return null;
  return { from, to: dest };
}

function binaryResource(relPath, dest) {
  const from = join(root, relPath);
  if (!existsSync(from)) return null;
  return { from, to: dest };
}

const extraResources = [
  { from: "node_modules/opencode-ai/bin/opencode.exe", to: "opencode/opencode.exe" },
  { from: "skills/builtin", to: "skills" },
  { from: "app/backend/migrations", to: "m365kg-migrations" },
  binaryResource("app/llm-svc/models.yaml", "llm-svc/models.yaml"),
  binaryResource("app/llm-svc/target/release/llm-svc.exe", "llm-svc/llm-svc.exe"),
  binaryResource("app/backend/bin/m365-knowledge-graph.exe", "m365kg-backend/m365-knowledge-graph.exe"),
  vendorResource("postgresql-16.14-windows-x64-binaries.zip", "m365kg-vendor/postgresql.zip"),
  vendorResource("neo4j-community-5.26.28-windows.zip",        "m365kg-vendor/neo4j.zip"),
  vendorResource("jre-21-windows-x64.zip",                     "m365kg-vendor/jre.zip"),
].filter(Boolean);

const missingVendor = [
  "postgresql-16.14-windows-x64-binaries.zip",
  "neo4j-community-5.26.28-windows.zip",
  "jre-21-windows-x64.zip",
].filter((f) => !existsSync(join(root, "vendor", f)));

if (missingVendor.length > 0) {
  console.warn(
    `[electron-builder] WARN: M365KG vendor ZIPs missing (${missingVendor.join(", ")}).\n` +
    `  Run scripts\\vendor-download.ps1 for a full release build.`
  );
}

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: "com.coworkghc.desktop",
  productName: "Cowork GHC",
  copyright: "Copyright (c) 2026 Cowork GHC",

  directories: { output: "dist-app" },

  asar: true,
  asarUnpack: [
    "**/node_modules/@napi-rs/keyring/**",
    "**/node_modules/@napi-rs/keyring-win32-x64-msvc/**",
  ],

  files: [
    "app/shell/dist/**",
    "app/ui/dist/**",
    "node_modules/@napi-rs/keyring/**",
    "node_modules/@napi-rs/keyring-win32-x64-msvc/**",
    "package.json",
    "app/shell/package.json",
    "!app/shell/dist/**/*.js",
    "!**/*.map",
    "!**/*.ts",
    "!**/*.tsbuildinfo",
    "!**/tsconfig*.json",
  ],

  extraResources,

  win: {
    target: ["nsis", "portable"],
    signAndEditExecutable: false,
  },

  forceCodeSigning: false,

  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    artifactName: "${productName}-${version}-setup.${ext}",
  },

  portable: {
    artifactName: "${productName}-${version}-portable.${ext}",
  },
};
