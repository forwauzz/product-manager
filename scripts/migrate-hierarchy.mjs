#!/usr/bin/env node
/* Apply the renames, deletes, note syncs and the space rename declared in the inventory file, then re-import.
   Usage: node scripts/migrate-hierarchy.mjs <baseUrl> [passcode] */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const here = path.dirname(fileURLToPath(import.meta.url));
const [base, passcode] = process.argv.slice(2);
const inv = JSON.parse(fs.readFileSync(path.join(here, "..", "data", "alie-feature-inventory.json"), "utf8"));
let cookie = "";
async function api(method, url, body) {
  const r = await fetch(base + url, { method, headers: Object.assign({ Cookie: cookie }, body !== undefined ? { "Content-Type": "application/json" } : {}), body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text(); if (!r.ok) throw new Error(method + " " + url + " -> " + r.status + " " + t.slice(0, 100)); return t ? JSON.parse(t) : null;
}
const session = await api("GET", "/api/session");
if (session.required && !session.authed) {
  const r = await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passcode }) });
  cookie = (r.headers.get("set-cookie") || "").split(";")[0];
}
const doc = await api("GET", "/api/state");
const s = doc.state;
const alie = s.projects.find(p => p.name === "ALIE");
const byName = n => s.features.find(f => f.project === alie.id && f.name.toLowerCase() === n.toLowerCase());
let renamed = 0, deleted = 0, synced = 0;
for (const [from, to] of Object.entries(inv.renames || {})) { const f = byName(from); if (f && !byName(to)) { f.name = to; renamed++; } }
for (const n of inv.deletes || []) { const f = byName(n); if (f) { s.features = s.features.filter(x => x.id !== f.id); deleted++; } }
const notes = new Map();
(function walk(list) { for (const f of list) { notes.set(f.name, f.note || ""); walk(f.children || []); } })(inv.features);
for (const n of inv.noteSync || []) { const f = byName(n); if (f && notes.has(n)) { f.note = notes.get(n); synced++; } }
if (s.spaces.includes("Administrative") && !s.spaces.includes("ALIE Admin")) {
  s.spaces = s.spaces.map(x => x === "Administrative" ? "ALIE Admin" : x);
  s.features.forEach(f => { f.spaces = (f.spaces || []).map(x => x === "Administrative" ? "ALIE Admin" : x); });
}
await api("PUT", "/api/state", { version: doc.version, state: s });
console.log(base + ": renamed " + renamed + ", deleted " + deleted + ", notes synced " + synced + ", spaces " + s.spaces.join(" / "));
execFileSync("node", [path.join(here, "import-inventory.mjs"), base, passcode || ""].filter(Boolean), { stdio: "inherit" });
