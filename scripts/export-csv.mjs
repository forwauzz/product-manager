/* Export the feature inventory and the change log as CSV files, ready to become Google Sheets in Drive.
   Usage: node scripts/export-csv.mjs <base-url> [passcode] [outDir]
   Writes <outDir>/alie-product-features.csv and <outDir>/alie-product-change-log.csv */
import fs from "node:fs";
import path from "node:path";

const base = process.argv[2] || "http://localhost:4177";
const passcode = process.argv[3] || "";
const outDir = process.argv[4] || "data/exports";

let cookie = "";
if (passcode) {
  const r = await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passcode }) });
  if (!r.ok) { console.error("login failed", r.status); process.exit(1); }
  cookie = (r.headers.get("set-cookie") || "").split(";")[0];
}
const doc = await (await fetch(base + "/api/state", { headers: { Cookie: cookie } })).json();
const S = doc.state;
const byId = Object.fromEntries(S.features.map(f => [f.id, f]));
const projectName = (S.projects.find(p => p.id === S.current) || S.projects[0] || {}).name || "";

function plain(html) {
  return String(html || "").replace(/<li>/g, "• ").replace(/<\/(p|li|h3|h4|blockquote)>/g, " ").replace(/<br\s*\/?>/g, " ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}
function csv(rows) {
  return rows.map(r => r.map(v => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(",")).join("\n") + "\n";
}
function effort(f) { return f.effort ? f.effort + " " + (f.effort === 1 ? String(f.effortUnit || "weeks").slice(0, -1) : f.effortUnit || "weeks") : ""; }
function monthLabel(p) { if (!p) return ""; const [y, m, d] = p.split("-").map(Number); const dt = new Date(y, m - 1, d || 1); return d ? dt.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" }) : dt.toLocaleDateString("en-CA", { year: "numeric", month: "long" }); }
function division(f, sp) { const top = f.parent && byId[f.parent] ? byId[f.parent] : f; return (top.sections && top.sections[sp]) || ""; }
function icpNames(f) { return (f.icps || []).map(id => (S.icps.find(x => x.id === id) || {}).name).filter(Boolean).join("; "); }

const features = S.features.filter(f => f.project === S.current);
const mains = features.filter(f => !f.parent).sort((a, b) => a.name.localeCompare(b.name));
const rows = [["Spaces", "Division", "Feature", "Sub-feature", "State", "Owner", "Date", "Estimate", "R&D", "Profiles", "Description", "Drive link", "Last updated", "Id"]];
function divisions(m) { return m.spaces.map(sp => division(m, sp)).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join("; "); }
for (const m of mains) {
  const sp = m.spaces.join("; ");
  rows.push([sp, divisions(m), m.name, "", m.state, m.owner, monthLabel(m.period), effort(m), m.rnd ? "yes" : "", icpNames(m), plain(m.note), m.link || "", new Date(m.updated || 0).toISOString().slice(0, 10), m.id]);
  for (const k of features.filter(f => f.parent === m.id).sort((a, b) => a.name.localeCompare(b.name))) {
    rows.push([sp, divisions(m), m.name, k.name, k.state, k.owner, monthLabel(k.period), effort(k), k.rnd ? "yes" : "", icpNames(k), plain(k.note), k.link || "", new Date(k.updated || 0).toISOString().slice(0, 10), k.id]);
  }
}
const LOG_FIELDS = { created: "Created", deleted: "Deleted", name: "Name", state: "State", owner: "Owner", period: "Date", effort: "Estimate", spaces: "Spaces", parent: "Parent", rnd: "R&D", rndStage: "R&D stage", student: "Student", link: "Drive link", note: "Description", image: "Screenshot" };
const logRows = [["When", "Who", "Feature", "Change", "From", "To", "Why"]];
for (const e of (S.log || []).slice().sort((a, b) => b.t - a.t)) {
  logRows.push([new Date(e.t).toISOString().replace("T", " ").slice(0, 16), e.who, e.fname, LOG_FIELDS[e.field] || e.field, e.field === "period" ? monthLabel(e.from) : e.from, e.field === "period" ? monthLabel(e.to) : e.to, e.why || ""]);
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "alie-product-features.csv"), "﻿" + csv(rows));
fs.writeFileSync(path.join(outDir, "alie-product-change-log.csv"), "﻿" + csv(logRows));
console.log(projectName + ": " + (rows.length - 1) + " feature rows, " + (logRows.length - 1) + " log rows written to " + outDir);
