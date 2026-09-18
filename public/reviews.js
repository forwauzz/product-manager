/* Client reviews: the pure part shared by the app, the guest page, the servers and the tests.
   A review is a curated document Uzziel writes inside a pilot; publishing freezes an allowlisted snapshot
   behind a long random link; the reader comments or suggests corrections against that snapshot.
   ESM everywhere; in a browser it also hangs off window.ALIE_REVIEWS for the classic app script. */

export const REVIEW_STATUS = ["Draft", "Published", "Disabled"];
export const FEEDBACK_STATES = ["Open", "In discussion", "Applied", "Closed"];
export const FEEDBACK_KINDS = ["comment", "suggestion", "finish"];
/* page compositions, after the reference cards: a full-height visual left of the text, the same reversed, or a reading column */
export const LAYOUTS = ["visual", "visual-right", "article"];
export const LIMITS = { text: 4000, suggestion: 4000, quote: 1200, name: 80, context: 400, perWindow: 40, windowMs: 10 * 60 * 1000 };

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const str = v => typeof v === "string" ? v : v == null ? "" : String(v);
const num = (v, d) => Number.isFinite(Number(v)) ? Number(v) : d;
const oneOf = (list, v, d) => list.indexOf(v) !== -1 ? v : d;

/* small stable hash for block ids: the same text yields the same id across revisions */
export function hashText(s) {
  let h = 5381;
  const t = String(s || "");
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
const normText = s => String(s || "").replace(/\s+/g, " ").trim();

/* Card bodies use a small markup: blank line between blocks; "## " subheading; "> " callout; "1. " numbered steps;
   "- " bullets; "| a | b |" rows make a two-column comparison (first row is the headings). Inline **bold** and *italic*. */
export function parseBlocks(body) {
  const chunks = String(body || "").replace(/\r\n?/g, "\n").split(/\n{2,}/).map(c => c.trim()).filter(Boolean);
  const out = [];
  const expanded = [];
  chunks.forEach(chunk => {
    const lines = chunk.split("\n").map(l => l.trim()).filter(Boolean);
    /* a heading followed on the next lines by a list, steps or a table: the heading stands alone, the rest is its own block */
    if (lines.length > 1 && lines[0].startsWith("## ") && /^(\d+[.)]\s|[-•]\s|\|)/.test(lines[1])) { expanded.push(lines[0]); expanded.push(lines.slice(1).join("\n")); }
    else expanded.push(chunk);
  });
  expanded.forEach(chunk => {
    const lines = chunk.split("\n").map(l => l.trim()).filter(Boolean);
    let b;
    if (lines.every(l => /^>\s?/.test(l))) b = { kind: "callout", text: lines.map(l => l.replace(/^>\s?/, "")).join(" ") };
    else if (lines.every(l => /^~/.test(l))) b = { kind: "flow", nodes: lines.map(parseFlowLine) };
    else if (lines.every(l => /^\?\|.*\|$/.test(l))) {
      const rows = lines.map(l => l.slice(2, -1).split("|").map(c => c.trim())).filter(r => !r.every(c => /^:?-+:?$/.test(c)));
      b = { kind: "table", head: rows[0] || [], rows: rows.slice(1) };
    }
    else if (lines.every(l => /^@\s/.test(l))) b = { kind: "team", people: lines.map(l => { const p = l.replace(/^@\s*/, "").split("|").map(x => x.trim()); return { name: p[0] || "", title: p[1] || "", role: p[2] || "" }; }) };
    else if (lines[0].startsWith("## ")) b = { kind: "h", text: lines[0].slice(3).trim(), rest: lines.slice(1).join(" ") };
    else if (lines.every(l => /^\d+[.)]\s/.test(l))) b = { kind: "steps", items: lines.map(l => l.replace(/^\d+[.)]\s/, "")) };
    else if (lines.every(l => /^[-•]\s/.test(l))) b = { kind: "list", items: lines.map(l => l.replace(/^[-•]\s/, "")) };
    else if (lines.every(l => /^\|.*\|$/.test(l))) {
      const rows = lines.map(l => l.slice(1, -1).split("|").map(c => c.trim())).filter(r => !r.every(c => /^:?-+:?$/.test(c)));
      b = { kind: "columns", head: rows[0] || [], rows: rows.slice(1) };
    }
    else b = { kind: "p", text: lines.join(" ") };
    if (b.text === undefined) b.text = blockText(b);
    b.src = lines.join("\n");
    b.id = "b" + hashText(b.kind + "|" + normText(blockText(b)));
    out.push(b);
  });
  /* two identical blocks in one card would share an id; suffix the later ones */
  const seen = {};
  out.forEach(b => { if (seen[b.id]) { seen[b.id]++; b.id += "-" + seen[b.id]; } else seen[b.id] = 1; });
  return out;
}
/* Flow diagram lines:  "~ [Actor] Stage :: note"  a stage;  "~? Question :: yes → A / no → B"  a decision;
   "~| [Actor] A || [Actor] B"  work in parallel;  "~> A || B || C"  a fan-out of possible paths;  "~= Throughout: …"  a band of continuous work. */
function parseFlowLine(l) {
  const m = /^~([?|>=]?)\s*(.*)$/.exec(l);
  const kind = { "?": "decision", "|": "parallel", ">": "fanout", "=": "band" }[m[1]] || "stage";
  const item = s => { const a = /^\[([^\]]*)\]\s*(.*)$/.exec(s.trim()); const rest = a ? a[2] : s.trim(); const parts = rest.split("::").map(x => x.trim()); return { actor: a ? a[1].trim() : "", label: parts[0] || "", note: parts.slice(1).join(" :: ") }; };
  if (kind === "parallel" || kind === "fanout") return { kind, items: m[2].split("||").map(item).filter(x => x.label) };
  if (kind === "decision") { const parts = m[2].split("::"); const opts = (parts[1] || "").split("/").map(x => x.trim()).filter(Boolean).map(o => { const oo = o.split(/→|->/).map(x => x.trim()); return { answer: oo[0] || "", to: oo.slice(1).join(" → ") }; }); return { kind, label: (parts[0] || "").trim(), options: opts }; }
  return Object.assign({ kind }, item(m[2]));
}
export function flowText(b) {
  return (b.nodes || []).map(n => n.items ? n.items.map(i => [i.actor, i.label, i.note].filter(Boolean).join(" · ")).join(" | ") : n.options ? [n.label].concat(n.options.map(o => o.answer + " → " + o.to)).join(" · ") : [n.actor, n.label, n.note].filter(Boolean).join(" · ")).join("\n");
}
/* the plain text a block shows, used for quoting and anchor checks */
export function blockText(b) {
  if (!b) return "";
  if (b.kind === "flow") return flowText(b);
  if (b.kind === "team") return (b.people || []).map(p => [p.name, p.title, p.role].filter(Boolean).join(" · ")).join("\n");
  if (b.kind === "steps" || b.kind === "list") return (b.items || []).join("\n");
  if (b.kind === "columns" || b.kind === "table") return [b.head || []].concat(b.rows || []).map(r => r.join(" | ")).join("\n");
  if (b.kind === "h") return [b.text, b.rest].filter(Boolean).join("\n");
  return b.text || "";
}
const stripInline = s => String(s || "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1");
export function cardPlainText(card, lang) { return parseBlocks(card[cardBodyKey(card, lang)]).map(b => stripInline(blockText(b))).join("\n"); }

