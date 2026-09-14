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

test("pilot requests are stored with their decision and a promoted feature link is validated", async () => {
  const st = await api("GET", "/api/state");
  const s = st.body.state;
  const f = s.features[0];
  s.pilots = [{ id: "p2", name: "Hugo", status: "Piloting", requests: [
    { id: "r1", title: "Automated appointment scheduling", bottleneck: "<p>Secretary books by phone.</p>", need: "<p>Two hours a day.</p>", solution: "<p>Integrate with their calendar.</p>", fit: "Out of scope", decision: "Integrate or partner", reason: "Not our product", feature: "ghost" },
    { id: "r2", title: "Body-part search", decision: "Build", feature: f.id }
  ] }];
  const put = await api("PUT", "/api/state", { version: st.body.version, state: s, who: "Uzziel" });
  assert.equal(put.status, 200);
  const rq = put.body.state.pilots[0].requests;
  assert.equal(rq.length, 2);
  assert.equal(rq[0].decision, "Integrate or partner");
  assert.equal(rq[0].feature, "", "unknown feature link is cleared");
  assert.equal(rq[1].feature, f.id);
  assert.equal(rq[1].fit, "");
});

test("pilot software and partners are stored with kind, category and usage", async () => {
  const st = await api("GET", "/api/state");
  const s = st.body.state;
  s.pilots = [{ id: "p3", name: "Le Cabinet M", status: "Piloting", stack: [
    { id: "s1", name: "Juris Évolution", kind: "Software", category: "Case or practice management", usage: "<p>Deadlines typed by hand.</p>", link: "https://example.com" },
    { id: "s2", name: "Agence X", kind: "Partner", category: "Marketing firm" },
    { id: "s3", name: "Odd", kind: "Whatever" }
  ] }];
  const put = await api("PUT", "/api/state", { version: st.body.version, state: s, who: "Uzziel" });
  assert.equal(put.status, 200);
  const stack = put.body.state.pilots[0].stack;
  assert.equal(stack.length, 3);
  assert.equal(stack[0].category, "Case or practice management");
  assert.equal(stack[1].kind, "Partner");
  assert.equal(stack[2].kind, "Software", "unknown kinds fall back to Software");
});

test("research items keep an experiment plan and the document keeps the R&D folder", async () => {
  const st = await api("GET", "/api/state");
  const s = st.body.state;
  s.rndFolder = "https://drive.google.com/drive/folders/1cWoQyIRKCA23LCkehvIzLTdoCVL1wmHE";
  const f = s.features.find(x => x.rnd);
  f.rndPlan = "<h2>Hypothesis</h2><p>Undated events can be placed by context.</p><table><tr><th>Step</th><th>Owner</th></tr><tr><td>Label 50 files</td><td>Student A</td></tr></table>";
  const put = await api("PUT", "/api/state", { version: st.body.version, state: s, who: "Uzziel" });
  assert.equal(put.status, 200);
  assert.equal(put.body.state.rndFolder, s.rndFolder);
  const saved = put.body.state.features.find(x => x.id === f.id);
  assert.match(saved.rndPlan, /Hypothesis/);
  assert.equal(saved.driveDoc, "");
  const log = put.body.state.log.filter(e => e.fid === f.id && e.field === "rndPlan");
  assert.equal(log.length, 1, "the plan change is in the change log");
  const patch = await api("PATCH", "/api/features/" + f.id, { rndPlan: "<p>Shorter.</p>", who: "Uzziel" });
  assert.equal(patch.status, 200);
  assert.equal(patch.body.rndPlan, "<p>Shorter.</p>");
});

