/* Cloudflare Worker: serves the static app from the ASSETS binding, runs the shared API
   against D1, and gates everything behind a passcode when APP_PASSCODE is set. */
import { handleApi } from "../shared/core.js";
import { D1Store } from "./store-d1.js";
import { syncAll as driveSyncAll, status as driveStatus, configured as driveConfigured, oauthReady as driveOauthReady, authUrl as driveAuthUrl, finishConnect as driveFinishConnect, disconnect as driveDisconnect, connectedAccount as driveAccount, pushRecord as drivePush } from "./drive.js";

const COOKIE = "pm_auth";
const COOKIE_DAYS = 30;
const enc = new TextEncoder();

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sessionToken(passcode) {
  const key = await crypto.subtle.importKey("raw", enc.encode(passcode), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode("alie-product-manager-session-v1")));
}
function timingSafeEqual(a, b) {
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
function cookieValue(request) {
  const raw = request.headers.get("Cookie") || "";
  const m = raw.split(/;\s*/).find(p => p.startsWith(COOKIE + "="));
  return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : "";
}
function setCookie(value, maxAge) {
  return COOKIE + "=" + encodeURIComponent(value) + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + maxAge;
}
function jsonResponse(status, body, headers) {
  if (status === 204) return new Response(null, { status: 204, headers });
  const h = new Headers(headers || {});
  h.set("Content-Type", "application/json; charset=utf-8");
  h.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers: h });
}

async function isAuthed(request, env) {
  if (!env.APP_PASSCODE) return true;
  const token = cookieValue(request);
  if (!token) return false;
  return timingSafeEqual(token, await sessionToken(env.APP_PASSCODE));
}

/* Feature screenshots: one D1 row per feature, image kept as a base64 data URL. */
async function handleShots(request, env, path) {
  const id = path.split("/")[3] || "";
  const store = new D1Store(env.DB);
  if (request.method === "GET" && id) {
    const row = await env.DB.prepare("SELECT mime, data FROM shots WHERE feature = ?").bind(id).first();
    if (!row) return jsonResponse(404, { error: "no screenshot" });
    const bin = Uint8Array.from(atob(row.data), c => c.charCodeAt(0));
    return new Response(bin, { status: 200, headers: { "Content-Type": row.mime, "Cache-Control": "public, max-age=60" } });
  }
  if (request.method === "POST") {
    let body = {};
    try { body = await request.json(); } catch (_) { return jsonResponse(400, { error: "Body must be JSON." }); }
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(body.data || ""));
    if (!m) return jsonResponse(400, { error: "data must be a base64 image data URL" });
    if (m[2].length > 1.2 * 1024 * 1024) return jsonResponse(400, { error: "image larger than 900 KB; shrink it first" });
    const doc = await store.load();
    const f = doc.state.features.find(x => x.id === body.feature) || doc.state.icps.find(x => x.id === body.feature);
    if (!f) return jsonResponse(400, { error: "unknown feature" });
    await env.DB.prepare("INSERT INTO shots (feature, mime, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(feature) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at")
      .bind(f.id, m[1], m[2], new Date().toISOString()).run();
    const url = "/api/shots/" + f.id + "?v=" + Date.now();
    f.image = url; f.updated = Date.now();
    await store.save(doc.state, doc.version);
    return jsonResponse(200, { feature: f.id, image: url });
  }
  if (request.method === "DELETE" && id) {
    await env.DB.prepare("DELETE FROM shots WHERE feature = ?").bind(id).run();
    const doc = await store.load();
    const f = doc.state.features.find(x => x.id === id) || doc.state.icps.find(x => x.id === id);
    if (f && f.image) { f.image = ""; f.updated = Date.now(); await store.save(doc.state, doc.version); }
    return jsonResponse(204, null);
  }
  return jsonResponse(404, { error: "unknown endpoint" });
}

