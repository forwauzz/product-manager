#!/usr/bin/env node
/* Load data/alie-feature-inventory.json into a running Product Manager (local or Cloudflare).
   Usage: node scripts/import-inventory.mjs <baseUrl> [passcode] [--project=ALIE]
   Idempotent: features are matched by name inside the target project. Existing features keep
   their notes, states and tags; only missing features are created, and parent links are (re)applied. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const [base, passcode] = process.argv.slice(2).filter(a => !a.startsWith("--"));
const projectName = (process.argv.find(a => a.startsWith("--project=")) || "--project=ALIE").split("=")[1];
if (!base) { console.error("usage: node scripts/import-inventory.mjs <baseUrl> [passcode]"); process.exit(1); }

const inv = JSON.parse(fs.readFileSync(path.join(here, "..", "data", "alie-feature-inventory.json"), "utf8"));
let cookie = "";

async function api(method, url, body) {
  const r = await fetch(base + url, {
    method,
    headers: Object.assign({ Cookie: cookie }, body !== undefined ? { "Content-Type": "application/json" } : {}),
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { /* not json */ }
  if (!r.ok) throw new Error(method + " " + url + " -> " + r.status + " " + (json && json.error ? json.error : text.slice(0, 120)));
  return json;
}

const session = await api("GET", "/api/session");
if (session.required && !session.authed) {
  if (!passcode) { console.error("This server needs a passcode."); process.exit(1); }
  const r = await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passcode }) });
  if (!r.ok) { console.error("login failed"); process.exit(1); }
  cookie = (r.headers.get("set-cookie") || "").split(";")[0];
}

const projects = await api("GET", "/api/projects");
const project = projects.find(p => p.name === projectName);
if (!project) { console.error("project not found: " + projectName); process.exit(1); }

const existing = await api("GET", "/api/features?project=" + project.id);
const byName = new Map(existing.map(f => [f.name.toLowerCase(), f]));

let created = 0, skipped = 0, linked = 0, patched = 0;
async function ensure(f, parentId) {
  let rec = byName.get(f.name.toLowerCase());
  if (!rec) {
    rec = await api("POST", "/api/features", {
      project: project.id, name: f.name, state: f.state || "Live", spaces: f.spaces || [], note: f.note || "",
      owner: "Unassigned", period: null, parent: parentId || null, sections: f.sections || {}
    });
    byName.set(f.name.toLowerCase(), rec);
    created++;
  } else {
    skipped++;
    const patch = {};
    if ((rec.parent || null) !== (parentId || null)) patch.parent = parentId || null;
    if (f.sections && JSON.stringify(f.sections) !== JSON.stringify(rec.sections || {})) patch.sections = f.sections;
    if (Object.keys(patch).length) {
      await api("PATCH", "/api/features/" + rec.id, patch);
      Object.assign(rec, patch);
      linked++;
    }
  }
  for (const c of f.children || []) await ensure(c, rec.id);
}
for (const f of inv.features) await ensure(f, null);

for (const p of inv.patches || []) {
  const f = byName.get(p.name.toLowerCase());
  if (!f) continue;
  const body = {};
  ["state", "spaces", "note", "owner", "sections"].forEach(k => { if (p[k] !== undefined) body[k] = p[k]; });
  await api("PATCH", "/api/features/" + f.id, body);
  patched++;
}
const after = await api("GET", "/api/features?project=" + project.id);
console.log(base + ": created " + created + ", already there " + skipped + ", parent links applied " + linked + ", patched " + patched +
  ". " + project.name + " now has " + after.length + " features (" + after.filter(f => f.parent).length + " sub-features), " + after.filter(f => f.state === "Live").length + " live.");
