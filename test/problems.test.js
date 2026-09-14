import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalize, seed } from "../shared/core.js";
import { pilotMarkdown, recordMarkdown } from "../shared/exports.js";
import { createApp } from "../server/server.js";

/* the browser module, loaded the way the page loads it */
const m = { exports: {} };
new Function("module", "self", fs.readFileSync(new URL("../public/problems.js", import.meta.url), "utf8"))(m, {});
const P = m.exports;

function framed(over) {
  const pr = P.empty();
  Object.assign(pr, { id: "pb1", title: "Collections take a day every month", status: "Framed", confidence: "Medium", owner: "Uzziel", created: 1, updated: 1 });
  Object.assign(pr.frame, { trigger: "the 20th of the month", pain: "about half of the Interac payers forget", role: "Caroline, the adjointe", workaround: "email each late client by hand on the 21st", consequence: "a day lost every month and late cash", deliverable: "the monthly collection run and the ageing report Sarah reads", better: "late payers reminded automatically, with one list to check" });
  Object.assign(pr.provenance, { trigger: "Client said", pain: "Client said", role: "Observed", workaround: "Client said", consequence: "Client paraphrase", deliverable: "Product inference", better: "Client said" });
  return Object.assign(pr, over || {});
}

test("framing module: completeness, gaps, synthesis only from entered fields, and gap questions without duplicates", () => {
  const pr = framed();
  assert.deepEqual(P.completeness(pr), { done: 7, total: 7, gaps: [], complete: true });
  const partial = P.empty(); partial.id = "pb2"; partial.title = "Records ordering"; partial.frame.role = "Caroline"; partial.frame.pain = "one letter per establishment";
  const c = P.completeness(partial);
  assert.equal(c.done, 2); assert.deepEqual(c.gaps, ["trigger", "workaround", "consequence", "deliverable", "better"]); assert.equal(c.complete, false);
  const text = P.synthesize(partial);
  assert.match(text, /^For Caroline, the pain is that one letter per establishment\./);
  assert.doesNotMatch(text, /Today they|At stake|Better would be/, "nothing is invented for empty fields");
  assert.equal(P.synthesize(P.empty()), "");
  const full = P.synthesize(pr);
  assert.match(full, /the trigger is the 20th of the month and the pain is that about half/);
  assert.match(full, /Today they email each late client by hand on the 21st, which costs a day lost every month/);
  assert.match(full, /At stake: the monthly collection run[\s\S]*Better would be late payers reminded automatically/);
  const gaps = P.gapQuestions(partial);
  assert.deepEqual(gaps.map(g => g.field), ["trigger", "workaround", "consequence", "deliverable", "better"]);
  const existing = [{ problem: "pb2", frameField: "trigger", state: "Unanswered" }, { problem: "pb2", frameField: "workaround", state: "Superseded" }, { problem: "other", frameField: "consequence", state: "Unanswered" }];
  const made = P.mergeGapQuestions(existing, partial, "s1", 5, () => "q");
  assert.deepEqual(made.map(q => q.frameField), ["workaround", "consequence", "deliverable", "better"], "an open question for the same problem and step is not duplicated; a superseded one is re-asked; another problem's question does not count");
  assert.equal(made[0].session, "s1"); assert.equal(made[0].problem, "pb2"); assert.equal(made[0].state, "Unanswered");
});

test("framing module: a problem framed from evidence or a request starts as a Draft with provenance, never as client evidence", () => {
  const e = { id: "e1", text: "On n'est pas chauds pour automatiser la préclassification", kind: "Direct quote", session: "s1", links: { step: "w1" } };
  const pr = P.fromEvidence(e, () => "pb3", 9);
  assert.equal(pr.status, "Draft"); assert.deepEqual(pr.evidence, ["e1"]); assert.equal(pr.session, "s1"); assert.deepEqual(pr.steps, ["w1"]);
  assert.equal(pr.provenance.pain, "Client said"); assert.equal(pr.statement, ""); assert.equal(pr.statementDraft, true);
  const r = { id: "r1", title: "Batch email", evidence: ["e1", "e2"], feature: "f1", decisionRef: "d1" };
  const pr2 = P.fromRequest(r, () => "pb4", 9);
  assert.deepEqual(pr2.requests, ["r1"]); assert.deepEqual(pr2.evidence, ["e1", "e2"]); assert.equal(pr2.provenance.pain, "Explicit request"); assert.equal(pr2.feature, "f1"); assert.equal(pr2.decision, "d1");
});

