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
export function cardPlainText(card) { return parseBlocks(card.body).map(b => stripInline(blockText(b))).join("\n"); }

export function emptyReview(o) {
  o = o || {};
  return { id: o.id || uid(), title: o.title || "", subtitle: o.subtitle || "", author: o.author || "Uzziel Tamon", date: o.date || new Date().toISOString().slice(0, 10), lang: o.lang === "fr" ? "fr" : "en",
    intro: o.intro || "", closing: o.closing || "", status: "Draft", cards: o.cards || [], revisions: [], feedback: [], created: Date.now(), updated: Date.now() };
}
export function normalizeReview(r) {
  r = r && typeof r === "object" ? r : {};
  const cards = (Array.isArray(r.cards) ? r.cards : []).filter(c => c && typeof c === "object").map(c => ({ id: str(c.id || uid()), section: str(c.section), title: str(c.title), body: str(c.body), layout: oneOf(LAYOUTS, c.layout, "article"), visual: /^[1-6]$/.test(String(c.visual || "")) ? String(c.visual) : "", figure: /^[1-6]$/.test(String(c.figure || "")) ? String(c.figure) : "" }));
  const revisions = (Array.isArray(r.revisions) ? r.revisions : []).filter(x => x && typeof x === "object").map((x, i) => ({
    id: str(x.id || uid()), n: num(x.n, i + 1), publishedAt: str(x.publishedAt), expires: str(x.expires), disabled: !!x.disabled, token: str(x.token), by: str(x.by),
    snapshot: x.snapshot && typeof x.snapshot === "object" ? x.snapshot : null
  }));
  const feedback = (Array.isArray(r.feedback) ? r.feedback : []).filter(x => x && typeof x === "object").map(x => ({
    id: str(x.id || uid()), revision: str(x.revision), card: str(x.card), block: str(x.block), kind: oneOf(FEEDBACK_KINDS, x.kind, "comment"),
    quote: str(x.quote).slice(0, LIMITS.quote), start: num(x.start, -1), end: num(x.end, -1), context: str(x.context).slice(0, LIMITS.context),
    suggestion: str(x.suggestion).slice(0, LIMITS.suggestion), text: str(x.text).slice(0, LIMITS.text), name: str(x.name).slice(0, LIMITS.name), submission: str(x.submission),
    state: oneOf(FEEDBACK_STATES, x.state, "Open"), links: { step: str(x.links && x.links.step), question: str(x.links && x.links.question) }, note: str(x.note),
    applied: x.applied && typeof x.applied === "object" ? { at: num(x.applied.at, 0), before: str(x.applied.before), after: str(x.applied.after), card: str(x.applied.card) } : null,
    created: num(x.created, Date.now())
  }));
  const status = oneOf(REVIEW_STATUS, r.status, revisions.length ? "Published" : "Draft");
  return { id: str(r.id || uid()), title: str(r.title), subtitle: str(r.subtitle), author: str(r.author), date: str(r.date), lang: r.lang === "fr" ? "fr" : "en", intro: str(r.intro), closing: str(r.closing),
    status, cards, revisions, feedback, created: num(r.created, Date.now()), updated: num(r.updated, Date.now()) };
}

