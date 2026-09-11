/* Runtime-neutral core: data model, seed, normalisation, and the HTTP API handler.
   Used by the local Express server and by the Cloudflare Worker. No Node or Workers APIs here. */

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
      note: note || "", link: "", rnd: false, rndStage: "Backlog", student: "", rndQuestion: "", rndFindings: "", parent: null,
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
  if (!Array.isArray(s.pilots)) s.pilots = [];
  const PILOT_STATUS = ["Prospect", "Piloting", "Live client", "Paused"];
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
      features: Array.isArray(d.features) ? d.features.filter(x => typeof x === "string") : []
    })),
    requests: (Array.isArray(p.requests) ? p.requests : []).filter(r => r && typeof r === "object").map(r => ({
      id: String(r.id || uid()), title: String(r.title || "Untitled request"),
      bottleneck: String(r.bottleneck || ""), need: String(r.need || ""), solution: String(r.solution || ""),
      fit: ["Core to ALIE", "Adjacent", "Out of scope"].indexOf(r.fit) !== -1 ? r.fit : "",
      decision: ["Undecided", "Build", "Integrate or partner", "Later", "Declined"].indexOf(r.decision) !== -1 ? r.decision : "Undecided",
      reason: String(r.reason || ""), source: String(r.source || ""), feature: String(r.feature || ""),
      created: Number(r.created) || Date.now(), updated: Number(r.updated) || Date.now()
    })),
    stack: (Array.isArray(p.stack) ? p.stack : []).filter(x => x && typeof x === "object").map(x => ({
      id: String(x.id || uid()), name: String(x.name || "Untitled"), kind: x.kind === "Partner" ? "Partner" : "Software",
      category: String(x.category || ""), usage: String(x.usage || ""), link: String(x.link || ""),
      created: Number(x.created) || Date.now(), updated: Number(x.updated) || Date.now()
    })),
    created: Number(p.created) || Date.now(), updated: Number(p.updated) || Date.now()
  }));
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
    if (typeof f.rndFindings !== "string") f.rndFindings = "";
    if (!Array.isArray(f.icps)) f.icps = [];
    f.icps = f.icps.filter(x => typeof x === "string" && icpIds.has(x));
    if (typeof f.parent !== "string" || !f.parent) f.parent = null;
    if (typeof f.thumb !== "string") f.thumb = "";
    if (typeof f.image !== "string") f.image = "";
    if (!f.sections || typeof f.sections !== "object" || Array.isArray(f.sections)) f.sections = {};
    Object.keys(f.sections).forEach(k => { if (typeof f.sections[k] !== "string" || !f.sections[k]) delete f.sections[k]; });
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
    note: f.note || "", image: f.image ? "set" : ""
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
const EDITABLE = ["name", "state", "owner", "spaces", "period", "effort", "effortUnit", "agreed", "note", "link", "rnd", "rndStage", "student", "rndQuestion", "rndFindings", "project", "icps", "parent", "thumb", "image", "sections"];

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
        student: String(body.student || ""), rndQuestion: String(body.rndQuestion || ""), rndFindings: String(body.rndFindings || ""),
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
