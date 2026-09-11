/* Export the feature inventory and the change log as CSV files, ready to become Google Sheets in Drive.
   Usage: node scripts/export-csv.mjs <base-url> [passcode] [outDir] */
import fs from "node:fs";
import path from "node:path";
import { featuresCsv, logCsv } from "../shared/exports.js";

const base = process.argv[2] || "http://localhost:4177";
const passcode = process.argv[3] || "";
const outDir = process.argv[4] || "data/exports";
let cookie = "";
if (passcode) {
  const r = await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passcode }) });
  if (!r.ok) { console.error("login failed", r.status); process.exit(1); }
  cookie = (r.headers.get("set-cookie") || "").split(";")[0];
}
const S = (await (await fetch(base + "/api/state", { headers: { Cookie: cookie } })).json()).state;
fs.mkdirSync(outDir, { recursive: true });
const f = featuresCsv(S), l = logCsv(S);
fs.writeFileSync(path.join(outDir, "alie-product-features.csv"), "\ufeff" + f);
fs.writeFileSync(path.join(outDir, "alie-product-change-log.csv"), "\ufeff" + l);
console.log((f.split("\n").length - 2) + " feature rows, " + (l.split("\n").length - 2) + " log rows written to " + outDir);