export function emptyReview(o) {
  o = o || {};
  return { id: o.id || uid(), title: o.title || "", subtitle: o.subtitle || "", author: o.author || "Uzziel Tamon", reader: o.reader || "", date: o.date || new Date().toISOString().slice(0, 10), lang: o.lang === "fr" ? "fr" : "en",
    intro: o.intro || "", closing: o.closing || "", status: "Draft", cards: o.cards || [], revisions: [], feedback: [], created: Date.now(), updated: Date.now() };
}
export function normalizeReview(r) {
  r = r && typeof r === "object" ? r : {};
  const cards = (Array.isArray(r.cards) ? r.cards : []).filter(c => c && typeof c === "object").map(c => ({ id: str(c.id || uid()), section: str(c.section), title: str(c.title), body: str(c.body), sectionFr: str(c.sectionFr), titleFr: str(c.titleFr), bodyFr: str(c.bodyFr), notes: str(c.notes), layout: oneOf(LAYOUTS, c.layout, "article"), visual: /^[1-6]$/.test(String(c.visual || "")) ? String(c.visual) : "", figure: /^[1-6]$/.test(String(c.figure || "")) ? String(c.figure) : "" }));
  const revisions = (Array.isArray(r.revisions) ? r.revisions : []).filter(x => x && typeof x === "object").map((x, i) => ({
    id: str(x.id || uid()), n: num(x.n, i + 1), publishedAt: str(x.publishedAt), expires: str(x.expires), disabled: !!x.disabled, token: str(x.token), by: str(x.by),
    snapshot: x.snapshot && typeof x.snapshot === "object" ? x.snapshot : null
  }));
  const feedback = (Array.isArray(r.feedback) ? r.feedback : []).filter(x => x && typeof x === "object").map(x => ({
    id: str(x.id || uid()), revision: str(x.revision), card: str(x.card), block: str(x.block), kind: oneOf(FEEDBACK_KINDS, x.kind, "comment"),
    quote: str(x.quote).slice(0, LIMITS.quote), start: num(x.start, -1), end: num(x.end, -1), context: str(x.context).slice(0, LIMITS.context),
    suggestion: str(x.suggestion).slice(0, LIMITS.suggestion), text: str(x.text).slice(0, LIMITS.text), name: str(x.name).slice(0, LIMITS.name), submission: str(x.submission),
    lang: x.lang === "fr" ? "fr" : x.lang === "en" ? "en" : "",
    row: Number.isInteger(x.row) && x.row >= 0 ? x.row : -1,
    item: x.item && typeof x.item === "object" && Number.isInteger(x.item.list) && Number.isInteger(x.item.index) && x.item.list >= 0 && x.item.index >= 0 ? { list: x.item.list, index: x.item.index } : null,
    state: oneOf(FEEDBACK_STATES, x.state, "Open"), links: { step: str(x.links && x.links.step), question: str(x.links && x.links.question) }, note: str(x.note),
    applied: x.applied && typeof x.applied === "object" ? { at: num(x.applied.at, 0), before: str(x.applied.before), after: str(x.applied.after), card: str(x.applied.card), lang: str(x.applied.lang) } : null,
    created: num(x.created, Date.now())
  }));
  const status = oneOf(REVIEW_STATUS, r.status, revisions.length ? "Published" : "Draft");
  return { id: str(r.id || uid()), title: str(r.title), subtitle: str(r.subtitle), author: str(r.author), date: str(r.date), lang: r.lang === "fr" ? "fr" : "en", intro: str(r.intro), closing: str(r.closing),
    titleFr: str(r.titleFr), subtitleFr: str(r.subtitleFr), introFr: str(r.introFr), closingFr: str(r.closingFr), reader: str(r.reader).slice(0, 120),
    code: str(r.code).toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 24),
    status, cards, revisions, feedback, draftAt: num(r.draftAt, 0), created: num(r.created, Date.now()), updated: num(r.updated, Date.now()) };
}
/* French text exists when at least one page carries it */
export function hasFrench(review) { return (review.cards || []).some(c => (c.bodyFr || "").trim() || (c.titleFr || "").trim()); }
/* the fields a page shows in one language; a page without French falls back to its English text so the switch never hides a page */
export function cardIn(card, lang) {
  if (lang === "fr") return { id: card.id, section: card.sectionFr || card.section, title: card.titleFr || card.title, body: card.bodyFr || card.body, layout: card.layout, visual: card.visual, figure: card.figure };
  return { id: card.id, section: card.section, title: card.title, body: card.body, layout: card.layout, visual: card.visual, figure: card.figure };
}
export function reviewIn(review, lang) {
  if (lang === "fr") return { title: review.titleFr || review.title, subtitle: review.subtitleFr || review.subtitle, intro: review.introFr || review.intro, closing: review.closingFr || review.closing };
  return { title: review.title, subtitle: review.subtitle, intro: review.intro, closing: review.closing };
}
/* which language a piece of feedback was written in; older feedback without one belongs to the review's default language */
export function feedbackLang(review, fb) { return fb.lang || review.lang || "en"; }
export function cardBodyKey(card, lang) { return lang === "fr" && (card.bodyFr || "").trim() ? "bodyFr" : "body"; }

/* Everything the guest may see, and nothing else. Built from the draft at publish time and frozen. */
function sectionsIn(review, lang) {
  const sections = [];
  review.cards.forEach(raw => {
    const c = cardIn(raw, lang);
    const name = c.section || "";
    let s = sections.find(x => x.title === name);
    if (!s) { s = { id: "s" + hashText(name), title: name, cards: [] }; sections.push(s); }
    s.cards.push({ id: c.id, title: c.title, layout: LAYOUTS.indexOf(c.layout) !== -1 ? c.layout : "article", visual: c.visual || "", figure: c.figure || "", blocks: parseBlocks(c.body).map(b => ({ id: b.id, kind: b.kind, text: b.text || "", rest: b.rest || "", items: b.items || [], head: b.head || [], rows: b.rows || [], nodes: b.nodes || [], people: b.people || [] })) });
  });
  return sections;
}
/* The default language sits at the top level (older snapshots have only that); the other language, when the review carries it, sits under `alt`. */
export function snapshotOf(review, pilot, n) {
  const lang = review.lang, main = reviewIn(review, lang);
  const snap = { reviewId: review.id, revision: n, pilot: pilot ? pilot.name : "", title: main.title, subtitle: main.subtitle, author: review.author, date: review.date, lang, intro: main.intro, closing: main.closing, sections: sectionsIn(review, lang), alt: null };
  const other = lang === "fr" ? "en" : "fr";
  if (other === "fr" ? hasFrench(review) : review.cards.some(c => (c.body || "").trim())) {
    const o = reviewIn(review, other);
    snap.alt = { lang: other, title: o.title, subtitle: o.subtitle, intro: o.intro, closing: o.closing, sections: sectionsIn(review, other) };
  }
  return snap;
}
export function snapshotLangs(snap) { return snap ? [snap.lang].concat(snap.alt ? [snap.alt.lang] : []) : []; }
export function snapshotIn(snap, lang) { return snap && snap.alt && lang && snap.alt.lang === lang ? snap.alt : snap; }
export function snapshotCards(snap, lang) { const s = snapshotIn(snap, lang); return (s && s.sections ? s.sections : []).reduce((a, x) => a.concat(x.cards), []); }
export function snapshotBlock(snap, cardId, blockId, lang) {
  const c = snapshotCards(snap, lang).find(x => x.id === cardId);
  if (!c) return null;
  return c.blocks.find(b => b.id === blockId) || null;
}

export function revisionOpen(rev, now) {
  if (!rev || rev.disabled) return false;
  if (rev.expires && rev.expires < new Date(now || Date.now()).toISOString().slice(0, 10)) return false;
  return true;
}
export function currentRevision(review) { return review.revisions.length ? review.revisions[review.revisions.length - 1] : null; }

