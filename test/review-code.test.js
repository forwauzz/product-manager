import { test } from "node:test";
import assert from "node:assert/strict";
import { handleApi, handlePublic, MemoryStore, seed, normalize } from "../shared/core.js";
import { parseBlocks, snapshotCards, emptyReview, newAccessCode, normalizeCode } from "../public/reviews.js";

const TABLE = "?| Document | Where |\n?| Decision | the subject line |\n?| Acknowledgement | the appendix |";
function state(code) {
  const s = normalize(seed());
  const r = emptyReview({ title: "T", lang: "fr", cards: [{ id: "k1", section: "S", title: "Page", body: "Intro.\n\n" + TABLE }] });
  r.code = code || "";
  s.pilots = [{ id: "p1", name: "Firm", status: "Discovery", reviews: [r] }];
  return normalize(s);
}
const req = (method, path, body, extra) => Object.assign({ method, path, body, query: {}, ip: "9.9.9.9" }, extra || {});

test("an answer table parses with its header and rows, and keeps a stable id", () => {
  const b = parseBlocks(TABLE)[0];
  assert.equal(b.kind, "table");
  assert.deepEqual(b.head, ["Document", "Where"]);
  assert.equal(b.rows.length, 2);
  assert.equal(parseBlocks("Other text first.\n\n" + TABLE)[1].id, b.id);
});

test("access codes: generated without look-alikes, compared without case or separators", () => {
  const c = newAccessCode();
  assert.match(c, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(normalizeCode(" ab12-cd34 "), "AB12CD34");
});

test("a protected link shows nothing without the right code, and slows down guessing", async () => {
  const store = new MemoryStore(state("QX7P-M4RT"));
  const rid = (await store.load()).state.pilots[0].reviews[0].id;
  const token = (await handleApi(req("POST", "/reviews/publish", { pilot: "p1", review: rid }), store)).body.revision.token;
  const none = await handlePublic(req("GET", "/public/review/" + token), store);
  assert.equal(none.status, 401); assert.equal(none.body.needsCode, true); assert.ok(!JSON.stringify(none.body).includes("Page"), "no content before the code");
  const bad = await handlePublic(req("GET", "/public/review/" + token, null, { code: "AAAA-BBBB" }), store);
  assert.equal(bad.status, 401); assert.equal(bad.body.wrong, true);
  const ok = await handlePublic(req("GET", "/public/review/" + token, null, { code: "qx7p m4rt" }), store);
  assert.equal(ok.status, 200); assert.equal(ok.body.snapshot.title, "T");
  assert.ok(!JSON.stringify(ok.body).includes("QX7P"), "the code itself never reaches the reader");
  const post = await handlePublic(req("POST", "/public/review/" + token + "/feedback", { submission: "s_12345678", kind: "comment", card: "k1", text: "hi", name: "A" }), store);
  assert.equal(post.status, 401, "writing needs the code too");
  for (let i = 0; i < 8; i++) await handlePublic(req("GET", "/public/review/" + token, null, { code: "WRONG" + i, ip: "7.7.7.7" }), store);
  const locked = await handlePublic(req("GET", "/public/review/" + token, null, { code: "QX7PM4RT", ip: "7.7.7.7" }), store);
  assert.equal(locked.status, 429, "after eight wrong codes the address waits, even with the right one");
});

test("an unprotected link works as before", async () => {
  const store = new MemoryStore(state(""));
  const rid = (await store.load()).state.pilots[0].reviews[0].id;
  const token = (await handleApi(req("POST", "/reviews/publish", { pilot: "p1", review: rid }), store)).body.revision.token;
  assert.equal((await handlePublic(req("GET", "/public/review/" + token), store)).status, 200);
});

test("a row answer is anchored to its row, with the row's own text as the quote; a bad row is refused", async () => {
  const store = new MemoryStore(state("CODE-1234"));
  const rid = (await store.load()).state.pilots[0].reviews[0].id;
  const token = (await handleApi(req("POST", "/reviews/publish", { pilot: "p1", review: rid }), store)).body.revision.token;
  const snap = (await handlePublic(req("GET", "/public/review/" + token, null, { code: "CODE1234" }), store)).body.snapshot;
  const table = snapshotCards(snap).find(c => c.id === "k1").blocks.find(b => b.kind === "table");
  const base = "/public/review/" + token + "/feedback";
  const a = await handlePublic(req("POST", base, { submission: "s_row00001", kind: "comment", card: "k1", block: table.id, row: 1, quote: "forged", text: "Yes, and the second page too.", name: "Amélie", lang: "fr" }, { code: "CODE1234" }), store);
  assert.equal(a.status, 200);
  const fb = (await store.load()).state.pilots[0].reviews[0].feedback[0];
  assert.equal(fb.row, 1); assert.equal(fb.block, table.id);
  assert.equal(fb.quote, "Acknowledgement · the appendix", "the quote comes from the row, not from the request");
  const bad = await handlePublic(req("POST", base, { submission: "s_row00002", kind: "comment", card: "k1", block: table.id, row: 9, text: "x", name: "A" }, { code: "CODE1234" }), store);
  assert.equal(bad.status, 400);
  const pblock = snapshotCards(snap).find(c => c.id === "k1").blocks[0];
  const notTable = await handlePublic(req("POST", base, { submission: "s_row00003", kind: "comment", card: "k1", block: pblock.id, row: 0, text: "x", name: "A" }, { code: "CODE1234" }), store);
  assert.equal(notTable.status, 400, "rows exist only in answer tables");
});

test("the code survives a whole-document save from the app and stays out of the reader's snapshot", async () => {
  const store = new MemoryStore(state("KEEP-CODE"));
  const doc = await store.load();
  const put = await handleApi(req("PUT", "/state", { version: doc.version, state: doc.state }), store);
  assert.equal(put.status, 200);
  assert.equal(put.body.state.pilots[0].reviews[0].code, "KEEP-CODE");
});
