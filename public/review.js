/* The guest side of a client review: read ten short pages, comment on a page, or highlight a passage and suggest
   better wording. No account. Everything sent goes to the published revision it was written against.
   Layout follows the reference cards: a navigation tree on the left, one white card, a full-height visual or a
   reading column, round back/next controls. */
import { UI, snapshotCards, snapshotIn, snapshotLangs, LIMITS } from "/reviews.js";

const root = document.getElementById("rv");
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>");
const params = new URLSearchParams(location.search);
const token = (location.pathname.match(/^\/r\/([A-Za-z0-9_-]{20,})$/) || [])[1] || "";
const preview = params.get("preview") || "";
const rnd = () => "s_" + Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, "0")).join("");
const ARROW_L = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" opacity=".35"/><path d="M14 8l-4 4 4 4"/></svg>';
const ARROW_R = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
function fmtDate(d) { try { return new Intl.DateTimeFormat(lang === "fr" ? "fr-CA" : "en-CA", { day: "numeric", month: "long", year: "numeric" }).format(new Date(d + "T12:00:00")); } catch (e) { return d || ""; } }
const visualSrc = n => "/visuals/v" + (/^[1-6]$/.test(String(n)) ? n : "1") + ".svg";

let snap = null, cur = null, lang = "en", revId = "", T = UI.en, cards = [], idx = 0, name = "", queue = [], mine = {}, seen = {}, done = false, panel = null, toastTimer = 0;
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } } };
const K = k => "alie.rv." + revId + "." + k;
const hooks = { afterRender: null }; /* the signed-in preview attaches its editing layer here */

async function boot() {
  let r, j;
  try {
    r = preview ? await fetch("/api/reviews/preview?pilot=" + encodeURIComponent(preview.split("/")[0]) + "&review=" + encodeURIComponent(preview.split("/")[1] || "")) : await fetch("/api/public/review/" + encodeURIComponent(token));
    j = await r.json();
  } catch (e) { return closed(true); }
  if (!r.ok || !j.snapshot) return closed(false, j && j.error);
  snap = j.snapshot; revId = preview ? "preview" : j.revisionId;
  const wanted = store.get("alie.rv.lang", "") || (params.get("lang") || "");
  setLang(snapshotLangs(snap).indexOf(wanted) !== -1 ? wanted : snap.lang);
  name = store.get("alie.rv.name", ""); queue = store.get(K("q"), []); mine = store.get(K("mine"), {}); seen = store.get(K("seen"), {}); done = !!store.get(K("done"), false);
  idx = Math.min(cards.length, Math.max(0, Number(store.get(K("pos"), 0)) || 0));
  render();
  retryQueue();
  window.addEventListener("online", retryQueue);
  if (preview) import("/review-edit.js").then(m => m.attach({ root, params, preview, esc, hooks, render, go, get lang() { return lang; }, get idx() { return idx; }, get cards() { return cards; }, setSnap(s) { snap = s; setLang(snapshotLangs(snap).indexOf(lang) !== -1 ? lang : snap.lang); if (idx > cards.length) idx = cards.length; } })).catch(() => {});
}
/* the whole experience follows the language: labels, pages, and the language a comment is filed under */
function setLang(l) {
  lang = l; cur = snapshotIn(snap, lang); T = UI[lang] || UI.en; cards = snapshotCards(snap, lang);
  document.documentElement.lang = lang; document.title = (cur.title || "ALIE") + " · " + T.cover;
  store.set("alie.rv.lang", lang);
}
function closed(network, why) {
  root.innerHTML = '<div class="rv-closed"><h1>' + esc(network ? "Cannot reach the server" : T.closed) + "</h1><p>" + esc(network ? "Check your connection and reload." : (why || T.closedHint)) + "</p></div>";
}

