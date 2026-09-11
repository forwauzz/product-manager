#!/usr/bin/env node
/* Upload the screenshots in data/shots/ to another Product Manager instance (normally the Cloudflare one).
   Usage: node scripts/sync-shots.mjs <baseUrl> [passcode]
   Only features that exist on the target (by id) get a screenshot; images larger than 900 KB are skipped. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "..", "data", "shots");
const [base, passcode] = process.argv.slice(2);
if (!base) { console.error("usage: node scripts/sync-shots.mjs <baseUrl> [passcode]"); process.exit(1); }
let cookie = "";
async function api(method, url, body) {
  const r = await fetch(base + url, { method, headers: Object.assign({ Cookie: cookie }, body !== undefined ? { "Content-Type": "application/json" } : {}), body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(method + " " + url + " -> " + r.status + " " + t.slice(0, 120));
  return t ? JSON.parse(t) : null;
}
const session = await api("GET", "/api/session");
if (session.required && !session.authed) {
  const r = await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passcode }) });
  if (!r.ok) { console.error("login failed"); process.exit(1); }
  cookie = (r.headers.get("set-cookie") || "").split(";")[0];
}
const features = await api("GET", "/api/features");
const ids = new Set(features.map(f => f.id));
let sent = 0, skipped = 0, missing = 0, failed = 0;
for (const file of fs.readdirSync(dir)) {
  const m = /^(.+)\.(jpg|png|webp)$/.exec(file);
  if (!m) continue;
  if (!ids.has(m[1])) { missing++; continue; }
  const buf = fs.readFileSync(path.join(dir, file));
  if (buf.length > 900 * 1024) { skipped++; continue; }
  const mime = m[2] === "jpg" ? "image/jpeg" : "image/" + m[2];
  try {
    await api("POST", "/api/shots", { feature: m[1], data: "data:" + mime + ";base64," + buf.toString("base64") });
    sent++;
  } catch (e) { failed++; console.error(file, e.message); }
}
console.log(base + ": uploaded " + sent + " screenshots, " + skipped + " too large, " + missing + " without a matching feature, " + failed + " failed.");