test("a pilot keeps its discovery record: sessions, evidence with provenance, workflow steps, fit, actions, recaps", async () => {
  const st = await api("GET", "/api/state");
  const s = st.body.state;
  const f = s.features[0];
  s.pilots = [{ id: "p9", name: "Le Cabinet M", status: "Discovery", objective: "Learn how they reason.",
    people: [{ id: "u1", name: "Amélie", role: "Paralegal", side: "Client" }],
    sessions: [{ id: "s1", date: "2026-09-08", title: "Onsite with Amélie", participants: "Amélie, Uzziel", purpose: "Case workflow", draft: true }],
    evidence: [{ id: "e1", text: "trouve-moi tous les rapports", kind: "Direct quote", session: "s1", source: "CM-20260908-01", speaker: "Amélie" }, { id: "e2", text: "they probably want X", kind: "Product inference" }, { id: "e3", text: "raw", kind: "nope", session: "ghost" }],
    steps: [{ id: "w1", title: "Build the chronology", version: "current", actor: "Amélie", evidence: ["e1", "ghost"] }],
    questions: [{ id: "q1", text: "Who uses it next?", step: "w1", session: "s1" }],
    actions: [{ id: "a1", title: "Send the map", owner: "Uzziel", side: "Internal", due: "2026-09-20", links: { session: "s1" } }],
    fit: { [f.id]: { fit: "Simplify", supports: "step 1", evidence: ["e1"] }, ghost: { fit: "Keep" } },
    recaps: [{ id: "r1", week: "2026-09-08", internal: "<p>x</p>", client: "<p>y</p>", clientReviewed: true }],
    deliverables: [{ id: "d1", title: "Clean file", status: "Ready for client testing", validation: { status: "Client validated", note: "Amélie ok" } }],
    requests: [{ id: "rq1", title: "Batch email", evidence: ["e1"], validation: { status: "weird" } }]
  }];
  const put = await api("PUT", "/api/state", { version: st.body.version, state: s, who: "Uzziel" });
  assert.equal(put.status, 200);
  const p = put.body.state.pilots[0];
  assert.equal(p.status, "Discovery");
  assert.equal(p.sessions[0].draft, true);
  assert.equal(p.evidence[1].kind, "Product inference");
  assert.equal(p.evidence[2].kind, "Unsorted", "unknown kinds fall back to Unsorted");
  assert.equal(p.evidence[2].session, "", "a missing session link is cleared");
  assert.deepEqual(p.steps[0].evidence, ["e1"], "evidence links to unknown items are dropped");
  assert.equal(p.questions[0].step, "w1");
  assert.equal(p.actions[0].links.session, "s1");
  assert.equal(p.fit[f.id].fit, "Simplify");
  assert.equal(p.recaps[0].clientReviewed, true);
  assert.equal(p.deliverables[0].status, "Ready for client testing");
  assert.equal(p.deliverables[0].validation.status, "Client validated");
  assert.equal(p.requests[0].validation.status, "Not validated", "an unknown validation status is not validated");
  assert.deepEqual(p.requests[0].evidence, ["e1"]);
});

test("an older pilot record gains empty discovery collections and keeps everything it had", async () => {
  const st = await api("GET", "/api/state");
  const s = st.body.state;
  s.pilots = [{ id: "p10", name: "Old", status: "Piloting", contact: "Sarah", notes: "<p>kept</p>", wants: ["x"], deliverables: [{ id: "d", title: "D", tag: "Quick win", features: [] }], requests: [{ id: "r", title: "R" }], stack: [{ id: "s", name: "Outlook" }] }];
  const put = await api("PUT", "/api/state", { version: st.body.version, state: s, who: "Uzziel" });
  const p = put.body.state.pilots[0];
  assert.equal(p.status, "Piloting");
  assert.equal(p.notes, "<p>kept</p>");
  assert.equal(p.contact, "Sarah");
  assert.equal(p.deliverables[0].status, "Proposed");
  assert.equal(p.deliverables[0].validation.status, "Not validated");
  assert.equal(p.requests[0].decision, "Undecided");
  assert.equal(p.stack[0].name, "Outlook");
  ["sessions", "evidence", "steps", "questions", "actions", "recaps", "artifacts", "decisions", "people"].forEach(k => assert.deepEqual(p[k], [], k));
  assert.deepEqual(p.fit, {});
});

