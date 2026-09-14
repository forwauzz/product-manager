import { test } from "node:test";
import assert from "node:assert/strict";
import { pilotForEvent, localParts, sessionFromEvent, eventForSession, applyEvent, wantsCalendar, isMeeting, emptyCalendar } from "../shared/calendar.js";
import { normalize } from "../shared/core.js";

const pilots = [
  { id: "p1", name: "Le Cabinet M", people: [{ id: "a", name: "Amélie Auger", side: "Client", email: "amelie@cabinetm.example" }, { id: "b", name: "Sarah-Jeanne", side: "Client" }, { id: "u", name: "Uzziel", side: "Internal" }] },
  { id: "p2", name: "Hugo", people: [{ id: "h", name: "Hugo", side: "Client" }] }
];

test("an event is matched to a pilot by attendee email, pilot name or a client person's name, accents ignored", () => {
  assert.equal(pilotForEvent({ summary: "Point hebdo", attendees: [{ email: "Amelie@CabinetM.example" }] }, pilots).id, "p1");
  assert.equal(pilotForEvent({ summary: "Visite le cabinet m — retour", attendees: [] }, pilots).id, "p1");
  assert.equal(pilotForEvent({ summary: "Suivi", description: "Appel avec Amelie sur le sommaire" }, pilots).id, "p1");
  assert.equal(pilotForEvent({ summary: "Coffee with Sarah-jeanne" }, pilots).id, "p1");
  assert.equal(pilotForEvent({ summary: "Dentist" }, pilots), null);
  assert.equal(pilotForEvent({ summary: "Lunch with Sarah" }, pilots), null);
  assert.equal(pilotForEvent({ summary: "Auger" }, pilots), null);
  /* short names alone (Hugo, 4 letters) match only as the pilot name, never through the people list */
  assert.equal(pilotForEvent({ summary: "Hugo: Section 7 review" }, pilots).id, "p2");
  assert.equal(pilotForEvent({ summary: "Hugoton trip" }, pilots), null);
  assert.equal(pilotForEvent({ summary: "Amélie", eventType: "focusTime", start: { dateTime: "2026-09-20T10:00:00-04:00" } }, pilots).id, "p1");
  assert.equal(isMeeting({ eventType: "focusTime", start: { dateTime: "2026-09-20T10:00:00-04:00" } }), false);
  assert.equal(isMeeting({ status: "cancelled", start: { date: "2026-09-20" } }), false);
  assert.equal(isMeeting({ start: { date: "2026-09-20" } }), true);
});

test("event times land in the firm's time zone; all-day events keep no time", () => {
  assert.deepEqual(localParts("2026-09-17T17:30:00Z"), { date: "2026-09-17", time: "13:30" });
  assert.deepEqual(localParts("2026-12-17T17:30:00Z"), { date: "2026-12-17", time: "12:30" });
  assert.deepEqual(localParts("2026-09-17T03:30:00Z"), { date: "2026-09-16", time: "23:30" });
  assert.deepEqual(localParts("2026-09-17"), { date: "2026-09-17", time: "" });
  assert.deepEqual(localParts(""), { date: "", time: "" });
});

test("a booked meeting becomes a Planned session that remembers its event", () => {
  const ev = { id: "ev1", summary: "Cabinet M — chronologie", description: "Plan:<br>1. duplicates", htmlLink: "https://calendar.google.com/x", updated: "2026-09-14T10:00:00Z", start: { dateTime: "2026-09-17T14:00:00-04:00" }, attendees: [{ email: "amelie@cabinetm.example", displayName: "Amélie Auger" }, { email: "me@alie.app" }] };
  const s = sessionFromEvent(ev, pilots[0], "2026-09-14T12:00:00.000Z", () => "s1");
  assert.equal(s.stage, "Planned");
  assert.equal(s.date, "2026-09-17"); assert.equal(s.time, "14:00");
  assert.equal(s.participants, "Amélie Auger, me@alie.app");
  assert.equal(s.purpose, "Plan:\n1. duplicates");
  assert.deepEqual(s.calendar, { eventId: "ev1", link: "https://calendar.google.com/x", status: "In calendar", syncedAt: "2026-09-14T12:00:00.000Z", error: "", origin: "Calendar", eventUpdated: "2026-09-14T10:00:00Z" });
  /* the meeting moves: the session follows; the app's own text stays */
  s.purpose = "edited in the app";
  applyEvent(s, Object.assign({}, ev, { start: { dateTime: "2026-09-18T09:00:00-04:00" }, summary: "Cabinet M — chronologie (déplacé)", updated: "2026-09-15T10:00:00Z" }), "2026-09-15T11:00:00.000Z");
  assert.equal(s.date, "2026-09-18"); assert.equal(s.time, "09:00");
  assert.equal(s.title, "Cabinet M — chronologie (déplacé)");
  assert.equal(s.purpose, "edited in the app");
  /* a session the app created keeps its own title when the event is renamed */
  const own = { id: "s2", title: "Onsite with Amélie", date: "2026-09-20", time: "10:00", calendar: Object.assign(emptyCalendar(), { eventId: "ev2" }) };
  applyEvent(own, { id: "ev2", summary: "renamed in calendar", start: { dateTime: "2026-09-21T10:00:00-04:00" } }, "2026-09-15T11:00:00.000Z");
  assert.equal(own.title, "Onsite with Amélie"); assert.equal(own.date, "2026-09-21");
});

