import { test } from "node:test";
import assert from "node:assert/strict";
import { handleApi, MemoryStore, ConflictError, normalize, seed, STATES, RND_STAGES } from "../shared/core.js";

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
