/* The guest side of a client review: read ten short pages, comment on a page, or highlight a passage and suggest
   better wording. No account. Everything sent goes to the published revision it was written against. */
import { UI, snapshotCards, LIMITS } from "/reviews.js";

const root = document.getElementById("rv");
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>");
const params = new URLSearchParams(location.search);
const token = (location.pathname.match(/^\/r\/([A-Za-z0-9_-]{20,})$/) || [])[1] || "";
const preview = params.get("preview") || "";
const rnd = () => "s_" + Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, "0")).join("");

let snap = null, revId = "", T = UI.en, cards = [], idx = 0, name = "", queue = [], mine = {}, done = false, panel = null, toastTimer = 0;
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } } };
const K = k => "alie.rv." + revId + "." + k;

async function boot() {
  let r, j;
  try {
    r = preview ? await fetch("/api/reviews/preview?pilot=" + encodeURIComponent(preview.split("/")[0]) + "&review=" + encodeURIComponent(preview.split("/")[1] || "")) : await fetch("/api/public/review/" + encodeURIComponent(token));
    j = await r.json();
  } catch (e) { return closed(true); }
  if (!r.ok || !j.snapshot) return closed(false, j && j.error);
  snap = j.snapshot; revId = preview ? "preview" : j.revisionId; T = UI[snap.lang] || UI.en; cards = snapshotCards(snap);
  document.documentElement.lang = snap.lang; document.title = (snap.title || "ALIE") + " · " + T.cover;
  name = store.get("alie.rv.name", ""); queue = store.get(K("q"), []); mine = store.get(K("mine"), {}); done = !!store.get(K("done"), false);
  idx = Math.min(cards.length, Math.max(0, Number(store.get(K("pos"), 0)) || 0));
  render();
  retryQueue();
  window.addEventListener("online", retryQueue);
}
function closed(network, why) {
  root.innerHTML = '<div class="rv-closed"><div class="rv-eyebrow">ALIE</div><h1>' + esc(network ? "Cannot reach the server" : T.closed) + "</h1><p>" + esc(network ? "Check your connection and reload." : (why || T.closedHint)) + "</p></div>";
}