/* Where a piece of feedback stands against the CURRENT draft: the quoted passage is still there, or it is not. */
export function anchorStatus(review, fb) {
  if (fb.kind === "finish") return "n/a";
  const card = review.cards.find(c => c.id === fb.card);
  if (!card) return "card missing";
  if (!fb.quote) return "page";
  const text = cardPlainText(card, feedbackLang(review, fb));
  const q = normText(fb.quote);
  const hay = normText(text);
  const idx = hay.indexOf(q);
  if (idx === -1) return "changed";
  return hay.indexOf(q, idx + 1) === -1 ? "intact" : "ambiguous";
}
/* Put a suggested correction into the draft, once, and keep the trace on the feedback. Never touches published revisions. */
export function applySuggestion(review, fb, now) {
  if (fb.kind !== "suggestion" || !fb.suggestion) return { ok: false, error: "Nothing to apply." };
  const card = review.cards.find(c => c.id === fb.card);
  if (!card) return { ok: false, error: "The page this was written on is no longer in the draft." };
  const q = str(fb.quote);
  const key = cardBodyKey(card, feedbackLang(review, fb));
  const count = q ? card[key].split(q).length - 1 : 0;
  if (count !== 1) return { ok: false, error: count === 0 ? "The quoted passage is not in the current draft as written. Edit the page by hand." : "The passage appears more than once. Edit the page by hand." };
  card[key] = card[key].replace(q, fb.suggestion);
  fb.state = "Applied";
  fb.applied = { at: now || Date.now(), before: q, after: fb.suggestion, card: card.id, lang: key === "bodyFr" ? "fr" : "en" };
  review.updated = now || Date.now(); review.draftAt = review.updated;
  return { ok: true };
}

/* Counts for the pilot list. `finished` is the finish record for the CURRENT revision only; `finishedEarlier` says an older revision was finished. */
export function feedbackCounts(review) {
  const cur = currentRevision(review);
  const open = review.feedback.filter(f => f.kind !== "finish" && (f.state === "Open" || f.state === "In discussion")).length;
  const finishes = review.feedback.filter(f => f.kind === "finish");
  const onCurrent = finishes.filter(f => cur && f.revision === cur.id);
  const earlier = finishes.filter(f => !cur || f.revision !== cur.id);
  return { open, total: review.feedback.filter(f => f.kind !== "finish").length, finished: onCurrent.length ? onCurrent[onCurrent.length - 1] : null, finishedEarlier: earlier.length ? earlier[earlier.length - 1] : null };
}

/* Validate one guest submission against a frozen snapshot. Returns { ok, error } or { ok, feedback }. */
export function validateSubmission(body, rev, now) {
  body = body && typeof body === "object" ? body : {};
  const kind = oneOf(FEEDBACK_KINDS, body.kind, "");
  if (!kind) return { ok: false, error: "Unknown feedback kind." };
  const submission = str(body.submission).slice(0, 60);
  if (!/^[A-Za-z0-9_-]{8,60}$/.test(submission)) return { ok: false, error: "A submission id is required." };
  const name = str(body.name).trim().slice(0, LIMITS.name);
  const text = str(body.text).trim();
  const suggestion = str(body.suggestion).trim();
  const quote = str(body.quote).trim();
  if (text.length > LIMITS.text || suggestion.length > LIMITS.suggestion || quote.length > LIMITS.quote) return { ok: false, error: "That is longer than this form accepts." };
  const langs = snapshotLangs(rev.snapshot);
  const lang = langs.indexOf(body.lang) !== -1 ? body.lang : (rev.snapshot && rev.snapshot.lang) || "en";
  const fb = { id: uid(), revision: rev.id, card: "", block: "", row: -1, kind, quote: "", start: -1, end: -1, context: "", suggestion: "", text: "", name, submission, lang, state: "Open", links: { step: "", question: "" }, note: "", applied: null, created: now || Date.now() };
  if (kind === "finish") return { ok: true, feedback: fb };
  const card = snapshotCards(rev.snapshot, lang).find(c => c.id === str(body.card));
  if (!card) return { ok: false, error: "That page is not part of this review." };
  fb.card = card.id;
  if (body.block) {
    const block = card.blocks.find(b => b.id === str(body.block));
    if (!block) return { ok: false, error: "That passage is not part of this page." };
    fb.block = block.id;
    fb.quote = quote; fb.start = num(body.start, -1); fb.end = num(body.end, -1); fb.context = str(body.context).slice(0, LIMITS.context);
    if (body.row !== undefined && body.row !== null && body.row !== -1) {
      const row = Number(body.row);
      if (block.kind !== "table" || !Number.isInteger(row) || row < 0 || row >= block.rows.length) return { ok: false, error: "That line is not part of this table." };
      fb.row = row; fb.quote = block.rows[row].join(" · ").slice(0, LIMITS.quote);
    }
  }
  if (kind === "suggestion") {
    if (!fb.quote) return { ok: false, error: "Select the passage to correct first." };
    if (!suggestion) return { ok: false, error: "Write the wording you would prefer." };
    fb.suggestion = suggestion; fb.text = text;
  } else {
    if (!text) return { ok: false, error: "Write something first." };
    fb.text = text;
  }
  return { ok: true, feedback: fb };
}

