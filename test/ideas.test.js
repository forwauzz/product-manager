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
  }).then(async r => ({ status: r.status, body: r.status === 204 ? null : await r.json() }));
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "alie-pm-ideas-"));
  const app = createApp({ dataFile: path.join(dir, "db.json") });
  await new Promise(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  base = "http://127.0.0.1:" + server.address().port;
  const st = await api("GET", "/api/state");
  const s = st.body.state;
  s.pilots = [{ id: "pA", name: "Test firm A", status: "Discovery" }, { id: "pB", name: "Test firm B", status: "Prospect" }];
  const put = await api("PUT", "/api/state", { version: st.body.version, state: s, who: "test" });
  assert.equal(put.status, 200);
});
after(async () => {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("an idea is saved once: the same id sent again never makes a second copy, and the capture time holds", async () => {
  const created = Date.now() - 3 * 3600000;
  const first = await api("POST", "/api/ideas", { id: "itest0001", text: "  A thought on the go  ", pilot: "", created });
  assert.equal(first.status, 200);
  assert.equal(first.body.ok, true); assert.equal(first.body.isNew, true);
  assert.equal(first.body.idea.text, "A thought on the go");
  assert.equal(first.body.idea.created, created, "the device's capture time is kept, even when the save lands later");
  const again = await api("POST", "/api/ideas", { id: "itest0001", text: "A thought on the go", pilot: "", created: Date.now() });
  assert.equal(again.status, 200); assert.equal(again.body.duplicate, true);
  const st = await api("GET", "/api/state");
  assert.equal(st.body.state.ideas.filter(x => x.id === "itest0001").length, 1);
  assert.equal(st.body.state.ideas[0].created, created);
});

test("editing the note or the pilot keeps the original capture time; the pilot can be set, changed and removed", async () => {
  const before = (await api("GET", "/api/state")).body.state.ideas.find(x => x.id === "itest0001");
  const e1 = await api("POST", "/api/ideas", { id: "itest0001", text: "A thought, reworded", pilot: "pA", created: 1 });
  assert.equal(e1.status, 200);
  assert.equal(e1.body.idea.created, before.created); assert.equal(e1.body.idea.pilot, "pA"); assert.ok(e1.body.idea.updated > before.created);
  const e2 = await api("POST", "/api/ideas", { id: "itest0001", text: "A thought, reworded", pilot: "pB" });
  assert.equal(e2.body.idea.pilot, "pB"); assert.equal(e2.body.idea.created, before.created);
  const e3 = await api("POST", "/api/ideas", { id: "itest0001", text: "A thought, reworded", pilot: "" });
  assert.equal(e3.body.idea.pilot, ""); assert.equal(e3.body.idea.created, before.created);
  const st = await api("GET", "/api/state");
  assert.equal(st.body.state.ideas.length, 1, "edits never add a record");
});

test("bad input is refused without writing: empty text, unknown pilot, malformed id, a capture time in the future", async () => {
  const v0 = (await api("GET", "/api/state")).body.version;
  assert.equal((await api("POST", "/api/ideas", { id: "itest0002", text: "   " })).status, 400);
  assert.equal((await api("POST", "/api/ideas", { id: "x", text: "hello" })).status, 400);
  assert.equal((await api("POST", "/api/ideas", { id: "itest0002", text: "hello", pilot: "ghost" })).status, 400);
  assert.equal((await api("GET", "/api/state")).body.version, v0, "nothing was written");
  const future = await api("POST", "/api/ideas", { id: "itest0003", text: "clock is wrong", created: Date.now() + 86400000 });
  assert.equal(future.status, 200);
  assert.ok(Math.abs(future.body.idea.created - Date.now()) < 5000, "an impossible capture time falls back to now");
});

test("ideas survive a whole-document save from the app, a stale copy is turned away, and deleting a pilot unlinks the idea", async () => {
  const st = await api("GET", "/api/state");
  const stale = JSON.parse(JSON.stringify(st.body.state));
  await api("POST", "/api/ideas", { id: "itest0004", text: "written from the phone", pilot: "pA" });
  const clash = await api("PUT", "/api/state", { version: st.body.version, state: stale, who: "desktop tab" });
  assert.equal(clash.status, 409, "the desktop copy that has not seen the idea cannot overwrite it");
  assert.ok(clash.body.state.ideas.some(x => x.id === "itest0004"));
  const fresh = clash.body.state;
  fresh.pilots = fresh.pilots.filter(p => p.id !== "pA");
  const put = await api("PUT", "/api/state", { version: clash.body.version, state: fresh, who: "desktop tab" });
  assert.equal(put.status, 200);
  const idea = put.body.state.ideas.find(x => x.id === "itest0004");
  assert.ok(idea, "the idea stays"); assert.equal(idea.pilot, "", "its pilot link is dropped with the pilot");
  const del = await api("DELETE", "/api/ideas/itest0004");
  assert.equal(del.status, 200); assert.equal(del.body.removed, 1);
  assert.ok(!(await api("GET", "/api/state")).body.state.ideas.some(x => x.id === "itest0004"));
});

test("moving a session to another date keeps the same record and everything attached to it", async () => {
  const st = await api("GET", "/api/state");
  const s = st.body.state;
  s.pilots.push({ id: "pT", name: "Test firm T", status: "Discovery",
    sessions: [{ id: "sT", date: "2026-09-17", time: "10:00", title: "Test visit", stage: "Planned", agenda: "Item one\nItem two", summary: "<p>notes</p>", transcript: "[00:00:01] A: hello",
      participants: "A, B", drive: { recording: "https://drive.google.com/file/d/rec", transcript: "https://drive.google.com/file/d/tr", folder: "https://drive.google.com/drive/folders/f" },
      files: [{ id: "f1", name: "Received file", link: "https://drive.google.com/file/d/x", kind: "Received file", from: "Client", loop: "Needs analysis" }],
      doc: { fileId: "doc123", status: "Synced" }, calendar: { eventId: "evt1", link: "https://calendar.google.com/e", status: "In calendar", syncedAt: "2026-09-10T10:00:00.000Z", origin: "App" } }],
    evidence: [{ id: "eT", text: "a quote", kind: "Direct quote", session: "sT" }],
    questions: [{ id: "qT", text: "A question?", session: "sT" }],
    actions: [{ id: "aT", title: "Follow up", status: "Open", links: { session: "sT" } }] });
  const put = await api("PUT", "/api/state", { version: st.body.version, state: s, who: "test" });
  assert.equal(put.status, 200);
  const before = JSON.parse(JSON.stringify(put.body.state.pilots.find(p => p.id === "pT")));
  /* what the Edit meeting form does: same object, five fields and the updated stamp */
  const next = put.body.state;
  const sess = next.pilots.find(p => p.id === "pT").sessions[0];
  sess.date = "2026-09-22"; sess.time = "13:30"; sess.title = "Test visit, moved"; sess.agenda = "Item one\nItem two\nItem three"; sess.summary = "<p>notes, revised</p>"; sess.updated = Date.now();
  const put2 = await api("PUT", "/api/state", { version: put.body.version, state: next, who: "test" });
  assert.equal(put2.status, 200);
  const after = put2.body.state.pilots.find(p => p.id === "pT");
  assert.equal(after.sessions.length, 1, "no second session");
  const a = after.sessions[0], b = before.sessions[0];
  assert.equal(a.id, "sT"); assert.equal(a.date, "2026-09-22"); assert.equal(a.time, "13:30"); assert.equal(a.title, "Test visit, moved");
  assert.equal(a.transcript, b.transcript); assert.deepEqual(a.drive, b.drive); assert.deepEqual(a.files, b.files); assert.deepEqual(a.doc, b.doc);
  assert.equal(a.calendar.eventId, "evt1", "the calendar link is the same event, so a sync updates it rather than creating another");
  assert.equal(a.participants, b.participants); assert.equal(a.stage, b.stage);
  assert.equal(after.evidence[0].session, "sT"); assert.equal(after.questions[0].session, "sT"); assert.equal(after.actions[0].links.session, "sT");
});