/* ---------- rendering ---------- */
function render() {
  const N = cards.length;
  const sections = cur.sections;
  const langs = snapshotLangs(snap);
  const other = langs.find(x => x !== lang);
  const langBtn = other ? '<button class="rv-lang" data-lang="' + other + '" lang="' + other + '" title="' + (other === "fr" ? "Lire en français" : "Read in English") + '">' + (other === "fr" ? "Français" : "English") + "</button>" : "";
  const seenCount = Object.keys(seen).length;
  let side = '<div class="rv-brandrow"><a class="rv-brand" href="#" data-go="0"><span class="sq">A</span>ALIE<span class="chev">⌄</span></a>' + langBtn + "</div>";
  let n = 0;
  sections.forEach((s, si) => {
    side += '<button class="rv-sec"><span class="ic">' + (si + 1) + '</span><span class="t">' + esc(s.title) + '</span><span class="ch">⌃</span></button>';
    s.cards.forEach(c => { n++; const m = (mine[c.id] || []).length; side += '<button class="rv-item" data-go="' + n + '" aria-current="' + (idx === n && !done) + '"><span class="box' + (seen[c.id] ? " on" : "") + '"></span><span class="t">' + esc(c.title) + "</span>" + (m ? '<span class="dot">' + m + "</span>" : "") + "</button>"; });
  });
  side += '<div class="foot"><span class="clock"></span><span>' + seenCount + " " + esc(T.of) + " " + N + " " + esc(lang === "fr" ? "pages lues" : "pages read") + "</span></div>";

  let card;
  const menuBtn = '<button class="rv-menu" data-menu>☰ ' + esc(T.sections) + "</button>";
  if (done) {
    card = '<div class="rv-card article">' + menuBtn + '<div class="rv-scroll"><div class="rv-col"><h1>' + esc(T.finished.split(".")[0]) + '.</h1><div class="rule"></div><div class="rv-body"><p>' + esc(T.finished.split(".").slice(1).join(".").trim()) + "</p><p>" + esc(T.finishNote) + '</p></div></div></div>' +
      '<button class="rv-back" data-go="' + N + '" data-undone="1" aria-label="' + esc(T.back) + '">' + ARROW_L + "</button></div>";
  } else if (idx === 0) {
    card = '<div class="rv-card visual hero">' + menuBtn + '<img class="rv-visual" src="' + visualSrc(1) + '" alt=""><div class="rv-hero"><h1>' + esc(cur.title) + '</h1><div class="sub">' + esc(cur.subtitle) + '</div><div class="meta">' + esc(T.prepared) + " <b>" + esc(snap.author) + "</b> · " + esc(T.lastUpdated) + " " + esc(fmtDate(snap.date)) + " · " + esc(T.revision) + " " + esc(String(snap.revision)) + "</div>" + (cur.intro ? '<p class="msg">' + inline(cur.intro) + "</p>" : "") + "</div>" +
      controls(N) + "</div>";
  } else {
    const c = cards[idx - 1];
    const sec = sections.find(s => s.cards.some(x => x.id === c.id));
    const layout = c.layout || "article";
    const commentBtn = '<button class="rv-cbtn" data-page-comment title="' + esc(T.prompt) + '">✎ ' + esc(T.comment) + "</button>";
    if (layout === "visual" || layout === "visual-right") {
      card = '<div class="rv-card visual' + (layout === "visual-right" ? " right" : "") + '">' + menuBtn + commentBtn + '<img class="rv-visual" src="' + visualSrc(c.visual || (idx % 6) + 1) + '" alt=""><div class="rv-text"><h1>' + esc(c.title) + '</h1><div class="rv-body" data-card="' + esc(c.id) + '">' + c.blocks.map(b => renderBlock(b, true)).join("") + (idx === N && cur.closing ? '<p class="closing">' + inline(cur.closing) + "</p>" : "") + "</div>" + renderMine(c.id) + "</div>" + controls(N) + "</div>";
    } else {
      let blocks = c.blocks.map(b => renderBlock(b, false));
      if (c.figure && blocks.length) { const last = blocks.pop(); blocks.push('<div class="rv-fig">' + last + '<img src="' + visualSrc(c.figure) + '" alt=""></div>'); }
      card = '<div class="rv-card article">' + menuBtn + commentBtn + '<div class="rv-scroll"><div class="rv-col"><div class="eyebrow" style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8a8a8a;margin-bottom:14px">' + esc(sec ? sec.title : "") + '</div><h1>' + esc(c.title) + '</h1><div class="rule"></div><div class="rv-body" data-card="' + esc(c.id) + '">' + blocks.join("") + (idx === N && cur.closing ? '<div class="rv-quote">' + inline(cur.closing) + "</div>" : "") + "</div>" + renderMine(c.id) + "</div></div>" + controls(N) + "</div>";
    }
  }
  root.setAttribute("data-panel", panel ? "open" : "closed");
  root.innerHTML = '<aside class="rv-side" id="side">' + side + "</aside>" + (preview ? '<div class="rv-preview">Preview · comments are off</div>' : "") + card;
  const cardEl = root.querySelector(".rv-card");
  if (panel && cardEl) { const pn = document.createElement("aside"); pn.className = "rv-panel"; pn.id = "panel"; pn.innerHTML = renderPanel(); cardEl.appendChild(pn); }
  if (cardEl) { const bg = document.createElement("div"); bg.className = "rv-bar-bg"; cardEl.appendChild(bg); }
  wire();
  if (hooks.afterRender) hooks.afterRender();
}
function controls(N) {
  const isVisual = idx === 0 || ((cards[idx - 1] || {}).layout || "article") !== "article";
  const back = '<button class="rv-back" data-go="' + (idx - 1) + '"' + (idx <= 0 ? " disabled" : "") + ' aria-label="' + esc(T.back) + '">' + ARROW_L + "</button>";
  const count = idx ? '<span class="rv-count">' + idx + " " + esc(T.of) + " " + N + "</span>" : "";
  let next;
  if (idx === 0) next = '<button class="rv-next pill hero" data-go="1">' + esc(T.start) + " " + ARROW_R + "</button>";
  else if (idx < N) next = isVisual ? '<button class="rv-next" data-go="' + (idx + 1) + '" aria-label="' + esc(T.next) + '">' + ARROW_R + "</button>" : '<button class="rv-next pill" data-go="' + (idx + 1) + '">' + esc(T.next) + " " + ARROW_R + "</button>";
  else next = preview ? "" : '<button class="rv-next pill dark" data-finish>' + esc(T.finish) + "</button>";
  return back + count + next;
}
function flowItem(i, cls) { return '<div class="fl-node' + (cls ? " " + cls : "") + '">' + (i.actor ? '<span class="fl-actor">' + inline(i.actor) + "</span>" : "") + '<span class="fl-label">' + inline(i.label) + "</span>" + (i.note ? '<span class="fl-note">' + inline(i.note) + "</span>" : "") + "</div>"; }
function renderFlow(b) {
  const arrow = '<div class="fl-arrow" aria-hidden="true"></div>';
  return '<div class="rv-flow" role="img" aria-label="' + esc(T.flowAria) + '">' + b.nodes.map((n, i) => {
    let h;
    if (n.kind === "parallel") h = '<div class="fl-par">' + n.items.map(it => flowItem(it)).join('<div class="fl-plus">+</div>') + "</div>";
    else if (n.kind === "fanout") h = '<div class="fl-fan">' + n.items.map(it => flowItem(it, "fan")).join("") + "</div>";
    else if (n.kind === "band") h = '<div class="fl-band">' + (n.actor ? '<span class="fl-actor">' + inline(n.actor) + "</span>" : "") + inline(n.label) + (n.note ? ' <span class="fl-note">' + inline(n.note) + "</span>" : "") + "</div>";
    else if (n.kind === "decision") h = '<div class="fl-dec"><span class="fl-q">?</span><span class="fl-label">' + inline(n.label) + "</span>" + (n.options.length ? '<div class="fl-opts">' + n.options.map(o => '<span class="fl-opt"><b>' + inline(o.answer) + "</b> → " + inline(o.to) + "</span>").join("") + "</div>" : "") + "</div>";
    else h = flowItem(n);
    const last = i === b.nodes.length - 1 || n.kind === "band" || (b.nodes[i + 1] && b.nodes[i + 1].kind === "band");
    return h + (last ? "" : arrow);
  }).join("") + "</div>";
}
function renderTeam(b) {
  return '<div class="rv-team">' + b.people.map(p => { const ini = p.name.split(/[\s-]+/).filter(Boolean).slice(0, 2).map(x => x[0]).join("").toUpperCase(); return '<div class="tm"><span class="tm-ini" aria-hidden="true">' + esc(ini) + '</span><div><b>' + inline(p.name) + "</b>" + (p.title ? '<span class="tm-title">' + inline(p.title) + "</span>" : "") + (p.role ? "<p>" + inline(p.role) + "</p>" : "") + "</div></div>"; }).join("") + "</div>";
}
function renderBlock(b, compact) {
  let inner;
  if (b.kind === "flow") inner = renderFlow(b);
  else if (b.kind === "team") inner = renderTeam(b);
  else if (b.kind === "h") inner = "<h2>" + inline(b.text) + "</h2>" + (b.rest ? "<p>" + inline(b.rest) + "</p>" : "");
  else if (b.kind === "callout") inner = '<div class="rv-quote' + (/^(to confirm|à confirmer)/i.test(b.text) ? " pink" : "") + '">' + inline(b.text) + "</div>";
  else if (b.kind === "steps") inner = b.items.map((it, i) => { const m = /^\*\*(.+?)\*\*\s*(.*)$/.exec(it); return '<div class="rv-num"><span class="n">' + (i + 1) + "</span>" + (m ? "<b>" + inline(m[1]) + "</b>" + inline(m[2]) : inline(it)) + "</div>"; }).join("");
  else if (b.kind === "list") inner = "<ul>" + b.items.map(i => "<li>" + inline(i) + "</li>").join("") + "</ul>";
  else if (b.kind === "columns") inner = '<div class="rv-grid">' + b.head.map((h, i) => '<div><img class="ico" src="' + visualSrc(2 + i) + '" alt=""><b>' + inline(h) + "</b>" + b.rows.map(r => "<p>" + inline(r[i] || "") + "</p>").join("") + "</div>").join("") + "</div>";
  else inner = '<p class="' + (b.text.length <= 70 && /:$/.test(b.text) ? "lead" : "") + '">' + inline(b.text) + "</p>";
  return '<div class="rv-block" data-block="' + esc(b.id) + '">' + inner + "</div>";
}
function renderMine(cardId) {
  const list = (mine[cardId] || []).concat(queue.filter(q => q.payload.card === cardId).map(q => ({ id: q.id, kind: q.payload.kind, quote: q.payload.quote, text: q.payload.text || q.payload.suggestion, pending: q.status })));
  if (!list.length) return "";
  return '<div class="rv-mine"><div class="lab">' + esc(T.yours) + "</div>" + list.map(it => '<div class="it"><b>' + esc(it.kind === "suggestion" ? T.suggest : T.commentSel) + "</b>" + (it.quote ? " · <q>" + esc(it.quote.slice(0, 90)) + (it.quote.length > 90 ? "…" : "") + "</q>" : "") + " — " + esc((it.text || "").slice(0, 140)) + (it.pending ? '<span class="st">' + esc(it.pending === "failed" ? T.failed : T.pending) + "</span>" : "") + "</div>").join("") + "</div>";
}
function renderPanel() {
  const p = panel;
  const c = cards.find(x => x.id === p.card);
  const failed = queue.filter(q => q.status === "failed").length;
  let h = '<button class="x" data-panel-close aria-label="' + esc(T.cancel) + '">×</button><h2>' + esc(p.mode === "suggest" ? T.suggest : p.mode === "comment" ? T.commentSel : T.pageComment) + '</h2><div class="where">' + esc(T.onPage) + " " + esc(c ? c.title : "") + "</div>";
  if (failed) h += '<div class="unsent">' + esc(T.failed) + ' <button class="btn" data-retry style="height:32px;padding:0 10px;margin-left:6px">' + esc(T.retry) + "</button></div>";
  if (p.quote) h += "<label>" + esc(T.original) + "</label><blockquote>" + esc(p.quote) + "</blockquote>";
  if (p.mode === "suggest") h += '<label for="pf-sug">' + esc(T.replacement) + '</label><textarea id="pf-sug" maxlength="' + LIMITS.suggestion + '">' + esc(p.suggestion) + '</textarea><label for="pf-txt">' + esc(T.why) + '</label><textarea id="pf-txt" style="min-height:70px" maxlength="' + LIMITS.text + '">' + esc(p.text) + "</textarea>";
  else h += '<label for="pf-txt">' + esc(T.prompt) + '</label><textarea id="pf-txt" maxlength="' + LIMITS.text + '">' + esc(p.text) + "</textarea>";
  if (!name) h += '<label for="pf-name">' + esc(T.name) + '</label><input id="pf-name" maxlength="' + LIMITS.name + '" autocomplete="name" value="' + esc(p.name || "") + '"><div class="hint">' + esc(T.nameHint) + "</div>";
  h += '<div class="acts"><button class="btn primary" data-send' + (preview ? " disabled" : "") + ">" + esc(T.send) + '</button><button class="btn" data-panel-close>' + esc(T.cancel) + "</button></div>";
  h += '<div class="status' + (p.status === "ok" ? " ok" : p.status === "bad" ? " bad" : "") + '">' + esc(p.statusText || "") + "</div>";
  return h;
}