/* The Cabinet M draft, from the approved five-page English document, split into ten short cards. */
export function cabinetMDraft() {
  const S1 = "Start here", S2 = "How a matter moves", S3 = "How the team works", S4 = "Where work is difficult", S5 = "What we should clarify";
  const d = emptyReview({
    title: "Le Cabinet M", subtitle: "What I understand about your business so far", author: "Uzziel Tamon", lang: "en",
    intro: "This is what I understand about your business so far. I will update it after each weekly visit as we learn more together. You can leave a comment anywhere to correct or add something.",
    closing: "Once we have corrected this picture together, we can choose the improvements that best fit the way your firm works. Thank you for taking the time.",
    cards: [
      { id: "c1", section: S1, title: "Why I prepared this", layout: "visual", visual: "1", body: "Sarah, after our conversations and the time spent with your team, I wanted to put my understanding in one place. This is the picture I have so far, with a few questions we can go through when we next meet.\n\n> How to use this: read each short page, highlight anything that is wrong or incomplete, and tell me what should change. A whole-page comment works too. What you write comes back to me before our next meeting; nothing is shared further.\n\nI have kept “my understanding” and “to confirm” wording wherever I am not sure. Those are the places where your correction matters most." },
      { id: "c2", section: S1, title: "The business and the people you help", layout: "article", figure: "2", body: "## Clients arrive with a problem. Your team looks at the whole matter.\nA client may contact you because benefits have stopped, a condition has been refused, or a decision does not seem right. They may not know what else needs attention in their file.\n\nYour team obtains the records, reconstructs the history, checks the decisions, and identifies the steps needed to protect the client’s interests. That review can uncover issues or potential entitlements beyond the reason the client first called.\n\nMost of our discussions have focused on CNESST, SAAQ, and IVAC matters. We also discussed insurance, Retraite Québec, civil liability, and medical liability. I would like to clarify how those parts of the practice differ.\n\nEach matter has an assigned legal technician, with lawyer supervision. Some periods involve substantial preparation; others involve waiting for records, a decision, or the next development. Around that legal work, the firm keeps appointments, client communication, payments, and follow-ups moving. New inquiries come through the website, phone, and email, supported in part by Google, Facebook, and radio advertising.\n\n> The goal I heard from you: give the team more capacity without having to continually add people as the workload grows." },
      { id: "c11", section: S2, title: "A matter, from first contact to the end", layout: "article", figure: "", notes: "Sources (09-10 = Sarah-Jeanne transcript, clips IMG_7928/7929; 09-08 = visit transcript, clips IMG_1246-1249; 05-14 = Amélie discovery; 05-20 = Sarah discovery). Channels 09-10 IMG_7928 00:00:09-00:01:00, 00:20:39-00:20:56 · Caroline callback within 24 h, minimal triage 00:04:00-00:05:07, 00:06:31-00:06:56 · intake rota 00:01:29-00:02:17, 00:05:58-00:06:26 · screening question 00:01:56-00:02:17 · consultation ~15 min 00:02:52-00:03:09, 00:12:04-00:12:42 · client decides 00:12:31-00:12:42 · opening instructions and assignment 00:11:23-00:11:52, 00:17:47-00:18:05; IMG_1249 00:20:03-00:20:28 · agreement and procurations 00:11:52-00:15:39 · signature + first payment gate 00:18:16-00:19:21 · opening in Juris 00:21:26-00:23:34 · agency stream 00:23:34-00:23:58; IMG_1249 00:20:30-00:21:47, 00:29:42-00:30:30 · medical stream 00:24:58-00:28:50; IMG_1249 00:24:14-00:26:19, 00:31:27-00:32:25 · sorting/scanning IMG_1246 00:02:44-00:03:09; IMG_1247 00:20:20-00:21:41, 00:54:35-00:55:24 · analysis in pairs, deadlines by hand IMG_1247 00:01:45-00:05:13, 01:02:00-01:02:21; IMG_1249 00:33:07-00:33:30 · lawyer review 09-10 00:24:03-00:24:10, 01:00:55-01:01:21 · paths 00:59:10-00:59:49, 01:04:30-01:05:57; 05-20 00:02:38-00:06:58, 00:48:46-00:48:55, 00:07:00-00:14:12; IMG_7929 00:00:00-00:02:50 · throughout: IMG_1246 00:09:45-00:09:53; 05-20 00:53:22-00:53:50; IMG_6775 00:24:14; 09-10 00:35:04-00:36:01 · closure not covered: 09-10 00:37:00-00:37:16, 00:44:24-00:45:06.", body: "This is the path of one client matter as I have seen it, from the first call to the end. Each box says who does the work today. The question marks are the points where the path splits.\n\n~ [Client] A request arrives :: website form, a call to reception, or an email to Sarah\n~ [Caroline] Callback booked within 24 hours :: only clearly out-of-scope requests are turned away\n~ [Intake person of the day] Screening call :: Amélie Monday and Friday, Maxime Tuesday, Laurence Wednesday, Claudie Thursday\n~? Within the firm's services, with something to do? :: yes → a consultation is booked with Sarah / no → no consultation (how the client is told: to confirm)\n~ [Sarah] Consultation, about 15 minutes :: what can be done, what it costs, how long it takes\n~? Does the client go ahead? :: yes → opening instructions for Caroline / not yet → the client thinks it over\n~ [Caroline] Fee agreement and procurations :: filled from the shared templates, sent for electronic signature\n~? Signed agreement and first payment received? :: yes → the file is opened / no → follow-up; some never sign\n~ [Caroline] File opened in JurisEvolution :: technician assigned by Sarah, first tasks created, confirmation sent\n~| [Technician] Agency or insurer file :: request with the procuration; the file arrives about a month later, unsorted || [Caroline] Medical records :: RAMQ record, one request per establishment, follow-ups; some take months\n~ [Technician with the front desk] Receipt, sorting, scanning :: piles by type, key reports labelled, filed under the same names as the summary\n~ [Technician with Amélie] Initial analysis, in pairs :: case summary filled in, decisions and contestations paired, deadlines entered by hand\n~ [Sarah] Review of the proposed actions :: and of most outgoing letters\n~> Ongoing support and waiting || Request for a decision || Contestation and revision || Chronology and expert mandate || Negotiation or settlement || Hearing and tribunal file\n~= Throughout: the summary kept up to date, client communication, deadline reminders, payments and collections\n~ [To complete with you] Settlement, final billing, closure :: not covered in our conversations yet\n\n> To confirm: what happens to a request the screening call turns down, the usual length of that call, and everything from settlement to closure." },
      { id: "c3", section: S2, title: "First contact", body: "## 1. Understand the request\nThe first conversation helps establish whether the request fits the firm’s services. Sarah then discusses the potential work and fees.\n\n1. A request arrives through the website, by phone, or by email.\n2. Caroline coordinates the callback.\n3. The person covering intake screens the request.\n4. Consultation with Sarah.\n\nCalls are grouped into designated windows to protect the team’s working day.\n\n> To confirm: the usual length of an intake call, and how urgent requests or checks before accepting a mandate fit into this sequence." },
      { id: "c4", section: S2, title: "Opening and requesting records", body: "## 2. Open the file\nSarah’s instructions, then the agreement and procurations, then signatures and initial payment, then the formal opening. Caroline prepares the documents and follows up. The opening includes the client details, payment arrangements, the assigned technician, and initial tasks for the team and Sarah.\n\n## 3. Obtain the records: two streams in parallel\n\n| Agency or insurer | Medical providers |\n| Notify it that the firm represents the client. Request its file and future correspondence. | Use the client’s information and RAMQ history to identify relevant providers. Request records for the appropriate periods with signed authorizations. |\n\nThese requests move in parallel because external delays can be long." },
      { id: "c5", section: S2, title: "Review and next legal steps", body: "## 4. Build the action plan\n1. Classify the records.\n2. Review the decisions and the medical information.\n3. Identify gaps and deadlines.\n4. The lawyer reviews the proposed actions.\n\nThe path then depends on the matter: ongoing support, a request for a decision, a contestation, an expert opinion, negotiation, or a hearing. New evidence can change the plan. Not every file follows every path.\n\n> Throughout: the team updates the case summary, communicates with the client, tracks deadlines, and follows payments.\n\n*The steps from resolution through final billing and closure are a part of the picture I still need to complete with you.*" },
      { id: "c6", section: S3, title: "The team, as I understand it", layout: "article", figure: "", notes: "Roster verified in the transcripts. Sarah-Jeanne: 'Laurence est l’autre avocate mais elle travaille comme moi' 09-10 IMG_7928 00:56:31; consultations 00:01:56; assigns 09-08 IMG_1249 00:20:26; reviews letters 09-10 01:01:02; expertises 01:05:15; tribunal table IMG_7929 00:00:22; supervises 05-14 IMG_6774 00:00:30. Laurence: avocate 09-10 00:56:31; same files 00:56:50; no consultations yet 00:56:56; tribunal comparison 01:03:19, IMG_7929 00:05:42; Wednesday 13-15 h 00:06:08, 00:06:50. Amélie Auger: title never stated by the firm (paralegal per Uzziel; 'A-U-G-E-R' 05-14 00:40:03); analysis with each technician 09-08 IMG_1247 01:02:00-01:02:14; chronology 05-14 00:11:01, 05-20 00:00:12; exhibits IMG_7929 00:01:39; Monday/Friday 09-10 00:06:16-00:06:21. Claudie: 'Claudie, qui est la technicienne juridique' 09-10 00:22:18-00:22:24, 00:22:48; orders IVAC file 00:23:53; pre-classes 09-08 IMG_1246 00:03:43; ~80 files IMG_1249 00:19:47; Thursday 00:05:58; spelled Claudine by Uzziel and in the 09-08 header. Maxime: 'la technicienne… Claudie ou Maxime ou Alicia' 09-08 IMG_1249 00:20:14; administrators 09-10 00:44:39; Tuesday 00:06:03. Alicia: 'Alicia, la technicienne, va faire les mémos d’expertise' 09-10 01:05:46; not on the intake rota. Caroline: 'Caroline, à l’adjointe' 00:11:23, 'Caro, l’adjointe' 00:12:42; reception 00:00:40-00:04:04; info box and callbacks 00:04:04-00:04:43; agreements/procurations 00:11:52-00:12:57; opening 00:18:16; invoices/payments 00:22:24-00:22:38; RAMQ 00:25:02; record letters 00:26:00-00:27:22; reminders 00:35:28-00:35:57. Unnamed colleague who orders/scans medical documents 09-08 IMG_1247 00:20:41-00:23:54 (to clarify). Headcount statements to reconcile: 'trois techniciennes juridiques' 09-10 00:01:29 vs four file administrators 00:44:39.", body: "Everyone I have met or heard about, with the title I was given. Where I was never told a title, it says so.\n\n@ Sarah-Jeanne Dubé Mercure | Avocate, owner of the firm | Does every new-client consultation, assigns each file, supervises the legal steps, reviews most letters, decides on expertises, prepares and pleads hearings.\n@ Laurence | Avocate | Works the same files as Sarah; covers the screening calls on Wednesday afternoons; prepares tribunal tables; no new-client consultations yet.\n@ Amélie Auger | Technicienne juridique (title to confirm) | Does the initial analysis with each technician; builds medical chronologies; prepares exhibits; screening calls on Mondays and Fridays.\n@ Claudie | Technicienne juridique | Responsible for her own files: orders the agency file, sorts and pre-classes it, writes requests to the agencies; screening calls on Thursdays.\n@ Maxime | Technicienne (title to confirm) | Responsible for her own files; screening calls on Tuesdays.\n@ Alicia | Technicienne | Responsible for her own files; prepares the expert memos with the questions, the chronology and the documents.\n@ Caroline | Adjointe, at reception | Handles the info mailbox and books the callbacks; prepares fee agreements and procurations; opens files, invoices and enters payments; orders the RAMQ record and writes the record requests; sends the payment reminders.\n\n> To confirm: Claudie or Claudine; Amélie’s and Maxime’s exact titles; whether Alicia takes screening calls; whether someone other than Caroline covers reception and scanning; who steps in when someone is away." },
      { id: "c7", section: S3, title: "Three working documents and supporting tools", body: "## Three working documents serve different purposes\n- **The case summary (sommaire de dossier):** the living overview of the matter, its decisions, important developments, and next steps.\n- **The medical chronology:** the relevant medical history, with source references, used particularly when preparing an expert mandate.\n- **The tribunal reference table:** the guide to the tribunal bundle and additional exhibits, with the correct document and page references.\n\nAn expert package needs a chronology that matches the documents actually sent. Tribunal preparation involves identifying missing material and the lawyer deciding what should be filed.\n\n## The tools supporting this work\n**JurisEvolution** holds the matters, documents, tasks, and billing. **SharePoint** holds shared templates and facility contacts. **Word and Adobe Pro** support document preparation and signatures; **Outlook** supports email and calendars. **Teams/Copilot and ChatGPT Business** help with conversations, drafting, and summaries." },
      { id: "c12", section: S4, title: "Where the work is heaviest today", layout: "article", figure: "", notes: "Bottlenecks from the reviewed problem list (scratch cabinetm-problems-2026-09-15.md), each with transcript pointers: handoffs 09-10 IMG_7928 00:02:36, 00:01:20, 00:07:45 · procurations 09-10 00:15:08, 00:15:39 · records requests 09-10 00:26:00, 00:26:41; 09-08 IMG_1249 00:31:39, 00:31:45 · unsorted agency file and joint analysis 09-08 IMG_1247 00:20:24, 00:04:44; IMG_1249 00:33:14 · chronology 05-14 00:10:44; 05-20 00:29:46; 05-26 00:29:31; 06-11 00:21:37 · tribunal comparison 05-20 00:08:20, 00:11:22, 00:49:19; 09-10 IMG_7929 00:02:24 · payments and notices 09-10 00:19:08, 00:35:43, 00:37:11 · lawyer review and reminders 09-10 IMG_7928 01:01:11, 01:01:53; 07-08 00:13:55.", body: "Each point names the work done by hand today and what it costs. These are what I heard and saw; nothing here is a proposal yet.\n\n- **Getting a request to you takes several handoffs.** Reception emails a call window, the person on intake calls back, then books the consultation. Days can pass before you hear about a case.\n- **The same client details are typed into the agreement and each procuration.** Openings are slower, identity data is retyped many times, and nothing can be ordered until everything is signed.\n- **Medical records are requested one establishment at a time.** Reading the RAMQ sheet, finding how each place accepts requests, one letter each, then the follow-ups. Some records take months to arrive.\n- **Agency files arrive unsorted and are read in full, in pairs.** Piles sorted by hand, then the summary and every deadline typed into JurisEvolution, in one joint session a week.\n- **A medical chronology is built by hand, three to six hours each.** Every report read, dated and cited in a Word table; duplicates removed by eye; page references redone when pages are pulled.\n- **Tribunal bundles are compared to your records document by document.** Hours of lawyer time right before a hearing, and many bundles are never analysed for lack of time.\n- **Payments and notices are followed one client at a time.** Interac transfers accepted by hand, reminders emailed individually, and no ready list of current clients to write to.\n- **Most outgoing letters wait for your review, and follow-ups run on reminders you set yourself.** Work stalls when you or the assigned technician is away.\n\n> To confirm: which of these weighs most on the team today, and what has already changed since our visits." },
      { id: "c8", section: S4, title: "Recurring effort and what an improvement must preserve", layout: "article", figure: "4", body: "## Coordinating the first calls\nSeveral exchanges are needed to move a request from reception to the person covering intake and then to Sarah. Appointments need to fit the team’s working windows without leaving scattered gaps in the day.\n\n## Repeating the same administrative work\nOpening a matter means putting the same client details into the agreement and multiple procurations. Medical requests add contact searches, individual letters, attachments, and follow-ups across different facilities and channels.\n\n## Reading, preparing, and comparing records\nThe team works through large files, sometimes with difficult scans or handwriting. Preparing a medical chronology requires identifying complete reports, extracting the relevant information, and preserving reliable page references. Two distinct comparison tasks follow: removing duplicate copies from an expert package, and finding material in the firm’s records that is absent from a tribunal bundle. Both require judgment about meaningful differences between documents.\n\n## Following payments and reaching the right clients\nRecurring card payments already exist, while many clients use monthly Interac transfers. The remaining work includes accepting transfers, checking payments, and sending individual reminders. For service notices, Caroline needs a reliable list of current clients with their email addresses; historical contacts, suppliers, and files open only for collection should not automatically be treated as the same audience.\n\n> What an improvement needs to preserve: assigned responsibility, lawyer review, reliable sources, shared templates, and control over appointment windows. You also raised that showing clients every internal step could create more anxiety and calls; any client-facing information needs to be useful and carefully chosen." },
      { id: "c9", section: S5, title: "Questions for our next meeting", body: "There is no need to answer these by email. I have grouped them here so we can complete the picture together when we meet.\n\n1. **Have I understood the team correctly?** Is this the right division of responsibilities, particularly Amélie’s role in the initial review and Caroline’s administrative scope? Who takes over when someone is unavailable?\n2. **Where does the journey differ?** Which steps change for civil, insurance, Retraite Québec, and the main agency matters? How do urgent requests and the checks before accepting a mandate fit into intake?\n3. **What are the rules behind the recurring work?** What are the usual intake call lengths and booking windows? How do you choose the medical-record period, renew authorizations, and decide when to follow up?\n4. **What happens financially and at the end of a matter?** How do fee arrangements and payment allocation work across different matters? What happens at settlement, final billing, and closure? When does a file become inactive, or remain open only for collection?\n5. **What would make the biggest difference first?** Which part of the work would you most like to make easier? What would tell you and the team that it had improved: fewer follow-ups, less preparation time, fewer scheduling exchanges, or something else?" },
      { id: "c10", section: S5, title: "Closing", layout: "visual-right", visual: "6", body: "If something important is missing from these pages altogether, the comment box on this page is the place to say so.\n\n> Pressing “Finish review” below tells me you have been through the pages. It does not mean you agree with every sentence; the corrections you left are what we will work from.\n\nUzziel" }
    ]
  });
  addCabinetMFrench(d);
  return d;
}

