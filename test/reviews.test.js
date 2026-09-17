import { test } from "node:test";
import assert from "node:assert/strict";
import { handleApi, handlePublic, MemoryStore, seed, normalize } from "../shared/core.js";
import { parseBlocks, cabinetMDraft, snapshotOf, snapshotCards, anchorStatus, applySuggestion, validateSubmission, feedbackCounts, emptyReview } from "../public/reviews.js";

test("card markup parses into typed blocks with ids that follow the text, not the position", () => {
  const b = parseBlocks("## Heading\nRest of it.\n\nA paragraph.\n\n> A callout\n\n1. one\n2. two\n\n- a\n- b\n\n| L | R |\n| left | right |");
  assert.deepEqual(b.map(x => x.kind), ["h", "p", "callout", "steps", "list", "columns"]);
  assert.equal(b[0].rest, "Rest of it.");
  assert.deepEqual(b[3].items, ["one", "two"]);
  assert.deepEqual(b[5].head, ["L", "R"]); assert.deepEqual(b[5].rows, [["left", "right"]]);
  const again = parseBlocks("Something new first.\n\nA paragraph.");
  assert.equal(again[1].id, b[1].id, "the same paragraph keeps its id when it moves");
  assert.notEqual(parseBlocks("A paragraph!")[0].id, b[1].id, "changed text gets a new id");
  const twice = parseBlocks("Same.\n\nSame.");
  assert.notEqual(twice[0].id, twice[1].id);
});

test("the Cabinet M draft is ten short pages in five sections, with the records page split in two columns", () => {
  const d = cabinetMDraft();
  assert.equal(d.cards.length, 10);
  const snap = snapshotOf(d, { name: "Le Cabinet M" }, 1);
  assert.deepEqual(snap.sections.map(s => s.cards.length), [2, 3, 2, 1, 2]);
  d.cards.forEach(c => { const w = c.body.split(/\s+/).filter(Boolean).length; assert.ok(w >= 40 && w <= 270, c.title + " has " + w + " words"); });
  const records = snapshotCards(snap).find(c => c.id === "c4");
  assert.ok(records.blocks.some(b => b.kind === "columns" && b.head.length === 2));
  assert.ok(!JSON.stringify(snap).includes("IMG_"), "no transcript references reach the guest");
  assert.deepEqual(Object.keys(snap).sort(), ["alt", "author", "closing", "date", "intro", "lang", "pilot", "reviewId", "revision", "sections", "subtitle", "title"]);
});

function pilotState() {
  const s = normalize(seed());
  s.pilots = [{ id: "p1", name: "Le Cabinet M", status: "Discovery", notes: "INTERNAL NOTE", evidence: [{ id: "e1", text: "secret quote", kind: "Direct quote" }], steps: [{ id: "st1", title: "Intake" }], questions: [{ id: "q1", text: "Who covers Fridays?" }], reviews: [cabinetMDraft()] },
    { id: "p2", name: "Hugo", status: "Prospect", reviews: [] }];
  return s;
}
const req = (method, path, body, ip) => ({ method, path: path.split("?")[0], body, query: Object.fromEntries(new URL("http://x" + path).searchParams), ip: ip || "1.1.1.1" });

