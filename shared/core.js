/* Runtime-neutral core: data model, seed, normalisation, and the HTTP API handler.
   Used by the local Express server and by the Cloudflare Worker. No Node or Workers APIs here. */

import { normalizeReview, snapshotOf, revisionOpen, validateSubmission, LIMITS as REVIEW_LIMITS } from "../public/reviews.js";

export const STATES = ["Proposed", "Research", "Planned", "Building", "Live", "Needs work", "Feature flag"];
/* States that mean the thing exists in the product. Reaching one of them without ever being Planned is drift. */
export const BUILT_STATES = ["Building", "Live", "Needs work", "Feature flag"];
export const RND_STAGES = ["Backlog", "Assigned", "In progress", "Findings", "Concluded"];

export function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function mKey(d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2); }
function mAdd(k, n) { const p = k.split("-"); return mKey(new Date(+p[0], +p[1] - 1 + n, 1)); }

export function seed() {
  const now = Date.now();
  const A = uid(), T = uid(), G = uid();
  const F = [];
  function f(pr, name, st, owner, spaces, off, note, extra) {
    F.push(Object.assign({
      id: uid(), project: pr, name, state: st, owner, spaces,
      period: off === null ? null : mAdd(mKey(new Date()), off),
      note: note || "", link: "", rnd: false, rndStage: "Backlog", student: "", rndQuestion: "", rndPlan: "", rndFindings: "", driveDoc: "", parent: null,
      created: now, updated: now
    }, extra || {}));
  }
  f(A, "Portal", "Live", "Uzziel", ["Legal"], null, "Client-facing dossier portal. In the application today.");
  f(A, "Report Shelf", "Live", "Uzziel", ["Legal", "Administrative"], null, "Where completed reports live after export.");
  f(A, "Focus Mode", "Feature flag", "Uzziel", ["Health"], null, "Built, but hide it from the UI until the layout settles.");
  f(A, "Dictation", "Needs work", "David", ["Health"], 2, "Accuracy needs another pass before clinics see it.");
  f(A, "Ask ALIE", "Building", "Uzziel", ["Legal", "Health"], 0, "Question box over the dossier. Every answer carries its source page.");
  f(A, "Section 9", "Planned", "David", ["Health"], 1, "First of the two remaining sections. Ships before Section 11.");
  f(A, "Section 11", "Planned", "David", ["Health"], 2, "Follows Section 9 directly. Same extraction path, different template.");
  f(A, "Chronology accounting", "Research", "Uzziel", ["Legal"], 1, "R&D before scoping. Decide how undated events are handled.",
    { rnd: true, rndStage: "Assigned", student: "Student A", rndQuestion: "How should undated events be placed in a chronology without misleading the reader?" });
  f(A, "Omission detection", "Planned", "Faical", ["Legal"], 3, "Mandatory scan before export unlocks.");
  f(A, "Case registry filters", "Needs work", "Faical", ["Administrative"], 1, "Status and date filters on the case list.");
  f(A, "Cross-report contradiction finder", "Research", "Uzziel", ["Legal", "Health"], null, "Detect contradictions between reports in the same dossier.",
    { rnd: true, rndStage: "Backlog", rndQuestion: "Can contradictions between two medical reports be surfaced reliably with citations?" });
  f(T, "HealthTech Navigator", "Needs work", "Uzziel", ["Administrative"], 0, "Hub links need repointing to indexable pages.");
  f(G, "Readiness report v2", "Planned", "Uzziel", ["Administrative"], 2, "Make the PDF legible without in-house engineering.");

  return {
    projects: [
      { id: A, name: "ALIE", kind: "Medico-legal" },
      { id: T, name: "Teche Health", kind: "Consulting" },
      { id: G, name: "GEO-Pulse", kind: "SaaS" }
    ],
    spaces: ["Health", "Legal", "Administrative"],
    sections: {},
    people: ["Uzziel", "David", "Faical", "Unassigned"],
    students: ["Student A", "Student B"],
    icps: seedIcps(),
    features: F,
    current: A
  };
}

export const DEFAULT_SECTIONS = {
  "Health": ["Command Center", "Schedule", "Cases", "Documents", "Ask ALIE", "Workflows", "Library", "Settings", "Platform"],
  "Legal": ["Create", "Search", "Ask ALIE", "Prompt Library", "Cases", "Drafts", "Tasks", "Settings", "Platform"],
  "ALIE Admin": ["Personal", "Workspace", "Platform"]
};

export const ICP_AVATARS = ["regime", "institution", "physician", "lawyer", "paralegal", "person", "law-firm", "clinic", "insurer", "employer", "other"];

export function seedIcps() {
  /* Seeded from the 9 Sept 2026 segmentation research ("The regime is the segment"): the statute that
     commissions the work is the primary axis; buyers are the parties it forces to produce a defensible package. */
  const mk = (name, kind, avatar, description, tam, notes) => ({ id: uid(), name, kind, avatar, description, tam, sam: "", som: "", notes, regimes: [], facts: [] });
  const cnesst = mk("CNESST", "Regime", "regime", "Workers' compensation under the LATMP: art. 204 (CNESST-designated) and art. 209 (employer-commissioned) expertises converging on the BEM. One closed list of five contested subjects.",
    "~24,457 medico-legal evaluations / yr",
    "8,507 BEM + 5,983 art. 204 + ~9,967 employer evaluations. 107,124 accepted injuries and 31,364 refused claims (2024); 78,475 demandes de r\u00e9vision (2025, 68.9% by employers); 43,256 TAT files opened. Tariff: $730 public lane vs ~$2,300 private lane (art. 196 carve-out). Sources: CNESST Statistiques annuelles, TAT, UTTAM (attribute by name).");
  const saaq = mk("SAAQ", "Regime", "regime", "Road-accident victims under the no-fault SAAQ regime: expert reports and chronologies for counsel and physicians. Voluminous file defined as more than 500 pages (directive in force 2025-01-01).",
    "91,418 claims / yr",
    "2025: 91,418 claims processed, $1,535M in indemnities. Tariffs: $791 other specialties, $1,180 psychiatry (entente SAAQ\u2013FMSQ). No bodily-injury action exists (art. 83.57), so settlement-demand tools do not transfer.");
  const ivac = mk("IVAC", "Regime", "regime", "Crime-victim compensation files, including the CNESST forms filed inside them. Fastest-growing regime by volume.",
    "27,904 requests / yr",
    "2024: 27,904 requests, up 3.25x in five years; 383,720 documents processed in one year (+35.7%). Source: MJQ LAPVIC 2024\u201325.");
  const civil = mk("Civil", "Regime", "regime", "Civil liability and insurance litigation built on hospital and clinic records. One expertise per discipline; the report stands as testimony (art. 232, 293 CPC) and can be rejected for irregularity (art. 241).",
    "Not sized",
    "Includes private disability insurers (LTD/STD, 2.9M Quebecers covered) as a reviewer segment: signal only.");
  const expert = mk("M\u00e9decin expert \u2014 private lane", "Buyer", "physician", "Expertise physicians working art. 209, insurer and lawyer-commissioned IMEs. Files of 50\u2013200 pages, private-market billing, solo buyer with no procurement.",
    "83 in the directory \u00b7 ~$1.5M ARR ceiling",
    "Research score 30/35, rank 1. Live lead. 55 published emails. ~300 experts at $5k/yr is a $1.5M ARR ceiling. Competitive headroom is the weak point (ExpertMedical.ai targets this ICP).");
  const worker = mk("Cabinet d'avocats \u2014 c\u00f4t\u00e9 travailleur", "Buyer", "law-firm", "Worker-side law firms contesting CNESST, SAAQ and IVAC decisions. Files of 200\u20133,000 pages; legal aid pays a fixed $385 per review and $1,115 per tribunal recourse.",
    "~170\u2013250 firms",
    "Research score 27/35, rank 2. Active pilot (Le Cabinet M). A hand-built chronology (5.5 paralegal hours, $196\u2013$218 loaded) consumes 56.6% of a legal-aid r\u00e9vision mandate.");
  const mutuelle = mk("Mutuelle managers & IME coordinators", "Buyer", "insurer", "The intermediary layer that reviews and coordinates independent medical examinations for employer groups.",
    "~35 firms \u00b7 27,724 employers",
    "Research score 23/35, rank 3. No lead yet.");
  const employer = mk("Cabinet d'avocats \u2014 c\u00f4t\u00e9 employeur", "Buyer", "law-firm", "Employer-side firms handling CNESST contestation; both contester and reviewer of the medical record.",
    "Subset of the same bar",
    "Research score 23/35, rank 3. Mailed.");
  expert.regimes = [cnesst.id, saaq.id, civil.id];
  worker.regimes = [cnesst.id, saaq.id, ivac.id];
  mutuelle.regimes = [cnesst.id];
  employer.regimes = [cnesst.id];
  expert.facts = [{ label: "Public-lane tariff (art. 204 / BEM)", value: "$730 per file" }, { label: "Private-lane price (art. 209)", value: "~$2,300 per file" }, { label: "Time per BEM opinion", value: "2\u20136 h, up to 10 h" }];
  worker.facts = [{ label: "Legal aid, r\u00e9vision mandate", value: "$385 fixed" }, { label: "Legal aid, tribunal recourse", value: "$1,115 fixed" }, { label: "Hand-built chronology", value: "5.5 paralegal hours" }];
  return [cnesst, saaq, ivac, civil, expert, worker, mutuelle, employer];
}