/* ---------- rendering ---------- */
function render() {
  const N = cards.length;
  const sections = snap.sections;
  let side = '<a class="rv-brand" href="#" data-go="0"><span class="sq">A</span><b>ALIE</b></a><div class="pilot">' + esc(snap.pilot || "") + "</div>";
  side += '<button class="rv-item" data-go="0" aria-current="' + (idx === 0) + '"><span class="n">·</span><span>' + esc(snap.title) + "</span></button>";
  let n = 0;
  sections.forEach(s => {
    side += '<div class="rv-sec">' + esc(s.title) + "</div>";
    s.cards.forEach(c => { n++; const m = (mine[c.id] || []).length; side += '<button class="rv-item" data-go="' + n + '" aria-current="' + (idx === n) + '"><span class="n">' + n + '</span><span>' + esc(c.title) + "</span>" + (m ? '<span class="dot">' + m + "</span>" : "") + "</button>"; });
  });
  side += '<div class="foot">' + esc(T.prepared) + " " + esc(snap.author) + " · " + esc(snap.date) + "<br>" + esc(T.revision) + " " + esc(String(snap.revision)) + "</div>";

  let main;
  if (done) {
    main = '<div class="rv-col rv-done"><div class="rv-eyebrow">' + esc(snap.pilot) + '</div><h1 class="rv-title">' + esc(T.finished.split(".")[0]) + ".</h1><p>" + esc(T.finished.split(".").slice(1).join(".").trim()) + '</p><p class="note">' + esc(T.finishNote) + '</p><p><button class="rv-cbtn" data-go="1" data-undone="1">' + esc(T.back) + "</button></p></div>";
  } else if (idx === 0) {
    main = '<div class="rv-col rv-cover"><div class="rv-topline"><div class="rv-eyebrow">' + esc(snap.pilot) + " · " + esc(T.cover) + '</div><button class="rv-cbtn rv-menu" data-menu>' + esc(T.sections) + "</button></div>" +
      '<h1 class="rv-title">' + esc(snap.title) + '</h1><p class="sub">' + esc(snap.subtitle) + '</p><div class="wash"></div>' +
      '<p class="meta"><b>' + esc(snap.author) + "</b> · " + esc(snap.date) + " · " + esc(T.revision) + " " + esc(String(snap.revision)) + "<br>" + esc(T.welcomeMeta) + "</p>" +
      '<p class="intro">' + inline(snap.intro) + '</p><p><button class="rv-cbtn primary" data-go="1">' + esc(T.start) + " →</button></p></div>";
  } else {
    const c = cards[idx - 1];
    const sec = sections.find(s => s.cards.some(x => x.id === c.id));
    main = '<div class="rv-col"><div class="rv-topline"><div class="rv-eyebrow">' + esc(sec ? sec.title : "") + " · " + idx + " " + esc(T.of) + " " + N + '</div><div class="grp"><button class="rv-cbtn rv-menu" data-menu>' + esc(T.sections) + '</button> <button class="rv-cbtn" data-page-comment title="' + esc(T.prompt) + '">✎ ' + esc(T.comment) + "</button></div></div>" +
      '<h1 class="rv-title">' + esc(c.title) + '</h1><div class="rv-rule"></div><div class="rv-body" data-card="' + esc(c.id) + '">' + c.blocks.map(renderBlock).join("") + "</div>" +
      (idx === N && snap.closing ? '<p class="rv-callout">' + inline(snap.closing) + "</p>" : "") +
      renderMine(c.id) + "</div>";
  }
  const bar = done ? "" : '<div class="rv-bar"><div class="grp"><button class="rv-cbtn" data-go="' + (idx - 1) + '"' + (idx <= 0 ? " disabled" : "") + ">← " + esc(T.back) + '</button></div><span class="count">' + (idx ? idx + " " + esc(T.of) + " " + N : "") + '</span><div class="grp">' +
    (idx < N ? '<button class="rv-cbtn primary" data-go="' + (idx + 1) + '">' + esc(idx === 0 ? T.start : T.next) + " →</button>" : (preview ? "" : '<button class="rv-cbtn primary" data-finish>' + esc(T.finish) + "</button>")) + "</div></div>";
  root.setAttribute("data-panel", panel ? "open" : "closed");
  root.innerHTML = '<aside class="rv-side" id="side">' + side + '</aside><main class="rv-main" id="main">' + (preview ? '<div class="rv-preview">Preview · comments are off</div>' : "") + main + "</main>" + (panel ? '<aside class="rv-panel" id="panel">' + renderPanel() + "</aside>" : "") + bar;
  wire();
}
function renderBlock(b) {
  let inner;
  if (b.kind === "h") inner = "<h2>" + inline(b.text) + "</h2>" + (b.rest ? "<p>" + inline(b.rest) + "</p>" : "");
  else if (b.kind === "callout") inner = '<aside class="rv-callout">' + inline(b.text) + "</aside>";
  else if (b.kind === "steps") inner = "<ol>" + b.items.map(i => "<li>" + inline(i) + "</li>").join("") + "</ol>";
  else if (b.kind === "list") inner = "<ul>" + b.items.map(i => "<li>" + inline(i) + "</li>").join("") + "</ul>";
  else if (b.kind === "columns") inner = '<div class="rv-cols">' + b.head.map((h, i) => '<div class="rv-col-card"><h3>' + inline(h) + "</h3>" + b.rows.map(r => "<p>" + inline(r[i] || "") + "</p>").join("") + "</div>").join("") + "</div>";
  else inner = "<p>" + inline(b.text) + "</p>";
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
  if (failed) h += '<div class="unsent">' + esc(T.failed) + ' <button class="rv-cbtn" data-retry style="min-height:32px;padding:4px 10px;margin-left:6px">' + esc(T.retry) + "</button></div>";
  if (p.quote) h += "<label>" + esc(T.original) + "</label><blockquote>" + esc(p.quote) + "</blockquote>";
  if (p.mode === "suggest") h += '<label for="pf-sug">' + esc(T.replacement) + '</label><textarea id="pf-sug" maxlength="' + LIMITS.suggestion + '">' + esc(p.suggestion) + '</textarea><label for="pf-txt">' + esc(T.why) + '</label><textarea id="pf-txt" style="min-height:70px" maxlength="' + LIMITS.text + '">' + esc(p.text) + "</textarea>";
  else h += '<label for="pf-txt">' + esc(T.prompt) + '</label><textarea id="pf-txt" maxlength="' + LIMITS.text + '">' + esc(p.text) + "</textarea>";
  if (!name) h += '<label for="pf-name">' + esc(T.name) + '</label><input id="pf-name" maxlength="' + LIMITS.name + '" autocomplete="name"><div class="hint">' + esc(T.nameHint) + "</div>";
  h += '<div class="acts"><button class="rv-cbtn primary" data-send' + (preview ? " disabled" : "") + ">" + esc(T.send) + '</button><button class="rv-cbtn" data-panel-close>' + esc(T.cancel) + "</button></div>";
  h += '<div class="status' + (p.status === "ok" ? " ok" : p.status === "bad" ? " bad" : "") + '">' + esc(p.statusText || "") + "</div>";
  return h;
}

