/* Google Drive sync from the Worker. Needs a service-account JSON key in the GOOGLE_SA_KEY secret
   and the target folders shared with that account. Never logs the key. */
import { D1Store } from "./store-d1.js";
import { pilotMarkdown, featuresCsv, logCsv, driveFolderId } from "../shared/exports.js";

const SCOPE = "https://www.googleapis.com/auth/drive";
const MARK = "drive-sync";

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
export function configured(env) { return !!(env.GOOGLE_SA_KEY && env.DB); }

let cachedToken = null;
export async function accessToken(env) {
  if (cachedToken && cachedToken.exp > Date.now() + 60000) return cachedToken.value;
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
  return { configured: configured(env), version: doc.version, syncedVersion: mark.version || 0, at: mark.at || null, ok: mark.ok !== false, error: mark.error || "", files: mark.files || [], pending: (mark.version || 0) !== doc.version };
}

/* Sync everything that has a Drive home: one Google Doc per pilot with a folder, plus the two sheets. */
export async function syncAll(env, opts) {
  opts = opts || {};
  if (!configured(env)) return { ok: false, error: "Drive sync is not set up: add the GOOGLE_SA_KEY secret." };
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
  if (env.FEATURES_SHEET_ID) { try { await updateMedia(token, env.FEATURES_SHEET_ID, "text/csv", featuresCsv(doc.state)); files.push({ sheet: "features", id: env.FEATURES_SHEET_ID, action: "updated" }); } catch (e) { errors.push("features sheet: " + e.message); } }
  if (env.LOG_SHEET_ID) { try { await updateMedia(token, env.LOG_SHEET_ID, "text/csv", logCsv(doc.state)); files.push({ sheet: "change log", id: env.LOG_SHEET_ID, action: "updated" }); } catch (e) { errors.push("change log sheet: " + e.message); } }
  if (changedDocIds) {
    try { const saved = await store.save(doc.state, doc.version); doc = saved; } catch (_) { /* a concurrent edit; the ids will be written on the next run */ }
  }
  const result = { version: doc.version, at: now.toISOString(), ok: errors.length === 0, error: errors.join(" | "), files };
  await writeMark(env, result);
  return result;
}