/* Make sure every record has every field the UI relies on. Mutates and returns the state. */
export function normalize(state) {
  const s = state && typeof state === "object" ? state : {};
  if (!Array.isArray(s.projects) || !s.projects.length) s.projects = [{ id: uid(), name: "New project", kind: "" }];
  s.projects = s.projects.filter(p => p && typeof p === "object").map(p => ({ id: String(p.id || uid()), name: String(p.name || "Untitled"), kind: String(p.kind || "") }));
  if (!Array.isArray(s.spaces)) s.spaces = [];
  s.spaces = s.spaces.filter(x => typeof x === "string" && x.trim()).map(x => x.trim());
  if (!s.sections || typeof s.sections !== "object" || Array.isArray(s.sections)) s.sections = {};
  Object.keys(s.sections).forEach(k => {
    if (!Array.isArray(s.sections[k])) { delete s.sections[k]; return; }
    s.sections[k] = s.sections[k].filter(x => typeof x === "string" && x.trim()).map(x => x.trim());
  });
  s.spaces.forEach(sp => { if (!s.sections[sp]) s.sections[sp] = (DEFAULT_SECTIONS[sp] || []).slice(); });
  if (!Array.isArray(s.people)) s.people = ["Unassigned"];
  s.people = s.people.filter(x => typeof x === "string" && x.trim()).map(x => x.trim());
  if (s.people.indexOf("Unassigned") === -1) s.people.push("Unassigned");
  if (!Array.isArray(s.students)) s.students = [];
  s.students = s.students.filter(x => typeof x === "string" && x.trim()).map(x => x.trim());
  if (s.icps === undefined) s.icps = seedIcps(); // documents created before profiles existed get the four regimes
  if (!Array.isArray(s.icps)) s.icps = [];
  s.icps = s.icps.filter(x => x && typeof x === "object").map(x => {
    const kind = x.kind === "Regime" ? "Regime" : "Buyer";
    let avatar = String(x.avatar || "");
    if (ICP_AVATARS.indexOf(avatar) === -1) avatar = kind === "Regime" ? "regime" : "person";
    return {
      id: String(x.id || uid()), name: String(x.name || "Untitled profile"), kind, avatar,
      description: String(x.description || ""), tam: String(x.tam || ""), sam: String(x.sam || ""), som: String(x.som || ""), notes: String(x.notes || ""),
      image: String(x.image || ""),
      regimes: Array.isArray(x.regimes) ? x.regimes.filter(r => typeof r === "string") : [],
      facts: Array.isArray(x.facts) ? x.facts.filter(f => f && typeof f === "object").map(f => ({ label: String(f.label || ""), value: String(f.value || "") })).filter(f => f.label || f.value) : []
    };
  });
  const icpIds = new Set(s.icps.map(x => x.id));
  const regimeIds = new Set(s.icps.filter(x => x.kind === "Regime").map(x => x.id));
  s.icps.forEach(x => { x.regimes = x.kind === "Regime" ? [] : x.regimes.filter(r => regimeIds.has(r)); });
  if (typeof s.driveFolder !== "string") s.driveFolder = "";
  if (typeof s.rndFolder !== "string") s.rndFolder = "";
  if (!Array.isArray(s.pilots)) s.pilots = [];
  const PILOT_STATUS = ["Prospect", "Discovery", "Preparing trial", "Piloting", "Live client", "Paused"];
  const EV_KINDS = ["Unsorted", "Direct quote", "Client paraphrase", "Observed", "Product inference", "Explicit request"];
  const FIT_VALUES = ["Not assessed", "Keep", "Simplify", "Rework", "Hide from pilot", "Retire candidate"];
  const DELIV_STATUS = ["Proposed", "Agreed", "In delivery", "Ready for client testing", "Accepted"];
  const VALIDATION = ["Not validated", "Client validated", "Rejected"];
  const str = v => (v === null || v === undefined) ? "" : String(v);
  const num = (v, d) => Number(v) || d;
  const validation = v => ({ status: v && VALIDATION.indexOf(v.status) !== -1 ? v.status : "Not validated", note: str(v && v.note), date: str(v && v.date) });
  const links = v => { const o = {}; if (v && typeof v === "object") ["session", "evidence", "request", "deliverable", "feature", "step", "question", "problem", "artifact"].forEach(k => { if (v[k]) o[k] = str(v[k]); }); return o; };
  const PROBLEM_STATUS = ["Draft", "Framed", "Validating", "Validated", "Superseded"];
  const PROV = ["", "Client said", "Client paraphrase", "Observed", "Product inference", "Explicit request"];
  const SURFACES = ["", "Legal case workspace", "Chronology workspace/editor", "Draft/report", "Expert package", "Share/portal", "Admin/evaluation", "Connected firm system", "Human-only/no product change", "Other"];
  const CAPS = ["Connected applications", "Retrieval", "Actions", "Schedules", "Approvals", "Automation", "Collaboration/delegation", "Other"];
  const VSTAGES = ["", "Prototype", "Review", "Test with users", "Refine", "Confirm fit"];
  const FRAME_KEYS = ["trigger", "pain", "role", "workaround", "consequence", "deliverable", "better"];
  const OPER_KEYS = ["data", "permissions", "retention", "review", "deployment", "model", "migration"];
  const arr = v => Array.isArray(v) ? v.filter(x => x && typeof x === "object") : [];
  const strIds = v => Array.isArray(v) ? v.filter(x => typeof x === "string") : [];
  const SESSION_STAGES = ["Planned", "Recorded", "Transcript added", "Extracted draft", "Human reviewed", "Follow-ups closed"];
  const Q_STATES = ["Unanswered", "Candidate answer from transcript", "Confirmed by client", "Superseded"];
  const LOOP = ["Received", "Needs analysis", "Action/prototype created", "Reviewed with firm", "Validated/Closed"];
  const FILE_KINDS = ["Recording", "Transcript", "Raw notes", "Summary", "Received file", "Output", "Other"];
  const ART_STATUS = ["Draft", "Shared", "Reviewed", "Final", "Retired"];
  const drv = v => ({ fileId: str(v && v.fileId), status: ["Not in Drive", "Linked", "Synced", "Error"].indexOf(v && v.status) !== -1 ? v.status : (v && v.fileId ? "Synced" : "Not in Drive"), syncedAt: str(v && v.syncedAt), error: str(v && v.error) });
  const oneOf = (list, v, d) => list.indexOf(v) !== -1 ? v : d;
  const cal = v => ({ eventId: str(v && v.eventId), link: str(v && v.link), status: oneOf(["Not in calendar", "In calendar", "Cancelled in calendar", "Error"], v && v.status, v && v.eventId ? "In calendar" : "Not in calendar"), syncedAt: str(v && v.syncedAt), error: str(v && v.error), origin: v && v.origin === "Calendar" ? "Calendar" : "App", eventUpdated: str(v && v.eventUpdated) });
  s.pilots = s.pilots.filter(p => p && typeof p === "object").map(p => ({
    id: String(p.id || uid()), name: String(p.name || "Untitled pilot"),
    status: PILOT_STATUS.indexOf(p.status) !== -1 ? p.status : "Prospect",
    contact: String(p.contact || ""), icp: String(p.icp || ""), since: typeof p.since === "string" ? p.since : "",
    notes: String(p.notes || ""), link: String(p.link || ""), driveDoc: String(p.driveDoc || ""),
    wants: Array.isArray(p.wants) ? p.wants.filter(x => typeof x === "string") : [],
    needs: Array.isArray(p.needs) ? p.needs.filter(x => typeof x === "string") : [],
    deliverables: (Array.isArray(p.deliverables) ? p.deliverables : []).filter(d => d && typeof d === "object").map(d => ({
      id: String(d.id || uid()), title: String(d.title || "Untitled deliverable"), note: String(d.note || ""),
      tag: ["Quick win", "Big bet", "Later", "Blocked"].indexOf(d.tag) !== -1 ? d.tag : "",
      features: Array.isArray(d.features) ? d.features.filter(x => typeof x === "string") : [],
      status: d.status, validation: d.validation, decisionRef: d.decisionRef
    })),
    requests: (Array.isArray(p.requests) ? p.requests : []).filter(r => r && typeof r === "object").map(r => ({
      id: String(r.id || uid()), title: String(r.title || "Untitled request"),
      bottleneck: String(r.bottleneck || ""), need: String(r.need || ""), solution: String(r.solution || ""),
      fit: ["Core to ALIE", "Adjacent", "Out of scope"].indexOf(r.fit) !== -1 ? r.fit : "",
      decision: ["Undecided", "Build", "Integrate or partner", "Later", "Declined"].indexOf(r.decision) !== -1 ? r.decision : "Undecided",
      reason: String(r.reason || ""), source: String(r.source || ""), feature: String(r.feature || ""),
      evidence: r.evidence, validation: r.validation, decisionRef: r.decisionRef,
      created: Number(r.created) || Date.now(), updated: Number(r.updated) || Date.now()
    })),
    stack: (Array.isArray(p.stack) ? p.stack : []).filter(x => x && typeof x === "object").map(x => ({
      id: String(x.id || uid()), name: String(x.name || "Untitled"), kind: x.kind === "Partner" ? "Partner" : "Software",
      category: String(x.category || ""), usage: String(x.usage || ""), link: String(x.link || ""),
      created: Number(x.created) || Date.now(), updated: Number(x.updated) || Date.now()
    })),
    /* discovery */
    objective: str(p.objective),
    nextTouch: { date: str(p.nextTouch && p.nextTouch.date), note: str(p.nextTouch && p.nextTouch.note) },
    people: arr(p.people).map(x => ({ id: str(x.id || uid()), name: str(x.name || "Unnamed"), role: str(x.role), side: x.side === "Internal" ? "Internal" : "Client", note: str(x.note), email: str(x.email).trim() })),
    sessions: arr(p.sessions).map(x => ({ id: str(x.id || uid()), date: str(x.date), time: str(x.time), title: str(x.title), participants: str(x.participants), purpose: str(x.purpose), agenda: str(x.agenda), links: str(x.links), summary: str(x.summary), findings: str(x.findings), draft: !!x.draft,
      stage: oneOf(SESSION_STAGES, x.stage, x.date && x.date > new Date().toISOString().slice(0, 10) ? "Planned" : "Recorded"),
      drive: { recording: str(x.drive && x.drive.recording), transcript: str(x.drive && x.drive.transcript), rawNotes: str(x.drive && x.drive.rawNotes), summary: str(x.drive && x.drive.summary), receivedFiles: str(x.drive && x.drive.receivedFiles), folder: str(x.drive && x.drive.folder) },
      transcript: str(x.transcript), extractedAt: num(x.extractedAt, 0),
      files: arr(x.files).map(f => ({ id: str(f.id || uid()), name: str(f.name || "File"), link: str(f.link), kind: oneOf(FILE_KINDS, f.kind, "Other"), from: f.from === "Client" ? "Client" : "Us", loop: oneOf(LOOP, f.loop, "Received"), owner: str(f.owner), due: str(f.due), note: str(f.note), drive: drv(f.drive), created: num(f.created, Date.now()), updated: num(f.updated, Date.now()) })),
      doc: drv(x.doc), calendar: cal(x.calendar), created: num(x.created, Date.now()), updated: num(x.updated, Date.now()) })),
    evidence: arr(p.evidence).map(x => ({ id: str(x.id || uid()), text: str(x.text), kind: EV_KINDS.indexOf(x.kind) !== -1 ? x.kind : "Unsorted", session: str(x.session), source: str(x.source), speaker: str(x.speaker), timestamp: str(x.timestamp), draft: !!x.draft, note: str(x.note), links: links(x.links), created: num(x.created, Date.now()), updated: num(x.updated, Date.now()) })),
    steps: arr(p.steps).map((x, i) => ({ id: str(x.id || uid()), order: Number.isFinite(Number(x.order)) ? Number(x.order) : i, title: str(x.title || "Untitled step"), version: x.version === "proposed" ? "proposed" : "current", actor: str(x.actor), trigger: str(x.trigger), action: str(x.action), reasoning: str(x.reasoning), output: str(x.output), next: str(x.next), systems: str(x.systems), evidence: strIds(x.evidence), draft: !!x.draft, created: num(x.created, Date.now()), updated: num(x.updated, Date.now()) })),
    workflowVersion: Math.max(1, Math.round(num(p.workflowVersion, 1))),
    workflowHistory: arr(p.workflowHistory).map(h => ({ id: str(h.id || uid()), v: num(h.v, 1), label: str(h.label), at: num(h.at, Date.now()), steps: arr(h.steps) })),
    questions: arr(p.questions).map(x => {
      const state = oneOf(Q_STATES, x.state, x.status === "Answered" ? "Confirmed by client" : "Unanswered");
      return { id: str(x.id || uid()), text: str(x.text), state, status: state === "Confirmed by client" || state === "Superseded" ? "Answered" : "Open", answer: str(x.answer), note: str(x.note),
        candidate: x.candidate && typeof x.candidate === "object" ? { text: str(x.candidate.text), evidence: str(x.candidate.evidence), session: str(x.candidate.session), contradicts: !!x.candidate.contradicts, partial: !!x.candidate.partial } : null,
        session: str(x.session), step: str(x.step), problem: str(x.problem), frameField: FRAME_KEYS.indexOf(x.frameField) !== -1 ? x.frameField : "", created: num(x.created, Date.now()), updated: num(x.updated, Date.now()) };
    }),
    actions: arr(p.actions).map(x => ({ id: str(x.id || uid()), title: str(x.title), owner: str(x.owner), due: str(x.due), side: x.side === "Client" ? "Client" : "Internal", status: ["Open", "Done", "Blocked"].indexOf(x.status) !== -1 ? x.status : "Open", note: str(x.note), links: links(x.links), created: num(x.created, Date.now()), updated: num(x.updated, Date.now()) })),
    fit: Object.fromEntries(Object.entries(p.fit && typeof p.fit === "object" && !Array.isArray(p.fit) ? p.fit : {}).map(([k, v]) => [str(k), { fit: v && FIT_VALUES.indexOf(v.fit) !== -1 ? v.fit : "Not assessed", supports: str(v && v.supports), evidence: strIds(v && v.evidence), unknown: str(v && v.unknown), next: str(v && v.next), updated: num(v && v.updated, Date.now()) }])),
    recaps: arr(p.recaps).map(x => ({ id: str(x.id || uid()), week: str(x.week), internal: str(x.internal), client: str(x.client), clientReviewed: !!x.clientReviewed, created: num(x.created, Date.now()), updated: num(x.updated, Date.now()) })),
    artifacts: arr(p.artifacts).map(x => ({ id: str(x.id || uid()), title: str(x.title || "Untitled"), link: str(x.link), kind: ["Prototype", "Document", "Recording", "Other"].indexOf(x.kind) !== -1 ? x.kind : "Other", note: str(x.note), feature: str(x.feature), request: str(x.request),
      audience: oneOf(["Internal", "Client", "Both"], x.audience, "Internal"), version: str(x.version), status: oneOf(ART_STATUS, x.status, "Draft"), owner: str(x.owner), session: str(x.session), origin: x.origin === "Received" ? "Received" : "Created", step: str(x.step), evidence: strIds(x.evidence), decision: str(x.decision), problem: str(x.problem),
      loop: oneOf(LOOP, x.loop, "Received"), loopOwner: str(x.loopOwner), loopDue: str(x.loopDue), drive: drv(x.drive), created: num(x.created, Date.now()), updated: num(x.updated, Date.now()) })),
    decisions: arr(p.decisions).map(x => ({ id: str(x.id || uid()), title: str(x.title || "Untitled decision"), decision: str(x.decision), reason: str(x.reason), date: str(x.date), links: links(x.links), created: num(x.created, Date.now()), updated: num(x.updated, Date.now()) })),
    /* client reviews: curated documents the client corrects through a link; feedback and published revisions are kept as they were */
    reviews: arr(p.reviews).map(normalizeReview),
    /* customer problems: evidence-backed, framed in seven steps; neither a request nor a product decision */
    problems: arr(p.problems).map(x => {
      const frame = {}, prov = {}; FRAME_KEYS.forEach(k => { frame[k] = str(x.frame && x.frame[k]); prov[k] = oneOf(PROV, x.provenance && x.provenance[k], ""); });
      const ro = x.routing && typeof x.routing === "object" ? x.routing : {};
      const oper = {}; OPER_KEYS.forEach(k => { oper[k] = str(ro.operating && ro.operating[k]); });
      return { id: str(x.id || uid()), title: str(x.title || "Untitled problem"), status: oneOf(PROBLEM_STATUS, x.status, "Draft"), confidence: oneOf(["", "Low", "Medium", "High"], x.confidence, ""), owner: str(x.owner),
        frame, provenance: prov, statement: str(x.statement), statementDraft: x.statementDraft === undefined ? true : !!x.statementDraft, statementAt: num(x.statementAt, 0),
        evidence: strIds(x.evidence), steps: strIds(x.steps), requests: strIds(x.requests), artifacts: strIds(x.artifacts), session: str(x.session), feature: str(x.feature), decision: str(x.decision),
        routing: { workflow: str(ro.workflow), output: str(ro.output), surface: oneOf(SURFACES, ro.surface, ""), capabilities: strIds(ro.capabilities).filter(c => CAPS.indexOf(c) !== -1), ownership: str(ro.ownership), operating: oper,
          validation: { stage: oneOf(VSTAGES, ro.validation && ro.validation.stage, ""), next: str(ro.validation && ro.validation.next), evidence: str(ro.validation && ro.validation.evidence) } },
        drive: drv(x.drive), created: num(x.created, Date.now()), updated: num(x.updated, Date.now()) };
    }),
    created: Number(p.created) || Date.now(), updated: Number(p.updated) || Date.now()
  }));
  s.pilots.forEach(p => {
    p.deliverables.forEach(d => { d.status = DELIV_STATUS.indexOf(d.status) !== -1 ? d.status : "Proposed"; d.validation = validation(d.validation); d.decisionRef = str(d.decisionRef); });
    p.requests.forEach(r => { r.evidence = strIds(r.evidence); r.validation = validation(r.validation); r.decisionRef = str(r.decisionRef); });
    p.artifacts.forEach(a => { if (a.session && !p.sessions.some(s2 => s2.id === a.session)) a.session = ""; a.evidence = a.evidence.filter(id => p.evidence.some(e => e.id === id)); if (a.problem && !p.problems.some(x => x.id === a.problem)) a.problem = ""; });
    const evSet = new Set(p.evidence.map(e => e.id)), stepSet = new Set(p.steps.map(x => x.id)), reqSet = new Set(p.requests.map(x => x.id)), artSet = new Set(p.artifacts.map(x => x.id)), sesSet = new Set(p.sessions.map(x => x.id)), probSet = new Set(p.problems.map(x => x.id));
    p.problems.forEach(pr => { pr.evidence = pr.evidence.filter(id => evSet.has(id)); pr.steps = pr.steps.filter(id => stepSet.has(id)); pr.requests = pr.requests.filter(id => reqSet.has(id)); pr.artifacts = pr.artifacts.filter(id => artSet.has(id)); if (pr.session && !sesSet.has(pr.session)) pr.session = ""; });
    p.questions.forEach(q => { if (q.problem && !probSet.has(q.problem)) { q.problem = ""; q.frameField = ""; } });
    const evIds = new Set(p.evidence.map(e => e.id)), sIds = new Set(p.sessions.map(x => x.id)), stIds = new Set(p.steps.map(x => x.id));
    p.steps.forEach(st => { st.evidence = st.evidence.filter(id => evIds.has(id)); });
    p.requests.forEach(r => { r.evidence = r.evidence.filter(id => evIds.has(id)); });
    Object.values(p.fit).forEach(v => { v.evidence = v.evidence.filter(id => evIds.has(id)); });
    p.evidence.forEach(e => { if (e.session && !sIds.has(e.session)) e.session = ""; if (e.links.step && !stIds.has(e.links.step)) delete e.links.step; });
    p.questions.forEach(q => { if (q.session && !sIds.has(q.session)) q.session = ""; if (q.step && !stIds.has(q.step)) q.step = ""; if (q.candidate && q.candidate.evidence && !evIds.has(q.candidate.evidence)) q.candidate.evidence = ""; });
  });
  /* product decisions: the gate through which anything moves toward Building or client testing */
  const DEC_STATE = ["Proposed", "Decided", "Deferred", "Rejected", "Revisit"];
  const ALIGN = ["Needs discussion", "Discussed", "Agreed", "Disagreed", "Not required"];
  const pilotIds = new Set(s.pilots.map(p => p.id));
  s.decisions = arr(s.decisions).map(d => ({
    id: str(d.id || uid()), title: str(d.title || "Untitled decision"), state: oneOf(DEC_STATE, d.state, "Proposed"), owner: str(d.owner || "Uzziel"), date: str(d.date),
    rationale: str(d.rationale), alignment: oneOf(ALIGN, d.alignment, "Needs discussion"), pilot: pilotIds.has(d.pilot) ? d.pilot : "",
    links: links(d.links), evidence: strIds(d.evidence),
    pending: d.pending && typeof d.pending === "object" && d.pending.kind ? { kind: str(d.pending.kind), id: str(d.pending.id), to: str(d.pending.to), pilot: str(d.pending.pilot) } : null,
    applied: !!d.applied, drive: drv(d.drive), created: num(d.created, Date.now()), updated: num(d.updated, Date.now())
  }));
  s.decisions.forEach(d => { if (d.links.problem) { const pp = s.pilots.find(p => p.id === d.pilot); if (!pp || !pp.problems.some(x => x.id === d.links.problem)) delete d.links.problem; } });
  if (!Array.isArray(s.log)) s.log = [];
  s.log = s.log.filter(e => e && typeof e === "object" && e.id).map(e => ({
    id: String(e.id), t: Number(e.t) || 0, who: String(e.who || ""), fid: String(e.fid || ""), fname: String(e.fname || ""),
    field: String(e.field || ""), from: e.from === null || e.from === undefined ? "" : String(e.from), to: e.to === null || e.to === undefined ? "" : String(e.to),
    why: String(e.why || "")
  }));
  s.log.sort((a, b) => a.t - b.t);
  if (s.log.length > LOG_CAP) s.log = s.log.slice(s.log.length - LOG_CAP);
  if (!Array.isArray(s.features)) s.features = [];
  const ids = new Set(s.projects.map(p => p.id));
  if (!ids.has(s.current)) s.current = s.projects[0].id;
  s.features = s.features.filter(f => f && typeof f === "object" && ids.has(f.project));
  s.features.forEach(f => {
    if (!f.id) f.id = uid();
    f.id = String(f.id);
    if (typeof f.name !== "string") f.name = "Untitled";
    if (STATES.indexOf(f.state) === -1) f.state = "Planned";
    if (!f.owner || typeof f.owner !== "string") f.owner = "Unassigned";
    if (!Array.isArray(f.spaces)) f.spaces = [];
    f.spaces = f.spaces.filter(x => typeof x === "string");
    if (f.period === undefined || f.period === "" || (f.period !== null && typeof f.period !== "string")) f.period = null;
    f.agreed = !!f.agreed;
    f.effort = Math.max(0, Math.round(Number(f.effort) || 0));
    if (EFFORT_UNITS.indexOf(f.effortUnit) === -1) f.effortUnit = "weeks";
    if (typeof f.note !== "string") f.note = "";
    if (typeof f.link !== "string") f.link = "";
    f.rnd = !!f.rnd;
    if (RND_STAGES.indexOf(f.rndStage) === -1) f.rndStage = "Backlog";
    if (typeof f.student !== "string") f.student = "";
    if (typeof f.rndQuestion !== "string") f.rndQuestion = "";
    if (typeof f.rndPlan !== "string") f.rndPlan = "";
    if (typeof f.rndFindings !== "string") f.rndFindings = "";
    if (typeof f.driveDoc !== "string") f.driveDoc = "";
    if (typeof f.decisionRef !== "string") f.decisionRef = "";
    if (!Array.isArray(f.icps)) f.icps = [];
    f.icps = f.icps.filter(x => typeof x === "string" && icpIds.has(x));
    if (typeof f.parent !== "string" || !f.parent) f.parent = null;
    if (typeof f.thumb !== "string") f.thumb = "";
    if (typeof f.image !== "string") f.image = "";
    if (!f.sections || typeof f.sections !== "object" || Array.isArray(f.sections)) f.sections = {};
    Object.keys(f.sections).forEach(k => { if (typeof f.sections[k] !== "string" || !f.sections[k]) delete f.sections[k]; });
    // a division only means something in a space the feature is in; leftovers from a move would resurface if the space came back
    Object.keys(f.sections).forEach(k => { if (f.spaces.indexOf(k) === -1) delete f.sections[k]; });
    if (!f.created) f.created = f.updated || Date.now();
    if (!f.updated) f.updated = Date.now();
  });
  const byId = new Map(s.features.map(f => [f.id, f]));
  s.features.forEach(f => {
    const p = f.parent ? byId.get(f.parent) : null;
    if (!p || p.id === f.id || p.project !== f.project) f.parent = null;
  });
  // one level only: you cannot nest under something that is itself nested
  const parentOf = new Map(s.features.map(f => [f.id, f.parent]));
  s.features.forEach(f => { if (f.parent && parentOf.get(f.parent)) f.parent = null; });
  const featIds = new Set(s.features.map(f => f.id));
  s.pilots.forEach(p => {
    p.wants = p.wants.filter(id => featIds.has(id)); p.needs = p.needs.filter(id => featIds.has(id));
    p.deliverables.forEach(d => { d.features = d.features.filter(id => featIds.has(id)); });
    p.requests.forEach(r => { if (r.feature && !featIds.has(r.feature)) r.feature = ""; });
  });
  return s;
}