test("normalize: problems round-trip, unknown values fall back, dangling links are dropped, requests and decisions untouched", () => {
  let s = normalize(seed());
  const f = s.features[0];
  s.pilots = [{ id: "p", name: "Le Cabinet M", status: "Discovery",
    evidence: [{ id: "e1", text: "quote", kind: "Direct quote" }], steps: [{ id: "w1", title: "Billing" }], requests: [{ id: "r1", title: "Batch email" }], artifacts: [{ id: "a1", title: "Mockup", problem: "pb1" }, { id: "a2", title: "Other", problem: "ghost" }], sessions: [{ id: "s1", title: "Sarah", date: "2026-09-10" }],
    questions: [{ id: "q1", text: "gap", problem: "pb1", frameField: "better" }, { id: "q2", text: "gap2", problem: "ghost", frameField: "nope" }],
    problems: [Object.assign(framed(), { status: "weird", confidence: "Huge", evidence: ["e1", "ghost"], steps: ["w1", "ghost"], requests: ["r1", "ghost"], artifacts: ["a1", "ghost"], session: "ghost", feature: f.id, decision: "d1",
      provenance: { trigger: "Client said", pain: "nope" }, routing: { workflow: "today", output: "a list", surface: "Connected firm system", capabilities: ["Retrieval", "Nope", "Actions"], ownership: "us", operating: { data: "JE export only" }, validation: { stage: "Prototype", next: "show Caroline", evidence: "she uses it twice" } } }), { title: "" }] }];
  s.decisions = [{ id: "d1", title: "Build batch email", state: "Proposed", pilot: "p", links: { problem: "pb1", request: "r1" } }, { id: "d2", title: "Elsewhere", state: "Proposed", pilot: "p", links: { problem: "ghost" } }];
  s = normalize(s);
  const p = s.pilots[0]; const pr = p.problems[0];
  assert.equal(p.problems.length, 2); assert.equal(p.problems[1].title, "Untitled problem"); assert.equal(p.problems[1].status, "Draft");
  assert.equal(pr.status, "Draft", "unknown status falls back to Draft"); assert.equal(pr.confidence, "");
  assert.deepEqual(pr.evidence, ["e1"]); assert.deepEqual(pr.steps, ["w1"]); assert.deepEqual(pr.requests, ["r1"]); assert.deepEqual(pr.artifacts, ["a1"]); assert.equal(pr.session, ""); assert.equal(pr.feature, f.id); assert.equal(pr.decision, "d1");
  assert.equal(pr.provenance.trigger, "Client said"); assert.equal(pr.provenance.pain, ""); assert.equal(pr.provenance.better, "");
  assert.equal(pr.frame.workaround, "email each late client by hand on the 21st");
  assert.deepEqual(pr.routing.capabilities, ["Retrieval", "Actions"]); assert.equal(pr.routing.surface, "Connected firm system"); assert.equal(pr.routing.operating.data, "JE export only"); assert.equal(pr.routing.operating.model, ""); assert.equal(pr.routing.validation.stage, "Prototype");
  assert.equal(pr.drive.status, "Not in Drive"); assert.equal(pr.statementDraft, true);
  assert.equal(p.artifacts[0].problem, "pb1"); assert.equal(p.artifacts[1].problem, "", "an artifact link to a missing problem is cleared");
  assert.equal(p.questions[0].problem, "pb1"); assert.equal(p.questions[0].frameField, "better"); assert.equal(p.questions[1].problem, ""); assert.equal(p.questions[1].frameField, "");
  assert.equal(p.requests.length, 1); assert.equal(p.requests[0].decision, "Undecided", "framing a problem changes no request");
  assert.equal(s.decisions[0].links.problem, "pb1"); assert.equal(s.decisions[0].state, "Proposed", "decisions keep their state; the gate is untouched");
  assert.equal(s.decisions[1].links.problem, undefined, "a decision link to a missing problem is dropped");
  const again = normalize(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(again.pilots[0].problems, s.pilots[0].problems, "normalize is idempotent on problems");
});

test("exports: the pilot doc and the per-record doc carry the framing, provenance and the draft flag", () => {
  let s = normalize(seed());
  const withRouting = framed({ evidence: ["e1"], requests: ["r1"], statement: "For Caroline, the trigger is the 20th.", statementDraft: true });
  withRouting.routing.surface = "Connected firm system"; withRouting.routing.validation.stage = "Prototype"; withRouting.routing.validation.next = "show Caroline a list"; withRouting.decision = "d1";
  s.pilots = [{ id: "p", name: "Le Cabinet M", status: "Discovery", link: "https://drive.google.com/drive/folders/abc", evidence: [{ id: "e1", text: "on oublie de payer", kind: "Direct quote", speaker: "Sarah-Jeanne" }], requests: [{ id: "r1", title: "Batch email" }], problems: [withRouting] }];
  s.decisions = [{ id: "d1", title: "Build batch email", state: "Decided", alignment: "Agreed", pilot: "p", links: { problem: "pb1" } }];
  s = normalize(s);
  const pm = pilotMarkdown(s, s.pilots[0], new Date("2026-09-15T00:00:00Z"));
  assert.match(pm, /## Customer problems \(1\)\n\n### Collections take a day every month · Framed · confidence Medium · 7 of 7 framed/);
  assert.match(pm, /- Trigger: the 20th of the month \[Client said\]/);
  assert.match(pm, /\*\*Specific problem \(draft synthesis, not client evidence\)\.\*\* For Caroline/);
  assert.match(pm, /Evidence: \[Direct quote\] on oublie de payer/);
  assert.match(pm, /Routing: surface Connected firm system · validation Prototype · next show Caroline a list/);
  const rm = recordMarkdown(s, "problem", s.pilots[0].problems[0], s.pilots[0], new Date("2026-09-15T00:00:00Z"));
  assert.match(rm, /^# Customer problem — Collections take a day every month · Le Cabinet M/);
  assert.match(rm, /\*\*6\. Decision\/deliverable at stake\*\* · Product inference\n\nthe monthly collection run/);
  assert.match(rm, /## Specific problem \(draft synthesis, not client evidence\)/);
  assert.match(rm, /- Request: Batch email/); assert.match(rm, /- Product decision: Build batch email \(Decided\)/);
  const dm = recordMarkdown(s, "decision", s.decisions[0], s.pilots[0]);
  assert.match(dm, /- Customer problem: Collections take a day every month \(Framed\)/);
});

let server, base, dir;
function api(method, url, body) {
  return fetch(base + url, { method, headers: body !== undefined ? { "Content-Type": "application/json" } : {}, body: body !== undefined ? JSON.stringify(body) : undefined })
    .then(async r => ({ status: r.status, body: r.status === 204 ? null : await r.json() }));
}
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "alie-pm-problems-"));
  const app = createApp({ dataFile: path.join(dir, "db.json") });
  await new Promise(res => { server = app.listen(0, res); });
  base = "http://127.0.0.1:" + server.address().port;
});
after(async () => { await new Promise(res => server.close(res)); fs.rmSync(dir, { recursive: true, force: true }); });