/* ---------- behaviour ---------- */
function wire() {
  root.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", e => { e.preventDefault(); if (b.dataset.undone) { done = false; store.set(K("done"), false); } go(Number(b.dataset.go)); }));
  root.querySelectorAll("[data-menu]").forEach(b => b.addEventListener("click", () => { root.setAttribute("data-menu", root.getAttribute("data-menu") === "open" ? "closed" : "open"); }));
  root.querySelectorAll("[data-lang]").forEach(b => b.addEventListener("click", () => { if (panel && (panel.text || panel.suggestion)) { toast(T.unsent); return; } panel = null; removeSelbar(); setLang(b.dataset.lang); render(); }));
  root.querySelectorAll(".rv-sec").forEach(b => b.addEventListener("click", () => { const first = b.nextElementSibling; if (first && first.dataset.go) go(Number(first.dataset.go)); }));
  const side = document.getElementById("side");
  side.addEventListener("click", e => { if (e.target.closest("[data-go]")) root.setAttribute("data-menu", "closed"); });
  const cardEl = root.querySelector(".rv-card");
  if (cardEl) cardEl.addEventListener("click", e => { if (root.getAttribute("data-menu") === "open" && !e.target.closest("[data-menu]")) root.setAttribute("data-menu", "closed"); });
  const pc = root.querySelector("[data-page-comment]"); if (pc) pc.addEventListener("click", () => openPanel("page", cards[idx - 1].id));
  const fin = root.querySelector("[data-finish]"); if (fin) fin.addEventListener("click", finish);
  root.querySelectorAll("[data-panel-close]").forEach(b => b.addEventListener("click", closePanel));
  const send = root.querySelector("[data-send]"); if (send) send.addEventListener("click", submit);
  const rt = root.querySelector("[data-retry]"); if (rt) rt.addEventListener("click", retryQueue);
  const txt = document.getElementById("pf-txt"); if (txt) txt.addEventListener("input", () => { panel.text = txt.value; });
  const sug = document.getElementById("pf-sug"); if (sug) sug.addEventListener("input", () => { panel.suggestion = sug.value; });
  const nmi = document.getElementById("pf-name"); if (nmi) nmi.addEventListener("input", () => { panel.name = nmi.value; });
  if (panel && !panel.focused) { panel.focused = true; const f = document.getElementById(panel.mode === "suggest" ? "pf-sug" : "pf-txt"); if (f && window.innerWidth > 860) f.focus(); }
  const body = root.querySelector(".rv-body[data-card]");
  if (body && !preview) { body.addEventListener("mouseup", onSelect); body.addEventListener("touchend", () => setTimeout(onSelect, 60)); body.addEventListener("keyup", e => { if (e.shiftKey) onSelect(); }); }
  const sc = root.querySelector(".rv-scroll, .rv-text"); if (sc) sc.scrollTop = 0;
  window.scrollTo({ top: 0 });
}
function go(i) {
  if (i < 0 || i > cards.length) return;
  idx = i; store.set(K("pos"), idx);
  if (idx > 0) { seen[cards[idx - 1].id] = 1; store.set(K("seen"), seen); }
  if (panel && !(panel.text || panel.suggestion || panel.name)) panel = null; /* an empty form closes; a started one (text or a typed name) stays on its page */
  removeSelbar(); render();
}
document.addEventListener("keydown", e => {
  if (e.target.closest("textarea, input")) return;
  if (e.key === "ArrowRight" && idx < cards.length && !done) go(idx + 1);
  if (e.key === "ArrowLeft" && idx > 0 && !done) go(idx - 1);
  if (e.key === "Escape") { removeSelbar(); if (panel && !(panel.text || panel.suggestion)) closePanel(); root.setAttribute("data-menu", "closed"); }
});
function openPanel(mode, cardId, sel) {
  const keepName = panel ? panel.name || "" : "";
  panel = Object.assign({ mode, card: cardId, block: "", quote: "", start: -1, end: -1, context: "", text: "", suggestion: "", name: keepName, lang, status: "", statusText: "", focused: false }, sel || {});
  if (mode === "suggest" && !panel.suggestion) panel.suggestion = panel.quote;
  removeSelbar(); render();
  if (window.innerWidth <= 860) { const pn = document.getElementById("panel"); if (pn) pn.scrollTop = 0; }
}
function closePanel() { panel = null; render(); }