test("a session becomes a one-hour event, or an all-day one without a time; nobody is invited", () => {
  const p = pilots[0];
  const timed = eventForSession(p, { id: "s1", title: "Onsite with Amélie", date: "2026-09-17", time: "13:00", purpose: "SAAQ case", agenda: "1. sommaire\n2. délais", stage: "Planned" }, "https://pm.example");
  assert.equal(timed.summary, "Le Cabinet M — Onsite with Amélie");
  assert.deepEqual(timed.start, { dateTime: "2026-09-17T13:00:00", timeZone: "America/Toronto" });
  assert.deepEqual(timed.end, { dateTime: "2026-09-17T14:00:00", timeZone: "America/Toronto" });
  assert.equal(timed.attendees, undefined);
  assert.match(timed.description, /Agenda:\n1\. sommaire/);
  assert.match(timed.description, /https:\/\/pm\.example\/#pilots/);
  assert.equal(timed.extendedProperties.private.alieSession, "s1");
  const late = eventForSession(p, { id: "s3", title: "x", date: "2026-09-17", time: "23:30" });
  assert.equal(late.end.dateTime, "2026-09-17T23:59:00");
  const allDay = eventForSession(p, { id: "s2", title: "Visit", date: "2026-09-30" });
  assert.deepEqual(allDay.start, { date: "2026-09-30" }); assert.deepEqual(allDay.end, { date: "2026-10-01" });
});

test("only dated sessions from today on go to the calendar by themselves; past ones only when already there", () => {
  const today = "2026-09-14";
  assert.equal(wantsCalendar({ date: "2026-09-17", stage: "Planned" }, today), true);
  assert.equal(wantsCalendar({ date: "2026-09-14", stage: "Recorded" }, today), true);
  assert.equal(wantsCalendar({ date: "2026-05-14", stage: "Transcript added" }, today), false);
  assert.equal(wantsCalendar({ date: "2026-05-14", stage: "Transcript added", calendar: { eventId: "e" } }, today), true);
  assert.equal(wantsCalendar({ date: "2026-09-17", stage: "Follow-ups closed" }, today), false);
  assert.equal(wantsCalendar({ date: "2026-09-17", stage: "Planned", calendar: { eventId: "e", status: "Cancelled in calendar" } }, today), false);
  assert.equal(wantsCalendar({ date: "", stage: "Planned" }, today), false);
});

test("normalize keeps a session's calendar state and a person's email", () => {
  const s = normalize({ pilots: [{ id: "p", name: "P", people: [{ id: "a", name: "Amélie", email: "a@b.c" }], sessions: [{ id: "s", title: "T", date: "2026-09-17", calendar: { eventId: "ev", link: "https://c", status: "In calendar", syncedAt: "2026-09-14T00:00:00Z", origin: "Calendar", eventUpdated: "x" } }, { id: "s2", title: "U" }] }] });
  const p = s.pilots[0];
  assert.equal(p.people[0].email, "a@b.c");
  assert.deepEqual(p.sessions[0].calendar, { eventId: "ev", link: "https://c", status: "In calendar", syncedAt: "2026-09-14T00:00:00Z", error: "", origin: "Calendar", eventUpdated: "x" });
  assert.deepEqual(p.sessions[1].calendar, emptyCalendar());
});
