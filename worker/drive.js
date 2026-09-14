/* Google Drive sync from the Worker. Needs a service-account JSON key in the GOOGLE_SA_KEY secret
   and the target folders shared with that account. Never logs the key. */
import { D1Store } from "./store-d1.js";
import { pilotMarkdown, rndMarkdown, recordMarkdown, featuresCsv, logCsv, driveFolderId } from "../shared/exports.js";

const SCOPE = "https://www.googleapis.com/auth/drive";
const MARK = "drive-sync";
const AUTH = "drive-auth";

function b64url(bytes) {
  const s = typeof bytes === "string" ? bytes : String.fromCharCode(...new Uint8Array(bytes));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function pemToDer(pem) {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
/* --- OAuth as the signed-in Google user (preferred): the refresh token lives in D1, never in the client --- */
export function oauthReady(env) { return !!(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.DB); }
async function readAuth(env) {
  const row = await env.DB.prepare("SELECT state FROM documents WHERE id = ?").bind(AUTH).first();
  try { return row ? JSON.parse(row.state) : null; } catch (_) { return null; }
}
async function writeAuth(env, auth) {
  if (!auth) { await env.DB.prepare("DELETE FROM documents WHERE id = ?").bind(AUTH).run(); return; }
  await env.DB.prepare("INSERT INTO documents (id, version, state, updated_at) VALUES (?, 1, ?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at")
    .bind(AUTH, JSON.stringify(auth), new Date().toISOString()).run();
}
export async function connectedAccount(env) {
  if (!oauthReady(env)) return null;
  const a = await readAuth(env);
  return a && a.refresh_token ? { email: a.email || "", since: a.at || null } : null;
}
export function authUrl(env, origin, state) {
  const q = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID, redirect_uri: origin + "/api/drive/callback", response_type: "code",
    scope: SCOPE + " https://www.googleapis.com/auth/userinfo.email", access_type: "offline", prompt: "consent", include_granted_scopes: "true", state
  });
  return "https://accounts.google.com/o/oauth2/v2/auth?" + q.toString();
}
export async function finishConnect(env, origin, code) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_OAUTH_CLIENT_ID, client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET, redirect_uri: origin + "/api/drive/callback", grant_type: "authorization_code" }).toString()
  });
  const j = await r.json();
  if (!r.ok || !j.refresh_token) throw new Error("Google did not return a refresh token: " + (j.error_description || j.error || r.status));
  let email = "";
  try { const u = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: "Bearer " + j.access_token } }); email = (await u.json()).email || ""; } catch (_) { /* optional */ }
  await writeAuth(env, { refresh_token: j.refresh_token, email, at: new Date().toISOString() });
  cachedToken = { value: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return { email };
}
export async function disconnect(env) {
  const a = await readAuth(env);
  if (a && a.refresh_token) { try { await fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(a.refresh_token), { method: "POST" }); } catch (_) { /* best effort */ } }
  await writeAuth(env, null);
  cachedToken = null;
}
async function oauthAccessToken(env) {
  const a = await readAuth(env);
  if (!a || !a.refresh_token) throw new Error("Google Drive is not connected yet.");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: a.refresh_token, client_id: env.GOOGLE_OAUTH_CLIENT_ID, client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET, grant_type: "refresh_token" }).toString()
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error("Google token refresh: " + (j.error_description || j.error || r.status));
  return { value: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
}

export function configured(env) { return !!(env.DB && (oauthReady(env) || env.GOOGLE_SA_KEY)); }