test("api: a pilot's problems persist through the whole-document save and leave the rest of the pilot as it was", async () => {
  const st = await api("GET", "/api/state");
  const s = st.body.state;
  s.pilots = [{ id: "p9", name: "Le Cabinet M", status: "Discovery", requests: [{ id: "r1", title: "Batch email" }], deliverables: [{ id: "d1", title: "Clean file" }], stack: [{ id: "x1", name: "Juris", kind: "Software" }, { id: "x2", name: "IT", kind: "Partner" }], evidence: [{ id: "e1", text: "quote", kind: "Direct quote" }], problems: [framed({ evidence: ["e1"], requests: ["r1"] })] }];
  const put = await api("PUT", "/api/state", { version: st.body.version, state: s, who: "Uzziel" });
  assert.equal(put.status, 200);
  const p = put.body.state.pilots[0];
  assert.equal(p.problems.length, 1); assert.equal(p.problems[0].frame.better, "late payers reminded automatically, with one list to check"); assert.equal(p.problems[0].provenance.consequence, "Client paraphrase");
  assert.equal(p.requests.length, 1); assert.equal(p.deliverables.length, 1); assert.equal(p.stack.length, 2); assert.equal(p.status, "Discovery");
  const again = await api("GET", "/api/state");
  assert.deepEqual(again.body.state.pilots[0].problems, p.problems);
});
