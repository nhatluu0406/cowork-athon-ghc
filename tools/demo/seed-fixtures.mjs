/**
 * One-shot generator for tools/demo/fixtures (run from repo root).
 * Usage: node tools/demo/seed-fixtures.mjs
 */

import { writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixtures = join(root, "tools", "demo", "fixtures");
const require = createRequire(join(root, "service", "package.json"));
const XLSX = require("xlsx");

mkdirSync(fixtures, { recursive: true });

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  wb,
  XLSX.utils.aoa_to_sheet([
    ["Item", "Qty"],
    ["Widget", "3"],
    ["Gadget", "7"],
  ]),
  "Budget",
);
writeFileSync(join(fixtures, "budget.xlsx"), XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

const build = join(root, "tools", "demo", "_docx_build");
rmSync(build, { recursive: true, force: true });
mkdirSync(join(build, "_rels"), { recursive: true });
mkdirSync(join(build, "word", "_rels"), { recursive: true });
writeFileSync(
  join(build, "[Content_Types].xml"),
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
);
writeFileSync(
  join(build, "_rels", ".rels"),
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
);
writeFileSync(
  join(build, "word", "document.xml"),
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Demo brief for Cowork GHC workspace companion.</w:t></w:r></w:p></w:body></w:document>',
);
writeFileSync(
  join(build, "word", "_rels", "document.xml.rels"),
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
);

const zipPath = join(fixtures, "brief.zip");
rmSync(zipPath, { force: true });
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${build.replace(/'/g, "''")}/*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
  { stdio: "inherit" },
);
writeFileSync(join(fixtures, "brief.docx"), readFileSync(zipPath));
rmSync(zipPath, { force: true });
rmSync(build, { recursive: true, force: true });
console.log("fixtures written to", fixtures);