/* The same ten pages in French, from the approved text with the wording of the French comprehension document. */
const FR_SECTIONS = { "Start here": "Pour commencer", "How a matter moves": "Le parcours d’un dossier", "How the team works": "Comment l’équipe travaille", "Where work is difficult": "Là où le travail s’alourdit", "What we should clarify": "Ce que nous devons préciser" };
const FR_CARDS = {
  c1: { title: "Pourquoi j’ai préparé ceci", body: "Sarah, après nos échanges et le temps passé avec votre équipe, j’ai voulu réunir en un seul endroit ce que je comprends de votre cabinet. C’est le portrait que j’en ai pour l’instant, avec quelques questions que nous pourrons passer en revue à notre prochaine rencontre.\n\n> Comment utiliser ces pages : lisez chaque courte page, surlignez ce qui est faux ou incomplet et dites-moi ce qui devrait changer. Un commentaire sur l’ensemble de la page fonctionne aussi. Ce que vous écrivez me revient avant notre prochaine rencontre; rien n’est partagé plus loin.\n\nJ’ai gardé les formulations « ce que je comprends » et « à confirmer » partout où je ne suis pas certain. Ce sont les endroits où votre correction compte le plus." },
  c2: { title: "Le cabinet et les personnes que vous aidez", body: "## Les clients arrivent avec un problème. Votre équipe examine l’ensemble du dossier.\nUn client peut vous contacter parce que des prestations ont cessé, qu’une condition a été refusée ou qu’une décision lui semble injuste. Il ne sait pas toujours ce qui, dans son dossier, demande aussi une attention.\n\nVotre équipe obtient les documents, reconstitue l’historique, vérifie les décisions et détermine les démarches nécessaires pour protéger les intérêts du client. Cette analyse peut faire ressortir des enjeux ou des droits qui dépassent la raison du premier appel.\n\nLa plupart de nos échanges ont porté sur des dossiers CNESST, SAAQ et IVAC. Nous avons aussi abordé les assurances, Retraite Québec, la responsabilité civile et la responsabilité médicale. J’aimerais préciser en quoi ces parties de la pratique diffèrent.\n\nChaque dossier a une technicienne juridique responsable, sous la supervision d’une avocate. Certaines périodes demandent une préparation importante; d’autres consistent à attendre des documents, une décision ou le prochain développement. Autour de ce travail juridique, le cabinet fait avancer les rendez-vous, les communications avec les clients, les paiements et les suivis. Les nouvelles demandes arrivent par le site web, le téléphone et le courriel, soutenues en partie par la publicité sur Google, Facebook et à la radio.\n\n> L’objectif que j’ai entendu de vous : donner plus de capacité à l’équipe sans devoir continuellement ajouter du personnel à mesure que la charge augmente." },
  c11: { title: "Un dossier, du premier contact jusqu’à la fin", body: "Voici le parcours d’un dossier client tel que je l’ai vu, du premier appel jusqu’à la fin. Chaque case dit qui fait le travail aujourd’hui. Les points d’interrogation sont les endroits où le parcours se sépare.\n\n~ [Client] Une demande arrive :: formulaire du site, appel à la réception ou courriel à Sarah\n~ [Caroline] Rappel fixé dans les 24 heures :: seules les demandes clairement hors champ sont écartées\n~ [Personne à la prise en charge du jour] Appel de tri :: Amélie lundi et vendredi, Maxime mardi, Laurence mercredi, Claudie jeudi\n~? Dans le champ du cabinet, avec quelque chose à faire? :: oui → une consultation est fixée avec Sarah / non → pas de consultation (comment le client est informé : à confirmer)\n~ [Sarah] Consultation d’environ 15 minutes :: ce qui peut être fait, ce que ça coûte, combien de temps ça prend\n~? Le client va de l’avant? :: oui → instructions d’ouverture à Caroline / pas encore → le client y réfléchit\n~ [Caroline] Convention d’honoraires et procurations :: remplies à partir des modèles partagés, envoyées pour signature électronique\n~? Convention signée et premier paiement reçus? :: oui → le dossier est ouvert / non → relance; certains ne signent jamais\n~ [Caroline] Dossier ouvert dans JurisEvolution :: technicienne attribuée par Sarah, premières tâches créées, confirmation envoyée\n~| [Technicienne] Dossier de l’organisme ou de l’assureur :: demande avec la procuration; le dossier arrive environ un mois plus tard, en vrac || [Caroline] Dossiers médicaux :: fiche RAMQ, une demande par établissement, relances; certains prennent des mois\n~ [Technicienne avec la réception] Réception, tri, numérisation :: piles par type, rapports clés étiquetés, classés sous les mêmes noms que le sommaire\n~ [Technicienne avec Amélie] Analyse initiale, à deux :: sommaire rempli, décisions et contestations appariées, échéances saisies à la main\n~ [Sarah] Révision des démarches proposées :: et de la plupart des lettres sortantes\n~> Accompagnement et attente || Demande de décision || Contestation et révision || Chronologie et mandat d’expertise || Négociation ou règlement || Audience et dossier du tribunal\n~= Tout au long : sommaire tenu à jour, communications avec le client, rappels d’échéances, paiements et recouvrement\n~ [À compléter avec vous] Règlement, facturation finale, fermeture :: pas encore couvert dans nos échanges\n\n> À confirmer : ce qui arrive à une demande écartée à l’appel de tri, la durée habituelle de cet appel, et tout ce qui va du règlement à la fermeture." },
  c3: { title: "Le premier contact", body: "## 1. Comprendre la demande\nLe premier échange permet d’établir si la demande correspond aux services du cabinet. Sarah discute ensuite du travail envisagé et des honoraires.\n\n1. Une demande arrive par le site web, par téléphone ou par courriel.\n2. Caroline organise le rappel.\n3. La personne qui couvre la prise en charge fait un premier tri.\n4. Consultation avec Sarah.\n\nLes appels sont regroupés dans des plages désignées pour protéger la journée de travail de l’équipe.\n\n> À confirmer : la durée habituelle d’un appel de prise en charge, et la place des demandes urgentes ou des vérifications avant d’accepter un mandat dans cette séquence." },
  c4: { title: "L’ouverture et les demandes de documents", body: "## 2. Ouvrir le dossier\nLes instructions de Sarah, puis la convention et les procurations, puis les signatures et le paiement initial, puis l’ouverture officielle. Caroline prépare les documents et fait les suivis. L’ouverture comprend les renseignements du client, les modalités de paiement, la technicienne responsable et les premières tâches pour l’équipe et Sarah.\n\n## 3. Obtenir les documents : deux démarches en parallèle\n\n| Organisme ou assureur | Établissements médicaux |\n| L’informer que le cabinet représente le client. Demander son dossier et la correspondance à venir. | Utiliser les renseignements du client et la fiche RAMQ pour identifier les établissements pertinents. Demander les documents pour les périodes appropriées, avec les autorisations signées. |\n\nCes demandes avancent en parallèle parce que les délais externes peuvent être longs." },
  c5: { title: "L’analyse et les prochaines étapes juridiques", body: "## 4. Établir le plan d’action\n1. Classer les documents.\n2. Réviser les décisions et l’information médicale.\n3. Repérer les lacunes et les échéances.\n4. L’avocate révise les démarches proposées.\n\nLa suite dépend du dossier : accompagnement, demande de décision, contestation, expertise, négociation ou audience. De nouvelles pièces peuvent modifier le plan. Tous les dossiers ne suivent pas tous les chemins.\n\n> Tout au long du parcours : l’équipe met à jour le sommaire de dossier, communique avec le client, suit les échéances et les paiements.\n\n*Les étapes qui vont du règlement à la facturation finale et à la fermeture font partie du portrait que je dois encore compléter avec vous.*" },
  c6: { title: "L’équipe, telle que je la comprends", body: "Toutes les personnes que j’ai rencontrées ou dont on m’a parlé, avec le titre qu’on m’a donné. Là où on ne m’a jamais dit de titre, c’est indiqué.\n\n@ Sarah-Jeanne Dubé Mercure | Avocate, propriétaire du cabinet | Fait chaque consultation avec les nouveaux clients, attribue chaque dossier, supervise les démarches juridiques, révise la plupart des lettres, décide des expertises, prépare et plaide les audiences.\n@ Laurence | Avocate | Travaille les mêmes dossiers que Sarah; couvre les appels de tri le mercredi après-midi; prépare les tableaux du tribunal; pas encore de consultations avec les nouveaux clients.\n@ Amélie Auger | Technicienne juridique (titre à confirmer) | Fait l’analyse initiale avec chaque technicienne; monte les chronologies médicales; prépare les pièces; appels de tri le lundi et le vendredi.\n@ Claudie | Technicienne juridique | Responsable de ses propres dossiers : commande le dossier de l’organisme, le trie et le préclasse, rédige les demandes aux organismes; appels de tri le jeudi.\n@ Maxime | Technicienne (titre à confirmer) | Responsable de ses propres dossiers; appels de tri le mardi.\n@ Alicia | Technicienne | Responsable de ses propres dossiers; prépare les mémos d’expertise avec les questions, la chronologie et les documents.\n@ Caroline | Adjointe, à la réception | Tient la boîte info et fixe les rappels; prépare les conventions d’honoraires et les procurations; ouvre les dossiers, facture et inscrit les paiements; commande la fiche RAMQ et rédige les demandes de dossiers; envoie les rappels de paiement.\n\n> À confirmer : Claudie ou Claudine; les titres exacts d’Amélie et de Maxime; si Alicia prend des appels de tri; si quelqu’un d’autre que Caroline couvre la réception et la numérisation; qui prend la relève en cas d’absence." },
  c7: { title: "Trois documents de travail et les outils de soutien", body: "## Trois documents de travail répondent à des besoins distincts\n- **Le sommaire de dossier :** la vue d’ensemble vivante du dossier, de ses décisions, des développements importants et des prochaines étapes.\n- **La chronologie médicale :** l’histoire médicale pertinente, avec des références aux sources, utilisée surtout pour préparer un mandat d’expertise.\n- **Le tableau de référence du tribunal :** le guide du dossier du tribunal et des pièces supplémentaires, avec les bonnes références de documents et de pages.\n\nUne expertise a besoin d’une chronologie qui correspond aux documents réellement envoyés. La préparation pour le tribunal consiste à repérer les pièces manquantes, l’avocate décidant ce qui doit être déposé.\n\n## Les outils qui soutiennent ce travail\n**JurisEvolution** contient les dossiers, les documents, les tâches et la facturation. **SharePoint** contient les modèles partagés et les coordonnées des établissements. **Word et Adobe Pro** servent à préparer les documents et aux signatures; **Outlook** au courriel et aux calendriers. **Teams/Copilot et ChatGPT Business** aident pour les conversations, la rédaction et les résumés." },
  c8: { title: "Le travail qui revient et ce qu’une amélioration doit préserver", body: "## Coordonner les premiers appels\nPlusieurs échanges sont nécessaires pour faire passer une demande de la réception à la personne qui couvre la prise en charge, puis à Sarah. Les rendez-vous doivent respecter les plages de travail de l’équipe sans laisser de trous dispersés dans la journée.\n\n## Ressaisir le même travail administratif\nOuvrir un dossier signifie inscrire les mêmes renseignements du client dans la convention et dans plusieurs procurations. Les demandes médicales ajoutent des recherches de coordonnées, des lettres individuelles, des pièces jointes et des suivis auprès d’établissements et de canaux différents.\n\n## Lire, préparer et comparer les documents\nL’équipe travaille dans de gros dossiers, parfois avec des numérisations ou une écriture difficiles à lire. Préparer une chronologie médicale demande de repérer les rapports complets, d’en extraire l’information pertinente et de conserver des références de pages fiables. Deux tâches de comparaison distinctes suivent : retirer les copies en double d’un envoi à l’expert, et trouver dans les documents du cabinet ce qui manque au dossier du tribunal. Les deux demandent du jugement sur les différences qui comptent entre les documents.\n\n## Suivre les paiements et joindre les bons clients\nLes paiements récurrents par carte existent déjà, alors que bien des clients paient par virement Interac mensuel. Il reste à accepter les virements, vérifier les paiements et envoyer des rappels individuels. Pour les avis de service, Caroline a besoin d’une liste fiable des clients actuels avec leurs adresses courriel; les anciens contacts, les fournisseurs et les dossiers ouverts seulement pour le recouvrement ne devraient pas être traités automatiquement comme le même public.\n\n> Ce qu’une amélioration doit préserver : une responsabilité attribuée, la révision par l’avocate, des sources fiables, des modèles partagés et le contrôle des plages de rendez-vous. Vous avez aussi soulevé que montrer aux clients chaque étape interne pourrait créer plus d’inquiétude et d’appels; toute information destinée aux clients doit être utile et choisie avec soin." },
  c9: { title: "Questions pour notre prochaine rencontre", body: "Il n’est pas nécessaire d’y répondre par courriel. Je les ai regroupées ici pour que nous complétions le portrait ensemble lors de notre rencontre.\n\n1. **Ai-je bien compris l’équipe?** Est-ce la bonne répartition des responsabilités, en particulier le rôle d’Amélie dans l’analyse initiale et l’étendue administrative du rôle de Caroline? Qui prend la relève quand quelqu’un n’est pas disponible?\n2. **Où le parcours diffère-t-il?** Quelles étapes changent pour les dossiers civils, d’assurance, de Retraite Québec et des principaux organismes? Comment les demandes urgentes et les vérifications avant d’accepter un mandat s’intègrent-elles à la prise en charge?\n3. **Quelles sont les règles derrière le travail récurrent?** Quelles sont les durées habituelles des appels de prise en charge et les plages de réservation? Comment choisissez-vous la période des documents médicaux, renouvelez-vous les autorisations et décidez-vous du moment des relances?\n4. **Que se passe-t-il sur le plan financier et à la fin d’un dossier?** Comment fonctionnent les conventions d’honoraires et l’affectation des paiements entre les dossiers? Que se passe-t-il au règlement, à la facturation finale et à la fermeture? Quand un dossier devient-il inactif, ou reste-t-il ouvert seulement pour le recouvrement?\n5. **Qu’est-ce qui ferait la plus grande différence en premier?** Quelle partie du travail voudriez-vous rendre plus facile en priorité? Qu’est-ce qui vous indiquerait, à vous et à l’équipe, que c’est amélioré : moins de suivis, moins de temps de préparation, moins d’échanges pour les rendez-vous, ou autre chose?" },
  c12: { title: "Là où le travail pèse le plus aujourd’hui", body: "Chaque point nomme le travail fait à la main aujourd’hui et ce qu’il coûte. C’est ce que j’ai entendu et vu; rien ici n’est encore une proposition.\n\n- **Faire parvenir une demande jusqu’à vous prend plusieurs relais.** La réception envoie une plage d’appel par courriel, la personne à la prise en charge rappelle, puis réserve la consultation. Des jours peuvent passer avant que vous entendiez parler d’un dossier.\n- **Les mêmes renseignements du client sont retapés dans la convention et dans chaque procuration.** L’ouverture est plus lente, les données d’identité sont ressaisies plusieurs fois, et rien ne peut être commandé avant que tout soit signé.\n- **Les dossiers médicaux sont demandés un établissement à la fois.** Lire la fiche RAMQ, trouver comment chaque endroit accepte les demandes, une lettre chacun, puis les suivis. Certains dossiers mettent des mois à arriver.\n- **Les dossiers des organismes arrivent en vrac et sont lus au complet, à deux.** Des piles triées à la main, puis le sommaire et chaque échéance saisis dans JurisEvolution, en une séance commune par semaine.\n- **Une chronologie médicale se fait à la main, trois à six heures chacune.** Chaque rapport lu, daté et cité dans un tableau Word; les doublons retirés à l’œil; les références de pages refaites quand des pages sont retirées.\n- **Les dossiers du tribunal sont comparés à vos documents pièce par pièce.** Des heures d’avocate juste avant une audience, et bien des dossiers ne sont jamais analysés faute de temps.\n- **Les paiements et les avis se suivent un client à la fois.** Les virements Interac acceptés à la main, les rappels envoyés un par un, et pas de liste prête des clients actuels à qui écrire.\n- **La plupart des lettres attendent votre révision, et les suivis reposent sur des rappels que vous placez vous-même.** Le travail s’arrête quand vous ou la technicienne responsable êtes absentes.\n\n> À confirmer : lequel de ces points pèse le plus sur l’équipe aujourd’hui, et ce qui a déjà changé depuis nos visites." },
  c10: { title: "Mot de la fin", body: "Si quelque chose d’important manque tout à fait à ces pages, la boîte de commentaire de cette page est l’endroit pour le dire.\n\n> Appuyer sur « Terminer la relecture » ci-dessous m’indique que vous avez parcouru les pages. Cela ne signifie pas que vous approuvez chaque phrase; les corrections que vous avez laissées sont ce sur quoi nous travaillerons.\n\nUzziel" }
};
export const CABINET_M_FR = { titleFr: "Le Cabinet M", subtitleFr: "Ce que je comprends de votre cabinet jusqu’ici", introFr: "Voici ce que je comprends de votre cabinet jusqu’ici. Je le mettrai à jour après chaque visite hebdomadaire, à mesure que nous apprenons ensemble. Vous pouvez laisser un commentaire n’importe où pour corriger ou ajouter quelque chose.", closingFr: "Une fois ce portrait corrigé ensemble, nous pourrons choisir les améliorations qui conviennent le mieux à la façon dont votre cabinet travaille. Merci d’y consacrer ce temps.", sections: FR_SECTIONS, cards: FR_CARDS };
/* add the French text to a Cabinet M review whose pages keep the seeded ids; pages already carrying French are left alone */
export function addCabinetMFrench(review) {
  const changed = [];
  ["titleFr", "subtitleFr", "introFr", "closingFr"].forEach(k => { if (!(review[k] || "").trim()) { review[k] = CABINET_M_FR[k]; changed.push(k); } });
  review.cards.forEach(c => {
    const fr = FR_CARDS[c.id]; if (!fr) return;
    if (!(c.bodyFr || "").trim()) { c.bodyFr = fr.body; c.titleFr = fr.title; c.sectionFr = FR_SECTIONS[c.section] || c.section; changed.push(c.id); }
  });
  return changed;
}

