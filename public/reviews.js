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
    else if (lines[0].startsWith("## ")) b = { kind: "h", text: lines[0].slice(3).trim(), rest: lines.slice(1).join(" ") };
    else if (lines.every(l => /^\d+[.)]\s/.test(l))) b = { kind: "steps", items: lines.map(l => l.replace(/^\d+[.)]\s/, "")) };
    else if (lines.every(l => /^[-•]\s/.test(l))) b = { kind: "list", items: lines.map(l => l.replace(/^[-•]\s/, "")) };
    else if (lines.every(l => /^\|.*\|$/.test(l))) {
      const rows = lines.map(l => l.slice(1, -1).split("|").map(c => c.trim())).filter(r => !r.every(c => /^:?-+:?$/.test(c)));
      b = { kind: "columns", head: rows[0] || [], rows: rows.slice(1) };
    }
    else b = { kind: "p", text: lines.join(" ") };
    if (b.text === undefined) b.text = blockText(b);
    b.id = "b" + hashText(b.kind + "|" + normText(blockText(b)));
    out.push(b);
  });
  /* two identical blocks in one card would share an id; suffix the later ones */
  const seen = {};
  out.forEach(b => { if (seen[b.id]) { seen[b.id]++; b.id += "-" + seen[b.id]; } else seen[b.id] = 1; });
  return out;
}
/* the plain text a block shows, used for quoting and anchor checks */
export function blockText(b) {
  if (!b) return "";
  if (b.kind === "steps" || b.kind === "list") return (b.items || []).join("\n");
  if (b.kind === "columns") return [b.head || []].concat(b.rows || []).map(r => r.join(" | ")).join("\n");
  if (b.kind === "h") return [b.text, b.rest].filter(Boolean).join("\n");
  return b.text || "";
}
const stripInline = s => String(s || "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1");
export function cardPlainText(card, lang) { return parseBlocks(card[cardBodyKey(card, lang)]).map(b => stripInline(blockText(b))).join("\n"); }