test("publishing freezes a snapshot behind a fresh link; the guest sees only that snapshot", async () => {
  const store = new MemoryStore(pilotState());
  const r0 = (await store.load()).state.pilots[0].reviews[0];
  const pub = await handleApi(req("POST", "/reviews/publish", { pilot: "p1", review: r0.id, who: "test" }), store);
  assert.equal(pub.status, 200); assert.equal(pub.body.revision.n, 1);
  const token = pub.body.revision.token;
  assert.ok(token.length >= 30);
  const saved = (await store.load()).state.pilots[0].reviews[0];
  assert.equal(saved.status, "Published"); assert.equal(saved.revisions[0].token, token);

  const g = await handlePublic(req("GET", "/public/review/" + token), store);
  assert.equal(g.status, 200);
  const text = JSON.stringify(g.body);
  assert.ok(!text.includes("INTERNAL NOTE") && !text.includes("secret quote") && !text.includes("Hugo") && !text.includes("token"));
  assert.equal(g.headers["X-Robots-Tag"], "noindex, nofollow");
  assert.equal(g.body.snapshot.sections.length, 5);

  assert.equal((await handlePublic(req("GET", "/public/review/" + token.slice(0, -1) + "x"), store)).status, 404);
  assert.equal((await handlePublic(req("GET", "/public/review/short"), store)).status, 404);
  assert.equal((await handlePublic(req("GET", "/public/review/" + token + "/../../state"), store)).status, 404);
  /* the authed preview works only for a signed-in caller; the public handler never serves it */
  const pv = await handleApi(req("GET", "/reviews/preview?pilot=p1&review=" + r0.id), store);
  assert.equal(pv.status, 200); assert.equal(pv.body.preview, true);
});

test("feedback lands on the right card and revision, is validated, deduplicated and bounded", async () => {
  const store = new MemoryStore(pilotState());
  const r0 = (await store.load()).state.pilots[0].reviews[0];
  const token = (await handleApi(req("POST", "/reviews/publish", { pilot: "p1", review: r0.id }), store)).body.revision.token;
  const snap = (await handlePublic(req("GET", "/public/review/" + token), store)).body.snapshot;
  const card = snapshotCards(snap)[2], block = card.blocks[0];
  const base = "/public/review/" + token + "/feedback";
  const c1 = await handlePublic(req("POST", base, { submission: "s_aaaaaaaa", kind: "comment", card: card.id, text: "Caroline also screens.", name: "Sarah" }), store);
  assert.equal(c1.status, 200);
  const dup = await handlePublic(req("POST", base, { submission: "s_aaaaaaaa", kind: "comment", card: card.id, text: "Caroline also screens.", name: "Sarah" }), store);
  assert.equal(dup.body.id, c1.body.id); assert.equal(dup.body.duplicate, true);
  const s1 = await handlePublic(req("POST", base, { submission: "s_bbbbbbbb", kind: "suggestion", card: card.id, block: block.id, quote: "Sarah then discusses the potential work and fees.", suggestion: "Sarah then explains the mandate and the fees.", start: 10, end: 60, name: "Sarah" }), store);
  assert.equal(s1.status, 200);
  assert.equal((await handlePublic(req("POST", base, { submission: "s_cccccccc", kind: "comment", card: "not-a-card", text: "x" }), store)).status, 400);
  assert.equal((await handlePublic(req("POST", base, { submission: "s_dddddddd", kind: "comment", card: card.id, block: "nope", quote: "q", text: "x" }), store)).status, 400);
  assert.equal((await handlePublic(req("POST", base, { submission: "s_eeeeeeee", kind: "suggestion", card: card.id, block: block.id, quote: "", suggestion: "y" }), store)).status, 400);
  assert.equal((await handlePublic(req("POST", base, { submission: "bad id", kind: "comment", card: card.id, text: "x" }), store)).status, 400);
  assert.equal((await handlePublic(req("POST", base, { submission: "s_ffffffff", kind: "comment", card: card.id, text: "x".repeat(5000) }), store)).status, 400);
  const fin = await handlePublic(req("POST", "/public/review/" + token + "/finish", { submission: "s_gggggggg", name: "Sarah" }), store);
  assert.equal(fin.status, 200);
  const after = (await store.load()).state.pilots[0].reviews[0];
  assert.equal(after.feedback.length, 3);
  assert.ok(after.feedback.every(f => f.revision === after.revisions[0].id));
  assert.equal(feedbackCounts(after).open, 2); assert.equal(feedbackCounts(after).finished.name, "Sarah");
  /* the pilot itself is untouched: status, evidence, steps */
  const p = (await store.load()).state.pilots[0];
  assert.equal(p.status, "Discovery"); assert.equal(p.evidence.length, 1); assert.equal(p.steps.length, 1);
  /* rate limit: many writes from one address are refused, not silently dropped */
  let last;
  for (let i = 0; i < 45; i++) last = await handlePublic(req("POST", base, { submission: "s_rate" + String(i).padStart(4, "0"), kind: "comment", card: card.id, text: "x" }, "9.9.9.9"), store);
  assert.equal(last.status, 429);
});

