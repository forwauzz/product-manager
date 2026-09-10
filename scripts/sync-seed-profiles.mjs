#!/usr/bin/env node
/* One-off: bring profiles created before avatars/regimes/facts existed in line with the seed, matched by name.
   Usage: node scripts/sync-seed-profiles.mjs <baseUrl> [passcode] */
import { seedIcps } from "../shared/core.js";
const [base, passcode] = process.argv.slice(2);
let cookie = "";
async function api(method, url, body) {
  const r = await fetch(base + url, { method, headers: Object.assign({ Cookie: cookie }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(method + " " + url + " -> " + r.status);
  return r.status === 204 ? null : r.json();
}
const session = await api("GET", "/api/session");
if (session.required && !session.authed) {
  const r = await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passcode }) });
  if (!r.ok) throw new Error("login failed");
  cookie = (r.headers.get("set-cookie") || "").split(";")[0];
}
const seed = seedIcps();
const live = await api("GET", "/api/icps");
const byName = new Map(live.map(i => [i.name, i]));
let n = 0;
for (const s of seed) {
  const t = byName.get(s.name);
  if (!t) continue;
  const regimes = s.regimes.map(rid => { const sr = seed.find(x => x.id === rid); const lr = sr && byName.get(sr.name); return lr && lr.id; }).filter(Boolean);
  const body = { kind: s.kind, avatar: s.avatar, regimes, tam: s.tam, notes: s.notes };
  if (!t.facts || !t.facts.length) body.facts = s.facts;
  await api("PATCH", "/api/icps/" + t.id, body);
  n++;
}
console.log(base + ": updated " + n + " seeded profiles");