/* Everything the guest may see, and nothing else. Built from the draft at publish time and frozen. */
export function snapshotOf(review, pilot, n) {
  const sections = [];
  review.cards.forEach(c => {
    const name = c.section || "";
    let s = sections.find(x => x.title === name);
    if (!s) { s = { id: "s" + hashText(name), title: name, cards: [] }; sections.push(s); }
    s.cards.push({ id: c.id, title: c.title, layout: LAYOUTS.indexOf(c.layout) !== -1 ? c.layout : "article", visual: c.visual || "", figure: c.figure || "", blocks: parseBlocks(c.body).map(b => ({ id: b.id, kind: b.kind, text: b.text || "", rest: b.rest || "", items: b.items || [], head: b.head || [], rows: b.rows || [] })) });
  });
  return { reviewId: review.id, revision: n, pilot: pilot ? pilot.name : "", title: review.title, subtitle: review.subtitle, author: review.author, date: review.date, lang: review.lang, intro: review.intro, closing: review.closing, sections };
}
export function snapshotCards(snap) { return (snap && snap.sections ? snap.sections : []).reduce((a, s) => a.concat(s.cards), []); }
export function snapshotBlock(snap, cardId, blockId) {
  const c = snapshotCards(snap).find(x => x.id === cardId);
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
  const text = cardPlainText(card);
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
  const count = q ? card.body.split(q).length - 1 : 0;
  if (count !== 1) return { ok: false, error: count === 0 ? "The quoted passage is not in the current draft as written. Edit the page by hand." : "The passage appears more than once. Edit the page by hand." };
  card.body = card.body.replace(q, fb.suggestion);
  fb.state = "Applied";
  fb.applied = { at: now || Date.now(), before: q, after: fb.suggestion, card: card.id };
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
  const fb = { id: uid(), revision: rev.id, card: "", block: "", kind, quote: "", start: -1, end: -1, context: "", suggestion: "", text: "", name, submission, state: "Open", links: { step: "", question: "" }, note: "", applied: null, created: now || Date.now() };
  if (kind === "finish") return { ok: true, feedback: fb };
  const card = snapshotCards(rev.snapshot).find(c => c.id === str(body.card));
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
  return emptyReview({
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
}

/* Guest-facing UI strings, by the review's language */
export const UI = {
  en: { start: "Start reading", next: "Next", back: "Back", of: "of", sections: "Sections", comment: "Add a comment", prompt: "Anything to correct or add?", suggest: "Suggest a correction", commentSel: "Comment", original: "Original passage", replacement: "Your wording", why: "Why (optional)", name: "Your name", nameHint: "So I know who wrote this. Remembered on this device only.", send: "Save", sending: "Saving…", saved: "Saved. Thank you.", failed: "Not saved. Check your connection and retry.", retry: "Retry", cancel: "Cancel", finish: "Finish review", finished: "Thank you. I have your comments and will go through the remaining questions with you at our next meeting.", finishNote: "This records that you have been through the pages, not that you agree with every sentence.", pageComment: "Comment on this page", onPage: "On page", revision: "Revision", prepared: "Prepared by", closed: "This link is no longer active.", closedHint: "Ask Uzziel for a fresh one.", cover: "For your review", pending: "waiting to send", yours: "Your comments on this page", unsent: "You have an unsent comment. It stays here until you save or cancel it.", welcomeMeta: "About ten short pages. Read in any order." },
  fr: { start: "Commencer la lecture", next: "Suivant", back: "Retour", of: "sur", sections: "Sections", comment: "Ajouter un commentaire", prompt: "Quelque chose à corriger ou à ajouter?", suggest: "Proposer une correction", commentSel: "Commenter", original: "Passage original", replacement: "Votre formulation", why: "Pourquoi (facultatif)", name: "Votre nom", nameHint: "Pour que je sache qui a écrit ceci. Mémorisé sur cet appareil seulement.", send: "Enregistrer", sending: "Enregistrement…", saved: "Enregistré. Merci.", failed: "Non enregistré. Vérifiez la connexion et réessayez.", retry: "Réessayer", cancel: "Annuler", finish: "Terminer la relecture", finished: "Merci. J’ai vos commentaires et nous passerons les questions restantes ensemble à notre prochaine rencontre.", finishNote: "Ceci indique que vous avez parcouru les pages, pas que vous approuvez chaque phrase.", pageComment: "Commenter cette page", onPage: "Sur la page", revision: "Révision", prepared: "Préparé par", closed: "Ce lien n’est plus actif.", closedHint: "Demandez un nouveau lien à Uzziel.", cover: "Pour votre relecture", pending: "en attente d’envoi", yours: "Vos commentaires sur cette page", unsent: "Un commentaire n’est pas envoyé. Il reste ici jusqu’à ce que vous l’enregistriez ou l’annuliez.", welcomeMeta: "Une dizaine de courtes pages. Lisez dans l’ordre que vous voulez." }
};

if (typeof window !== "undefined") {
  window.ALIE_REVIEWS = { REVIEW_STATUS, FEEDBACK_STATES, FEEDBACK_KINDS, LIMITS, UI, parseBlocks, blockText, cardPlainText, emptyReview, normalizeReview, snapshotOf, snapshotCards, snapshotBlock, revisionOpen, currentRevision, anchorStatus, applySuggestion, feedbackCounts, validateSubmission, cabinetMDraft, hashText };
}