/* ---------- behaviour ---------- */
function wire() {
  root.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", e => { e.preventDefault(); if (b.dataset.undone) { done = false; store.set(K("done"), false); } go(Number(b.dataset.go)); }));
  root.querySelectorAll("[data-menu]").forEach(b => b.addEventListener("click", () => { root.setAttribute("data-menu", root.getAttribute("data-menu") === "open" ? "closed" : "open"); }));
  const side = document.getElementById("side");
  side.addEventListener("click", e => { if (e.target.closest("[data-go]")) root.setAttribute("data-menu", "closed"); });
  const main = document.getElementById("main");
  main.addEventListener("click", e => { if (root.getAttribute("data-menu") === "open" && !e.target.closest("[data-menu]")) root.setAttribute("data-menu", "closed"); });
  const pc = root.querySelector("[data-page-comment]"); if (pc) pc.addEventListener("click", () => openPanel("page", cards[idx - 1].id));
  const fin = root.querySelector("[data-finish]"); if (fin) fin.addEventListener("click", finish);
  root.querySelectorAll("[data-panel-close]").forEach(b => b.addEventListener("click", closePanel));
  const send = root.querySelector("[data-send]"); if (send) send.addEventListener("click", submit);
  const rt = root.querySelector("[data-retry]"); if (rt) rt.addEventListener("click", retryQueue);
  const txt = document.getElementById("pf-txt"); if (txt) txt.addEventListener("input", () => { panel.text = txt.value; });
  const sug = document.getElementById("pf-sug"); if (sug) sug.addEventListener("input", () => { panel.suggestion = sug.value; });
  if (panel && !panel.focused) { panel.focused = true; const f = document.getElementById(panel.mode === "suggest" ? "pf-sug" : "pf-txt"); if (f && window.innerWidth > 860) f.focus(); }
  const body = root.querySelector(".rv-body");
  if (body && !preview) { body.addEventListener("mouseup", onSelect); body.addEventListener("touchend", () => setTimeout(onSelect, 60)); body.addEventListener("keyup", e => { if (e.shiftKey) onSelect(); }); }
  window.scrollTo({ top: 0 });
}
function go(i) {
  if (i < 0 || i > cards.length) return;
  idx = i; store.set(K("pos"), idx);
  if (panel && !(panel.text || panel.suggestion)) panel = null; /* an empty form closes; a started one stays on its page */
  removeSelbar(); render();
}
document.addEventListener("keydown", e => {
  if (e.target.closest("textarea, input")) return;
  if (e.key === "ArrowRight" && idx < cards.length && !done) go(idx + 1);
  if (e.key === "ArrowLeft" && idx > 0 && !done) go(idx - 1);
  if (e.key === "Escape") { removeSelbar(); if (panel && !(panel.text || panel.suggestion)) closePanel(); root.setAttribute("data-menu", "closed"); }
});
function openPanel(mode, cardId, sel) {
  panel = Object.assign({ mode, card: cardId, block: "", quote: "", start: -1, end: -1, context: "", text: "", suggestion: "", status: "", statusText: "", focused: false }, sel || {});
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
  bar.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, rect.left + window.scrollX + rect.width / 2 - w / 2)) + "px";
  bar.style.top = Math.max(8, rect.top + window.scrollY - bar.offsetHeight - 10) + "px";
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
  const payload = { submission: rnd(), kind: p.mode === "suggest" ? "suggestion" : "comment", card: p.card, block: p.block, quote: p.quote, start: p.start, end: p.end, context: p.context, text: p.text.trim(), suggestion: p.mode === "suggest" ? p.suggestion.trim() : "", name };
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
  const item = { id: rnd(), payload: { submission: rnd(), kind: "finish", name }, status: "sending", at: Date.now() };
  item.payload.submission = item.id;
  queue.push(item); store.set(K("q"), queue);
  const ok = await send(item);
  if (ok) { done = true; store.set(K("done"), true); panel = null; render(); } else { toast(T.failed); render(); }
}
function setStatus(kind, text) { if (!panel) return; panel.status = kind; panel.statusText = text; const st = root.querySelector(".rv-panel .status"); if (st) { st.className = "status" + (kind === "ok" ? " ok" : kind === "bad" ? " bad" : ""); st.textContent = text; } }
function toast(msg) { let t = document.getElementById("rvtoast"); if (!t) { t = document.createElement("div"); t.id = "rvtoast"; t.className = "rv-toast"; document.body.appendChild(t); } t.textContent = msg; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 3500); }
window.addEventListener("beforeunload", e => { if (panel && (panel.text || panel.suggestion)) { e.preventDefault(); e.returnValue = ""; } });

boot();
