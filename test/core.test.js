import { test } from "node:test";
import assert from "node:assert/strict";
import { handleApi, MemoryStore, ConflictError, normalize, seed, STATES, RND_STAGES } from "../shared/core.js";
import { markdownText, rndMarkdown } from "../shared/exports.js";

test("seed is well formed and normalize is idempotent", () => {
  const s = normalize(seed());
  assert.equal(s.projects.length, 3);
  assert.ok(s.features.every(f => STATES.includes(f.state) && RND_STAGES.includes(f.rndStage)));
  const again = normalize(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(again, s);
});

test("normalize builds a usable document from garbage", () => {
  const s = normalize({ projects: "nope", features: [{ name: 1 }, null, { id: 7, project: "x" }], people: null, spaces: [1, " A "], current: 9 });
  assert.equal(s.projects.length, 1);
  assert.equal(s.current, s.projects[0].id);
  assert.deepEqual(s.features, []);
  assert.deepEqual(s.spaces, ["A"]);
  assert.deepEqual(s.people, ["Unassigned"]);
});

test("MemoryStore enforces optimistic versioning", async () => {
  const store = new MemoryStore();
  const a = await store.load();
  await store.save(a.state, a.version);
  await assert.rejects(() => store.save(a.state, a.version), ConflictError);
  const forced = await store.save(a.state, null);
  assert.equal(forced.version, a.version + 2);
});

test("handleApi routes and retries granular mutations on conflict", async () => {
  const store = new MemoryStore();
  // A store that conflicts on the first save attempt simulates a concurrent write from another device.
  let failures = 1;
  const flaky = {
    load: () => store.load(),
    save: async (state, expected) => {
      if (failures > 0) { failures--; await store.save((await store.load()).state, null); }
      return store.save(state, expected);
    },
    reset: () => store.reset()
  };
  const created = await handleApi({ method: "POST", path: "/features", body: { name: "Retry me", rnd: true } }, flaky);
  assert.equal(created.status, 201);
  assert.equal(failures, 0);
  const list = await handleApi({ method: "GET", path: "/features", query: { rnd: "true" } }, store);
  assert.ok(list.body.some(f => f.name === "Retry me"));

  const patched = await handleApi({ method: "PATCH", path: "/features/" + created.body.id, body: { rndStage: "Findings", rndFindings: "It works." } }, store);
  assert.equal(patched.status, 200);
  assert.equal(patched.body.rndStage, "Findings");

  const missing = await handleApi({ method: "GET", path: "/features/nope" }, store);
  assert.equal(missing.status, 404);
  const unknown = await handleApi({ method: "GET", path: "/whatever" }, store);
  assert.equal(unknown.status, 404);
  const meta = await handleApi({ method: "GET", path: "/meta" }, store);
  assert.deepEqual(meta.body.rndStages, RND_STAGES);
});

test("whole-document PUT reports conflicts with the current copy", async () => {
  const store = new MemoryStore();
  const doc = await store.load();
  const ok = await handleApi({ method: "PUT", path: "/state", body: { version: doc.version, state: doc.state } }, store);
  assert.equal(ok.status, 200);
  const conflict = await handleApi({ method: "PUT", path: "/state", body: { version: doc.version, state: doc.state } }, store);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.version, ok.body.version);
  const forced = await handleApi({ method: "PUT", path: "/state", body: { state: doc.state } }, store);
  assert.equal(forced.status, 200);
});

test("spaces are URL-decoded and cleaned from features when deleted", async () => {
  const store = new MemoryStore();
  await handleApi({ method: "POST", path: "/spaces", body: { name: "Data & Privacy" } }, store);
  const f = await handleApi({ method: "POST", path: "/features", body: { name: "Consent", spaces: ["Data & Privacy"] } }, store);
  const del = await handleApi({ method: "DELETE", path: "/spaces/" + encodeURIComponent("Data & Privacy") }, store);
  assert.equal(del.status, 204);
  const got = await handleApi({ method: "GET", path: "/features/" + f.body.id }, store);
  assert.deepEqual(got.body.spaces, []);
});

