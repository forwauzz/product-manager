/* Export one pilot as a Markdown record (for the firm's Drive folder).
   Usage: node scripts/export-pilot.mjs <base-url> <passcode-or-empty> "<pilot name>" [outDir] */
import fs from "node:fs";
import path from "node:path";
import { pilotMarkdown } from "../shared/exports.js";

const [base = "http://localhost:4177", passcode = "", pilotName = "", outDir = "data/exports"] = process.argv.slice(2);
if (!pilotName) { console.error("pilot name required"); process.exit(1); }
let cookie = "";
if (passcode) {
  const r = await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passcode }) });
  if (!r.ok) { console.error("login failed", r.status); process.exit(1); }
  cookie = (r.headers.get("set-cookie") || "").split(";")[0];
}
const S = (await (await fetch(base + "/api/state", { headers: { Cookie: cookie } })).json()).state;
const p = (S.pilots || []).find(x => x.name === pilotName);
if (!p) { console.error("pilot not found: " + pilotName); process.exit(1); }
const md = pilotMarkdown(S, p);
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, "pilot-" + p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") + ".md");
fs.writeFileSync(file, md);
console.log(`${p.name}: ${(p.wants || []).length} asks, ${(p.needs || []).length} needs, ${(p.requests || []).length} requests, ${(p.deliverables || []).length} deliverables, ${(p.stack || []).length} software/partners → ${file}`);
