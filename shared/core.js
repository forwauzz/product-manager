/* Runtime-neutral core: data model, seed, normalisation, and the HTTP API handler.
   Used by the local Express server and by the Cloudflare Worker. No Node or Workers APIs here. */

export const STATES = ["Research", "Planned", "Building", "Live", "Needs work", "Feature flag"];
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
      note: note || "", link: "", rnd: false, rndStage: "Backlog", student: "", rndQuestion: "", rndFindings: "",
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
    people: ["Uzziel", "David", "Faical", "Unassigned"],
    students: ["Student A", "Student B"],
    features: F,
    current: A
  };
}

/* Make sure every record has every field the UI relies on. Mutates and returns the state. */
export function normalize(state) {
  const s = state && typeof state === "object" ? state : {};
  if (!Array.isArray(s.projects) || !s.projects.length) s.projects = [{ id: uid(), name: "New project", kind: "" }];
  s.projects = s.projects.filter(p => p && typeof p === "object").map(p => ({ id: String(p.id || uid()), name: String(p.name || "Untitled"), kind: String(p.kind || "") }));
  if (!Array.isArray(s.spaces)) s.spaces = [];
  s.spaces = s.spaces.filter(x => typeof x === "string" && x.trim()).map(x => x.trim());
  if (!Array.isArray(s.people)) s.people = ["Unassigned"];
  s.people = s.people.filter(x => typeof x === "string" && x.trim()).map(x => x.trim());
  if (s.people.indexOf("Unassigned") === -1) s.people.push("Unassigned");
  if (!Array.isArray(s.students)) s.students = [];
  s.students = s.students.filter(x => typeof x === "string" && x.trim()).map(x => x.trim());
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
    if (typeof f.note !== "string") f.note = "";
    if (typeof f.link !== "string") f.link = "";
    f.rnd = !!f.rnd;
    if (RND_STAGES.indexOf(f.rndStage) === -1) f.rndStage = "Backlog";
    if (typeof f.student !== "string") f.student = "";
    if (typeof f.rndQuestion !== "string") f.rndQuestion = "";
    if (typeof f.rndFindings !== "string") f.rndFindings = "";
    if (!f.created) f.created = f.updated || Date.now();
    if (!f.updated) f.updated = Date.now();
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

async function mutate(store, fn) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const doc = await store.load();
    const state = normalize(JSON.parse(JSON.stringify(doc.state)));
    const out = fn(state);
    if (out && out.error) return out;
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
const EDITABLE = ["name", "state", "owner", "spaces", "period", "note", "link", "rnd", "rndStage", "student", "rndQuestion", "rndFindings", "project"];

/* Handle one API request. `req` = { method, path, query, body } where `path` is relative to /api
   (for example "/features/abc") and `query` is a plain object. Returns { status, body, headers }. */
export async function handleApi(req, store) {
  const method = req.method.toUpperCase();
  const path = (req.path || "/").replace(/\/+$/, "") || "/";
  const query = req.query || {};
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const seg = path.split("/").filter(Boolean).map(decodeURIComponent);

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
        return json(200, await store.save(normalize(JSON.parse(JSON.stringify(incoming))), expected));
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
    return json(200, await store.save(normalize(JSON.parse(JSON.stringify(st))), null));
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
        state: STATES.indexOf(body.state) !== -1 ? body.state : "Planned",
        owner: typeof body.owner === "string" && body.owner ? body.owner : "Unassigned",
        spaces: Array.isArray(body.spaces) ? body.spaces.filter(x => typeof x === "string") : [],
        period: typeof body.period === "string" && body.period ? body.period : null,
        note: String(body.note || ""), link: String(body.link || ""), rnd: !!body.rnd,
        rndStage: RND_STAGES.indexOf(body.rndStage) !== -1 ? body.rndStage : "Backlog",
        student: String(body.student || ""), rndQuestion: String(body.rndQuestion || ""), rndFindings: String(body.rndFindings || ""),
        created: now, updated: now
      };
      const r = await mutate(store, s => {
        if (!f.project) f.project = s.current;
        if (!s.projects.some(p => p.id === f.project)) return { error: json(400, { error: "unknown project" }) };
        s.features.push(f);
        return { result: f };
      });
      return r.error || json(201, r.result);
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
        return { result: f };
      });
      return r.error || json(200, normalize({ projects: [{ id: r.result.project }], features: [r.result] }).features[0]);
    }
    if (seg.length === 2 && method === "DELETE") {
      const r = await mutate(store, s => {
        if (!s.features.some(x => x.id === seg[1])) return { error: json(404, { error: "not found" }) };
        s.features = s.features.filter(x => x.id !== seg[1]);
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
