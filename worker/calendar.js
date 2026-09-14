/* Google Calendar sync from the Worker, as the signed-in Google user (same OAuth grant as Drive, calendar.events scope).
   Pull: meetings booked in the calendar with pilot people become Planned sessions; moved or cancelled meetings update
   their session. Push: dated sessions from today on become calendar events; edited sessions update their event. */
import { D1Store } from "./store-d1.js";
import { accessToken, calendarConnected } from "./drive.js";
import { isMeeting, pilotForEvent, sessionFromEvent, applyEvent, eventForSession, wantsCalendar, localParts, emptyCalendar } from "../shared/calendar.js";

const MARK = "calendar-sync";
const API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

async function gcal(token, method, url, body) {
  const r = await fetch(url, { method, headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let j = {};
  try { j = text ? JSON.parse(text) : {}; } catch (_) { j = { raw: text.slice(0, 200) }; }
  if (!r.ok) {
    const msg = (j.error && (j.error.message || j.error.status)) || j.raw || ("HTTP " + r.status);
    throw new Error("Calendar API: " + String(msg).slice(0, 220));
  }
  return j;
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
  return { connected: await calendarConnected(env), at: mark.at || null, ok: mark.ok !== false, error: mark.error || "", created: mark.created || [], updated: mark.updated || [], pushed: mark.pushed || [], events: mark.events || 0 };
}

async function listEvents(token, from, to) {
  const out = [];
  let pageToken = "";
  do {
    const q = new URLSearchParams({ singleEvents: "true", showDeleted: "true", orderBy: "startTime", maxResults: "250", timeMin: from.toISOString(), timeMax: to.toISOString() });
    if (pageToken) q.set("pageToken", pageToken);
    const j = await gcal(token, "GET", API + "?" + q.toString());
    (j.items || []).forEach(e => out.push(e));
    pageToken = j.nextPageToken || "";
  } while (pageToken);
  return out;
}

/* One full pass, both directions. Safe to run every ten minutes. */
export async function syncCalendar(env, opts) {
  opts = opts || {};
  if (!(await calendarConnected(env))) return { ok: false, error: "Google Calendar is not connected yet. Press Connect Google Calendar on the Pilots page." };
  const store = new D1Store(env.DB);
  const doc = await store.load();
  const now = new Date();
  const nowIso = now.toISOString();
  const today = localParts(nowIso).date;
  const created = [], updated = [], pushed = [], errors = [];
  let changed = false;
  let token;
  try { token = await accessToken(env); } catch (e) { await writeMark(env, { at: nowIso, ok: false, error: e.message }); return { ok: false, error: e.message }; }
  const pilots = doc.state.pilots || [];
  const byEvent = {}, byId = {};
  pilots.forEach(p => (p.sessions || []).forEach(s => { if (!s.calendar) s.calendar = emptyCalendar(); if (s.calendar.eventId) byEvent[s.calendar.eventId] = { p, s }; byId[s.id] = { p, s }; }));

  /* pull */
  let events = [];
  try { events = await listEvents(token, new Date(now.getTime() - 14 * 86400000), new Date(now.getTime() + 183 * 86400000)); }
  catch (e) { errors.push(e.message); }
  for (const ev of events) {
    const priv = (ev.extendedProperties && ev.extendedProperties.private) || {};
    const hit = byEvent[ev.id] || (priv.alieSession && byId[priv.alieSession]) || null;
    if (hit) {
      const s = hit.s;
      if (ev.status === "cancelled") {
        if (s.calendar.status !== "Cancelled in calendar") { s.calendar.status = "Cancelled in calendar"; s.calendar.syncedAt = nowIso; s.updated = now.getTime(); updated.push(s.title + " (cancelled in calendar)"); changed = true; }
        continue;
      }
      if (!s.calendar.eventId || (ev.updated && ev.updated > (s.calendar.eventUpdated || ""))) {
        const before = s.date + " " + s.time;
        applyEvent(s, ev, nowIso);
        if (before !== s.date + " " + s.time) updated.push(s.title + " → " + s.date + (s.time ? " " + s.time : ""));
        changed = true;
      }
      continue;
    }
    if (!isMeeting(ev)) continue;
    const p = pilotForEvent(ev, pilots);
    if (!p) continue;
    const s = sessionFromEvent(ev, p, nowIso, uid);
    p.sessions = (p.sessions || []).concat([s]);
    p.updated = now.getTime();
    byEvent[ev.id] = { p, s }; byId[s.id] = { p, s };
    created.push(p.name + ": " + s.title + " · " + s.date + (s.time ? " " + s.time : ""));
    changed = true;
  }

  /* push */
  for (const p of pilots) {
    for (const s of p.sessions || []) {
      if (!wantsCalendar(s, today)) continue;
      const c = s.calendar;
      try {
        if (c.eventId) {
          if (s.updated > Date.parse(c.syncedAt || 0)) {
            const r = await gcal(token, "PATCH", API + "/" + encodeURIComponent(c.eventId), eventForSession(p, s, opts.origin));
            Object.assign(c, { link: r.htmlLink || c.link, status: "In calendar", syncedAt: nowIso, error: "", eventUpdated: r.updated || c.eventUpdated });
            pushed.push(s.title + " (updated)"); changed = true;
          }
        } else {
          const r = await gcal(token, "POST", API, eventForSession(p, s, opts.origin));
          Object.assign(c, { eventId: r.id, link: r.htmlLink || "", status: "In calendar", syncedAt: nowIso, error: "", eventUpdated: r.updated || "" });
          pushed.push(s.title + " (created)"); changed = true;
        }
      } catch (e) {
        if (c.error !== e.message) { c.status = c.eventId ? c.status : "Error"; c.error = String(e.message).slice(0, 200); changed = true; }
        errors.push(s.title + ": " + e.message);
      }
    }
  }
  let version = doc.version;
  if (changed) {
    try { version = (await store.save(doc.state, doc.version)).version; }
    catch (e) { errors.push("The app changed while syncing; the next run will catch up."); }
  }
  const result = { ok: errors.length === 0, error: errors.join(" | "), at: nowIso, version, events: events.length, created, updated, pushed };
  await writeMark(env, result);
  return result;
}

/* Put one session in the calendar now, whatever its date, or refresh its event. */
export async function pushSession(env, body, origin) {
  if (!(await calendarConnected(env))) return { ok: false, error: "Google Calendar is not connected yet." };
  const store = new D1Store(env.DB);
  const doc = await store.load();
  const p = (doc.state.pilots || []).find(x => x.id === body.pilot);
  const s = p && (p.sessions || []).find(x => x.id === body.id);
  if (!s) return { ok: false, error: "Session not found." };
  if (!s.date) return { ok: false, error: "Give the session a date first." };
  if (!s.calendar) s.calendar = emptyCalendar();
  const nowIso = new Date().toISOString();
  try {
    const token = await accessToken(env);
    const c = s.calendar;
    const r = c.eventId ? await gcal(token, "PATCH", API + "/" + encodeURIComponent(c.eventId), eventForSession(p, s, origin)) : await gcal(token, "POST", API, eventForSession(p, s, origin));
    Object.assign(c, { eventId: r.id || c.eventId, link: r.htmlLink || c.link, status: "In calendar", syncedAt: nowIso, error: "", eventUpdated: r.updated || "" });
  } catch (e) {
    s.calendar.status = s.calendar.eventId ? s.calendar.status : "Error"; s.calendar.error = String(e.message).slice(0, 200);
  }
  s.updated = Date.parse(nowIso);
  const saved = await store.save(doc.state, doc.version);
  return { ok: !s.calendar.error, error: s.calendar.error, calendar: s.calendar, version: saved.version };
}