export default {
  /* Cron: push anything that changed to Drive. */
  async scheduled(event, env, ctx) {
    if (!driveConfigured(env)) return;
    ctx.waitUntil(driveSyncAll(env).catch(() => {}));
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const required = !!env.APP_PASSCODE;

    /* Auth endpoints are always reachable. */
    if (path === "/api/session" && request.method === "GET") {
      return jsonResponse(200, { authed: await isAuthed(request, env), required });
    }
    if (path === "/api/login" && request.method === "POST") {
      if (!required) return jsonResponse(200, { ok: true });
      let body = {};
      try { body = await request.json(); } catch (_) { /* fall through */ }
      const given = String((body && body.passcode) || "");
      if (!given || !timingSafeEqual(given, env.APP_PASSCODE)) {
        // Small fixed delay to make guessing slower.
        await new Promise(r => setTimeout(r, 400));
        return jsonResponse(401, { error: "That passcode is not right." });
      }
      return jsonResponse(200, { ok: true }, { "Set-Cookie": setCookie(await sessionToken(env.APP_PASSCODE), COOKIE_DAYS * 86400) });
    }
    if (path === "/api/version" && request.method === "GET") {
      return jsonResponse(200, { build: buildId(env) });
    }
    if (path === "/api/logout" && request.method === "POST") {
      return jsonResponse(204, null, { "Set-Cookie": setCookie("", 0) });
    }

    const authed = await isAuthed(request, env);

    if (path.startsWith("/api/shots")) {
      if (!authed) return jsonResponse(401, { error: "Sign in first." });
      return handleShots(request, env, path);
    }
    if (path === "/api/drive/connect" && request.method === "GET") {
      if (!authed) return Response.redirect(url.origin + "/login.html", 302);
      if (!driveOauthReady(env)) return jsonResponse(409, { error: "The Google OAuth client is not configured on this server." });
      const state = await sessionToken(env.APP_PASSCODE + ":drive:" + new Date().toISOString().slice(0, 13));
      return Response.redirect(driveAuthUrl(env, url.origin, state), 302);
    }
    if (path === "/api/drive/callback" && request.method === "GET") {
      if (!authed) return Response.redirect(url.origin + "/login.html", 302);
      const code = url.searchParams.get("code"), state = url.searchParams.get("state") || "";
      const now = new Date();
      const okState = state && (timingSafeEqual(state, await sessionToken(env.APP_PASSCODE + ":drive:" + now.toISOString().slice(0, 13))) || timingSafeEqual(state, await sessionToken(env.APP_PASSCODE + ":drive:" + new Date(now.getTime() - 3600000).toISOString().slice(0, 13))));
      if (!code || !okState) return Response.redirect(url.origin + "/#pilots?drive=denied", 302);
      try {
        await driveFinishConnect(env, url.origin, code);
        if (ctx) ctx.waitUntil(driveSyncAll(env, { force: true }).catch(() => {}));
        return Response.redirect(url.origin + "/#pilots?drive=connected", 302);
      } catch (e) {
        return Response.redirect(url.origin + "/#pilots?drive=failed&why=" + encodeURIComponent(String(e.message || "").slice(0, 120)), 302);
      }
    }
    if (path === "/api/drive/disconnect" && request.method === "POST") {
      if (!authed) return jsonResponse(401, { error: "Sign in first." });
      try { await driveDisconnect(env); return jsonResponse(200, { ok: true }); } catch (e) { return jsonResponse(500, { error: e.message }); }
    }
    if (path === "/api/drive/status" && request.method === "GET") {
      if (!authed) return jsonResponse(401, { error: "Sign in first." });
      if (!env.DB) return jsonResponse(500, { error: "D1 binding DB is not configured." });
      try { return jsonResponse(200, await driveStatus(env)); } catch (e) { return jsonResponse(500, { error: e.message }); }
    }
    if (path === "/api/drive/push" && request.method === "POST") {
      if (!authed) return jsonResponse(401, { error: "Sign in first." });
      let body = {};
      try { body = await request.json(); } catch (_) { return jsonResponse(400, { ok: false, error: "Body must be JSON." }); }
      if (!driveConfigured(env)) return jsonResponse(409, { ok: false, error: "Drive sync is not set up yet." });
      try { return jsonResponse(200, await drivePush(env, body)); } catch (e) { return jsonResponse(500, { ok: false, error: e.message }); }
    }
    if (path === "/api/drive/sync" && request.method === "POST") {
      if (!authed) return jsonResponse(401, { error: "Sign in first." });
      if (!driveConfigured(env)) return jsonResponse(409, { ok: false, error: "Drive sync is not set up yet." });
      if (driveOauthReady(env) && !(await driveAccount(env))) return jsonResponse(409, { ok: false, error: "Connect Google Drive first." });
      try { return jsonResponse(200, await driveSyncAll(env, { force: true })); } catch (e) { return jsonResponse(500, { ok: false, error: e.message }); }
    }
    if (path.startsWith("/api/")) {
      if (!authed) return jsonResponse(401, { error: "Sign in first." });
      if (!env.DB) return jsonResponse(500, { error: "D1 binding DB is not configured." });
      let body = null;
      if (request.method !== "GET" && request.method !== "HEAD") {
        const text = await request.text();
        if (text.trim()) {
          try { body = JSON.parse(text); } catch (_) { return jsonResponse(400, { error: "Body must be JSON." }); }
        }
      }
      const query = Object.fromEntries(url.searchParams.entries());
      try {
        const out = await handleApi({ method: request.method, path: path.replace(/^\/api/, ""), query, body }, new D1Store(env.DB));
        // Any successful edit: push to Drive in the background, shortly after the save.
        if (request.method !== "GET" && out.status < 300 && driveConfigured(env) && ctx) {
          ctx.waitUntil(new Promise(r => setTimeout(r, 20000)).then(() => driveSyncAll(env)).catch(() => {}));
        }
        return jsonResponse(out.status, out.body, out.headers);
      } catch (e) {
        return jsonResponse(500, { error: e.message || "Server error" });
      }
    }

    /* Pages: the app shell is gated, the login page and its assets are not. */
    if (!authed && (path === "/" || path === "/index.html" || path.startsWith("/#"))) {
      return Response.redirect(url.origin + "/login.html", 302);
    }
    if (authed && path === "/login.html") {
      return Response.redirect(url.origin + "/", 302);
    }

    const res = await env.ASSETS.fetch(request);
    if (res.status === 404 && request.method === "GET" && !/\.[a-z0-9]+$/i.test(path)) {
      // Client-side routes fall back to the shell.
      if (!authed) return Response.redirect(url.origin + "/login.html", 302);
      return stampHtml(await env.ASSETS.fetch(new Request(url.origin + "/index.html", request)), env);
    }
    if (path === "/" || path === "/index.html" || path === "/login.html" || path === "/login") return stampHtml(res, env);
    return res;
  }
};

/* Every deploy gets a new version id; the page carries it so app.js and styles.css are fetched fresh
   after a deploy, and the app can tell when a newer build is live. */
function buildId(env) {
  const meta = env.CF_VERSION_METADATA;
  return meta && meta.id ? String(meta.id).slice(0, 8) : "dev";
}
async function stampHtml(res, env) {
  if (!res.ok || !/text\/html/.test(res.headers.get("Content-Type") || "")) return res;
  const v = buildId(env);
  const html = (await res.text())
    .replace('<link rel="stylesheet" href="/styles.css">', '<link rel="stylesheet" href="/styles.css?v=' + v + '">')
    .replace('<script src="/app.js"></script>', '<meta name="build" content="' + v + '"><script src="/app.js?v=' + v + '"></script>');
  const h = new Headers(res.headers);
  h.set("Cache-Control", "no-cache");
  h.delete("Content-Length");
  return new Response(html, { status: res.status, headers: h });
}