test("a whole-document save from the app keeps feedback and revisions written on the server in between", async () => {
  const store = new MemoryStore(pilotState());
  const before = await store.load();
  const r0 = before.state.pilots[0].reviews[0];
  const token = (await handleApi(req("POST", "/reviews/publish", { pilot: "p1", review: r0.id }), store)).body.revision.token;
  const snap = (await handlePublic(req("GET", "/public/review/" + token), store)).body.snapshot;
  await handlePublic(req("POST", "/public/review/" + token + "/feedback", { submission: "s_hhhhhhhh", kind: "comment", card: snapshotCards(snap)[0].id, text: "hello", name: "S" }), store);
  /* the app still holds the copy from before publishing: no revision, no feedback, and a newer pilot stamp */
  const stale = JSON.parse(JSON.stringify(before.state));
  stale.pilots[0].updated = Date.now() + 5000; stale.pilots[0].reviews[0].title = "Le Cabinet M (edited in the app)";
  const put = await handleApi(req("PUT", "/state", { version: (await store.load()).version, state: stale, who: "app" }), store);
  assert.equal(put.status, 200);
  const r = put.body.state.pilots[0].reviews[0];
  assert.equal(r.title, "Le Cabinet M (edited in the app)");
  assert.equal(r.revisions.length, 1); assert.equal(r.feedback.length, 1);
});

test("disabled and expired links reveal nothing; a new revision retires the old link", async () => {
  const store = new MemoryStore(pilotState());
  const r0 = (await store.load()).state.pilots[0].reviews[0];
  const t1 = (await handleApi(req("POST", "/reviews/publish", { pilot: "p1", review: r0.id, expires: "2000-01-01" }), store)).body.revision.token;
  assert.equal((await handlePublic(req("GET", "/public/review/" + t1), store)).status, 404, "expired");
  const t2 = (await handleApi(req("POST", "/reviews/publish", { pilot: "p1", review: r0.id }), store)).body.revision.token;
  assert.equal((await handlePublic(req("GET", "/public/review/" + t2), store)).status, 200);
  const doc = await store.load();
  doc.state.pilots[0].reviews[0].revisions[1].disabled = true;
  await store.save(doc.state, doc.version);
  assert.equal((await handlePublic(req("GET", "/public/review/" + t2), store)).status, 404, "disabled");
  assert.equal((await handlePublic(req("POST", "/public/review/" + t2 + "/feedback", { submission: "s_iiiiiiii", kind: "comment", card: "c1", text: "x" }), store)).status, 404);
  const t3 = (await handleApi(req("POST", "/reviews/publish", { pilot: "p1", review: r0.id }), store)).body.revision.token;
  assert.equal((await handlePublic(req("GET", "/public/review/" + t2), store)).status, 404, "old link retired");
  assert.equal((await handlePublic(req("GET", "/public/review/" + t3), store)).body.snapshot.revision, 3);
});

test("a suggestion changes the draft only, once, and leaves a trace; anchors are flagged rather than moved", () => {
  const r = cabinetMDraft();
  const snap = snapshotOf(r, { name: "Le Cabinet M" }, 1);
  const rev = { id: "rev1", n: 1, snapshot: snap };
  const card = snapshotCards(snap).find(c => c.id === "c2");
  const v = validateSubmission({ submission: "s_jjjjjjjj", kind: "suggestion", card: "c2", block: card.blocks[1].id, quote: "reconstructs the history", suggestion: "rebuilds the history", name: "Sarah" }, rev, 1000);
  assert.equal(v.ok, true);
  const fb = v.feedback;
  assert.equal(anchorStatus(r, fb), "intact");
  const out = applySuggestion(r, fb, 2000);
  assert.equal(out.ok, true);
  assert.ok(r.cards.find(c => c.id === "c2").body.includes("rebuilds the history"));
  assert.equal(fb.state, "Applied"); assert.deepEqual(fb.applied, { at: 2000, before: "reconstructs the history", after: "rebuilds the history", card: "c2", lang: "en" });
  assert.ok(JSON.stringify(snap).includes("reconstructs the history"), "the published snapshot is untouched");
  assert.equal(anchorStatus(r, fb), "changed");
  assert.equal(applySuggestion(r, fb, 3000).ok, false);
  const page = { kind: "comment", card: "c2", quote: "", text: "x" };
  assert.equal(anchorStatus(r, page), "page");
  assert.equal(anchorStatus(r, { kind: "comment", card: "zzz", quote: "q" }), "card missing");
  const e = emptyReview({ title: "T" });
  assert.equal(e.status, "Draft"); assert.equal(e.cards.length, 0);
});