export function emptyReview(o) {
  o = o || {};
  return { id: o.id || uid(), title: o.title || "", subtitle: o.subtitle || "", author: o.author || "Uzziel Tamon", date: o.date || new Date().toISOString().slice(0, 10), lang: o.lang === "fr" ? "fr" : "en",
    intro: o.intro || "", closing: o.closing || "", status: "Draft", cards: o.cards || [], revisions: [], feedback: [], created: Date.now(), updated: Date.now() };
}
export function normalizeReview(r) {
  r = r && typeof r === "object" ? r : {};
  const cards = (Array.isArray(r.cards) ? r.cards : []).filter(c => c && typeof c === "object").map(c => ({ id: str(c.id || uid()), section: str(c.section), title: str(c.title), body: str(c.body), sectionFr: str(c.sectionFr), titleFr: str(c.titleFr), bodyFr: str(c.bodyFr), layout: oneOf(LAYOUTS, c.layout, "article"), visual: /^[1-6]$/.test(String(c.visual || "")) ? String(c.visual) : "", figure: /^[1-6]$/.test(String(c.figure || "")) ? String(c.figure) : "" }));
  const revisions = (Array.isArray(r.revisions) ? r.revisions : []).filter(x => x && typeof x === "object").map((x, i) => ({
    id: str(x.id || uid()), n: num(x.n, i + 1), publishedAt: str(x.publishedAt), expires: str(x.expires), disabled: !!x.disabled, token: str(x.token), by: str(x.by),
    snapshot: x.snapshot && typeof x.snapshot === "object" ? x.snapshot : null
  }));
  const feedback = (Array.isArray(r.feedback) ? r.feedback : []).filter(x => x && typeof x === "object").map(x => ({
    id: str(x.id || uid()), revision: str(x.revision), card: str(x.card), block: str(x.block), kind: oneOf(FEEDBACK_KINDS, x.kind, "comment"),
    quote: str(x.quote).slice(0, LIMITS.quote), start: num(x.start, -1), end: num(x.end, -1), context: str(x.context).slice(0, LIMITS.context),
    suggestion: str(x.suggestion).slice(0, LIMITS.suggestion), text: str(x.text).slice(0, LIMITS.text), name: str(x.name).slice(0, LIMITS.name), submission: str(x.submission),
    lang: x.lang === "fr" ? "fr" : x.lang === "en" ? "en" : "",
    state: oneOf(FEEDBACK_STATES, x.state, "Open"), links: { step: str(x.links && x.links.step), question: str(x.links && x.links.question) }, note: str(x.note),
    applied: x.applied && typeof x.applied === "object" ? { at: num(x.applied.at, 0), before: str(x.applied.before), after: str(x.applied.after), card: str(x.applied.card), lang: str(x.applied.lang) } : null,
    created: num(x.created, Date.now())
  }));
  const status = oneOf(REVIEW_STATUS, r.status, revisions.length ? "Published" : "Draft");
  return { id: str(r.id || uid()), title: str(r.title), subtitle: str(r.subtitle), author: str(r.author), date: str(r.date), lang: r.lang === "fr" ? "fr" : "en", intro: str(r.intro), closing: str(r.closing),
    titleFr: str(r.titleFr), subtitleFr: str(r.subtitleFr), introFr: str(r.introFr), closingFr: str(r.closingFr),
    status, cards, revisions, feedback, created: num(r.created, Date.now()), updated: num(r.updated, Date.now()) };
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
    s.cards.push({ id: c.id, title: c.title, layout: LAYOUTS.indexOf(c.layout) !== -1 ? c.layout : "article", visual: c.visual || "", figure: c.figure || "", blocks: parseBlocks(c.body).map(b => ({ id: b.id, kind: b.kind, text: b.text || "", rest: b.rest || "", items: b.items || [], head: b.head || [], rows: b.rows || [] })) });
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
  review.updated = now || Date.now();
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
  const fb = { id: uid(), revision: rev.id, card: "", block: "", kind, quote: "", start: -1, end: -1, context: "", suggestion: "", text: "", name, submission, lang, state: "Open", links: { step: "", question: "" }, note: "", applied: null, created: now || Date.now() };
  if (kind === "finish") return { ok: true, feedback: fb };
  const card = snapshotCards(rev.snapshot, lang).find(c => c.id === str(body.card));
  if (!card) return { ok: false, error: "That page is not part of this review." };
  fb.card = card.id;
  if (body.block) {
    const block = card.blocks.find(b => b.id === str(body.block));
    if (!block) return { ok: false, error: "That passage is not part of this page." };
    fb.block = block.id;
    fb.quote = quote; fb.start = num(body.start, -1); fb.end = num(body.end, -1); fb.context = str(body.context).slice(0, LIMITS.context);
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
    intro: "This is the picture I have of your firm after our conversations and the time spent with your team. It is here to be corrected. Highlight any sentence to suggest better wording, or add a comment on any page. Nothing in it is final, and we will go through the remaining questions together at our next meeting.",
    closing: "Once we have corrected this picture together, we can choose the improvements that best fit the way your firm works. Thank you for taking the time.",
    cards: [
      { id: "c1", section: S1, title: "Why I prepared this", layout: "visual", visual: "1", body: "Sarah, after our conversations and the time spent with your team, I wanted to put my understanding in one place. This is the picture I have so far, with a few questions we can go through when we next meet.\n\n> How to use this: read each short page, highlight anything that is wrong or incomplete, and tell me what should change. A whole-page comment works too. What you write comes back to me before our next meeting; nothing is shared further.\n\nI have kept “my understanding” and “to confirm” wording wherever I am not sure. Those are the places where your correction matters most." },
      { id: "c2", section: S1, title: "The business and the people you help", layout: "article", figure: "2", body: "## Clients arrive with a problem. Your team looks at the whole matter.\nA client may contact you because benefits have stopped, a condition has been refused, or a decision does not seem right. They may not know what else needs attention in their file.\n\nYour team obtains the records, reconstructs the history, checks the decisions, and identifies the steps needed to protect the client’s interests. That review can uncover issues or potential entitlements beyond the reason the client first called.\n\nMost of our discussions have focused on CNESST, SAAQ, and IVAC matters. We also discussed insurance, Retraite Québec, civil liability, and medical liability. I would like to clarify how those parts of the practice differ.\n\nEach matter has an assigned legal technician, with lawyer supervision. Some periods involve substantial preparation; others involve waiting for records, a decision, or the next development. Around that legal work, the firm keeps appointments, client communication, payments, and follow-ups moving. New inquiries come through the website, phone, and email, supported in part by Google, Facebook, and radio advertising.\n\n> The goal I heard from you: give the team more capacity without having to continually add people as the workload grows." },
      { id: "c3", section: S2, title: "First contact", body: "## 1. Understand the request\nThe first conversation helps establish whether the request fits the firm’s services. Sarah then discusses the potential work and fees.\n\n1. A request arrives through the website, by phone, or by email.\n2. Caroline coordinates the callback.\n3. The person covering intake screens the request.\n4. Consultation with Sarah.\n\nCalls are grouped into designated windows to protect the team’s working day.\n\n> To confirm: the usual length of an intake call, and how urgent requests or checks before accepting a mandate fit into this sequence." },
      { id: "c4", section: S2, title: "Opening and requesting records", body: "## 2. Open the file\nSarah’s instructions, then the agreement and procurations, then signatures and initial payment, then the formal opening. Caroline prepares the documents and follows up. The opening includes the client details, payment arrangements, the assigned technician, and initial tasks for the team and Sarah.\n\n## 3. Obtain the records: two streams in parallel\n\n| Agency or insurer | Medical providers |\n| Notify it that the firm represents the client. Request its file and future correspondence. | Use the client’s information and RAMQ history to identify relevant providers. Request records for the appropriate periods with signed authorizations. |\n\nThese requests move in parallel because external delays can be long." },
      { id: "c5", section: S2, title: "Review and next legal steps", body: "## 4. Build the action plan\n1. Classify the records.\n2. Review the decisions and the medical information.\n3. Identify gaps and deadlines.\n4. The lawyer reviews the proposed actions.\n\nThe path then depends on the matter: ongoing support, a request for a decision, a contestation, an expert opinion, negotiation, or a hearing. New evidence can change the plan. Not every file follows every path.\n\n> Throughout: the team updates the case summary, communicates with the client, tracks deadlines, and follows payments.\n\n*The steps from resolution through final billing and closure are a part of the picture I still need to complete with you.*" },
      { id: "c6", section: S3, title: "People and handoffs", layout: "article", figure: "3", body: "## Clear ownership, with review at key points\n- **Caroline and administrative support** coordinate incoming requests, prepare opening documents, follow signatures and payments, and support records administration.\n- **The assigned legal technician** handles the file’s day-to-day work: records, follow-ups, draft communications, tasks, and updates.\n- **Amélie** participates in file work and the initial analysis with the other technicians.\n- **Sarah and Laurence** exercise legal judgment, supervise the work, and prepare matters for resolution or hearing. Sarah also leads the new-client consultations and assignments described in our meetings.\n\nThe September walkthrough showed an initial analysis done together, followed by ongoing work by the assigned technician. Findings and proposed actions go to the lawyer for review. JurisEvolution activities and reminders connect those handoffs.\n\n> To confirm: this division of responsibilities, in particular Amélie’s role in the initial review and Caroline’s administrative scope." },
      { id: "c7", section: S3, title: "Three working documents and supporting tools", body: "## Three working documents serve different purposes\n- **The case summary (sommaire de dossier):** the living overview of the matter, its decisions, important developments, and next steps.\n- **The medical chronology:** the relevant medical history, with source references, used particularly when preparing an expert mandate.\n- **The tribunal reference table:** the guide to the tribunal bundle and additional exhibits, with the correct document and page references.\n\nAn expert package needs a chronology that matches the documents actually sent. Tribunal preparation involves identifying missing material and the lawyer deciding what should be filed.\n\n## The tools supporting this work\n**JurisEvolution** holds the matters, documents, tasks, and billing. **SharePoint** holds shared templates and facility contacts. **Word and Adobe Pro** support document preparation and signatures; **Outlook** supports email and calendars. **Teams/Copilot and ChatGPT Business** help with conversations, drafting, and summaries." },
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
  c3: { title: "Le premier contact", body: "## 1. Comprendre la demande\nLe premier échange permet d’établir si la demande correspond aux services du cabinet. Sarah discute ensuite du travail envisagé et des honoraires.\n\n1. Une demande arrive par le site web, par téléphone ou par courriel.\n2. Caroline organise le rappel.\n3. La personne qui couvre la prise en charge fait un premier tri.\n4. Consultation avec Sarah.\n\nLes appels sont regroupés dans des plages désignées pour protéger la journée de travail de l’équipe.\n\n> À confirmer : la durée habituelle d’un appel de prise en charge, et la place des demandes urgentes ou des vérifications avant d’accepter un mandat dans cette séquence." },
  c4: { title: "L’ouverture et les demandes de documents", body: "## 2. Ouvrir le dossier\nLes instructions de Sarah, puis la convention et les procurations, puis les signatures et le paiement initial, puis l’ouverture officielle. Caroline prépare les documents et fait les suivis. L’ouverture comprend les renseignements du client, les modalités de paiement, la technicienne responsable et les premières tâches pour l’équipe et Sarah.\n\n## 3. Obtenir les documents : deux démarches en parallèle\n\n| Organisme ou assureur | Établissements médicaux |\n| L’informer que le cabinet représente le client. Demander son dossier et la correspondance à venir. | Utiliser les renseignements du client et la fiche RAMQ pour identifier les établissements pertinents. Demander les documents pour les périodes appropriées, avec les autorisations signées. |\n\nCes demandes avancent en parallèle parce que les délais externes peuvent être longs." },
  c5: { title: "L’analyse et les prochaines étapes juridiques", body: "## 4. Établir le plan d’action\n1. Classer les documents.\n2. Réviser les décisions et l’information médicale.\n3. Repérer les lacunes et les échéances.\n4. L’avocate révise les démarches proposées.\n\nLa suite dépend du dossier : accompagnement, demande de décision, contestation, expertise, négociation ou audience. De nouvelles pièces peuvent modifier le plan. Tous les dossiers ne suivent pas tous les chemins.\n\n> Tout au long du parcours : l’équipe met à jour le sommaire de dossier, communique avec le client, suit les échéances et les paiements.\n\n*Les étapes qui vont du règlement à la facturation finale et à la fermeture font partie du portrait que je dois encore compléter avec vous.*" },
  c6: { title: "Les personnes et les passages de relais", body: "## Des responsabilités claires, avec une révision aux moments clés\n- **Caroline et le soutien administratif** organisent les demandes reçues, préparent les documents d’ouverture, suivent les signatures et les paiements et soutiennent l’administration des documents.\n- **La technicienne juridique responsable** s’occupe du quotidien du dossier : documents, suivis, projets de communications, tâches et mises à jour.\n- **Amélie** participe au travail sur les dossiers et à l’analyse initiale avec les autres techniciennes.\n- **Sarah et Laurence** exercent le jugement juridique, supervisent le travail et préparent les dossiers pour le règlement ou l’audience. Sarah mène aussi les consultations avec les nouveaux clients et les attributions décrites lors de nos rencontres.\n\nLa rencontre de septembre a montré une analyse initiale faite à deux, suivie du travail continu de la technicienne responsable. Les constats et les démarches proposées vont à l’avocate pour révision. Les activités et les rappels de JurisEvolution relient ces passages de relais.\n\n> À confirmer : cette répartition des responsabilités, en particulier le rôle d’Amélie dans l’analyse initiale et l’étendue administrative du rôle de Caroline." },
  c7: { title: "Trois documents de travail et les outils de soutien", body: "## Trois documents de travail répondent à des besoins distincts\n- **Le sommaire de dossier :** la vue d’ensemble vivante du dossier, de ses décisions, des développements importants et des prochaines étapes.\n- **La chronologie médicale :** l’histoire médicale pertinente, avec des références aux sources, utilisée surtout pour préparer un mandat d’expertise.\n- **Le tableau de référence du tribunal :** le guide du dossier du tribunal et des pièces supplémentaires, avec les bonnes références de documents et de pages.\n\nUne expertise a besoin d’une chronologie qui correspond aux documents réellement envoyés. La préparation pour le tribunal consiste à repérer les pièces manquantes, l’avocate décidant ce qui doit être déposé.\n\n## Les outils qui soutiennent ce travail\n**JurisEvolution** contient les dossiers, les documents, les tâches et la facturation. **SharePoint** contient les modèles partagés et les coordonnées des établissements. **Word et Adobe Pro** servent à préparer les documents et aux signatures; **Outlook** au courriel et aux calendriers. **Teams/Copilot et ChatGPT Business** aident pour les conversations, la rédaction et les résumés." },
  c8: { title: "Le travail qui revient et ce qu’une amélioration doit préserver", body: "## Coordonner les premiers appels\nPlusieurs échanges sont nécessaires pour faire passer une demande de la réception à la personne qui couvre la prise en charge, puis à Sarah. Les rendez-vous doivent respecter les plages de travail de l’équipe sans laisser de trous dispersés dans la journée.\n\n## Ressaisir le même travail administratif\nOuvrir un dossier signifie inscrire les mêmes renseignements du client dans la convention et dans plusieurs procurations. Les demandes médicales ajoutent des recherches de coordonnées, des lettres individuelles, des pièces jointes et des suivis auprès d’établissements et de canaux différents.\n\n## Lire, préparer et comparer les documents\nL’équipe travaille dans de gros dossiers, parfois avec des numérisations ou une écriture difficiles à lire. Préparer une chronologie médicale demande de repérer les rapports complets, d’en extraire l’information pertinente et de conserver des références de pages fiables. Deux tâches de comparaison distinctes suivent : retirer les copies en double d’un envoi à l’expert, et trouver dans les documents du cabinet ce qui manque au dossier du tribunal. Les deux demandent du jugement sur les différences qui comptent entre les documents.\n\n## Suivre les paiements et joindre les bons clients\nLes paiements récurrents par carte existent déjà, alors que bien des clients paient par virement Interac mensuel. Il reste à accepter les virements, vérifier les paiements et envoyer des rappels individuels. Pour les avis de service, Caroline a besoin d’une liste fiable des clients actuels avec leurs adresses courriel; les anciens contacts, les fournisseurs et les dossiers ouverts seulement pour le recouvrement ne devraient pas être traités automatiquement comme le même public.\n\n> Ce qu’une amélioration doit préserver : une responsabilité attribuée, la révision par l’avocate, des sources fiables, des modèles partagés et le contrôle des plages de rendez-vous. Vous avez aussi soulevé que montrer aux clients chaque étape interne pourrait créer plus d’inquiétude et d’appels; toute information destinée aux clients doit être utile et choisie avec soin." },
  c9: { title: "Questions pour notre prochaine rencontre", body: "Il n’est pas nécessaire d’y répondre par courriel. Je les ai regroupées ici pour que nous complétions le portrait ensemble lors de notre rencontre.\n\n1. **Ai-je bien compris l’équipe?** Est-ce la bonne répartition des responsabilités, en particulier le rôle d’Amélie dans l’analyse initiale et l’étendue administrative du rôle de Caroline? Qui prend la relève quand quelqu’un n’est pas disponible?\n2. **Où le parcours diffère-t-il?** Quelles étapes changent pour les dossiers civils, d’assurance, de Retraite Québec et des principaux organismes? Comment les demandes urgentes et les vérifications avant d’accepter un mandat s’intègrent-elles à la prise en charge?\n3. **Quelles sont les règles derrière le travail récurrent?** Quelles sont les durées habituelles des appels de prise en charge et les plages de réservation? Comment choisissez-vous la période des documents médicaux, renouvelez-vous les autorisations et décidez-vous du moment des relances?\n4. **Que se passe-t-il sur le plan financier et à la fin d’un dossier?** Comment fonctionnent les conventions d’honoraires et l’affectation des paiements entre les dossiers? Que se passe-t-il au règlement, à la facturation finale et à la fermeture? Quand un dossier devient-il inactif, ou reste-t-il ouvert seulement pour le recouvrement?\n5. **Qu’est-ce qui ferait la plus grande différence en premier?** Quelle partie du travail voudriez-vous rendre plus facile en priorité? Qu’est-ce qui vous indiquerait, à vous et à l’équipe, que c’est amélioré : moins de suivis, moins de temps de préparation, moins d’échanges pour les rendez-vous, ou autre chose?" },
  c10: { title: "Mot de la fin", body: "Si quelque chose d’important manque tout à fait à ces pages, la boîte de commentaire de cette page est l’endroit pour le dire.\n\n> Appuyer sur « Terminer la relecture » ci-dessous m’indique que vous avez parcouru les pages. Cela ne signifie pas que vous approuvez chaque phrase; les corrections que vous avez laissées sont ce sur quoi nous travaillerons.\n\nUzziel" }
};
export const CABINET_M_FR = { titleFr: "Le Cabinet M", subtitleFr: "Ce que je comprends de votre cabinet jusqu’ici", introFr: "Voici le portrait que j’ai de votre cabinet après nos échanges et le temps passé avec votre équipe. Il est là pour être corrigé. Surlignez n’importe quelle phrase pour proposer une meilleure formulation, ou ajoutez un commentaire sur n’importe quelle page. Rien n’y est définitif, et nous passerons les questions restantes ensemble à notre prochaine rencontre.", closingFr: "Une fois ce portrait corrigé ensemble, nous pourrons choisir les améliorations qui conviennent le mieux à la façon dont votre cabinet travaille. Merci d’y consacrer ce temps.", sections: FR_SECTIONS, cards: FR_CARDS };
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

/* Guest-facing UI strings, by the review's language */
export const UI = {
  en: { start: "Start reading", next: "Next", back: "Back", of: "of", sections: "Sections", comment: "Add a comment", prompt: "Anything to correct or add?", suggest: "Suggest a correction", commentSel: "Comment", original: "Original passage", replacement: "Your wording", why: "Why (optional)", name: "Your name", nameHint: "So I know who wrote this. Remembered on this device only.", send: "Save", sending: "Saving…", saved: "Saved. Thank you.", failed: "Not saved. Check your connection and retry.", retry: "Retry", cancel: "Cancel", finish: "Finish review", finished: "Thank you. I have your comments and will go through the remaining questions with you at our next meeting.", finishNote: "This records that you have been through the pages, not that you agree with every sentence.", pageComment: "Comment on this page", onPage: "On page", revision: "Revision", prepared: "Prepared by", closed: "This link is no longer active.", closedHint: "Ask Uzziel for a fresh one.", cover: "For your review", pending: "waiting to send", yours: "Your comments on this page", unsent: "You have an unsent comment. It stays here until you save or cancel it.", welcomeMeta: "About ten short pages. Read in any order." },
  fr: { start: "Commencer la lecture", next: "Suivant", back: "Retour", of: "sur", sections: "Sections", comment: "Ajouter un commentaire", prompt: "Quelque chose à corriger ou à ajouter?", suggest: "Proposer une correction", commentSel: "Commenter", original: "Passage original", replacement: "Votre formulation", why: "Pourquoi (facultatif)", name: "Votre nom", nameHint: "Pour que je sache qui a écrit ceci. Mémorisé sur cet appareil seulement.", send: "Enregistrer", sending: "Enregistrement…", saved: "Enregistré. Merci.", failed: "Non enregistré. Vérifiez la connexion et réessayez.", retry: "Réessayer", cancel: "Annuler", finish: "Terminer la relecture", finished: "Merci. J’ai vos commentaires et nous passerons les questions restantes ensemble à notre prochaine rencontre.", finishNote: "Ceci indique que vous avez parcouru les pages, pas que vous approuvez chaque phrase.", pageComment: "Commenter cette page", onPage: "Sur la page", revision: "Révision", prepared: "Préparé par", closed: "Ce lien n’est plus actif.", closedHint: "Demandez un nouveau lien à Uzziel.", cover: "Pour votre relecture", pending: "en attente d’envoi", yours: "Vos commentaires sur cette page", unsent: "Un commentaire n’est pas envoyé. Il reste ici jusqu’à ce que vous l’enregistriez ou l’annuliez.", welcomeMeta: "Une dizaine de courtes pages. Lisez dans l’ordre que vous voulez." }
};

if (typeof window !== "undefined") {
  window.ALIE_REVIEWS = { REVIEW_STATUS, FEEDBACK_STATES, FEEDBACK_KINDS, LAYOUTS, LIMITS, UI, parseBlocks, blockText, cardPlainText, emptyReview, normalizeReview, snapshotOf, snapshotCards, snapshotBlock, snapshotLangs, snapshotIn, revisionOpen, currentRevision, anchorStatus, applySuggestion, feedbackCounts, validateSubmission, cabinetMDraft, addCabinetMFrench, hasFrench, cardIn, reviewIn, feedbackLang, hashText };
}
