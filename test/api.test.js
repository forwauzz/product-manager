import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/server.js";

let server, base, dir;

function api(method, url, body) {
  return fetch(base + url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined
  }).then(async r => ({ status: r.status, body: r.status === 204 ? null : await r.json(), headers: r.headers }));
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "alie-pm-test-"));
  const app = createApp({ dataFile: path.join(dir, "db.json") });
  await new Promise(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  base = "http://127.0.0.1:" + server.address().port;
});
after(async () => {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("health, session and seed data", async () => {
  const h = await api("GET", "/api/health");
  assert.equal(h.status, 200);
  assert.equal(h.body.ok, true);
  const s = await api("GET", "/api/session");
  assert.deepEqual(s.body, { authed: true, required: false });
  const st = await api("GET", "/api/state");
  assert.equal(st.status, 200);
  assert.equal(st.body.version, 1);
  assert.equal(st.body.state.projects.length, 3);
  assert.ok(st.body.state.features.length >= 12);
  assert.ok(Array.isArray(st.body.state.students));
  assert.ok(st.body.state.features.some(f => f.rnd), "seed has at least one R&D item");
});

test("static app and login page are served, deep links fall back to the shell", async () => {
  const r = await fetch(base + "/");
  assert.equal(r.status, 200);
  assert.match(await r.text(), /<title>ALIE Product<\/title>/);
  assert.equal((await fetch(base + "/app.js")).status, 200);
  assert.equal((await fetch(base + "/login.html")).status, 200);
  assert.equal((await fetch(base + "/some/client/route")).status, 200);
});

test("PUT /api/state saves, bumps version and rejects stale versions", async () => {
  const st = await api("GET", "/api/state");
  const s = st.body.state;
  s.features[0].name = "Portal renamed";
  const put = await api("PUT", "/api/state", { version: st.body.version, state: s });
  assert.equal(put.status, 200);
  assert.equal(put.body.version, st.body.version + 1);
  assert.equal(put.body.state.features[0].name, "Portal renamed");

  const stale = await api("PUT", "/api/state", { version: st.body.version, state: s });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.version, put.body.version, "conflict response carries the current document");
  assert.ok(Array.isArray(stale.body.state.features));

  const bad = await api("PUT", "/api/state", { version: put.body.version, state: { nope: true } });
  assert.equal(bad.status, 400);
});

test("state is persisted to disk atomically", async () => {
  const file = path.join(dir, "db.json");
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(doc.state.features[0].name, "Portal renamed");
  assert.ok(!fs.readdirSync(dir).some(n => n.endsWith(".tmp")), "no temp files left behind");
});

test("projects: create, rename, delete cascades features", async () => {
  const c = await api("POST", "/api/projects", { name: "Pilot", kind: "Trial" });
  assert.equal(c.status, 201);
  const id = c.body.id;
  const f = await api("POST", "/api/features", { project: id, name: "Pilot feature" });
  assert.equal(f.status, 201);
  const r = await api("PATCH", "/api/projects/" + id, { name: "Pilot 2" });
  assert.equal(r.body.name, "Pilot 2");
  const d = await api("DELETE", "/api/projects/" + id);
  assert.equal(d.status, 204);
  assert.equal((await api("GET", "/api/features/" + f.body.id)).status, 404);
  assert.equal((await api("POST", "/api/projects", { name: "  " })).status, 400);
  assert.equal((await api("DELETE", "/api/projects/nope")).status, 404);
});

test("features: create, patch, validate, R&D filter, delete", async () => {
  const c = await api("POST", "/api/features", { name: "Contradiction finder", spaces: ["Legal"], rnd: true, rndQuestion: "Can we do it?" });
  assert.equal(c.status, 201);
  assert.equal(c.body.rnd, true);
  assert.equal(c.body.rndStage, "Backlog");
  const id = c.body.id;

  const p = await api("PATCH", "/api/features/" + id, { rndStage: "In progress", student: "Student A", state: "Research" });
  assert.equal(p.status, 200);
  assert.equal(p.body.rndStage, "In progress");
  assert.equal(p.body.student, "Student A");

  assert.equal((await api("PATCH", "/api/features/" + id, { state: "Bogus" })).status, 400);
  assert.equal((await api("PATCH", "/api/features/" + id, { rndStage: "Bogus" })).status, 400);
  assert.equal((await api("PATCH", "/api/features/" + id, { project: "nope" })).status, 400);
  assert.equal((await api("POST", "/api/features", { project: "nope" })).status, 400);

  const rnd = await api("GET", "/api/features?rnd=true");
  assert.ok(rnd.body.some(f => f.id === id));
  assert.ok(rnd.body.every(f => f.rnd));
  const legal = await api("GET", "/api/features?space=Legal");
  assert.ok(legal.body.some(f => f.id === id));

  assert.equal((await api("DELETE", "/api/features/" + id)).status, 204);
  assert.equal((await api("DELETE", "/api/features/" + id)).status, 404);
});

test("spaces, people and students lists", async () => {
  const s = await api("POST", "/api/spaces", { name: "Billing" });
  assert.equal(s.status, 201);
  assert.ok(s.body.includes("Billing"));
  const f = await api("POST", "/api/features", { name: "Invoices", spaces: ["Billing"] });
  assert.equal((await api("DELETE", "/api/spaces/Billing")).status, 204);
  const after_ = await api("GET", "/api/features/" + f.body.id);
  assert.deepEqual(after_.body.spaces, [], "deleting a space removes the tag");

  const stu = await api("POST", "/api/students", { name: "Student C" });
  assert.ok(stu.body.includes("Student C"));
  assert.equal((await api("DELETE", "/api/people/Unassigned")).status, 400);
  const dup = await api("POST", "/api/people", { name: "Uzziel" });
  assert.equal(dup.body.filter(x => x === "Uzziel").length, 1, "no duplicate people");
  const added = await api("POST", "/api/people", { name: "Marie" });
  assert.ok(added.body.indexOf("Marie") < added.body.indexOf("Unassigned"), "Unassigned stays last");
});

test("export, import and reset", async () => {
  const ex = await api("GET", "/api/export");
  assert.equal(ex.status, 200);
  assert.match(ex.headers.get("content-disposition") || "", /attachment/);
  assert.ok(ex.body.state.features.length > 0);

  const st = JSON.parse(JSON.stringify(ex.body.state));
  st.features = st.features.slice(0, 2);
  const im = await api("POST", "/api/import", { state: st });
  assert.equal(im.status, 200);
  assert.equal(im.body.state.features.length, 2);
  assert.equal((await api("POST", "/api/import", { hello: "world" })).status, 400);

  const rs = await api("POST", "/api/reset");
  assert.equal(rs.status, 200);
  assert.ok(rs.body.state.features.length >= 12);
  assert.equal(rs.body.state.projects.length, 3);
});

test("normalize repairs incomplete records", async () => {
  const st = (await api("GET", "/api/state")).body;
  const s = st.state;
  s.features.push({ id: "x1", project: s.projects[0].id, name: "Bare" });
  s.features.push({ id: "orphan", project: "does-not-exist", name: "Orphan" });
  s.current = "nope";
  const put = await api("PUT", "/api/state", { version: st.version, state: s });
  assert.equal(put.status, 200);
  const bare = put.body.state.features.find(f => f.id === "x1");
  assert.equal(bare.state, "Planned");
  assert.equal(bare.owner, "Unassigned");
  assert.deepEqual(bare.spaces, []);
  assert.equal(bare.rnd, false);
  assert.equal(bare.rndStage, "Backlog");
  assert.ok(!put.body.state.features.some(f => f.id === "orphan"), "orphans dropped");
  assert.equal(put.body.state.current, s.projects[0].id);
});

test("unknown API routes return JSON 404, bad JSON returns 400", async () => {
  assert.equal((await api("GET", "/api/nothing-here")).status, 404);
  const bad = await fetch(base + "/api/state", { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{not json" });
  assert.equal(bad.status, 400);
});

test("every save is recorded in the change log and entries survive later saves", async () => {
  const st = await api("GET", "/api/state");
  const s = st.body.state;
  const f = s.features[0];
  f.state = "Building"; f.effort = 2; f.effortUnit = "weeks";
  const put = await api("PUT", "/api/state", { version: st.body.version, state: s, who: "Uzziel" });
  assert.equal(put.status, 200);
  const log = put.body.state.log;
  const mine = log.filter(e => e.fid === f.id);
  assert.ok(mine.some(e => e.field === "state" && e.to === "Building" && e.who === "Uzziel"), "state change recorded");
  assert.ok(mine.some(e => e.field === "effort" && e.to === "2 weeks"), "estimate recorded");

  // a client that never saw the log cannot erase it, and it can add a reason to an entry
  const again = await api("GET", "/api/state");
  const s2 = again.body.state;
  const entry = s2.log.find(e => e.field === "effort" && e.fid === f.id);
  entry.why = "David asked for two weeks";
  const put2 = await api("PUT", "/api/state", { version: again.body.version, state: Object.assign({}, s2, { log: [entry] }), who: "Uzziel" });
  assert.equal(put2.status, 200);
  const kept = put2.body.state.log;
  assert.ok(kept.some(e => e.field === "state" && e.fid === f.id), "earlier entries kept");
  assert.equal(kept.find(e => e.id === entry.id).why, "David asked for two weeks");

  // granular edits are logged too
  const patch = await api("PATCH", "/api/features/" + f.id, { owner: "David", who: "script" });
  assert.equal(patch.status, 200);
  const after = await api("GET", "/api/state");
  assert.ok(after.body.state.log.some(e => e.fid === f.id && e.field === "owner" && e.to === "David"), "PATCH recorded");
});

test("new features start Proposed, Planned marks them agreed, creation keeps the birth state", async () => {
  const made = await api("POST", "/api/features", { name: "Drift probe", state: "Building", who: "script" });
  assert.equal(made.status, 201);
  const st = await api("GET", "/api/state");
  const born = st.body.state.log.find(e => e.fid === made.body.id && e.field === "created");
  assert.equal(born.from, "Building", "the created entry remembers the state it was born in");
  const plain = await api("POST", "/api/features", { name: "Fresh idea" });
  assert.equal(plain.body.state, "Proposed");
  assert.equal(plain.body.agreed, false);
});

test("pilots are kept in the document and their feature lists only keep real features", async () => {
  const st = await api("GET", "/api/state");
  const s = st.body.state;
  const f = s.features[0];
  s.pilots = [{ id: "p1", name: "Le Cabinet M", status: "Piloting", wants: [f.id, "ghost"], needs: [] }];
  const put = await api("PUT", "/api/state", { version: st.body.version, state: s, who: "Uzziel" });
  assert.equal(put.status, 200);
  const p = put.body.state.pilots[0];
  assert.equal(p.name, "Le Cabinet M");
  assert.deepEqual(p.wants, [f.id], "unknown feature ids are dropped");
  assert.equal(p.status, "Piloting");
});