test("ideal client profiles: seeded for old documents, CRUD, and tags cleaned on delete", async () => {
  const store = new MemoryStore();
  const doc = await store.load();
  assert.ok(doc.state.icps.filter(i => i.kind === "Regime").length === 4, "seed carries the four regimes");
  const legacy = normalize({ projects: [{ id: "p" }], features: [{ id: "f", project: "p", icps: ["nope"] }] });
  assert.ok(legacy.icps.length >= 4, "documents without an icps array get the seeded profiles");
  assert.deepEqual(legacy.features[0].icps, [], "unknown profile ids are dropped");
  const keep = normalize({ projects: [{ id: "p" }], features: [], icps: [] });
  assert.equal(keep.icps.length, 0, "an explicitly empty list stays empty");

  const c = await handleApi({ method: "POST", path: "/icps", body: { name: "Insurers", kind: "Payer", tam: "$4M" } }, store);
  assert.equal(c.status, 201);
  assert.equal(c.body.tam, "$4M");
  const f = await handleApi({ method: "POST", path: "/features", body: { name: "Bulk export", icps: [c.body.id, "bogus"] } }, store);
  assert.deepEqual(f.body.icps, [c.body.id]);
  const p = await handleApi({ method: "PATCH", path: "/features/" + f.body.id, body: { icps: [c.body.id] } }, store);
  assert.deepEqual(p.body.icps, [c.body.id], "patch response keeps valid profile tags");
  const bad = await handleApi({ method: "PATCH", path: "/icps/" + c.body.id, body: { name: "  " } }, store);
  assert.equal(bad.body.name, "Insurers", "blank names are ignored");
  const d = await handleApi({ method: "DELETE", path: "/icps/" + c.body.id }, store);
  assert.equal(d.status, 204);
  const got = await handleApi({ method: "GET", path: "/features/" + f.body.id }, store);
  assert.deepEqual(got.body.icps, []);
  assert.equal((await handleApi({ method: "DELETE", path: "/icps/nope" }, store)).status, 404);
});

test("profiles carry avatar, regimes and facts; buyers only tag existing regimes", async () => {
  const store = new MemoryStore();
  const doc = await store.load();
  const regimes = doc.state.icps.filter(i => i.kind === "Regime");
  const buyer = doc.state.icps.find(i => i.kind === "Buyer");
  assert.equal(regimes[0].avatar, "regime");
  assert.ok(buyer.regimes.length > 0 && buyer.regimes.every(r => regimes.some(x => x.id === r)));
  const c = await handleApi({ method: "POST", path: "/icps", body: { name: "Clinique", kind: "Buyer", avatar: "clinic", regimes: [regimes[0].id, "nope"], facts: [{ label: "Sites", value: "3" }, { label: "", value: "" }] } }, store);
  assert.equal(c.status, 201);
  assert.equal(c.body.avatar, "clinic");
  assert.deepEqual(c.body.regimes, [regimes[0].id]);
  assert.deepEqual(c.body.facts, [{ label: "Sites", value: "3" }]);
  const p = await handleApi({ method: "PATCH", path: "/icps/" + c.body.id, body: { avatar: "bogus", kind: "Regime" } }, store);
  assert.equal(p.body.kind, "Regime");
  assert.equal(p.body.avatar, "regime", "unknown avatar falls back by kind");
  assert.deepEqual(p.body.regimes, [], "regimes carry no regime tags");
  const d = await handleApi({ method: "DELETE", path: "/icps/" + regimes[0].id }, store);
  assert.equal(d.status, 204);
  const after = (await store.load()).state.icps.find(i => i.id === buyer.id);
  assert.ok(!after.regimes.includes(regimes[0].id), "deleting a regime removes it from buyers");
});

