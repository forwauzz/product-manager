/* Cloudflare Worker: serves the static app from the ASSETS binding, runs the shared API
   against D1, and gates everything behind a passcode when APP_PASSCODE is set. */
import { handleApi } from "../shared/core.js";
import { D1Store } from "./store-d1.js";

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

export default {
  async fetch(request, env) {
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
    if (path === "/api/logout" && request.method === "POST") {
      return jsonResponse(204, null, { "Set-Cookie": setCookie("", 0) });
    }

    const authed = await isAuthed(request, env);

    if (path.startsWith("/api/")) {
      if (!authed) return jsonResponse(401, { error: "Sign in first." });
      if (!env.DB) return jsonResponse(500, { error: "D1 binding DB is not configured." });
      let body = null;
      if (request.method !== "GET" && request.method !== "HEAD") {
        try { body = await request.json(); } catch (_) { return jsonResponse(400, { error: "Body must be JSON." }); }
      }
      const query = Object.fromEntries(url.searchParams.entries());
      try {
        const out = await handleApi({ method: request.method, path: path.replace(/^\/api/, ""), query, body }, new D1Store(env.DB));
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
      return env.ASSETS.fetch(new Request(url.origin + "/index.html", request));
    }
    return res;
  }
};