export function isStateShaped(x) {
  return !!x && typeof x === "object" && Array.isArray(x.features) && Array.isArray(x.projects);
}

export class ConflictError extends Error {
  constructor(snapshot) { super("Version conflict"); this.status = 409; this.snapshot = snapshot; }
}

/* Store contract (all async):
     load()                      -> { version, state }
     save(state, expectedVersion) -> { version, state }; throws ConflictError when expectedVersion is stale
     reset()                     -> { version, state } with fresh seed data
   `expectedVersion` may be null/undefined to force the write. */

/* ---- change log: compare the document before and after a save and record what moved ---- */
const LOG_CAP = 4000;
const LOG_COLLAPSE_MS = 2 * 60 * 1000;
function effortText(f) { return f && f.effort ? f.effort + " " + (f.effort === 1 ? String(f.effortUnit || "weeks").slice(0, -1) : (f.effortUnit || "weeks")) : ""; }
function trackedValues(f, byId) {
  const parent = f.parent && byId[f.parent] ? byId[f.parent].name : "";
  return {
    name: f.name, state: f.state, owner: f.owner, period: f.period || "", effort: effortText(f), agreed: f.agreed ? "yes" : "no",
    spaces: (f.spaces || []).slice().sort().join(", "), parent, rnd: f.rnd ? "yes" : "no",
    rndStage: f.rnd ? f.rndStage : "", student: f.student || "", link: f.link || "",
    note: f.note || "", rndPlan: f.rndPlan || "", rndFindings: f.rndFindings || "", image: f.image ? "set" : ""
  };
}
/* Keep every entry ever written (a client can never drop them), let a client fill in a reason, then add what changed now. */
export function applyLog(prevState, nextState, who) {
  const prevLog = Array.isArray(prevState && prevState.log) ? prevState.log : [];
  const byIdLog = new Map();
  prevLog.forEach(e => byIdLog.set(e.id, Object.assign({}, e)));
  (Array.isArray(nextState.log) ? nextState.log : []).forEach(e => {
    const have = byIdLog.get(e.id);
    if (have) { if (e.why && e.why !== have.why) have.why = String(e.why); }
    else byIdLog.set(e.id, Object.assign({}, e));
  });
  const log = Array.from(byIdLog.values()).sort((a, b) => a.t - b.t);
  const now = Date.now();
  const w = String(who || "").trim() || "script";
  const prevBy = {}; (prevState && prevState.features || []).forEach(f => { prevBy[f.id] = f; });
  const nextBy = {}; (nextState.features || []).forEach(f => { nextBy[f.id] = f; });
  function add(f, field, from, to) {
    const last = log.length ? log[log.length - 1] : null;
    if (last && last.fid === f.id && last.field === field && last.who === w && now - last.t < LOG_COLLAPSE_MS && field !== "created" && field !== "deleted") {
      if (String(last.from) === String(to)) { log.pop(); return; }
      last.to = String(to); last.t = now; return;
    }
    log.push({ id: uid(), t: now, who: w, fid: f.id, fname: f.name, field, from: String(from), to: String(to), why: "" });
  }
  (nextState.features || []).forEach(f => {
    const p = prevBy[f.id];
    if (!p) { add(f, "created", f.state, f.name); return; } // "from" keeps the state it was born in
    const a = trackedValues(p, prevBy), b = trackedValues(f, nextBy);
    Object.keys(b).forEach(k => {
      if (a[k] === b[k]) return;
      if (k === "note") add(f, k, "", "edited");
      else if (k === "image") add(f, k, "", b[k] ? "updated" : "removed");
      else add(f, k, a[k], b[k]);
    });
  });
  Object.keys(prevBy).forEach(id => { if (!nextBy[id]) add(prevBy[id], "deleted", prevBy[id].name, ""); });
  return log.length > LOG_CAP ? log.slice(log.length - LOG_CAP) : log;
}

