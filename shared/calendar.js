/* Google Calendar ↔ pilot sessions: the pure part. Which pilot a calendar event belongs to, what a session
   looks like when it comes from an event, and what event a session becomes. No network here. */

export const CAL_TZ = "America/Toronto";
export const CAL_STATUS = ["Not in calendar", "In calendar", "Cancelled in calendar", "Error"];

export function emptyCalendar() { return { eventId: "", link: "", status: "Not in calendar", syncedAt: "", error: "", origin: "App", eventUpdated: "" }; }

export function fold(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
function wordIn(text, word) {
  const w = fold(word).trim();
  if (!w) return false;
  const re = new RegExp("(^|[^a-z0-9])" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^a-z0-9]|$)");
  return re.test(text);
}
export function stripHtml(s) {
  return String(s || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/* Only ordinary meetings: no birthdays, focus time, out of office or working-location entries. */
export function isMeeting(ev) {
  if (!ev || ev.status === "cancelled") return false;
  if (ev.eventType && ev.eventType !== "default") return false;
  return !!(ev.start && (ev.start.dateTime || ev.start.date));
}

/* The pilot an event is about: an attendee email on the pilot's people list, the pilot's name in the title or
   description, or a client person's full name (5+ letters) as a whole word. Conservative on purpose. */
export function pilotForEvent(ev, pilots) {
  if (!ev) return null;
  const list = (pilots || []).filter(p => p && typeof p === "object");
  const attendees = Array.isArray(ev.attendees) ? ev.attendees : [];
  const emails = attendees.map(a => fold(a.email)).filter(Boolean);
  for (const p of list) {
    if ((p.people || []).some(x => x.email && emails.indexOf(fold(x.email)) !== -1)) return p;
  }
  const text = fold([ev.summary, ev.description, attendees.map(a => a.displayName || "").join(" ")].join(" \n "));
  for (const p of list) {
    if (fold(p.name).trim().length >= 4 && wordIn(text, p.name)) return p;
  }
  for (const p of list) {
    if ((p.people || []).some(x => x.side !== "Internal" && fold(x.name).trim().length >= 5 && wordIn(text, x.name))) return p;
  }
  /* a first name alone counts when it is distinctive enough (six letters or more: Amélie, Claudine; not Hugo or Sarah) */
  for (const p of list) {
    if ((p.people || []).some(x => { const first = fold(x.name).trim().split(/\s+/)[0] || ""; return x.side !== "Internal" && first.length >= 6 && wordIn(text, first); })) return p;
  }
  return null;
}

/* "2026-09-17T13:00:00-04:00" → { date: "2026-09-17", time: "13:00" } in the firm's time zone; an all-day date keeps no time. */
export function localParts(v, tz) {
  if (!v) return { date: "", time: "" };
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return { date: v, time: "" };
  const d = new Date(v);
  if (isNaN(d.getTime())) return { date: "", time: "" };
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz || CAL_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const parts = {};
  f.formatToParts(d).forEach(x => { parts[x.type] = x.value; });
  return { date: parts.year + "-" + parts.month + "-" + parts.day, time: (parts.hour === "24" ? "00" : parts.hour) + ":" + parts.minute };
}
function nextDay(date) {
  const d = new Date(date + "T12:00:00Z");
  return new Date(d.getTime() + 86400000).toISOString().slice(0, 10);
}
function plusMinutes(time, mins) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time || "");
  if (!m) return "";
  const t = Math.min(23 * 60 + 59, Number(m[1]) * 60 + Number(m[2]) + mins);
  return String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0");
}

export function participantsOf(ev) {
  return (Array.isArray(ev.attendees) ? ev.attendees : []).filter(a => a && !a.resource).map(a => a.displayName || a.email || "").filter(Boolean).join(", ");
}

/* A Planned session created from a meeting that was booked in the calendar. */
export function sessionFromEvent(ev, pilot, nowIso, makeId) {
  const st = localParts(ev.start && (ev.start.dateTime || ev.start.date));
  return {
    id: makeId(), date: st.date, time: st.time, title: ev.summary || "Meeting", participants: participantsOf(ev),
    purpose: stripHtml(ev.description).slice(0, 1200), agenda: "", links: ev.htmlLink || "", summary: "", findings: "", draft: false, stage: "Planned",
    drive: { recording: "", transcript: "", rawNotes: "", summary: "", receivedFiles: "", folder: "" }, transcript: "", extractedAt: 0, files: [],
    doc: { fileId: "", status: "Not in Drive", syncedAt: "", error: "" },
    calendar: { eventId: ev.id, link: ev.htmlLink || "", status: "In calendar", syncedAt: nowIso, error: "", origin: "Calendar", eventUpdated: ev.updated || "" },
    created: Date.parse(nowIso), updated: Date.parse(nowIso)
  };
}

/* The calendar moved or renamed a meeting: the session follows. The app's own text (purpose, agenda, findings) is never overwritten. */
export function applyEvent(s, ev, nowIso) {
  const st = localParts(ev.start && (ev.start.dateTime || ev.start.date));
  if (st.date) { s.date = st.date; s.time = st.time; }
  if (!s.calendar) s.calendar = emptyCalendar();
  if (s.calendar.origin === "Calendar") {
    if (ev.summary) s.title = ev.summary;
    const who = participantsOf(ev); if (who) s.participants = who;
  }
  if (ev.htmlLink && !s.links) s.links = ev.htmlLink;
  Object.assign(s.calendar, { eventId: ev.id, link: ev.htmlLink || s.calendar.link, status: "In calendar", syncedAt: nowIso, error: "", eventUpdated: ev.updated || "" });
  s.updated = Date.parse(nowIso);
  return s;
}

/* What the session looks like in the calendar: one hour from its time, or all day; no attendees are invited from here. */
export function eventForSession(p, s, origin) {
  const title = (p ? p.name + " — " : "") + (s.title || s.purpose || "Session");
  const lines = [];
  if (s.purpose) lines.push(s.purpose);
  if (s.agenda) lines.push("Agenda:\n" + s.agenda);
  if (s.participants) lines.push("Participants: " + s.participants);
  lines.push("Session record in ALIE Product Manager" + (origin ? ": " + origin + "/#pilots" : "") + (s.stage ? " · stage " + s.stage : ""));
  const body = { summary: title, description: lines.join("\n\n"), extendedProperties: { private: { alieSession: s.id, aliePilot: p ? p.id : "" } } };
  if (s.time) {
    body.start = { dateTime: s.date + "T" + s.time + ":00", timeZone: CAL_TZ };
    body.end = { dateTime: s.date + "T" + plusMinutes(s.time, 60) + ":00", timeZone: CAL_TZ };
  } else {
    body.start = { date: s.date };
    body.end = { date: nextDay(s.date) };
  }
  return body;
}

/* Sessions the sync carries to the calendar on its own: dated today or later and not closed, plus anything already there. */
export function wantsCalendar(s, today) {
  if (!s || !s.date) return false;
  const c = s.calendar || {};
  if (c.status === "Cancelled in calendar") return false;
  if (c.eventId) return true;
  return s.date >= today && s.stage !== "Follow-ups closed";
}