test("meeting workflow, decision gate records and artifact loop survive a round trip", async () => {
  const st = await api("GET", "/api/state");
  const s = st.body.state;
  const f = s.features[0];
  s.pilots = [{ id: "p11", name: "Le Cabinet M", status: "Discovery",
    sessions: [{ id: "s1", date: "2026-09-17", time: "14:00", title: "Onsite with Amélie", stage: "Planned", agenda: "Walk a different case", drive: { recording: "https://drive.google.com/file/d/rec", folder: "https://drive.google.com/drive/folders/abc" }, transcript: "[00:01] Amélie: on relit tout", files: [{ id: "f1", name: "Sommaire", kind: "Received file", from: "Client", loop: "Needs analysis", owner: "Uzziel", due: "2026-09-20" }, { id: "f2", name: "x", kind: "nope", from: "??", loop: "??" }] }, { id: "s2", title: "Old", stage: "bogus", date: "2026-01-01" }],
    evidence: [{ id: "e1", text: "on relit tout", kind: "Direct quote", session: "s1", speaker: "Amélie", timestamp: "00:01", draft: true }],
    questions: [{ id: "q1", text: "Why the chronology?", state: "Candidate answer from transcript", candidate: { text: "on relit tout", evidence: "e1", session: "s1", partial: true }, session: "s1" }, { id: "q2", text: "Old style", status: "Answered" }, { id: "q3", text: "Bad state", state: "nope" }],
    artifacts: [{ id: "a1", title: "Portal prototype", kind: "Prototype", origin: "Received", audience: "Both", version: "2", status: "Shared", owner: "David", session: "s1", evidence: ["e1", "ghost"], loop: "Reviewed with firm", loopOwner: "Uzziel", loopDue: "2026-09-30", drive: { fileId: "doc1", status: "Synced", syncedAt: "2026-09-14T00:00:00Z" } }],
    deliverables: [{ id: "d1", title: "Clean file", status: "In delivery", decisionRef: "dec1" }],
    requests: [{ id: "r1", title: "Batch email", decision: "Build", decisionRef: "dec1" }]
  }];
  s.decisions = [{ id: "dec1", title: "Build batch email", state: "Decided", owner: "Uzziel", date: "2026-09-14", rationale: "Because", alignment: "Discussed", pilot: "p11", links: { request: "r1", feature: f.id }, evidence: ["e1"], pending: { kind: "request", id: "r1", to: "Build", pilot: "p11" } }, { id: "dec2", title: "Bad", state: "nope", alignment: "nope", pilot: "ghost" }];
  const put = await api("PUT", "/api/state", { version: st.body.version, state: s, who: "Uzziel" });
  assert.equal(put.status, 200);
  const p = put.body.state.pilots[0];
  assert.equal(p.sessions[0].stage, "Planned");
  assert.equal(p.sessions[0].drive.recording, "https://drive.google.com/file/d/rec");
  assert.equal(p.sessions[0].files[0].loop, "Needs analysis");
  assert.equal(p.sessions[0].files[1].kind, "Other"); assert.equal(p.sessions[0].files[1].from, "Us"); assert.equal(p.sessions[0].files[1].loop, "Received");
  assert.equal(p.sessions[1].stage, "Recorded", "an unknown stage on a past date is Recorded");
  assert.equal(p.evidence[0].draft, true); assert.equal(p.evidence[0].timestamp, "00:01");
  assert.equal(p.questions[0].state, "Candidate answer from transcript"); assert.equal(p.questions[0].status, "Open"); assert.equal(p.questions[0].candidate.partial, true);
  assert.equal(p.questions[1].state, "Confirmed by client", "old Answered maps to Confirmed by client");
  assert.equal(p.questions[2].state, "Unanswered");
  const a = p.artifacts[0];
  assert.equal(a.origin, "Received"); assert.equal(a.audience, "Both"); assert.equal(a.loop, "Reviewed with firm"); assert.deepEqual(a.evidence, ["e1"]); assert.equal(a.drive.status, "Synced");
  assert.equal(p.deliverables[0].decisionRef, "dec1"); assert.equal(p.requests[0].decisionRef, "dec1");
  const dec = put.body.state.decisions;
  assert.equal(dec.length, 2);
  assert.equal(dec[0].alignment, "Discussed"); assert.equal(dec[0].pending.to, "Build"); assert.deepEqual(dec[0].evidence, ["e1"]);
  assert.equal(dec[1].state, "Proposed"); assert.equal(dec[1].alignment, "Needs discussion"); assert.equal(dec[1].pilot, "", "an unknown pilot link is dropped");
  assert.equal(dec[1].owner, "Uzziel");
});
