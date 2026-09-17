/* Author editing on the review page itself. Loaded only in the signed-in preview. Everything on the page can be
   changed in place: cover, page titles, sections, every block (through its own source text), page order, composition
   and visuals, in whichever language is showing. Edits go to the DRAFT; published revisions never change. */
import { parseBlocks, snapshotOf, LAYOUTS } from "/reviews.js";

export async function attach(api) {
  const [pilotId, reviewId] = api.preview.split("/");
  let draft = null, pilot = null, revisionCount = 0;
  let editing = api.params.get("edit") === "1" || sessionStorage.getItem("alie.rv.editing") === "1";
  let saveTimer = 0, saveState = "", openBlock = null;
  const esc = api.esc;
  const today = () => new Date().toISOString().slice(0, 10);
  const F = k => (api.lang === "fr" ? k + "Fr" : k);

  try {
    const r = await fetch("/api/reviews/draft?pilot=" + encodeURIComponent(pilotId) + "&review=" + encodeURIComponent(reviewId));
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "draft");
    draft = j.review; pilot = j.pilot; revisionCount = j.revisionCount || 0;
  } catch (e) { return; }

  function rebuild() { api.setSnap(snapshotOf(Object.assign({}, draft, { date: today() }), { name: pilot.name }, revisionCount + 1)); }
  function card() { const c = api.cards[api.idx - 1]; return c ? draft.cards.find(x => x.id === c.id) : null; }
  function commit() { save(); rebuild(); api.render(); }
  function save() {
    saveState = "saving"; paintState(); clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const r = await fetch("/api/reviews/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pilot: pilotId, review: reviewId, draft, who: "Uzziel (edited on the page)" }) });
        saveState = r.ok ? "saved" : "failed";
      } catch (e) { saveState = "failed"; }
      paintState();
    }, 450);
  }
  function paintState() { const s = document.getElementById("rv-savestate"); if (!s) return; s.textContent = saveState === "saving" ? "Saving…" : saveState === "failed" ? "Not saved. Click to retry" : saveState === "saved" ? "Saved to the draft" : ""; s.className = "st " + saveState; }
  window.addEventListener("beforeunload", e => { if (saveState === "saving") { e.preventDefault(); e.returnValue = ""; } });

  /* ---------- the bar ---------- */
  function bar() {
    document.querySelectorAll(".rv-preview, .rv-editbar").forEach(x => x.remove());
    const b = document.createElement("div"); b.className = "rv-editbar";
    const c = card();
    const langName = api.lang === "fr" ? "French" : "English";
    let h = '<div class="seg"><button data-mode="preview" aria-pressed="' + !editing + '">Preview</button><button data-mode="edit" aria-pressed="' + editing + '">Edit</button></div>';
    if (editing) {
      h += '<span class="which">Editing the ' + langName + " text</span>";
      if (c) {
        h += '<label>Section <input id="ed-section" value="' + esc(c[F("section")] || c.section || "") + '"></label>';
        h += '<label>Composition <select id="ed-layout">' + [["article", "Reading column"], ["visual", "Image left"], ["visual-right", "Image right"]].map(o => '<option value="' + o[0] + '"' + ((c.layout || "article") === o[0] ? " selected" : "") + ">" + o[1] + "</option>").join("") + "</select></label>";
        const isArticle = (c.layout || "article") === "article";
        h += "<label>" + (isArticle ? "Figure" : "Image") + ' <select id="ed-visual"><option value="">' + (isArticle ? "None" : "Auto") + "</option>" + [1, 2, 3, 4, 5, 6].map(n => '<option value="' + n + '"' + (String(isArticle ? c.figure : c.visual) === String(n) ? " selected" : "") + ">Visual " + n + "</option>").join("") + "</select></label>";
        h += '<span class="grp"><button data-page="up" title="Move this page earlier">↑</button><button data-page="down" title="Move this page later">↓</button><button data-page="add" title="Add a page after this one">+ Page</button><button data-page="del" class="danger" title="Delete this page">Delete</button></span>';
      }
      h += '<button id="rv-savestate" class="st"></button>';
    } else h += '<span class="which">This is exactly what the reader sees. Comments are off in preview.</span>';
    b.innerHTML = h;
    document.body.appendChild(b);
    api.root.classList.add("has-editbar");
    api.root.classList.toggle("editing", editing);
    paintState();
    b.querySelectorAll("[data-mode]").forEach(x => x.addEventListener("click", () => { editing = x.dataset.mode === "edit"; sessionStorage.setItem("alie.rv.editing", editing ? "1" : "0"); openBlock = null; api.render(); }));
    const st = document.getElementById("rv-savestate"); if (st) st.addEventListener("click", () => { if (saveState === "failed") save(); });
    const sec = document.getElementById("ed-section"); if (sec) sec.addEventListener("change", () => { c[F("section")] = sec.value.trim(); commit(); });
    const lay = document.getElementById("ed-layout"); if (lay) lay.addEventListener("change", () => { c.layout = LAYOUTS.indexOf(lay.value) !== -1 ? lay.value : "article"; if (c.layout === "article") { c.visual = ""; } else { c.figure = ""; if (!c.visual) c.visual = String(((api.idx - 1) % 6) + 1); } commit(); });
    const vis = document.getElementById("ed-visual"); if (vis) vis.addEventListener("change", () => { if ((c.layout || "article") === "article") c.figure = vis.value; else c.visual = vis.value; commit(); });
    b.querySelectorAll("[data-page]").forEach(x => x.addEventListener("click", () => pageOp(x.dataset.page)));
  }
  function pageOp(op) {
    const c = card(); if (!c) return;
    const i = draft.cards.indexOf(c);
    if (op === "up" && i > 0) { draft.cards.splice(i - 1, 0, draft.cards.splice(i, 1)[0]); save(); rebuild(); api.go(api.idx - 1); }
    else if (op === "down" && i < draft.cards.length - 1) { draft.cards.splice(i + 1, 0, draft.cards.splice(i, 1)[0]); save(); rebuild(); api.go(api.idx + 1); }
    else if (op === "add") {
      const n = { id: "c" + Date.now().toString(36), section: c.section, sectionFr: c.sectionFr || "", title: "New page", titleFr: "Nouvelle page", body: "Write here.", bodyFr: "Écrire ici.", layout: "article", visual: "", figure: "", notes: "" };
      draft.cards.splice(i + 1, 0, n); save(); rebuild(); api.go(api.idx + 1);
    }
    else if (op === "del") {
      if (!window.confirm("Delete the page “" + (c[F("title")] || c.title) + "” from the draft? Published revisions keep it.")) return;
      draft.cards.splice(i, 1); save(); rebuild(); api.go(Math.max(1, Math.min(api.idx, draft.cards.length)));
    }
  }

  /* ---------- in-place editing ---------- */
  function editable(el, get, set, multiline) {
    if (!el) return;
    el.contentEditable = "true"; el.classList.add("rv-ed"); el.spellcheck = true;
    el.addEventListener("keydown", e => { if (e.key === "Enter" && !multiline) { e.preventDefault(); el.blur(); } if (e.key === "Escape") { el.innerText = get(); el.blur(); } e.stopPropagation(); });
    el.addEventListener("blur", () => { const v = el.innerText.replace(/\s+\n/g, "\n").trim(); if (v !== (get() || "")) { set(v); commit(); } });
  }
  function bodyKey(c) { return F("body"); }
  function blocksOf(c) { const key = bodyKey(c); const src = (c[key] || "").trim() ? c[key] : c.body; return parseBlocks(src); }
  function writeBlocks(c, blocks) { c[bodyKey(c)] = blocks.map(b => b.src).join("\n\n"); }

  function after() {
    bar();
    if (!editing) return;
    const N = api.cards.length;
    if (api.idx === 0) {
      editable(api.root.querySelector(".rv-hero h1"), () => draft[F("title")] || draft.title, v => { draft[F("title")] = v; });
      editable(api.root.querySelector(".rv-hero .sub"), () => draft[F("subtitle")] || draft.subtitle, v => { draft[F("subtitle")] = v; });
      let msg = api.root.querySelector(".rv-hero .msg");
      if (!msg) { msg = document.createElement("p"); msg.className = "msg"; api.root.querySelector(".rv-hero").appendChild(msg); }
      editable(msg, () => draft[F("intro")] || draft.intro, v => { draft[F("intro")] = v; }, true);
      return;
    }
    const c = card(); if (!c) return;
    editable(api.root.querySelector(".rv-col h1, .rv-text h1"), () => c[F("title")] || c.title, v => { c[F("title")] = v; });
    if (api.idx === N) editable(api.root.querySelector(".rv-body > .rv-quote, .rv-body > .closing"), () => draft[F("closing")] || draft.closing, v => { draft[F("closing")] = v; }, true);
    const blocks = blocksOf(c);
    const body = api.root.querySelector(".rv-body[data-card]");
    api.root.querySelectorAll(".rv-block[data-block]").forEach(el => {
      const i = blocks.findIndex(b => b.id === el.dataset.block);
      if (i === -1) return;
      el.classList.add("rv-edblock");
      const tools = document.createElement("div"); tools.className = "rv-edtools";
      tools.innerHTML = '<button data-t="edit" title="Edit this block">✎ Edit</button><button data-t="up" title="Move up">↑</button><button data-t="down" title="Move down">↓</button><button data-t="add" title="Add a block below">+ Block</button><button data-t="del" class="danger" title="Delete this block">✕</button>';
      el.appendChild(tools);
      tools.addEventListener("click", e => {
        e.stopPropagation(); const t = e.target.dataset.t; if (!t) return;
        if (t === "edit") return openEditor(el, c, blocks, i);
        if (t === "up" && i > 0) blocks.splice(i - 1, 0, blocks.splice(i, 1)[0]);
        else if (t === "down" && i < blocks.length - 1) blocks.splice(i + 1, 0, blocks.splice(i, 1)[0]);
        else if (t === "add") { blocks.splice(i + 1, 0, { src: api.lang === "fr" ? "Nouveau paragraphe." : "New paragraph." }); writeBlocks(c, blocks); save(); rebuild(); api.render(); const nb = blocksOf(c)[i + 1]; const ne = nb && api.root.querySelector('[data-block="' + nb.id + '"]'); if (ne) openEditor(ne, c, blocksOf(c), i + 1); return; }
        else if (t === "del") { if (!window.confirm("Delete this block?")) return; blocks.splice(i, 1); }
        else return;
        writeBlocks(c, blocks); commit();
      });
      el.addEventListener("click", e => { if (e.target.closest(".rv-edtools, .rv-srcbox")) return; openEditor(el, c, blocks, i); });
    });
    if (body && !blocks.length) { const add = document.createElement("button"); add.className = "rv-addfirst"; add.textContent = "+ Add the first block"; add.addEventListener("click", () => { c[bodyKey(c)] = api.lang === "fr" ? "Écrire ici." : "Write here."; commit(); }); body.appendChild(add); }
  }
  function openEditor(el, c, blocks, i) {
    if (el.querySelector(".rv-srcbox")) return;
    const b = blocks[i];
    const box = document.createElement("div"); box.className = "rv-srcbox";
    const ta = document.createElement("textarea"); ta.value = b.src; ta.rows = Math.min(24, Math.max(3, b.src.split("\n").length + 1));
    const hint = document.createElement("div"); hint.className = "hint";
    hint.textContent = "Plain text is a paragraph. “## ” heading · “> ” callout (“> To confirm…” turns pink) · “1. ” numbered steps · “- ” bullets · “| left | right |” columns · “@ Name | Title | Role” team · “~ [Who] Stage :: note”, “~? Question :: yes → A / no → B”, “~| A || B” side by side, “~> A || B” paths, “~= …” band · **bold**, *italic*. Ctrl+Enter saves.";
    const acts = document.createElement("div"); acts.className = "acts";
    const ok = document.createElement("button"); ok.className = "primary"; ok.textContent = "Save";
    const no = document.createElement("button"); no.textContent = "Cancel";
    acts.append(ok, no); box.append(ta, acts, hint);
    Array.from(el.children).forEach(ch => { if (!ch.classList.contains("rv-edtools")) ch.style.display = "none"; });
    el.appendChild(box); ta.focus();
    const done = () => { const v = ta.value.replace(/\r\n?/g, "\n").trim(); if (!v) blocks.splice(i, 1); else blocks[i] = { src: v }; writeBlocks(c, blocks); commit(); };
    ok.addEventListener("click", e => { e.stopPropagation(); done(); });
    no.addEventListener("click", e => { e.stopPropagation(); api.render(); });
    ta.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); done(); } if (e.key === "Escape") api.render(); });
  }

  api.hooks.afterRender = after;
  rebuild();
  api.render();
}