test("a review carries French pages; the guest gets both languages, and a French correction lands in the French text", async () => {
  const { hasFrench, snapshotLangs, cardIn } = await import("../public/reviews.js");
  const d = cabinetMDraft();
  assert.equal(hasFrench(d), true);
  assert.equal(d.cards.filter(c => c.bodyFr).length, 10);
  const snap = snapshotOf(d, { name: "Le Cabinet M" }, 1);
  assert.deepEqual(snapshotLangs(snap), ["en", "fr"]);
  assert.equal(snap.alt.lang, "fr");
  assert.equal(snap.alt.sections.length, 5);
  assert.equal(snapshotCards(snap, "fr").length, 10);
  assert.deepEqual(snapshotCards(snap, "fr").map(c => c.id), snapshotCards(snap, "en").map(c => c.id), "page ids are shared across languages");
  assert.equal(cardIn(d.cards[3], "fr").title, "L’ouverture et les demandes de documents");
  assert.ok(snapshotCards(snap, "fr")[3].blocks.some(b => b.kind === "columns"), "French records page keeps its two columns");
  const rev = { id: "rev1", n: 1, snapshot: snap };
  const frCard = snapshotCards(snap, "fr").find(c => c.id === "c2");
  const frBlock = frCard.blocks.find(b => /reconstitue/.test(b.text));
  const v = validateSubmission({ submission: "s_frfrfrfr", kind: "suggestion", lang: "fr", card: "c2", block: frBlock.id, quote: "reconstitue l’historique", suggestion: "reconstruit l’historique", name: "Sarah" }, rev, 1000);
  assert.equal(v.ok, true); assert.equal(v.feedback.lang, "fr");
  /* the same block id does not exist in English: a French block cannot be filed against the English page */
  const wrong = validateSubmission({ submission: "s_frfrfrf2", kind: "suggestion", lang: "en", card: "c2", block: frBlock.id, quote: "x", suggestion: "y" }, rev, 1000);
  assert.equal(wrong.ok, false);
  assert.equal(anchorStatus(d, v.feedback), "intact");
  const out = applySuggestion(d, v.feedback, 2000);
  assert.equal(out.ok, true);
  assert.ok(d.cards.find(c => c.id === "c2").bodyFr.includes("reconstruit l’historique"));
  assert.ok(d.cards.find(c => c.id === "c2").body.includes("reconstructs the history"), "the English text is untouched");
  assert.equal(v.feedback.applied.lang, "fr");
  /* a page without French falls back to English in the French snapshot, so the switch never hides a page */
  const e = emptyReview({ title: "T", cards: [{ id: "x1", section: "S", title: "Only English", body: "Hello.", bodyFr: "Bonjour.", titleFr: "Seulement" }, { id: "x2", section: "S", title: "Second", body: "Two." }] });
  const s2 = snapshotOf(e, null, 1);
  assert.equal(snapshotCards(s2, "fr")[1].title, "Second");
  assert.equal(snapshotCards(s2, "fr")[0].title, "Seulement");
  const none = emptyReview({ title: "T", cards: [{ id: "y", section: "S", title: "E", body: "e" }] });
  assert.equal(snapshotOf(none, null, 1).alt, null);
});