test("features can nest one level under a parent in the same project", async () => {
  const store = new MemoryStore();
  const doc = await store.load();
  const proj = doc.state.projects[0].id;
  const other = doc.state.projects[1].id;
  const parent = await handleApi({ method: "POST", path: "/features", body: { project: proj, name: "Report editor" } }, store);
  const child = await handleApi({ method: "POST", path: "/features", body: { project: proj, name: "Section 7", parent: parent.body.id } }, store);
  assert.equal(child.body.parent, parent.body.id);
  const grandchild = await handleApi({ method: "POST", path: "/features", body: { project: proj, name: "Too deep", parent: child.body.id } }, store);
  assert.equal(grandchild.body.parent, null, "a child cannot be a parent");
  const cross = await handleApi({ method: "POST", path: "/features", body: { project: other, name: "Elsewhere", parent: parent.body.id } }, store);
  assert.equal(cross.body.parent, null, "parents must be in the same project");
  const self = await handleApi({ method: "PATCH", path: "/features/" + parent.body.id, body: { parent: parent.body.id } }, store);
  assert.equal(self.body.parent, null, "no self-parenting");
  const bogus = await handleApi({ method: "PATCH", path: "/features/" + child.body.id, body: { parent: "nope" } }, store);
  assert.equal(bogus.body.parent, null);
  await handleApi({ method: "PATCH", path: "/features/" + child.body.id, body: { parent: parent.body.id } }, store);
  await handleApi({ method: "DELETE", path: "/features/" + parent.body.id }, store);
  const orphan = await handleApi({ method: "GET", path: "/features/" + child.body.id }, store);
  assert.equal(orphan.body.parent, null, "deleting a parent releases its children");
});

import { pilotMarkdown, featuresCsv, logCsv, driveFolderId } from "../shared/exports.js";
test("exports: pilot record, sheets and folder ids come out of the state", () => {
  const S = normalize(seed());
  const f = S.features[0];
  S.pilots = [{ id: "p", name: "Le Cabinet M", status: "Piloting", link: "https://drive.google.com/drive/folders/1OEmlNW5m-gZGqbZK0H5EYkRk5D20qyRa", wants: [f.id], needs: [], deliverables: [{ id: "d", title: "A clean file", tag: "Quick win", note: "", features: [f.id] }], requests: [{ id: "r", title: "Batch email", decision: "Later", reason: "Not core", fit: "Out of scope", bottleneck: "<p>One by one.</p>" }], stack: [{ id: "s", name: "Outlook", kind: "Software", category: "Email and calendar", usage: "" }] }];
  const md = pilotMarkdown(normalize(S), normalize(S).pilots[0], new Date("2026-09-11T12:00:00Z"));
  assert.match(md, /# ALIE pilot record — Le Cabinet M/);
  assert.match(md, /### 1\. Batch email/);
  assert.match(md, /Decision: Later — Not core/);
  assert.match(md, /A clean file · Quick win/);
  assert.match(md, /\*\*Outlook\*\* · Email and calendar/);
  assert.equal(featuresCsv(S).split("\n")[0], "Spaces,Division,Feature,Sub-feature,State,Owner,Date,Estimate,R&D,Profiles,Description,Drive link,Last updated,Id");
  assert.equal(logCsv(S).split("\n")[0], "When,Who,Feature,Change,From,To,Why");
  assert.equal(driveFolderId("https://drive.google.com/drive/folders/1OEmlNW5m-gZGqbZK0H5EYkRk5D20qyRa"), "1OEmlNW5m-gZGqbZK0H5EYkRk5D20qyRa");
  assert.equal(driveFolderId("https://example.com"), "");
});

test("markdownText keeps headings, code and tables; rndMarkdown has the plan", () => {
  const md = markdownText("<h2>Plan</h2><p>Use <code>x</code>.</p><pre><code>a &lt; b</code></pre><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table><hr>");
  assert.match(md, /## Plan/);
  assert.match(md, /`x`/);
  assert.match(md, /```\na < b\n```/);
  assert.match(md, /\| A \| B \|\n\| --- \| --- \|\n\| 1 \| 2 \|/);
  assert.match(md, /---/);
  const s = normalize(seed());
  const f = s.features.find(x => x.rnd);
  f.rndPlan = "<h2>Hypothesis</h2><p>It works.</p>";
  const doc = rndMarkdown(s, f, new Date("2026-09-12T00:00:00Z"));
  assert.match(doc, new RegExp("^# ALIE R&D — " + f.name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")));
  assert.match(doc, /## Experiment plan\n\n## Hypothesis\nIt works\./);
  assert.match(doc, /- Stage: Assigned/);
});

test("normalize drops a division for a space the feature is not in", () => {
  const s = normalize(seed());
  const f = s.features.find(x => !x.parent);
  f.spaces = ["Health"]; f.sections = { Health: "Cases", Legal: "Cases" };
  const n = normalize(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(n.features.find(x => x.id === f.id).sections, { Health: "Cases" });
});
