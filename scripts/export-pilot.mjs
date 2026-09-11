/* Export one pilot as a Markdown record (for the firm's Drive folder).
   Usage: node scripts/export-pilot.mjs <base-url> <passcode-or-empty> "<pilot name>" [outDir]
   Writes <outDir>/pilot-<slug>.md and prints a short summary. */
import fs from "node:fs";
import path from "node:path";

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
const byId = Object.fromEntries(S.features.map(f => [f.id, f]));
const feat = id => byId[id];
const fname = f => (f.parent && byId[f.parent] ? byId[f.parent].name + " › " : "") + f.name;

function text(html) {
  return String(html || "")
    .replace(/<h[34][^>]*>/g, "\n### ").replace(/<\/h[34]>/g, "\n")
    .replace(/<li>/g, "- ").replace(/<\/li>/g, "\n").replace(/<\/(p|blockquote)>/g, "\n\n").replace(/<br\s*\/?>/g, "\n")
    .replace(/<b>|<strong>/g, "**").replace(/<\/b>|<\/strong>/g, "**").replace(/<i>|<em>/g, "_").replace(/<\/i>|<\/em>/g, "_")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g, "$2 ($1)")
    .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n").trim();
}
const effort = f => f.effort ? f.effort + " " + (f.effort === 1 ? String(f.effortUnit || "weeks").slice(0, -1) : f.effortUnit || "weeks") : "";
const frow = f => `- ${fname(f)} — ${f.state}${f.owner && f.owner !== "Unassigned" ? " · " + f.owner : ""}${f.period ? " · " + f.period : ""}${effort(f) ? " · takes " + effort(f) : ""}`;
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
const icp = p.icp ? (S.icps.find(x => x.id === p.icp) || {}).name : "";

let md = `# ALIE pilot record — ${p.name}\n\nExported ${stamp} UTC from the ALIE Product Manager. The app is the source of truth for this record; this copy lives in the firm's Drive folder for the team.\n\n`;
md += `## Overview\n\n- Status: ${p.status}\n- Since: ${p.since || "—"}\n- Contact: ${p.contact || "—"}\n- Buyer profile: ${icp || "—"}\n- Drive folder: ${p.link || "—"}\n\n`;
if (p.notes) md += `### Notebook\n\n${text(p.notes)}\n\n`;
const wants = (p.wants || []).map(feat).filter(Boolean), needs = (p.needs || []).map(feat).filter(Boolean);
const live = wants.filter(f => f.state === "Live" || f.state === "Needs work");
md += `## They asked for (${wants.length})\n\n${wants.map(frow).join("\n") || "- nothing yet"}\n\n`;
md += `## Requested features shipped (${live.length})\n\n${live.map(frow).join("\n") || "- none yet"}\n\n`;
md += `## We think they will need (${needs.length})\n\n${needs.map(frow).join("\n") || "- nothing yet"}\n\n`;
const rq = p.requests || [];
md += `## Requests (${rq.length})\n\n`;
rq.forEach((r, i) => {
  md += `### ${i + 1}. ${r.title}\n\n- Decision: ${r.decision}${r.reason ? " — " + r.reason : ""}\n- Fit: ${r.fit || "not assessed"}\n${r.source ? "- Source: " + r.source + "\n" : ""}${r.feature && byId[r.feature] ? "- Promoted to feature: " + byId[r.feature].name + " (" + byId[r.feature].state + ")\n" : ""}\n`;
  if (r.bottleneck) md += `**Current bottleneck**\n\n${text(r.bottleneck)}\n\n`;
  if (r.need) md += `**Business need**\n\n${text(r.need)}\n\n`;
  if (r.solution) md += `**Possible solution**\n\n${text(r.solution)}\n\n`;
});
if (!rq.length) md += "- none yet\n\n";
const dl = p.deliverables || [];
md += `## Deliverables (${dl.length})\n\n`;
dl.forEach((d, i) => {
  const fs2 = (d.features || []).map(feat).filter(Boolean);
  const liveN = fs2.filter(f => ["Live", "Needs work", "Feature flag"].indexOf(f.state) !== -1).length;
  md += `### ${i + 1}. ${d.title}${d.tag ? " · " + d.tag : ""}\n\n${fs2.length ? liveN + " of " + fs2.length + " features live" : "no features tagged"}\n\n`;
  if (d.note) md += `${text(d.note)}\n\n`;
  if (fs2.length) md += fs2.map(frow).join("\n") + "\n\n";
});
if (!dl.length) md += "- none yet\n\n";
const st = p.stack || [];
md += `## Software and partners (${st.length})\n\n`;
["Software", "Partner"].forEach(kind => {
  const items = st.filter(x => x.kind === kind);
  if (!items.length) return;
  md += `### ${kind === "Software" ? "Software they use" : "Firms and partners"}\n\n`;
  items.forEach(x => { md += `- **${x.name}**${x.category ? " · " + x.category : ""}${x.link ? " · " + x.link : ""}\n${x.usage ? "  " + text(x.usage).replace(/\n+/g, " ") + "\n" : ""}`; });
  md += "\n";
});
if (!st.length) md += "- none yet\n\n";

fs.mkdirSync(outDir, { recursive: true });
const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const file = path.join(outDir, "pilot-" + slug + ".md");
fs.writeFileSync(file, md);
console.log(`${p.name}: ${wants.length} asks, ${needs.length} needs, ${rq.length} requests, ${dl.length} deliverables, ${st.length} software/partners, notes ${p.notes ? text(p.notes).length + " chars" : "empty"} → ${file}`);