/* Avatars: initials on a colour that stays the same for a person wherever they appear. A feedback name like
   "Sarah-Jeanne Dubé Mercure" matches the pilot's person "Sarah-Jeanne" by first name. */
const AV_COLOURS = ["#b9657a", "#5f7fa8", "#6f9a6a", "#9a6fb0", "#c07a45", "#4f9a9a", "#7a8a4a"]; /* gold is kept for the author */
const fold = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
export function matchPerson(name, people) {
  const first = fold(name).split(/\s+/)[0];
  if (!first) return null;
  return (people || []).find(p => fold(p.name) === fold(name)) || (people || []).find(p => fold(p.name).split(/\s+/)[0] === first) || null;
}
export function avatarFor(name, opts) {
  opts = opts || {};
  const parts = String(name || "").replace(/\(.*?\)/g, "").trim().split(/\s+/).filter(Boolean);
  const hy = parts.length === 1 ? parts[0].split("-").filter(Boolean) : [];
  const initials = (hy.length > 1 ? hy[0][0] + hy[1][0] : (parts[0] || "?")[0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  if (opts.me) return { initials, colour: "#a8894a", name };
  let h = 0; const key = fold(parts[0] || "");
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return { initials, colour: AV_COLOURS[h % AV_COLOURS.length], name };
}

/* Access codes: an optional second key for a shared link, sent to the reader separately (for example by email).
   Letters and digits only, without look-alikes; stored upper-case, compared upper-case. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function normalizeCode(c) { return String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 24); }
export function newAccessCode() {
  const bytes = new Uint8Array(8); globalThis.crypto.getRandomValues(bytes);
  let s = ""; bytes.forEach(b => { s += CODE_ALPHABET[b % CODE_ALPHABET.length]; });
  return s.slice(0, 4) + "-" + s.slice(4);
}

/* Guest-facing UI strings, by the review's language */
export const UI = {
  en: { start: "Start reading", next: "Next", back: "Back", of: "of", sections: "Sections", comment: "Add a comment", prompt: "Anything to correct or add?", suggest: "Suggest a correction", commentSel: "Comment", original: "Original passage", replacement: "Your wording", why: "Why (optional)", name: "Your name", nameHint: "So I know who wrote this. Remembered on this device only.", send: "Save", sending: "Saving…", saved: "Saved. Thank you.", failed: "Not saved. Check your connection and retry.", retry: "Retry", cancel: "Cancel", finish: "Finish review", finished: "Thank you. I have your comments and will go through the remaining questions with you at our next meeting.", finishNote: "This records that you have been through the pages, not that you agree with every sentence.", pageComment: "Comment on this page", flowAria: "Flow of a client matter, from first contact to the end", lastUpdated: "Last updated", onPage: "On page", revision: "Revision", prepared: "Prepared by", closed: "This link is no longer active.", closedHint: "Ask Uzziel for a fresh one.", cover: "For your review", pending: "waiting to send", yours: "Your comments on this page", unsent: "You have an unsent comment. It stays here until you save or cancel it.", welcomeMeta: "About ten short pages. Read in any order.", answerCol: "Your answer", answerPh: "Correct, add, or explain…", answerSave: "Save", answerSaved: "Saved", answerEdit: "Change my answer", codeTitle: "This link is protected", codeHint: "Enter the access code you received by email.", codeLabel: "Access code", codeOpen: "Open", codeWrong: "That code does not match. Check it and try again.", fbTitle: "Feedback", fbOnPage: "Comments on this page", fbShow: "Show feedback in the pages", fbHide: "Hide feedback in the pages", fbFinished: "finished reading version", fbVersion: "version", fbOther: "written in the other language", fbNone: "No feedback yet.", fbClosed: "closed, not shown", fbAnswers: "answers", langFr: "Français", langEn: "English" },
  fr: { start: "Commencer la lecture", next: "Suivant", back: "Retour", of: "sur", sections: "Sections", comment: "Ajouter un commentaire", prompt: "Quelque chose à corriger ou à ajouter?", suggest: "Proposer une correction", commentSel: "Commenter", original: "Passage original", replacement: "Votre formulation", why: "Pourquoi (facultatif)", name: "Votre nom", nameHint: "Pour que je sache qui a écrit ceci. Mémorisé sur cet appareil seulement.", send: "Enregistrer", sending: "Enregistrement…", saved: "Enregistré. Merci.", failed: "Non enregistré. Vérifiez la connexion et réessayez.", retry: "Réessayer", cancel: "Annuler", finish: "Terminer la relecture", finished: "Merci. J’ai vos commentaires et nous passerons les questions restantes ensemble à notre prochaine rencontre.", finishNote: "Ceci indique que vous avez parcouru les pages, pas que vous approuvez chaque phrase.", pageComment: "Commenter cette page", flowAria: "Parcours d’un dossier client, du premier contact à la fin", lastUpdated: "Dernière mise à jour", onPage: "Sur la page", revision: "Révision", prepared: "Préparé par", closed: "Ce lien n’est plus actif.", closedHint: "Demandez un nouveau lien à Uzziel.", cover: "Pour votre relecture", pending: "en attente d’envoi", yours: "Vos commentaires sur cette page", unsent: "Un commentaire n’est pas envoyé. Il reste ici jusqu’à ce que vous l’enregistriez ou l’annuliez.", welcomeMeta: "Une dizaine de courtes pages. Lisez dans l’ordre que vous voulez.", answerCol: "Votre réponse", answerPh: "Confirmez, corrigez ou expliquez…", answerSave: "Enregistrer", answerSaved: "Enregistré", answerEdit: "Modifier ma réponse", codeTitle: "Ce lien est protégé", codeHint: "Entrez le code d’accès reçu par courriel.", codeLabel: "Code d’accès", codeOpen: "Ouvrir", codeWrong: "Ce code ne correspond pas. Vérifiez-le et réessayez.", fbTitle: "Retours", fbOnPage: "Commentaires sur cette page", fbShow: "Afficher les retours dans les pages", fbHide: "Masquer les retours dans les pages", fbFinished: "a terminé la lecture de la version", fbVersion: "version", fbOther: "écrit dans l’autre langue", fbNone: "Aucun retour pour l’instant.", fbClosed: "fermés, non affichés", fbAnswers: "répond à", langFr: "Français", langEn: "English" }
};

if (typeof window !== "undefined") {
  window.ALIE_REVIEWS = { REVIEW_STATUS, FEEDBACK_STATES, FEEDBACK_KINDS, LAYOUTS, LIMITS, UI, parseBlocks, blockText, cardPlainText, emptyReview, normalizeReview, normalizeCode, newAccessCode, avatarFor, matchPerson, snapshotOf, snapshotCards, snapshotBlock, snapshotLangs, snapshotIn, revisionOpen, currentRevision, anchorStatus, applySuggestion, feedbackCounts, validateSubmission, cabinetMDraft, addCabinetMFrench, hasFrench, cardIn, reviewIn, feedbackLang, hashText };
}