/* text selection inside one block: offer Comment / Suggest a correction just above it */
function onSelect() {
  removeSelbar();
  const s = window.getSelection();
  if (!s || s.isCollapsed || !s.rangeCount) return;
  const range = s.getRangeAt(0);
  const text = s.toString().replace(/\s+/g, " ").trim();
  if (text.length < 2 || text.length > LIMITS.quote) return;
  const startEl = nodeEl(range.startContainer).closest("[data-block]"), endEl = nodeEl(range.endContainer).closest("[data-block]");
  if (!startEl || startEl !== endEl) return;
  const blockEl = startEl, cardEl = blockEl.closest("[data-card]");
  const pre = range.cloneRange(); pre.selectNodeContents(blockEl); pre.setEnd(range.startContainer, range.startOffset);
  const before = pre.toString();
  const full = blockEl.textContent || "";
  const start = before.length, end = start + s.toString().length;
  const sel = { card: cardEl.dataset.card, block: blockEl.dataset.block, quote: text, start, end, context: (full.slice(Math.max(0, start - 40), start) + "‹›" + full.slice(end, end + 40)).replace(/\s+/g, " ") };
  const rect = range.getBoundingClientRect();
  const bar = document.createElement("div"); bar.className = "rv-selbar"; bar.id = "selbar";
  bar.innerHTML = '<button data-m="comment">💬 ' + esc(T.commentSel) + '</button><button data-m="suggest">✎ ' + esc(T.suggest) + "</button>";
  document.body.appendChild(bar);
  const w = bar.offsetWidth;
  bar.style.position = "fixed";
  bar.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, rect.left + rect.width / 2 - w / 2)) + "px";
  bar.style.top = Math.max(8, rect.top - bar.offsetHeight - 10) + "px";
  bar.querySelectorAll("button").forEach(b => b.addEventListener("mousedown", e => e.preventDefault()));
  bar.querySelectorAll("button").forEach(b => b.addEventListener("click", () => { openPanel(b.dataset.m, sel.card, sel); if (s.removeAllRanges) s.removeAllRanges(); }));
  blockEl.classList.add("hl"); setTimeout(() => blockEl.classList.remove("hl"), 1500);
}
function nodeEl(n) { return n.nodeType === 1 ? n : n.parentElement; }
function removeSelbar() { const b = document.getElementById("selbar"); if (b) b.remove(); }
document.addEventListener("mousedown", e => { if (!e.target.closest("#selbar")) removeSelbar(); });

