/* Customer problem framing: the seven steps between a broad complaint and a specific problem.
   Pure functions shared by the browser (window.ALIE_PROBLEMS) and the tests (require). No DOM here. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api; else root.ALIE_PROBLEMS = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var FRAME = [
    { key: "trigger", n: 1, label: "Trigger", prompt: "When it happens; what starts the work.",
      questions: ["When does this happen, and how often?", "What starts the work: a deadline, a meeting, a request, a review, an escalation, a handoff, or a cycle?"] },
    { key: "pain", n: 2, label: "Specific pain", prompt: "What is hard, slow or unreliable at that moment.",
      questions: ["What exactly is hard, slow or unreliable at that moment?", "Where does it break, and what do they do when it does?"] },
    { key: "role", n: 3, label: "Affected role/team", prompt: "Who carries it.",
      questions: ["Which role or team is affected, and how many people?", "Who else feels it downstream?"] },
    { key: "workaround", n: 4, label: "Current workaround", prompt: "Tools, documents, systems, manual steps, breakpoints, missing or outdated information.",
      questions: ["What do they do today, step by step?", "Which tools, documents or systems are involved, and where does the manual work sit?", "What information is missing or outdated when they do it?"] },
    { key: "consequence", n: 5, label: "Business consequence", prompt: "Delay, risk, effect on clients or staff, cost, capacity, quality or speed.",
      questions: ["What does it cost the business: delay, risk, cost, capacity, quality or speed?", "Who feels it: a client, the staff, the firm?", "What happens when it goes wrong?"] },
    { key: "deliverable", n: 6, label: "Decision/deliverable at stake", prompt: "The customer's output, approval, handoff or decision. Not ALIE's decision gate.",
      questions: ["What must be created, updated, reviewed, approved or handed off?", "Who uses it next, and for what?", "Which decision of theirs does it support?"] },
    { key: "better", n: 7, label: "Better state", prompt: "In business language: faster, easier, more consistent, more visible.",
      questions: ["What would better look like, in their words: faster, easier, more consistent, more visible?", "What could the team do then that they cannot do now?", "How would they know it improved?"] }
  ];
  var STATUS = ["Draft", "Framed", "Validating", "Validated", "Superseded"];
  var CONFIDENCE = ["", "Low", "Medium", "High"];
  var PROVENANCE = ["", "Client said", "Client paraphrase", "Observed", "Product inference", "Explicit request"];
  var EVIDENCE_TO_PROVENANCE = { "Direct quote": "Client said", "Client paraphrase": "Client paraphrase", "Observed": "Observed", "Product inference": "Product inference", "Explicit request": "Explicit request", "Unsorted": "" };
  var SURFACES = ["", "Legal case workspace", "Chronology workspace/editor", "Draft/report", "Expert package", "Share/portal", "Admin/evaluation", "Connected firm system", "Human-only/no product change", "Other"];
  var CAPABILITIES = ["Connected applications", "Retrieval", "Actions", "Schedules", "Approvals", "Automation", "Collaboration/delegation", "Other"];
  var VALIDATION_STAGES = ["", "Prototype", "Review", "Test with users", "Refine", "Confirm fit"];
  var OPERATING = [["data", "Data and source boundaries"], ["permissions", "Permissions"], ["retention", "Retention"], ["review", "Human review"], ["deployment", "Deployment and infrastructure"], ["model", "Model choice"], ["migration", "Migration"]];

  function s(v) { return v === null || v === undefined ? "" : String(v); }
  function clean(v) { return s(v).replace(/\s+/g, " ").trim(); }
  function endsWithDot(t) { return /[.!?…»]$/.test(t) ? t : t + "."; }
  function lowerFirst(t) { return t ? t.charAt(0).toLowerCase() + t.slice(1) : t; }

  function empty() {
    return {
      id: "", title: "", status: "Draft", confidence: "", owner: "",
      frame: { trigger: "", pain: "", role: "", workaround: "", consequence: "", deliverable: "", better: "" },
      provenance: { trigger: "", pain: "", role: "", workaround: "", consequence: "", deliverable: "", better: "" },
      statement: "", statementDraft: true, statementAt: 0,
      evidence: [], steps: [], requests: [], artifacts: [], session: "", feature: "", decision: "",
      routing: { workflow: "", output: "", surface: "", capabilities: [], ownership: "", operating: { data: "", permissions: "", retention: "", review: "", deployment: "", model: "", migration: "" }, validation: { stage: "", next: "", evidence: "" } },
      drive: { fileId: "", status: "Not in Drive", syncedAt: "", error: "" }, created: 0, updated: 0
    };
  }
  /* which of the seven steps are filled; the title counts separately */
  function completeness(pr) {
    var f = (pr && pr.frame) || {};
    var gaps = FRAME.filter(function (st) { return !clean(f[st.key]); }).map(function (st) { return st.key; });
    return { done: FRAME.length - gaps.length, total: FRAME.length, gaps: gaps, complete: gaps.length === 0 && !!clean(pr && pr.title) };
  }
  /* a 2–3 sentence draft made only from what was entered; nothing is invented for a missing field */
  function synthesize(pr) {
    var f = (pr && pr.frame) || {};
    var role = clean(f.role), trigger = clean(f.trigger), pain = clean(f.pain), wa = clean(f.workaround), cons = clean(f.consequence), del = clean(f.deliverable), better = clean(f.better);
    var s1 = [];
    if (role || trigger || pain) {
      var head = role ? "For " + role + ", " : "";
      var parts = [];
      if (trigger) parts.push("the trigger is " + lowerFirst(trigger));
      if (pain) parts.push("the pain is " + (/^(that|when|how)\b/i.test(pain) ? lowerFirst(pain) : "that " + lowerFirst(pain)));
      head += parts.join(" and ");
      if (!parts.length) head = role + " is the affected role";
      s1 = [endsWithDot(head.charAt(0).toUpperCase() + head.slice(1))];
    }
    var s2 = "";
    if (wa || cons) {
      s2 = wa ? "Today they " + lowerFirst(wa) : "";
      if (cons) s2 += (wa ? ", which costs " : "This costs ") + lowerFirst(cons);
      s2 = endsWithDot(s2);
    }
    var s3 = "";
    if (del || better) {
      s3 = del ? "At stake: " + lowerFirst(del) : "";
      if (better) s3 += (del ? ". Better would be " : "Better would be ") + lowerFirst(better);
      s3 = endsWithDot(s3);
    }
    return [s1[0], s2, s3].filter(Boolean).join(" ");
  }
  /* helper questions for every unfilled step */
  function gapQuestions(pr) {
    var c = completeness(pr);
    var out = [];
    FRAME.forEach(function (st) { if (c.gaps.indexOf(st.key) === -1) return; out.push({ field: st.key, text: st.questions[0], label: st.label }); });
    return out;
  }
  /* new question records for a session, skipping any open question already asked for the same problem and step */
  function mergeGapQuestions(existing, pr, sessionId, now, makeId) {
    var have = {};
    (existing || []).forEach(function (q) { if (q && q.problem === pr.id && q.frameField && q.state !== "Superseded") have[q.frameField] = true; });
    return gapQuestions(pr).filter(function (g) { return !have[g.field]; }).map(function (g) {
      return { id: makeId(), text: g.text, note: "Framing gap on “" + clean(pr.title) + "”: " + g.label + ".", state: "Unanswered", status: "Open", answer: "", candidate: null, session: sessionId || "", step: "", problem: pr.id, frameField: g.field, created: now, updated: now };
    });
  }
  function fromEvidence(e, makeId, now) {
    var pr = empty();
    pr.id = makeId(); pr.created = now; pr.updated = now;
    pr.title = clean(e && e.text).slice(0, 110);
    pr.evidence = e && e.id ? [e.id] : [];
    pr.session = (e && e.session) || "";
    var prov = EVIDENCE_TO_PROVENANCE[e && e.kind] || "";
    if (prov) pr.provenance.pain = prov;
    if (e && e.links && e.links.request) pr.requests = [e.links.request];
    if (e && e.links && e.links.step) pr.steps = [e.links.step];
    if (e && e.links && e.links.feature) pr.feature = e.links.feature;
    return pr;
  }
  function fromRequest(r, makeId, now) {
    var pr = empty();
    pr.id = makeId(); pr.created = now; pr.updated = now;
    pr.title = clean(r && r.title).slice(0, 110);
    pr.requests = r && r.id ? [r.id] : [];
    pr.evidence = (r && r.evidence || []).slice();
    pr.provenance.pain = "Explicit request";
    if (r && r.feature) pr.feature = r.feature;
    if (r && r.decisionRef) pr.decision = r.decisionRef;
    return pr;
  }
  return { FRAME: FRAME, STATUS: STATUS, CONFIDENCE: CONFIDENCE, PROVENANCE: PROVENANCE, EVIDENCE_TO_PROVENANCE: EVIDENCE_TO_PROVENANCE, SURFACES: SURFACES, CAPABILITIES: CAPABILITIES, VALIDATION_STAGES: VALIDATION_STAGES, OPERATING: OPERATING,
    empty: empty, completeness: completeness, synthesize: synthesize, gapQuestions: gapQuestions, mergeGapQuestions: mergeGapQuestions, fromEvidence: fromEvidence, fromRequest: fromRequest };
});
