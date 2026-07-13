/**
 * Generate .xlsx fixture for demo-seed.bat
 * Usage: node tools/demo/seed-office.mjs <demo-workspace-dir>
 */

import { writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const target = process.argv[2];
if (!target) {
  console.error("usage: node tools/demo/seed-office.mjs <dir>");
  process.exit(1);
}

mkdirSync(target, { recursive: true });

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "../../service/package.json"));
const XLSX = require("xlsx");

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
writeFileSync(join(target, "budget.xlsx"), XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

copyFileSync(join(here, "fixtures", "brief.docx"), join(target, "brief.docx"));
console.log("office fixtures written");