/* ---------- sending: a queue in this browser, one id per submission so a retry never doubles a comment ---------- */
async function submit() {
  if (preview) return;
  const nm = document.getElementById("pf-name");
  if (nm) { name = nm.value.trim(); if (!name) { nm.focus(); setStatus("bad", T.name); return; } store.set("alie.rv.name", name); }
  const p = panel;
  const payload = { submission: rnd(), kind: p.mode === "suggest" ? "suggestion" : "comment", card: p.card, block: p.block, quote: p.quote, start: p.start, end: p.end, context: p.context, text: p.text.trim(), suggestion: p.mode === "suggest" ? p.suggestion.trim() : "", name, lang: p.lang || lang };
  if (payload.kind === "suggestion" && !payload.suggestion) { setStatus("bad", T.replacement); return; }
  if (payload.kind === "comment" && !payload.text) { setStatus("bad", T.prompt); return; }
  const item = { id: payload.submission, payload, status: "sending", at: Date.now() };
  queue.push(item); store.set(K("q"), queue);
  setStatus("", T.sending);
  const ok = await send(item);
  if (ok) { panel = null; toast(T.saved); render(); }
  else { setStatus("bad", T.failed); render(); }
}
async function send(item) {
  try {
    const r = await fetch("/api/public/review/" + encodeURIComponent(token) + (item.payload.kind === "finish" ? "/finish" : "/feedback"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item.payload) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.ok) {
      queue = queue.filter(q => q.id !== item.id); store.set(K("q"), queue);
      if (item.payload.kind !== "finish") { const c = item.payload.card; mine[c] = (mine[c] || []).concat([{ id: j.id, kind: item.payload.kind, quote: item.payload.quote, text: item.payload.text || item.payload.suggestion }]); store.set(K("mine"), mine); }
      return true;
    }
    if (r.status === 400 || r.status === 404) { queue = queue.filter(q => q.id !== item.id); store.set(K("q"), queue); toast(j.error || T.failed); return false; }
    item.status = "failed"; store.set(K("q"), queue); return false;
  } catch (e) { item.status = "failed"; store.set(K("q"), queue); return false; }
}
async function retryQueue() {
  const pending = queue.filter(q => q.status === "failed" || Date.now() - q.at > 20000);
  let any = false;
  for (const it of pending) { it.status = "sending"; if (await send(it)) any = true; }
  if (any) { toast(T.saved); }
  if (pending.length) render();
}
async function finish() {
  if (preview) return;
  if (!name) { openPanel("page", cards[cards.length - 1].id); setStatus("", T.name); return; }
  const item = { id: rnd(), payload: { submission: "", kind: "finish", name, lang }, status: "sending", at: Date.now() };
  item.payload.submission = item.id;
  queue.push(item); store.set(K("q"), queue);
  const ok = await send(item);
  if (ok) { done = true; store.set(K("done"), true); panel = null; render(); } else { toast(T.failed); render(); }
}
function setStatus(kind, text) { if (!panel) return; panel.status = kind; panel.statusText = text; const st = root.querySelector(".rv-panel .status"); if (st) { st.className = "status" + (kind === "ok" ? " ok" : kind === "bad" ? " bad" : ""); st.textContent = text; } }
function toast(msg) { let t = document.getElementById("rvtoast"); if (!t) { t = document.createElement("div"); t.id = "rvtoast"; t.className = "rv-toast"; document.body.appendChild(t); } t.textContent = msg; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 3500); }
window.addEventListener("beforeunload", e => { if (panel && (panel.text || panel.suggestion)) { e.preventDefault(); e.returnValue = ""; } });

boot();