let cachedToken = null;
export async function accessToken(env) {
  if (cachedToken && cachedToken.exp > Date.now() + 60000) return cachedToken.value;
  if (oauthReady(env)) { cachedToken = await oauthAccessToken(env); return cachedToken.value; }
  if (!env.GOOGLE_SA_KEY) throw new Error("No Google credential configured.");
  const sa = JSON.parse(env.GOOGLE_SA_KEY);
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: sa.token_uri || "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(header + "." + claims));
  const jwt = header + "." + claims + "." + b64url(sig);
  const r = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" + encodeURIComponent(jwt)
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error("Google token: " + (j.error_description || j.error || r.status));
  cachedToken = { value: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return cachedToken.value;
}

async function updateMedia(token, fileId, mime, body) {
  const r = await fetch("https://www.googleapis.com/upload/drive/v3/files/" + encodeURIComponent(fileId) + "?uploadType=media&supportsAllDrives=true", {
    method: "PATCH", headers: { Authorization: "Bearer " + token, "Content-Type": mime }, body
  });
  if (!r.ok) throw new Error("Drive update " + fileId + ": " + r.status + " " + (await r.text()).slice(0, 200));
  return r.json();
}
async function createDoc(token, folderId, name, markdown) {
  const boundary = "alie" + Date.now().toString(36);
  const meta = JSON.stringify({ name, mimeType: "application/vnd.google-apps.document", parents: [folderId] });
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n${markdown}\r\n--${boundary}--`;
  const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true", {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "multipart/related; boundary=" + boundary }, body
  });
  if (!r.ok) throw new Error("Drive create in " + folderId + ": " + r.status + " " + (await r.text()).slice(0, 200));
  return r.json();
}

async function readMark(env) {
  const row = await env.DB.prepare("SELECT state FROM documents WHERE id = ?").bind(MARK).first();
  try { return row ? JSON.parse(row.state) : {}; } catch (_) { return {}; }
}
async function writeMark(env, mark) {
  await env.DB.prepare("INSERT INTO documents (id, version, state, updated_at) VALUES (?, 1, ?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at")
    .bind(MARK, JSON.stringify(mark), new Date().toISOString()).run();
}

export async function status(env) {
  const mark = await readMark(env);
  const store = new D1Store(env.DB);
  const doc = await store.load();
  const account = await connectedAccount(env);
  const ready = oauthReady(env) ? !!account : !!env.GOOGLE_SA_KEY;
  return { configured: ready, canConnect: oauthReady(env) && !account, mode: oauthReady(env) ? "user" : env.GOOGLE_SA_KEY ? "service" : "none", account: account ? account.email : "",
    version: doc.version, syncedVersion: mark.version || 0, at: mark.at || null, ok: mark.ok !== false, error: mark.error || "", files: mark.files || [], pending: (mark.version || 0) !== doc.version };
}

function pushedRecords(state) {
  const out = [];
  (state.pilots || []).forEach(p => {
    (p.sessions || []).forEach(s => { if (s.doc && s.doc.fileId) out.push({ kind: "session", rec: Object.assign(s, { drive: s.doc }), pilot: p, key: "doc" }); });
    (p.artifacts || []).forEach(a => { if (a.drive && a.drive.fileId) out.push({ kind: "artifact", rec: a, pilot: p }); });
    (p.problems || []).forEach(a => { if (a.drive && a.drive.fileId) out.push({ kind: "problem", rec: a, pilot: p }); });
  });
  (state.decisions || []).forEach(d => { if (d.drive && d.drive.fileId) out.push({ kind: "decision", rec: d, pilot: (state.pilots || []).find(p => p.id === d.pilot) || null }); });
  return out;
}
function findRecord(state, kind, id, pilotId) {
  const p = (state.pilots || []).find(x => x.id === pilotId) || null;
  if (kind === "session") { const s = p && (p.sessions || []).find(x => x.id === id); return s ? { rec: s, pilot: p, folder: driveFolderId(s.drive && s.drive.folder) || driveFolderId(p.link), slot: "doc" } : null; }
  if (kind === "artifact") { const a = p && (p.artifacts || []).find(x => x.id === id); return a ? { rec: a, pilot: p, folder: driveFolderId(p.link), slot: "drive" } : null; }
  if (kind === "problem") { const a = p && (p.problems || []).find(x => x.id === id); return a ? { rec: a, pilot: p, folder: driveFolderId(p.link), slot: "drive" } : null; }
  if (kind === "decision") { const d = (state.decisions || []).find(x => x.id === id); if (!d) return null; const pp = (state.pilots || []).find(x => x.id === d.pilot) || null; return { rec: d, pilot: pp, folder: (pp && driveFolderId(pp.link)) || driveFolderId(state.driveFolder), slot: "drive" }; }
  return null;
}
/* Push one record to Drive now: create its Google Doc the first time, update it afterwards; the outcome is written back on the record. */
export async function pushRecord(env, body) {
  if (!configured(env)) return { ok: false, error: "Drive sync is not set up yet." };
  if (oauthReady(env) && !(await connectedAccount(env))) return { ok: false, error: "Google Drive is not connected yet." };
  const store = new D1Store(env.DB);
  const doc = await store.load();
  const hit = findRecord(doc.state, body.kind, body.id, body.pilot);
  if (!hit) return { ok: false, error: "Record not found." };
  const now = new Date();
  const cur = hit.rec[hit.slot] || {};
  let result;
  try {
    const token = await accessToken(env);
    const md = recordMarkdown(doc.state, body.kind, hit.rec, hit.pilot, now);
    if (cur.fileId) { await updateMedia(token, cur.fileId, "text/markdown", md); result = { fileId: cur.fileId, action: "updated" }; }
    else {
      if (!hit.folder) throw new Error("No Drive folder: set the pilot's folder link first.");
      const name = (body.kind === "session" ? "Session — " : body.kind === "artifact" ? "Artifact — " : body.kind === "problem" ? "Customer problem — " : "Decision — ") + (hit.rec.title || hit.rec.purpose || "Untitled");
      const made = await createDoc(token, hit.folder, name, md);
      result = { fileId: made.id, action: "created" };
    }
    hit.rec[hit.slot] = { fileId: result.fileId, status: "Synced", syncedAt: now.toISOString(), error: "" };
  } catch (e) {
    hit.rec[hit.slot] = { fileId: cur.fileId || "", status: "Error", syncedAt: cur.syncedAt || "", error: String(e.message || e).slice(0, 200) };
    result = { error: hit.rec[hit.slot].error };
  }
  hit.rec.updated = now.getTime();
  const saved = await store.save(doc.state, doc.version);
  return { ok: !result.error, error: result.error || "", drive: hit.rec[hit.slot], version: saved.version, fileId: hit.rec[hit.slot].fileId };
}
/* Sync everything that has a Drive home: one Google Doc per pilot with a folder, one per research item in the R&D folder, plus the two sheets. */
export async function syncAll(env, opts) {
  opts = opts || {};
  if (!configured(env)) return { ok: false, error: "Drive sync is not set up yet." };
  if (oauthReady(env) && !(await connectedAccount(env))) return { ok: false, error: "Google Drive is not connected yet. Use Connect Google Drive on the Pilots page." };
  const store = new D1Store(env.DB);
  let doc = await store.load();
  const mark = await readMark(env);
  if (!opts.force && mark.version === doc.version && mark.ok !== false) return { ok: true, skipped: true, version: doc.version, at: mark.at };
  const files = [];
  const errors = [];
  let token;
  try { token = await accessToken(env); } catch (e) { await writeMark(env, { version: mark.version || 0, at: new Date().toISOString(), ok: false, error: e.message, files: mark.files || [] }); return { ok: false, error: e.message }; }
  const now = new Date();
  let changedDocIds = false;
  for (const p of doc.state.pilots || []) {
    const folder = driveFolderId(p.link);
    if (!folder) continue;
    const md = pilotMarkdown(doc.state, p, now);
    try {
      if (p.driveDoc) {
        await updateMedia(token, p.driveDoc, "text/markdown", md);
        files.push({ pilot: p.name, id: p.driveDoc, action: "updated" });
      } else {
        const made = await createDoc(token, folder, "ALIE pilot record — " + p.name, md);
        p.driveDoc = made.id; changedDocIds = true;
        files.push({ pilot: p.name, id: made.id, action: "created" });
      }
    } catch (e) { errors.push(p.name + ": " + e.message); }
  }
  /* per-record docs that were pushed once are refreshed on every sync */
  for (const rec of pushedRecords(doc.state)) {
    if (!rec.rec.drive || !rec.rec.drive.fileId) continue;
    try {
      await updateMedia(token, rec.rec.drive.fileId, "text/markdown", recordMarkdown(doc.state, rec.kind, rec.rec, rec.pilot, now));
      rec.rec.drive = { fileId: rec.rec.drive.fileId, status: "Synced", syncedAt: now.toISOString(), error: "" }; changedDocIds = true;
      files.push({ record: rec.kind + ": " + (rec.rec.title || rec.rec.name || ""), id: rec.rec.drive.fileId, action: "updated" });
    } catch (e) { rec.rec.drive = Object.assign({}, rec.rec.drive, { status: "Error", error: String(e.message || e).slice(0, 200) }); changedDocIds = true; errors.push(rec.kind + " " + (rec.rec.title || "") + ": " + e.message); }
  }
  const rndFolder = driveFolderId(doc.state.rndFolder) || env.RND_FOLDER_ID || "";
  if (rndFolder) {
    for (const f of doc.state.features.filter(x => x.rnd)) {
      const md = rndMarkdown(doc.state, f, now);
      try {
        if (f.driveDoc) {
          await updateMedia(token, f.driveDoc, "text/markdown", md);
          files.push({ rnd: f.name, id: f.driveDoc, action: "updated" });
        } else {
          const made = await createDoc(token, rndFolder, "ALIE R&D — " + f.name, md);
          f.driveDoc = made.id; changedDocIds = true;
          files.push({ rnd: f.name, id: made.id, action: "created" });
        }
      } catch (e) { errors.push("R&D " + f.name + ": " + e.message); }
    }
  }
  if (env.FEATURES_SHEET_ID) { try { await updateMedia(token, env.FEATURES_SHEET_ID, "text/csv", featuresCsv(doc.state)); files.push({ sheet: "features", id: env.FEATURES_SHEET_ID, action: "updated" }); } catch (e) { errors.push("features sheet: " + e.message); } }
  if (env.LOG_SHEET_ID) { try { await updateMedia(token, env.LOG_SHEET_ID, "text/csv", logCsv(doc.state)); files.push({ sheet: "change log", id: env.LOG_SHEET_ID, action: "updated" }); } catch (e) { errors.push("change log sheet: " + e.message); } }
  if (changedDocIds) {
    try { const saved = await store.save(doc.state, doc.version); doc = saved; } catch (_) { /* a concurrent edit; the ids will be written on the next run */ }
  }
  const result = { version: doc.version, at: now.toISOString(), ok: errors.length === 0, error: errors.join(" | "), files };
  await writeMark(env, result);
  return result;
}