let currentWho = ""; // set per request by handleApi so granular edits are attributed to their caller
async function mutate(store, fn, who) {
  who = who || currentWho;
  for (let attempt = 0; attempt < 4; attempt++) {
    const doc = await store.load();
    const state = normalize(JSON.parse(JSON.stringify(doc.state)));
    const out = fn(state);
    if (out && out.error) return out;
    state.log = applyLog(doc.state, state, who);
    try {
      const saved = await store.save(state, doc.version);
      return { result: out ? out.result : null, snapshot: saved };
    } catch (e) {
      if (!(e instanceof ConflictError) || attempt === 3) throw e;
    }
  }
  throw new Error("unreachable");
}

const json = (status, body, headers) => ({ status, body, headers: headers || {} });
const EFFORT_UNITS = ["days", "weeks", "months"];

/* ---- client reviews: the anonymous side ----
   A whole-document save from the app carries a copy of each pilot; feedback and revisions written on the server
   between two saves must survive that copy, so they are unioned back in by id. */
const DRAFT_FIELDS = ["title", "subtitle", "author", "lang", "intro", "closing", "titleFr", "subtitleFr", "introFr", "closingFr"];
function draftOf(r) { const d = { id: r.id, date: r.date, cards: r.cards }; DRAFT_FIELDS.forEach(k => { d[k] = r[k]; }); return d; }
function keepServerSideReviewData(currentState, next) {
  (currentState.pilots || []).forEach(cp => {
    const np = (next.pilots || []).find(x => x.id === cp.id);
    if (!np) return;
    (cp.reviews || []).forEach(cr => {
      const nr = np.reviews.find(x => x.id === cr.id);
      if (!nr) return;
      /* a draft edited on the page after this copy of the app was loaded wins over the app's older copy */
      if ((cr.draftAt || 0) > (nr.draftAt || 0)) { DRAFT_FIELDS.forEach(k => { nr[k] = cr[k]; }); nr.cards = cr.cards; nr.draftAt = cr.draftAt; }
      cr.feedback.forEach(f => { if (!nr.feedback.some(x => x.id === f.id)) nr.feedback.push(f); });
      cr.revisions.forEach(rv => { if (!nr.revisions.some(x => x.id === rv.id)) nr.revisions.push(rv); });
      nr.revisions.sort((a, b) => a.n - b.n);
    });
  });
}
function randomToken() {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  let s = ""; bytes.forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function findRevisionByToken(state, token) {
  if (!token || token.length < 20) return null;
  for (const p of state.pilots || []) for (const r of p.reviews || []) for (const rev of r.revisions) if (rev.token && rev.token.length === token.length && timingEqual(rev.token, token)) return { p, r, rev };
  return null;
}
function timingEqual(a, b) { let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
const publicRate = new Map();
function rateLimited(key) {
  const now = Date.now();
  const list = (publicRate.get(key) || []).filter(t => now - t < REVIEW_LIMITS.windowMs);
  if (list.length >= REVIEW_LIMITS.perWindow) { publicRate.set(key, list); return true; }
  list.push(now); publicRate.set(key, list);
  if (publicRate.size > 5000) publicRate.clear();
  return false;
}
/* Requests under /api/public/review/<token>: read one frozen revision, or leave feedback inside its scope. Nothing else. */
export async function handlePublic(req, store) {
  const method = String(req.method || "GET").toUpperCase();
  const seg = String(req.path || "").split("/").filter(Boolean).map(decodeURIComponent);
  const noStore = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
  if (seg[0] !== "public" || seg[1] !== "review" || !seg[2]) return json(404, { error: "unknown endpoint" }, noStore);
  const token = seg[2];
  const ip = String(req.ip || "");
  if (rateLimited("r:" + ip)) return json(429, { error: "Too many requests. Try again in a few minutes." }, noStore);
  const doc = await store.load();
  const hit = findRevisionByToken(doc.state, token);
  if (!hit || !revisionOpen(hit.rev)) return json(404, { error: "This link is not active." }, noStore);
  if (seg.length === 3 && method === "GET") {
    return json(200, { ok: true, revisionId: hit.rev.id, snapshot: hit.rev.snapshot, expires: hit.rev.expires || "" }, noStore);
  }
  if (seg.length === 4 && (seg[3] === "feedback" || seg[3] === "finish") && method === "POST") {
    if (rateLimited("w:" + ip)) return json(429, { error: "Too many submissions. Try again in a few minutes." }, noStore);
    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (seg[3] === "finish") body.kind = "finish";
    const v = validateSubmission(body, hit.rev, Date.now());
    if (!v.ok) return json(400, { error: v.error }, noStore);
    const out = await mutate(store, state => {
      const again = findRevisionByToken(state, token);
      if (!again || !revisionOpen(again.rev)) return { error: "This link is not active." };
      const existing = again.r.feedback.find(f => f.revision === again.rev.id && f.submission === v.feedback.submission);
      if (existing) return { result: { id: existing.id, duplicate: true } };
      again.r.feedback.push(v.feedback);
      again.r.updated = Date.now(); again.p.updated = Date.now();
      return { result: { id: v.feedback.id } };
    }, "client review link");
    if (out.error) return json(404, { error: out.error }, noStore);
    return json(200, Object.assign({ ok: true }, out.result), noStore);
  }
  return json(404, { error: "unknown endpoint" }, noStore);
}
const EDITABLE = ["name", "state", "owner", "spaces", "period", "effort", "effortUnit", "agreed", "note", "link", "rnd", "rndStage", "student", "rndQuestion", "rndPlan", "rndFindings", "project", "icps", "parent", "thumb", "image", "sections", "decisionRef"];

/* Handle one API request. `req` = { method, path, query, body } where `path` is relative to /api
   (for example "/features/abc") and `query` is a plain object. Returns { status, body, headers }. */
export async function handleApi(req, store) {
  const method = req.method.toUpperCase();
  const path = (req.path || "/").replace(/\/+$/, "") || "/";
  const query = req.query || {};
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const seg = path.split("/").filter(Boolean).map(decodeURIComponent);
  currentWho = String(body.who || (req.query && req.query.who) || "").trim() || "script";

  if (path === "/health" && method === "GET") {
    const doc = await store.load();
    return json(200, { ok: true, version: doc.version, features: doc.state.features.length });
  }
  if (path === "/meta" && method === "GET") return json(200, { states: STATES, rndStages: RND_STAGES });

  if (path === "/state") {
    if (method === "GET") return json(200, await store.load());
    if (method === "PUT") {
      const incoming = isStateShaped(body.state) ? body.state : body;
      if (!isStateShaped(incoming)) return json(400, { error: "state must include projects and features arrays" });
      const expected = body.version === undefined || body.version === null ? null : Number(body.version);
      try {
        const current = await store.load();
        const next = normalize(JSON.parse(JSON.stringify(incoming)));
        keepServerSideReviewData(current.state, next);
        next.log = applyLog(current.state, next, body.who);
        return json(200, await store.save(next, expected));
      } catch (e) {
        if (e instanceof ConflictError) return json(409, Object.assign({ error: e.message }, e.snapshot));
        throw e;
      }
    }
  }

  if (path === "/export" && method === "GET") {
    const doc = await store.load();
    return json(200, { exportedAt: new Date().toISOString(), version: doc.version, state: doc.state },
      { "Content-Disposition": "attachment; filename=\"alie-product-" + new Date().toISOString().slice(0, 10) + ".json\"" });
  }
  if (path === "/import" && method === "POST") {
    const st = isStateShaped(body.state) ? body.state : body;
    if (!isStateShaped(st)) return json(400, { error: "file does not look like an export" });
    const current = await store.load();
    const next = normalize(JSON.parse(JSON.stringify(st)));
    next.log = applyLog(current.state, next, body.who || "import");
    return json(200, await store.save(next, null));
  }
  if (path === "/reset" && method === "POST") return json(200, await store.reset());

  /* Projects */
  if (seg[0] === "projects") {
    if (seg.length === 1 && method === "GET") return json(200, (await store.load()).state.projects);
    if (seg.length === 1 && method === "POST") {
      const name = String(body.name || "").trim();
      if (!name) return json(400, { error: "name is required" });
      const p = { id: uid(), name, kind: String(body.kind || "").trim() };
      await mutate(store, s => { s.projects.push(p); });
      return json(201, p);
    }
    if (seg.length === 2 && method === "PATCH") {
      const r = await mutate(store, s => {
        const p = s.projects.find(x => x.id === seg[1]);
        if (!p) return { error: json(404, { error: "not found" }) };
        if (typeof body.name === "string" && body.name.trim()) p.name = body.name.trim();
        if (typeof body.kind === "string") p.kind = body.kind.trim();
        return { result: p };
      });
      return r.error || json(200, r.result);
    }
    if (seg.length === 2 && method === "DELETE") {
      const r = await mutate(store, s => {
        const p = s.projects.find(x => x.id === seg[1]);
        if (!p) return { error: json(404, { error: "not found" }) };
        if (s.projects.length === 1) return { error: json(400, { error: "cannot delete the last project" }) };
        s.projects = s.projects.filter(x => x.id !== p.id);
        s.features = s.features.filter(f => f.project !== p.id);
        if (s.current === p.id) s.current = s.projects[0].id;
        return { result: null };
      });
      return r.error || json(204, null);
    }
  }

  /* Features */
  if (seg[0] === "features") {
    if (seg.length === 1 && method === "GET") {
      let list = (await store.load()).state.features;
      if (query.project) list = list.filter(f => f.project === query.project);
      if (query.rnd === "true") list = list.filter(f => f.rnd);
      if (query.space) list = list.filter(f => f.spaces.indexOf(query.space) !== -1);
      return json(200, list);
    }
    if (seg.length === 1 && method === "POST") {
      const now = Date.now();
      const f = {
        id: uid(), project: body.project || null, name: String(body.name || "New feature"),
        state: STATES.indexOf(body.state) !== -1 ? body.state : "Proposed",
        agreed: !!body.agreed,
        owner: typeof body.owner === "string" && body.owner ? body.owner : "Unassigned",
        spaces: Array.isArray(body.spaces) ? body.spaces.filter(x => typeof x === "string") : [],
        period: typeof body.period === "string" && body.period ? body.period : null,
        effort: Math.max(0, Math.round(Number(body.effort) || 0)),
        effortUnit: EFFORT_UNITS.indexOf(body.effortUnit) !== -1 ? body.effortUnit : "weeks",
        note: String(body.note || ""), link: String(body.link || ""), rnd: !!body.rnd,
        rndStage: RND_STAGES.indexOf(body.rndStage) !== -1 ? body.rndStage : "Backlog",
        student: String(body.student || ""), rndQuestion: String(body.rndQuestion || ""), rndPlan: String(body.rndPlan || ""), rndFindings: String(body.rndFindings || ""), driveDoc: "",
        icps: Array.isArray(body.icps) ? body.icps.filter(x => typeof x === "string") : [],
        parent: typeof body.parent === "string" && body.parent ? body.parent : null,
        thumb: typeof body.thumb === "string" ? body.thumb : "",
        image: typeof body.image === "string" ? body.image : "",
        sections: body.sections && typeof body.sections === "object" ? body.sections : {},
        created: now, updated: now
      };
      const r = await mutate(store, s => {
        if (!f.project) f.project = s.current;
        if (!s.projects.some(p => p.id === f.project)) return { error: json(400, { error: "unknown project" }) };
        f.icps = f.icps.filter(x => s.icps.some(i => i.id === x));
        s.features.push(f);
        return { result: f.id };
      });
      return r.error || json(201, r.snapshot.state.features.find(x => x.id === r.result));
    }
    if (seg.length === 2 && method === "GET") {
      const f = (await store.load()).state.features.find(x => x.id === seg[1]);
      return f ? json(200, f) : json(404, { error: "not found" });
    }
    if (seg.length === 2 && method === "PATCH") {
      if (body.state !== undefined && STATES.indexOf(body.state) === -1) return json(400, { error: "invalid state" });
      if (body.rndStage !== undefined && RND_STAGES.indexOf(body.rndStage) === -1) return json(400, { error: "invalid rndStage" });
      const r = await mutate(store, s => {
        const f = s.features.find(x => x.id === seg[1]);
        if (!f) return { error: json(404, { error: "not found" }) };
        if (body.project !== undefined && !s.projects.some(p => p.id === body.project)) return { error: json(400, { error: "unknown project" }) };
        EDITABLE.forEach(k => { if (body[k] !== undefined) f[k] = body[k]; });
        f.updated = Date.now();
        return { result: f.id };
      });
      return r.error || json(200, r.snapshot.state.features.find(x => x.id === r.result));
    }
    if (seg.length === 2 && method === "DELETE") {
      const r = await mutate(store, s => {
        if (!s.features.some(x => x.id === seg[1])) return { error: json(404, { error: "not found" }) };
        s.features = s.features.filter(x => x.id !== seg[1]);
        s.features.forEach(x => { if (x.parent === seg[1]) x.parent = null; });
        return { result: null };
      });
      return r.error || json(204, null);
    }
  }

  /* Ideal client profiles (market segments) */
  /* client reviews: publishing freezes a snapshot behind a fresh link; preview shows the draft to a signed-in user */
  if (seg[0] === "reviews" && seg[1] === "publish" && method === "POST") {
    const out = await mutate(store, state => {
      const p = (state.pilots || []).find(x => x.id === body.pilot);
      const r = p && p.reviews.find(x => x.id === body.review);
      if (!r) return { error: "Review not found." };
      if (!r.cards.length) return { error: "Add at least one page before publishing." };
      const now = new Date();
      r.date = now.toISOString().slice(0, 10); /* the cover says when this understanding was last updated: the day it was published */
      const rev = { id: uid(), n: r.revisions.length + 1, publishedAt: now.toISOString(), expires: /^\d{4}-\d{2}-\d{2}$/.test(String(body.expires || "")) ? body.expires : "", disabled: false, token: randomToken(), by: String(body.who || currentWho || ""), snapshot: snapshotOf(r, p, r.revisions.length + 1) };
      r.revisions.forEach(x => { x.disabled = true; });
      r.revisions.push(rev);
      r.status = "Published"; r.updated = now.getTime(); p.updated = now.getTime();
      return { result: { revision: { id: rev.id, n: rev.n, publishedAt: rev.publishedAt, token: rev.token } } };
    }, body.who);
    if (out.error) return json(400, { error: out.error });
    return json(200, Object.assign({ ok: true }, out.result, { version: out.snapshot.version, state: out.snapshot.state }));
  }
  if (seg[0] === "reviews" && seg[1] === "preview" && method === "GET") {
    const doc = await store.load();
    const p = (doc.state.pilots || []).find(x => x.id === query.pilot);
    const r = p && p.reviews.find(x => x.id === query.review);
    if (!r) return json(404, { error: "Review not found." });
    return json(200, { ok: true, preview: true, snapshot: snapshotOf(Object.assign({}, r, { date: new Date().toISOString().slice(0, 10) }), p, r.revisions.length + 1) });
  }
  /* editing on the page: a signed-in author reads the raw draft and writes it back; revisions and feedback are never touched here */
  if (seg[0] === "reviews" && seg[1] === "draft" && method === "GET") {
    const doc = await store.load();
    const p = (doc.state.pilots || []).find(x => x.id === query.pilot);
    const r = p && p.reviews.find(x => x.id === query.review);
    if (!r) return json(404, { error: "Review not found." });
    return json(200, { ok: true, pilot: { id: p.id, name: p.name }, review: draftOf(r), revisionCount: r.revisions.length, status: r.status });
  }
  if (seg[0] === "reviews" && seg[1] === "draft" && method === "POST") {
    const incoming = body.draft && typeof body.draft === "object" ? body.draft : null;
    if (!incoming || !Array.isArray(incoming.cards)) return json(400, { error: "draft with cards is required" });
    const out = await mutate(store, state => {
      const p = (state.pilots || []).find(x => x.id === body.pilot);
      const r = p && p.reviews.find(x => x.id === body.review);
      if (!r) return { error: "Review not found." };
      const notesById = {}; r.cards.forEach(c => { notesById[c.id] = c.notes; });
      DRAFT_FIELDS.forEach(k => { if (typeof incoming[k] === "string") r[k] = incoming[k]; });
      r.cards = incoming.cards.filter(c => c && typeof c === "object").map(c => Object.assign({}, c, { notes: typeof c.notes === "string" ? c.notes : (notesById[c.id] || "") }));
      const now = Date.now(); r.updated = now; r.draftAt = now; p.updated = now;
      return { result: { updated: now } };
    }, body.who);
    if (out.error) return json(404, { error: out.error });
    return json(200, Object.assign({ ok: true, version: out.snapshot.version }, out.result));
  }
  if (seg[0] === "public") return handlePublic(req, store);

  if (seg[0] === "icps") {
    const ICP_FIELDS = ["name", "kind", "avatar", "description", "tam", "sam", "som", "notes", "image"];
    const ICP_LISTS = ["regimes", "facts"];
    if (seg.length === 1 && method === "GET") return json(200, (await store.load()).state.icps);
    if (seg.length === 1 && method === "POST") {
      const name = String(body.name || "").trim();
      if (!name) return json(400, { error: "name is required" });
      const icp = { id: uid(), name, kind: "Buyer", avatar: "", description: "", tam: "", sam: "", som: "", notes: "", regimes: [], facts: [] };
      ICP_FIELDS.slice(1).forEach(k => { if (typeof body[k] === "string") icp[k] = body[k].trim(); });
      ICP_LISTS.forEach(k => { if (Array.isArray(body[k])) icp[k] = body[k]; });
      const made = await mutate(store, s => { s.icps.push(icp); return { result: icp.id }; });
      return json(201, made.snapshot.state.icps.find(x => x.id === icp.id));
    }
    if (seg.length === 2 && method === "PATCH") {
      const r = await mutate(store, s => {
        const icp = s.icps.find(x => x.id === seg[1]);
        if (!icp) return { error: json(404, { error: "not found" }) };
        ICP_FIELDS.forEach(k => { if (typeof body[k] === "string" && (k !== "name" || body[k].trim())) icp[k] = body[k].trim(); });
        ICP_LISTS.forEach(k => { if (Array.isArray(body[k])) icp[k] = body[k]; });
        return { result: icp.id };
      });
      return r.error || json(200, r.snapshot.state.icps.find(x => x.id === r.result));
    }
    if (seg.length === 2 && method === "DELETE") {
      const r = await mutate(store, s => {
        if (!s.icps.some(x => x.id === seg[1])) return { error: json(404, { error: "not found" }) };
        s.icps = s.icps.filter(x => x.id !== seg[1]);
        s.features.forEach(f => { f.icps = (f.icps || []).filter(x => x !== seg[1]); });
        return { result: null };
      });
      return r.error || json(204, null);
    }
  }

  /* Simple string lists */
  if (["spaces", "people", "students"].indexOf(seg[0]) !== -1) {
    const list = seg[0];
    if (seg.length === 1 && method === "GET") return json(200, (await store.load()).state[list]);
    if (seg.length === 1 && method === "POST") {
      const name = String(body.name || "").trim();
      if (!name) return json(400, { error: "name is required" });
      const r = await mutate(store, s => {
        if (s[list].indexOf(name) === -1) {
          if (list === "people") s.people.splice(Math.max(0, s.people.indexOf("Unassigned")), 0, name);
          else s[list].push(name);
        }
        return { result: s[list] };
      });
      return json(201, r.result);
    }
    if (seg.length === 2 && method === "DELETE") {
      const name = seg[1];
      if (list === "people" && name === "Unassigned") return json(400, { error: "Unassigned cannot be removed" });
      const r = await mutate(store, s => {
        if (s[list].indexOf(name) === -1) return { error: json(404, { error: "not found" }) };
        s[list] = s[list].filter(x => x !== name);
        s.features.forEach(f => {
          if (list === "spaces") f.spaces = f.spaces.filter(x => x !== name);
          if (list === "people" && f.owner === name) f.owner = "Unassigned";
          if (list === "students" && f.student === name) f.student = "";
        });
        return { result: null };
      });
      return r.error || json(204, null);
    }
  }

  return json(404, { error: "unknown endpoint" });
}

/* In-memory store, used by tests and as a reference implementation of the contract. */
export class MemoryStore {
  constructor(initial) { this.version = 1; this.state = normalize(initial || seed()); }
  async load() { return { version: this.version, state: JSON.parse(JSON.stringify(this.state)) }; }
  async save(state, expected) {
    if (expected !== null && expected !== undefined && Number(expected) !== this.version) throw new ConflictError(await this.load());
    this.state = normalize(JSON.parse(JSON.stringify(state)));
    this.version += 1;
    return this.load();
  }
  async reset() { this.state = normalize(seed()); this.version += 1; return this.load(); }
}
