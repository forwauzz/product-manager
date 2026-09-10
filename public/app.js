(function () {
  "use strict";

  var STATES = ["Research", "Planned", "Building", "Live", "Needs work", "Feature flag"];
  var RND_STAGES = ["Backlog", "Assigned", "In progress", "Findings", "Concluded"];
  var ICONS = { roadmap: "▤", features: "◫", parallel: "⋔", timeline: "▦", rnd: "⚗", space: "◆" };

  /* ---------- helpers ---------- */

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function narrow() { return window.matchMedia("(max-width: 860px)").matches; }
  function mKey(d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2); }
  function dKey(d) { return mKey(d) + "-" + ("0" + d.getDate()).slice(-2); }
  function toDate(period) {
    if (!period) return null;
    var p = period.split("-");
    return p.length === 2 ? new Date(+p[0], +p[1] - 1, 1) : new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function weekStart(d) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var day = (x.getDay() + 6) % 7;
    x.setDate(x.getDate() - day);
    return x;
  }
  function wKey(d) { return dKey(weekStart(d)); }
  function wAdd(k, n) { var d = toDate(k); d.setDate(d.getDate() + n * 7); return dKey(d); }
  function wLabel(k) {
    var d = toDate(k), e = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 6);
    var a = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    var b = e.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return a + " to " + b;
  }
  function wShort(k) { var d = toDate(k); return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
  function mAdd(k, n) { var p = k.split("-"); return mKey(new Date(+p[0], +p[1] - 1 + n, 1)); }
  function mLong(k) { var p = k.split("-"); return new Date(+p[0], +p[1] - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }); }
  function mShort(k) { var p = k.split("-"); return new Date(+p[0], +p[1] - 1, 1).toLocaleDateString(undefined, { month: "short", year: "2-digit" }); }
  function qOf(k) { var p = k.split("-"); return p[0] + "-Q" + (Math.floor((+p[1] - 1) / 3) + 1); }
  function qLabel(q) { var p = q.split("-"); return p[1] + " " + p[0]; }
  function qFirst(q) { var p = q.split("-"); return p[0] + "-" + ("0" + ((+p[1].slice(1) - 1) * 3 + 1)).slice(-2); }

  /* ---------- state ---------- */

  var S = { projects: [], spaces: [], people: ["Unassigned"], students: [], features: [], current: null };
  var VERSION = 0;
  var ui = { view: "roadmap", space: null, feature: null, grain: "month", group: "state", rmode: "order", preview: null,
             spaceFilter: null, ownerFilter: "", studentFilter: "", rgroup: "stage", query: "", menu: null };
  var timer = null, dirty = false, saving = false, conflicts = 0, tombstones = {}, SESSION = { authed: true, required: false };

  function setSaveState(text, isErr) {
    var e = document.getElementById("savestate");
    e.textContent = text;
    e.className = "savestate" + (isErr ? " err" : "");
  }

  function save() {
    dirty = true;
    setSaveState("Unsaved");
    clearTimeout(timer);
    timer = setTimeout(flush, 350);
  }
  function flush() {
    if (!dirty || saving) return Promise.resolve();
    saving = true; dirty = false;
    setSaveState("Saving…");
    return fetch("/api/state", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: VERSION, state: S })
    }).then(function (r) {
      if (r.status === 401) { location.href = "/login.html"; return; }
      return r.json().then(function (body) {
        if (r.status === 409) {
          // Someone saved from another device or tab first. Merge their copy with ours and try again.
          conflicts++;
          if (conflicts > 4) { dirty = false; setSaveState("Not saved", true); toast("Could not reconcile with the copy on the server. Reload the page.", true); return; }
          S = mergeStates(S, body.state); VERSION = body.version; dirty = true;
          if (ui.feature && !feature(ui.feature)) ui.feature = null;
          render(); toast("Merged changes made elsewhere.");
          return;
        }
        if (!r.ok) throw new Error(body.error || "Save failed");
        VERSION = body.version; conflicts = 0;
        setSaveState(dirty ? "Unsaved" : "Saved");
      });
    }).catch(function (e) {
      dirty = true;
      setSaveState("Not saved", true);
      toast("Could not save: " + e.message, true);
    }).then(function () {
      saving = false;
      if (dirty) { clearTimeout(timer); timer = setTimeout(flush, conflicts ? 120 : 1500); }
    });
  }
  window.addEventListener("beforeunload", function (e) {
    if (dirty || saving) {
      clearTimeout(timer); flush();
      e.preventDefault(); e.returnValue = "";
    }
  });

  /* Three-way-ish merge used when a save conflicts: newest feature wins by its `updated` stamp,
     features created here are kept, features deleted here stay deleted, lists are unioned. */
  function mergeStates(mine, theirs) {
    var out = JSON.parse(JSON.stringify(theirs));
    out.features = out.features.filter(function (f) { return !tombstones[f.id]; });
    var byId = {};
    out.features.forEach(function (f) { byId[f.id] = f; });
    mine.features.forEach(function (f) {
      var t = byId[f.id];
      if (!t) out.features.push(f);
      else if ((f.updated || 0) >= (t.updated || 0)) Object.keys(f).forEach(function (k) { t[k] = f[k]; });
    });
    ["spaces", "people", "students"].forEach(function (k) {
      (mine[k] || []).forEach(function (x) { if (out[k].indexOf(x) === -1) out[k].push(x); });
    });
    out.projects = out.projects.filter(function (p) { return !tombstones[p.id]; });
    mine.projects.forEach(function (p) {
      var t = out.projects.filter(function (x) { return x.id === p.id; })[0];
      if (!t) out.projects.push(p); else { t.name = p.name; t.kind = p.kind; }
    });
    out.features = out.features.filter(function (f) { return out.projects.some(function (p) { return p.id === f.project; }); });
    out.current = out.projects.some(function (p) { return p.id === mine.current; }) ? mine.current : out.projects[0].id;
    return out;
  }

  function load() {
    return fetch("/api/session").then(function (r) { return r.ok ? r.json() : { authed: true, required: false }; })
      .then(function (s) {
        SESSION = s;
        if (s.required && !s.authed) { location.href = "/login.html"; return new Promise(function () {}); }
        return fetch("/api/state");
      }).then(function (r) {
        if (r.status === 401) { location.href = "/login.html"; return new Promise(function () {}); }
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).then(function (doc) {
        S = doc.state; VERSION = doc.version;
        setSaveState("Saved");
      }).catch(function (e) {
        setSaveState("Offline", true);
        toast("Could not reach the server: " + e.message, true);
      });
  }

  /* Pick up edits made on another device when this window comes back to the front. */
  function refreshIfStale() {
    if (dirty || saving || document.hidden || !VERSION) return;
    var a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.id !== "find") return;
    fetch("/api/state", { cache: "no-store" }).then(function (r) {
      if (r.status === 401) { location.href = "/login.html"; return null; }
      return r.ok ? r.json() : null;
    }).then(function (doc) {
      if (!doc || doc.version === VERSION || dirty || saving) return;
      S = doc.state; VERSION = doc.version;
      if (ui.feature && !feature(ui.feature)) ui.feature = null;
      closePreview();
      render(); toast("Updated with changes made elsewhere.");
    }).catch(function () {});
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) refreshIfStale(); });
  window.addEventListener("focus", refreshIfStale);
  setInterval(refreshIfStale, 45000);

  function project() { return S.projects.filter(function (p) { return p.id === S.current; })[0] || S.projects[0]; }
  function feats() { return S.features.filter(function (f) { return f.project === S.current; }); }
  function feature(id) { return S.features.filter(function (f) { return f.id === id; })[0]; }
  function inSpace(sp) { return feats().filter(function (f) { return (f.spaces || []).indexOf(sp) !== -1; }); }
  function rndFeats() { return feats().filter(function (f) { return f.rnd; }); }
  function touch(f) { f.updated = Date.now(); }

  function setState(f, v) {
    f.state = v;
    if (v === "Research" && !f.rnd) { f.rnd = true; toast(f.name + " tagged as R&D."); }
    touch(f);
  }
  function setRnd(f, on) {
    f.rnd = !!on;
    if (on && f.rndStage === "Concluded") f.rndStage = "Backlog";
    touch(f);
  }

  /* ---------- periods ---------- */

  function keys() {
    var out = [], i;
    if (ui.grain === "week") {
      var w = wKey(new Date());
      for (i = 0; i < 12; i++) out.push(wAdd(w, i));
      return out;
    }
    if (ui.grain === "quarter") {
      var q = qOf(mKey(new Date()));
      for (i = 0; i < 4; i++) { out.push(q); q = qOf(mAdd(qFirst(q), 3)); }
      return out;
    }
    var m = mKey(new Date());
    for (i = 0; i < 12; i++) out.push(mAdd(m, i));
    return out;
  }
  function keyOfDate(d) {
    if (ui.grain === "week") return wKey(d);
    if (ui.grain === "quarter") return qOf(mKey(d));
    return mKey(d);
  }
  function laneOfPeriod(f, ks) {
    if (!f.period) return "none";
    var k = keyOfDate(toDate(f.period));
    if (ks.indexOf(k) !== -1) return k;
    return k < ks[0] ? ks[0] : "later";
  }
  function periodFor(k) {
    if (k === "none") return null;
    if (k === "later") {
      var ks = keys(), last = ks[ks.length - 1];
      if (ui.grain === "week") return wAdd(last, 1);
      if (ui.grain === "quarter") return mAdd(qFirst(last), 3);
      return mAdd(last, 1);
    }
    if (ui.grain === "quarter") return qFirst(k);
    return k;
  }
  function laneLabel(k) {
    if (k === "none") return "No date yet";
    if (k === "later") return "Later";
    if (ui.grain === "week") return wLabel(k);
    if (ui.grain === "quarter") return qLabel(k);
    return mLong(k);
  }
  function laneShort(k) {
    if (k === "none") return "No date";
    if (k === "later") return "Later";
    if (ui.grain === "week") return wShort(k);
    if (ui.grain === "quarter") return qLabel(k);
    return mShort(k);
  }
  function periodShort(f) {
    if (!f.period) return "";
    var d = toDate(f.period);
    return ui.grain === "week" ? wShort(wKey(d)) : mShort(mKey(d));
  }

  function moveBefore(a, b) {
    if (a === b) return;
    var i = S.features.findIndex(function (f) { return f.id === a; });
    if (i === -1) return;
    var moved = S.features.splice(i, 1)[0];
    var j = S.features.findIndex(function (f) { return f.id === b; });
    S.features.splice(j === -1 ? S.features.length : j, 0, moved);
  }

  /* ---------- small builders ---------- */

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function pill(text, mod) { return el("span", "pill" + (mod ? " " + mod : ""), text); }
  function statePill(f) { return pill(f.state, f.state === "Live" ? "on" : f.state === "Feature flag" ? "gold" : ""); }
  function closeMenus() {
    Array.prototype.forEach.call(document.querySelectorAll(".menu, .wsmenu"), function (m) { m.style.display = "none"; });
  }
  document.addEventListener("click", closeMenus);
  function menu(label, entries, cls) {
    var w = el("div", "menu-wrap");
    var b = el("button", cls || "btn ghost", label);
    b.setAttribute("aria-haspopup", "true");
    var m = el("div", "menu");
    m.style.display = "none";
    entries.forEach(function (en) {
      if (!en) return;
      if (en === "-") { m.appendChild(el("div", "sep")); return; }
      var x = el("button", en[2] ? "warn" : "", en[0]);
      x.onclick = function (ev) { ev.stopPropagation(); m.style.display = "none"; en[1](); };
      m.appendChild(x);
    });
    b.onclick = function (ev) {
      ev.stopPropagation();
      var open = m.style.display !== "none";
      closeMenus();
      m.style.display = open ? "none" : "block";
    };
    w.appendChild(b); w.appendChild(m);
    return w;
  }
  function selectOf(options, current, onPick, label) {
    var s = el("select");
    s.setAttribute("aria-label", label || "Select");
    options.forEach(function (o) {
      var v = typeof o === "string" ? o : o[0];
      var t = typeof o === "string" ? o : o[1];
      var e = el("option", null, t);
      e.value = v;
      if (v === current) e.selected = true;
      s.appendChild(e);
    });
    s.onchange = function (ev) { ev.stopPropagation(); onPick(s.value); };
    s.onclick = function (ev) { ev.stopPropagation(); };
    return s;
  }
  function ownerSelect(onChange) {
    var os = el("select", "selbox");
    os.setAttribute("aria-label", "Owner filter");
    [["", "Anyone"]].concat(S.people.map(function (p) { return [p, p]; })).forEach(function (o) {
      var e = el("option", null, o[1]); e.value = o[0];
      if (o[0] === ui.ownerFilter) e.selected = true;
      os.appendChild(e);
    });
    os.onchange = function () { ui.ownerFilter = os.value; onChange(); };
    return os;
  }
  function sectionTitle(text, top) {
    var h = el("h2", null, text);
    h.style.cssText = "font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--slate);margin:" + (top || 26) + "px 0 10px;";
    return h;
  }

  /* ---------- toasts & dialogs ---------- */

  function toast(msg, isErr) {
    var host = document.getElementById("toasts");
    var t = el("div", "toast" + (isErr ? " err" : ""), msg);
    host.appendChild(t);
    requestAnimationFrame(function () { t.classList.add("show"); });
    setTimeout(function () { t.classList.remove("show"); setTimeout(function () { t.remove(); }, 250); }, isErr ? 5000 : 2600);
  }

  function dialog(build) {
    return new Promise(function (resolve) {
      var scrim = el("div", "mscrim");
      var box = el("div", "modal");
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");
      function close(v) { scrim.remove(); document.removeEventListener("keydown", onKey); resolve(v); }
      function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); close(null); } }
      document.addEventListener("keydown", onKey);
      scrim.onclick = function (e) { if (e.target === scrim) close(null); };
      build(box, close);
      scrim.appendChild(box);
      document.body.appendChild(scrim);
      var first = box.querySelector("input, select, button.btn");
      if (first) first.focus();
    });
  }
  /* Ask for one line of text. Resolves with the trimmed string, or null when cancelled. */
  function askText(title, o) {
    o = o || {};
    return dialog(function (box, close) {
      box.appendChild(el("h2", null, title));
      if (o.text) box.appendChild(el("p", null, o.text));
      var inp = el("input");
      inp.value = o.value || "";
      inp.placeholder = o.placeholder || "";
      inp.setAttribute("aria-label", title);
      box.appendChild(inp);
      var err = el("div", "err", "");
      err.style.display = "none";
      box.appendChild(err);
      var acts = el("div", "acts");
      var cancel = el("button", "btn ghost", "Cancel");
      cancel.onclick = function () { close(null); };
      var ok = el("button", "btn", o.ok || "Save");
      function submit() {
        var v = inp.value.trim();
        if (!v) { err.textContent = "Type a name first."; err.style.display = "block"; inp.focus(); return; }
        if (o.validate) { var msg = o.validate(v); if (msg) { err.textContent = msg; err.style.display = "block"; inp.focus(); return; } }
        close(v);
      }
      ok.onclick = submit;
      inp.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); submit(); } };
      acts.appendChild(cancel); acts.appendChild(ok);
      box.appendChild(acts);
      setTimeout(function () { inp.focus(); inp.select(); }, 0);
    });
  }
  function askConfirm(title, text, o) {
    o = o || {};
    return dialog(function (box, close) {
      box.appendChild(el("h2", null, title));
      if (text) box.appendChild(el("p", null, text));
      var acts = el("div", "acts");
      var cancel = el("button", "btn ghost", "Cancel");
      cancel.onclick = function () { close(false); };
      var ok = el("button", "btn" + (o.danger ? " danger" : ""), o.ok || "Confirm");
      ok.onclick = function () { close(true); };
      acts.appendChild(cancel); acts.appendChild(ok);
      box.appendChild(acts);
      setTimeout(function () { (o.danger ? cancel : ok).focus(); }, 0);
    }).then(function (v) { return !!v; });
  }
  function askProject(title, current) {
    return dialog(function (box, close) {
      box.appendChild(el("h2", null, title));
      box.appendChild(el("p", null, "A project is a separate workspace with its own roadmap, features and research."));
      var name = el("input"); name.placeholder = "Project name"; name.value = current ? current.name : "";
      name.setAttribute("aria-label", "Project name");
      var kind = el("input"); kind.placeholder = "Kind, for example SaaS or Consulting"; kind.value = current ? current.kind || "" : "";
      kind.setAttribute("aria-label", "Project kind");
      box.appendChild(name); box.appendChild(kind);
      var err = el("div", "err", ""); err.style.display = "none"; box.appendChild(err);
      var acts = el("div", "acts");
      var cancel = el("button", "btn ghost", "Cancel"); cancel.onclick = function () { close(null); };
      var ok = el("button", "btn", current ? "Save" : "Create project");
      function submit() {
        if (!name.value.trim()) { err.textContent = "Give the project a name."; err.style.display = "block"; name.focus(); return; }
        close({ name: name.value.trim(), kind: kind.value.trim() });
      }
      ok.onclick = submit;
      name.onkeydown = kind.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); submit(); } };
      acts.appendChild(cancel); acts.appendChild(ok);
      box.appendChild(acts);
    });
  }

  /* ---------- routing (hash keeps the view across reloads) ---------- */

  function writeHash() {
    var h = "#/" + ui.view;
    if (ui.feature) h = "#/feature/" + ui.feature;
    else if (ui.view === "space" && ui.space) h = "#/space/" + encodeURIComponent(ui.space);
    if (location.hash !== h) history.replaceState(null, "", h);
  }
  function readHash() {
    var m = (location.hash || "").replace(/^#\/?/, "").split("/");
    if (!m[0]) return;
    if (m[0] === "feature" && m[1] && feature(m[1])) { ui.feature = m[1]; S.current = feature(m[1]).project; return; }
    if (m[0] === "space" && m[1]) { var sp = decodeURIComponent(m[1]); if (S.spaces.indexOf(sp) !== -1) { ui.view = "space"; ui.space = sp; } return; }
    if (["roadmap", "features", "parallel", "timeline", "rnd"].indexOf(m[0]) !== -1) ui.view = m[0];
  }

  /* ---------- nav ---------- */

  function render() { renderNav(); renderView(); writeHash(); }

  function renderNav() {
    var nav = document.getElementById("nav");
    nav.innerHTML = "";

    var brand = el("div", "brand");
    brand.appendChild(el("div", "sq", "A"));
    brand.appendChild(el("b", null, "ALIE"));
    var col = el("button", "col", "«");
    col.setAttribute("aria-label", "Collapse navigation");
    col.onclick = function () { document.getElementById("app").dataset.nav = "closed"; document.getElementById("scrim").style.display = "none"; };
    brand.appendChild(col);
    nav.appendChild(brand);

    var p = project();
    var wsWrap = el("div", "ws-wrap");
    var ws = el("button", "ws");
    ws.setAttribute("aria-haspopup", "true");
    ws.appendChild(el("span", "dot"));
    var txt = el("div", "txt");
    txt.appendChild(el("b", null, p.name));
    txt.appendChild(el("span", null, p.kind || "Project"));
    ws.appendChild(txt);
    ws.appendChild(el("span", "car", "⌄"));
    ws.title = "Switch project";
    var wm = el("div", "wsmenu");
    wm.style.display = "none";
    S.projects.forEach(function (pr) {
      var b = el("button");
      b.setAttribute("aria-current", String(pr.id === S.current));
      b.appendChild(el("span", null, pr.name));
      b.appendChild(el("span", "k", String(S.features.filter(function (f) { return f.project === pr.id; }).length)));
      b.onclick = function (e) {
        e.stopPropagation(); wm.style.display = "none";
        if (pr.id === S.current) return;
        S.current = pr.id; ui.feature = null; ui.space = null; ui.spaceFilter = null;
        if (ui.view === "space") ui.view = "roadmap";
        render(); save();
      };
      wm.appendChild(b);
    });
    wm.appendChild(el("div", "sep"));
    var np = el("button", null, "+  New project");
    np.onclick = function (e) {
      e.stopPropagation(); wm.style.display = "none";
      askProject("New project").then(function (v) {
        if (!v) return;
        var pr = { id: uid(), name: v.name, kind: v.kind };
        S.projects.push(pr); S.current = pr.id; ui.feature = null; ui.space = null; ui.view = "roadmap";
        render(); save(); toast("Project " + pr.name + " created.");
      });
    };
    wm.appendChild(np);
    var rp = el("button", null, "Rename " + p.name);
    rp.onclick = function (e) {
      e.stopPropagation(); wm.style.display = "none";
      askProject("Edit project", p).then(function (v) {
        if (!v) return;
        p.name = v.name; p.kind = v.kind; render(); save();
      });
    };
    wm.appendChild(rp);
    if (S.projects.length > 1) {
      var dp = el("button", "warn", "Delete " + p.name);
      dp.onclick = function (e) {
        e.stopPropagation(); wm.style.display = "none";
        var n = feats().length;
        askConfirm("Delete " + p.name + "?", n ? "Its " + n + " feature" + (n === 1 ? "" : "s") + " will be deleted too. This cannot be undone." : "This cannot be undone.", { danger: true, ok: "Delete project" })
          .then(function (yes) {
            if (!yes) return;
            S.features.forEach(function (f) { if (f.project === p.id) tombstones[f.id] = true; });
            tombstones[p.id] = true;
            S.features = S.features.filter(function (f) { return f.project !== p.id; });
            S.projects = S.projects.filter(function (x) { return x.id !== p.id; });
            S.current = S.projects[0].id; ui.feature = null; ui.space = null; ui.view = "roadmap";
            render(); save(); toast("Project deleted.");
          });
      };
      wm.appendChild(dp);
    }
    ws.onclick = function (e) {
      e.stopPropagation();
      var open = wm.style.display !== "none";
      closeMenus();
      wm.style.display = open ? "none" : "block";
    };
    wsWrap.style.position = "relative";
    wsWrap.appendChild(ws); wsWrap.appendChild(wm);
    nav.appendChild(wsWrap);

    var scroll = el("div", "navscroll");

    scroll.appendChild(el("div", "navlabel", "MAIN"));
    [["roadmap", "Product Roadmap", ICONS.roadmap, null],
     ["features", "Features", ICONS.features, feats().length],
     ["parallel", "Parallel view", ICONS.parallel, null],
     ["timeline", "Timeline", ICONS.timeline, null],
     ["rnd", "Research & Development", ICONS.rnd, rndFeats().length]].forEach(function (it) {
      var b = el("button", "navitem" + (it[0] === "rnd" ? " rnd" : ""));
      b.setAttribute("aria-current", String(ui.view === it[0] && !ui.feature));
      b.dataset.view = it[0];
      b.appendChild(el("span", "ic", it[2]));
      b.appendChild(el("span", "nm", it[1]));
      if (it[3] !== null) b.appendChild(el("span", "ct", String(it[3])));
      b.onclick = function () { ui.view = it[0]; ui.feature = null; ui.space = null; closeNavIfNarrow(); render(); };
      if (it[0] === "rnd") {
        b.title = "Drop a feature here to push it to R&D";
        b.addEventListener("dragover", function (e) { e.preventDefault(); b.classList.add("dragover"); });
        b.addEventListener("dragleave", function () { b.classList.remove("dragover"); });
        b.addEventListener("drop", function (e) {
          e.preventDefault(); b.classList.remove("dragover");
          var f = feature(e.dataTransfer.getData("text/plain"));
          if (!f || f.rnd) return;
          setRnd(f, true); render(); save(); toast(f.name + " pushed to R&D.");
        });
      }
      scroll.appendChild(b);
    });

    var lab = el("div", "navlabel", "SPACES");
    var add = el("button", null, "+");
    add.title = "New space";
    add.setAttribute("aria-label", "New space");
    add.onclick = function (e) { e.stopPropagation(); newSpace(); };
    lab.appendChild(add);
    scroll.appendChild(lab);

    S.spaces.forEach(function (sp) {
      var b = el("button", "navitem");
      b.setAttribute("aria-current", String(ui.view === "space" && ui.space === sp && !ui.feature));
      b.appendChild(el("span", "ic", ICONS.space));
      b.appendChild(el("span", "nm", sp));
      b.appendChild(el("span", "ct", String(inSpace(sp).length)));
      b.onclick = function () { ui.view = "space"; ui.space = sp; ui.feature = null; closeNavIfNarrow(); render(); };
      b.addEventListener("dragover", function (e) { e.preventDefault(); b.classList.add("dragover"); });
      b.addEventListener("dragleave", function () { b.classList.remove("dragover"); });
      b.addEventListener("drop", function (e) {
        e.preventDefault(); b.classList.remove("dragover");
        var f = feature(e.dataTransfer.getData("text/plain"));
        if (!f) return;
        f.spaces = f.spaces || [];
        if (f.spaces.indexOf(sp) === -1) f.spaces.push(sp);
        touch(f); render(); save();
      });
      scroll.appendChild(b);
    });
    if (!S.spaces.length) {
      var hint = el("div", "note", "No spaces yet. Press + to add one.");
      hint.style.cssText = "padding:6px 22px;color:rgba(240,237,229,.5);font-size:12px;";
      scroll.appendChild(hint);
    }

    nav.appendChild(scroll);

    var foot = el("div", "navfoot");
    foot.appendChild(el("div", "av", "UT"));
    var who = el("div");
    who.appendChild(el("b", null, "Uzziel Tamon"));
    who.appendChild(el("span", null, "CEO · Chief Product Officer"));
    foot.appendChild(who);
    var gear = menu("⚙", [
      ["Team members", function () { managePeople("people"); }],
      ["Students", function () { managePeople("students"); }],
      "-",
      ["Export data (JSON)", function () { window.open("/api/export", "_blank"); }],
      ["Import data (JSON)", importData],
      "-",
      ["Reset to sample data", function () {
        askConfirm("Reset everything?", "All projects, features and research will be replaced by the sample data.", { danger: true, ok: "Reset" })
          .then(function (yes) { if (yes) resetSample(); });
      }, true],
      SESSION.required ? "-" : null,
      SESSION.required ? ["Sign out", function () {
        fetch("/api/logout", { method: "POST" }).then(function () { location.href = "/login.html"; });
      }] : null
    ], "gear");
    gear.querySelector("button").setAttribute("aria-label", "Settings");
    foot.appendChild(gear);
    nav.appendChild(foot);
  }

  function resetSample() {
    fetch("/api/reset", { method: "POST" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (doc) {
      S = doc.state; VERSION = doc.version; dirty = false;
      ui.feature = null; ui.view = "roadmap"; ui.space = null;
      render(); toast("Sample data restored.");
    }).catch(function (e) { toast("Reset failed: " + e.message, true); });
  }

  function importData() {
    var inp = document.createElement("input");
    inp.type = "file"; inp.accept = "application/json,.json";
    inp.onchange = function () {
      var file = inp.files && inp.files[0];
      if (!file) return;
      file.text().then(function (txt) {
        var doc;
        try { doc = JSON.parse(txt); } catch (e) { toast("That file is not valid JSON.", true); return; }
        var st = doc.state || doc;
        if (!st || !Array.isArray(st.features) || !Array.isArray(st.projects)) { toast("That file does not look like an export.", true); return; }
        askConfirm("Replace all data?", "Everything currently in the app will be replaced by " + file.name + ".", { danger: true, ok: "Import" }).then(function (yes) {
          if (!yes) return;
          fetch("/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: st }) })
            .then(function (r) { return r.json().then(function (b) { if (!r.ok) throw new Error(b.error || "Import failed"); return b; }); })
            .then(function (doc2) {
              S = doc2.state; VERSION = doc2.version; dirty = false;
              ui.feature = null; ui.view = "roadmap"; ui.space = null;
              render(); toast("Imported " + S.features.length + " features.");
            }).catch(function (e) { toast(e.message, true); });
        });
      });
    };
    inp.click();
  }

  function managePeople(list) {
    var title = list === "people" ? "Team members" : "Students";
    dialog(function (box, close) {
      box.appendChild(el("h2", null, title));
      box.appendChild(el("p", null, list === "people" ? "Owners you can assign features to." : "Students who can be assigned research items."));
      var chips = el("div", "people");
      function draw() {
        chips.innerHTML = "";
        S[list].forEach(function (n) {
          var c = el("button", "chip");
          c.appendChild(document.createTextNode(n));
          if (!(list === "people" && n === "Unassigned")) {
            c.appendChild(el("span", "x", "×"));
            c.title = "Remove " + n;
            c.onclick = function () {
              S[list] = S[list].filter(function (x) { return x !== n; });
              S.features.forEach(function (f) {
                if (list === "people" && f.owner === n) f.owner = "Unassigned";
                if (list === "students" && f.student === n) f.student = "";
              });
              draw(); render(); save();
            };
          }
          chips.appendChild(c);
        });
        if (!S[list].length) chips.appendChild(el("span", "note", "Nobody yet."));
      }
      draw();
      box.appendChild(chips);
      var inp = el("input"); inp.placeholder = "Add a name and press Enter"; inp.style.marginTop = "14px";
      inp.setAttribute("aria-label", "New " + (list === "people" ? "team member" : "student"));
      inp.onkeydown = function (e) {
        if (e.key !== "Enter") return;
        e.preventDefault();
        var v = inp.value.trim();
        if (!v) return;
        if (S[list].indexOf(v) === -1) {
          if (list === "people") S[list].splice(Math.max(0, S[list].indexOf("Unassigned")), 0, v); else S[list].push(v);
        }
        inp.value = ""; draw(); render(); save();
      };
      box.appendChild(inp);
      var acts = el("div", "acts");
      var ok = el("button", "btn", "Done"); ok.onclick = function () { close(true); };
      acts.appendChild(ok); box.appendChild(acts);
    });
  }

  function newSpace() {
    askText("New space", { placeholder: "For example Health or Legal", ok: "Create space",
      validate: function (v) { return S.spaces.indexOf(v) !== -1 ? "That space already exists." : ""; } })
      .then(function (n) {
        if (!n) return;
        S.spaces.push(n); render(); save(); toast("Space " + n + " created.");
      });
  }

  function closeNavIfNarrow() {
    if (narrow()) { document.getElementById("app").dataset.nav = "closed"; document.getElementById("scrim").style.display = "none"; }
  }

  /* ---------- page frame ---------- */

  function header(eyebrow, title, actions) {
    var h = el("div", "head");
    h.appendChild(el("div", "rule"));
    var row = el("div", "row");
    var grow = el("div", "grow");
    grow.appendChild(el("div", "eyebrow", eyebrow));
    grow.appendChild(el("h1", null, title));
    row.appendChild(grow);
    (actions || []).forEach(function (a) { row.appendChild(a); });
    h.appendChild(row);
    return h;
  }

  function newBtn(label, fn) {
    var b = el("button", "btn");
    b.appendChild(el("span", null, "+"));
    b.appendChild(el("span", null, label));
    b.onclick = fn;
    return b;
  }

  function spaceChips(bar) {
    S.spaces.forEach(function (sp) {
      var c = el("button", "chip", sp);
      c.setAttribute("aria-pressed", String(ui.spaceFilter === sp));
      c.onclick = function () { ui.spaceFilter = ui.spaceFilter === sp ? null : sp; renderView(); };
      bar.appendChild(c);
    });
  }

  function passes(f) {
    if (ui.spaceFilter && (f.spaces || []).indexOf(ui.spaceFilter) === -1) return false;
    if (ui.ownerFilter && f.owner !== ui.ownerFilter) return false;
    return true;
  }

  /* ---------- views ---------- */

  function renderView() {
    var host = document.getElementById("scroll");
    host.innerHTML = "";
    host.scrollTop = 0;
    if (!S.projects.length) { host.appendChild(el("div", "empty", "No projects.")); return; }
    if (ui.query.trim()) return renderSearch(host);
    if (ui.feature) { var f = feature(ui.feature); if (f) return renderFeature(host, f); ui.feature = null; }
    if (ui.view === "roadmap") return renderRoadmap(host);
    if (ui.view === "features") return renderFeatures(host);
    if (ui.view === "parallel") return renderParallel(host);
    if (ui.view === "timeline") return renderTimeline(host);
    if (ui.view === "rnd") return renderRnd(host);
    if (ui.view === "space") {
      if (S.spaces.indexOf(ui.space) !== -1) return renderSpace(host, ui.space);
      ui.view = "features";
      return renderFeatures(host);
    }
    renderRoadmap(host);
  }

  /* --- product roadmap: deployment order --- */

  function renderRoadmap(host) {
    var p = project();
    var acts = [];
    acts.push(menu("Add feature", [
      ["Create a new feature", function () { create(); }],
      "-"
    ].concat(feats().filter(function (f) { return !f.period; }).slice(0, 8).map(function (f) {
      return ["Schedule " + f.name, function () {
        f.period = mKey(new Date()); touch(f); render(); save();
      }];
    })), "btn"));
    var pr = el("button", "btn ghost", "Print");
    pr.onclick = function () { window.print(); };
    acts.push(pr);

    host.appendChild(header("PRODUCT ROADMAP", p.name + " deployment order", acts));

    var bar = el("div", "bar");
    var seg = el("div", "seg");
    [["Order", "order"], ["Timeline", "timeline"], ["Gantt", "gantt"]].forEach(function (m) {
      var b = el("button", null, m[0]);
      b.setAttribute("aria-pressed", String(ui.rmode === m[1]));
      b.onclick = function () { ui.rmode = m[1]; renderView(); };
      seg.appendChild(b);
    });
    bar.appendChild(seg);

    var g = el("div", "seg");
    [["Weekly", "week"], ["Monthly", "month"], ["Quarterly", "quarter"]].forEach(function (m) {
      var b = el("button", null, m[0]);
      b.setAttribute("aria-pressed", String(ui.grain === m[1]));
      b.onclick = function () { ui.grain = m[1]; renderView(); };
      g.appendChild(b);
    });
    bar.appendChild(g);
    spaceChips(bar);
    bar.appendChild(ownerSelect(renderView));
    host.appendChild(bar);

    if (ui.rmode === "gantt") return renderGantt(host);
    if (ui.rmode === "timeline") return renderColumns(host);

    var pad = el("div", "pad");
    var list = feats().filter(passes);
    var scheduled = list.filter(function (f) { return f.period; });
    var later = list.filter(function (f) { return !f.period; });

    var intro = el("div", "note");
    intro.style.marginBottom = "18px";
    intro.textContent = "Order top to bottom is the order things ship. Drag a row to move it, and change the owner or the month inline.";
    pad.appendChild(intro);

    if (!scheduled.length) {
      pad.appendChild(el("div", "empty", "Nothing scheduled. Use Add feature to put something on the roadmap."));
    } else {
      var byLane = {};
      var ks = keys();
      scheduled.forEach(function (f) {
        var k = laneOfPeriod(f, ks);
        (byLane[k] = byLane[k] || []).push(f);
      });
      var seq = 0;
      ks.concat(["later"]).forEach(function (k) {
        var group = byLane[k];
        if (!group || !group.length) return;
        pad.appendChild(sectionTitle(laneLabel(k)));
        var rows = el("div", "rows");
        group.forEach(function (f) { seq++; rows.appendChild(featureRow(f, seq, k)); });
        rows.addEventListener("dragover", function (e) { e.preventDefault(); });
        rows.addEventListener("drop", function (e) {
          e.preventDefault();
          var d = feature(e.dataTransfer.getData("text/plain"));
          if (!d) return;
          d.period = periodFor(k); touch(d); render(); save();
        });
        pad.appendChild(rows);
      });
    }

    if (later.length) {
      pad.appendChild(sectionTitle("Not on the roadmap yet", 32));
      var r2 = el("div", "rows");
      later.forEach(function (f) { r2.appendChild(featureRow(f, null, "none")); });
      pad.appendChild(r2);
    }

    host.appendChild(pad);
  }

  function renderColumns(host) {
    var ks = keys();
    var list = feats().filter(passes);
    var lanes = ks.map(function (k) { return { key: k, label: laneLabel(k) }; })
      .concat([{ key: "later", label: "Later" }, { key: "none", label: "No date yet" }]);

    var pad = el("div", "pad");
    var note = el("div", "note");
    note.style.marginBottom = "16px";
    note.textContent = "Every feature listed under the " + (ui.grain === "week" ? "week" : ui.grain === "quarter" ? "quarter" : "month") +
      " it ships in. Drag a card to another column to move it, or drop it onto a card to set the order inside that column.";
    pad.appendChild(note);

    var wrap = el("div", "lanes");
    var seq = 0;

    lanes.forEach(function (lane) {
      var items = list.filter(function (f) { return (f.period ? laneOfPeriod(f, ks) : "none") === lane.key; });
      var col = el("div", "lane");

      var h = el("h2");
      h.appendChild(el("span", null, lane.label));
      h.appendChild(el("em", null, String(items.length)));
      col.appendChild(h);

      var drop = el("div", "drop");
      drop.addEventListener("dragover", function (e) { e.preventDefault(); drop.classList.add("over"); });
      drop.addEventListener("dragleave", function () { drop.classList.remove("over"); });
      drop.addEventListener("drop", function (e) {
        e.preventDefault(); drop.classList.remove("over");
        var d = feature(e.dataTransfer.getData("text/plain"));
        if (!d) return;
        d.period = periodFor(lane.key); touch(d); render(); save();
      });

      var plus = el("button", "colplus", "+  New here");
      plus.onclick = function () {
        var f = create(ui.spaceFilter ? [ui.spaceFilter] : [], { period: periodFor(lane.key) });
        if (f) save();
      };
      drop.appendChild(plus);

      if (!items.length) drop.appendChild(el("div", "note", lane.key === "none" ? "Everything has a date." : "Open capacity."));

      items.forEach(function (f) {
        var n = null;
        if (lane.key !== "none") { seq++; n = seq; }
        drop.appendChild(roadCard(f, lane.key, n, lanes));
      });

      col.appendChild(drop);
      wrap.appendChild(col);
    });

    pad.appendChild(wrap);
    host.appendChild(pad);
  }

  function roadCard(f, laneKey, seq, lanes) {
    var c = el("div", "card");
    c.draggable = true;
    c.dataset.id = f.id;

    var top = el("div");
    top.style.cssText = "display:flex;gap:9px;align-items:baseline;";
    if (seq) {
      var n = el("span", null, seq + ".");
      n.style.cssText = "font-family:var(--mono);font-size:11.5px;color:var(--slate);";
      top.appendChild(n);
    }
    top.appendChild(el("h3", null, f.name));
    c.appendChild(top);

    if (f.note) c.appendChild(el("p", null, f.note.slice(0, 88)));

    var tags = el("div", "tags");
    tags.appendChild(statePill(f));
    tags.appendChild(pill(f.owner));
    (f.spaces || []).forEach(function (sp) { tags.appendChild(pill(sp)); });
    if (f.rnd) tags.appendChild(pill("R&D", "rnd"));
    if (f.link) tags.appendChild(pill("Drive"));
    c.appendChild(tags);

    var sel = el("select", "cardsel");
    sel.setAttribute("aria-label", "Move " + f.name);
    lanes.forEach(function (l) {
      var o = el("option", null, l.label);
      o.value = l.key;
      if (l.key === laneKey) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = function (e) { e.stopPropagation(); f.period = periodFor(sel.value); touch(f); render(); save(); };
    sel.onclick = function (e) { e.stopPropagation(); };
    c.appendChild(sel);

    wireDrag(c, f, function (d) {
      d.period = periodFor(laneKey);
      moveBefore(d.id, f.id);
      touch(d); render(); save();
    });
    c.onclick = function () { preview(f.id); };
    c.ondblclick = function () { open(f.id); };
    return c;
  }

  /* Shared drag wiring: makes `node` draggable for feature f and accepts drops of other features. */
  function wireDrag(node, f, onDropOther) {
    node.addEventListener("dragstart", function (e) {
      e.dataTransfer.setData("text/plain", f.id);
      e.dataTransfer.effectAllowed = "move";
      node.classList.add("dragging");
    });
    node.addEventListener("dragend", function () { node.classList.remove("dragging"); });
    if (!onDropOther) return;
    node.addEventListener("dragover", function (e) { e.preventDefault(); e.stopPropagation(); node.classList.add("dragover"); });
    node.addEventListener("dragleave", function () { node.classList.remove("dragover"); });
    node.addEventListener("drop", function (e) {
      e.preventDefault(); e.stopPropagation(); node.classList.remove("dragover");
      var d = feature(e.dataTransfer.getData("text/plain"));
      if (!d || d.id === f.id) return;
      onDropOther(d);
    });
  }

  function renderGantt(host) {
    var ks = keys();
    var list = feats().filter(passes);
    var scheduled = list.filter(function (f) { return f.period; });
    var unscheduled = list.filter(function (f) { return !f.period; });

    var pad = el("div", "pad");
    var note = el("div", "note");
    note.style.marginBottom = "16px";
    note.textContent = "Each row is a feature in deployment order. Drag a bar into another column to move it. Click a name or a bar for the description and the Drive link.";
    pad.appendChild(note);

    var frame = el("div", "gantt");
    var grid = el("div", "gt");
    grid.style.gridTemplateColumns = "260px repeat(" + ks.length + ", " + (ui.grain === "week" ? "132px" : ui.grain === "quarter" ? "190px" : "150px") + ")";

    grid.appendChild(el("div", "hd first", "Feature"));
    ks.forEach(function (k, i) { grid.appendChild(el("div", "hd" + (i === 0 ? " now" : ""), laneShort(k))); });

    function addRow(f, seq) {
      var lane = f.period ? laneOfPeriod(f, ks) : "none";
      var nc = el("div", "nc");
      nc.appendChild(el("span", "seqn", seq ? seq + "." : "—"));
      var box = el("div");
      box.appendChild(el("b", null, f.name));
      box.appendChild(el("span", null, f.owner + "  ·  " + f.state + (f.rnd ? "  ·  R&D" : "")));
      nc.appendChild(box);
      nc.onclick = function () { preview(f.id); };
      grid.appendChild(nc);

      ks.forEach(function (k, i) {
        var cell = el("div", "cell" + (i === 0 ? " nowcol" : ""));
        cell.addEventListener("dragover", function (e) { e.preventDefault(); cell.classList.add("over"); });
        cell.addEventListener("dragleave", function () { cell.classList.remove("over"); });
        cell.addEventListener("drop", function (e) {
          e.preventDefault(); cell.classList.remove("over");
          var d = feature(e.dataTransfer.getData("text/plain"));
          if (!d) return;
          d.period = periodFor(k); touch(d); render(); save();
        });
        if (lane === k) {
          var bar = el("div", "bar" + (f.state === "Live" ? " live" : f.state === "Feature flag" ? " flag" : ""), f.state);
          bar.draggable = true;
          bar.title = f.name + " — " + f.state;
          wireDrag(bar, f, null);
          bar.onclick = function () { preview(f.id); };
          cell.appendChild(bar);
        }
        grid.appendChild(cell);
      });
    }

    var seq = 0;
    scheduled.forEach(function (f) { seq++; addRow(f, seq); });
    unscheduled.forEach(function (f) { addRow(f, null); });

    frame.appendChild(grid);
    pad.appendChild(frame);
    if (!scheduled.length && !unscheduled.length) pad.appendChild(el("div", "empty", "No features yet."));
    host.appendChild(pad);
  }

  /* ---------- preview drawer ---------- */

  function closePreview() {
    ui.preview = null;
    var d = document.getElementById("drawer");
    var sc = document.getElementById("dscrim");
    if (d) d.remove();
    if (sc) sc.remove();
  }

  function preview(id) {
    closePreview();
    var f = feature(id);
    if (!f) return;
    ui.preview = id;

    var sc = el("div", "dscrim");
    sc.id = "dscrim";
    sc.onclick = closePreview;
    document.body.appendChild(sc);

    var d = el("div", "drawer");
    d.id = "drawer";
    d.setAttribute("role", "dialog");
    d.setAttribute("aria-label", f.name);

    var x = el("button", "dclose", "×");
    x.setAttribute("aria-label", "Close");
    x.onclick = closePreview;
    d.appendChild(x);

    d.appendChild(el("div", "eyebrow", ((f.spaces || []).join(" · ") || "FEATURE").toUpperCase()));
    d.appendChild(el("h2", null, f.name));

    var pills = el("div", "pills");
    pills.appendChild(statePill(f));
    pills.appendChild(pill(f.owner));
    if (f.period) pills.appendChild(pill(laneLabel(laneOfPeriod(f, keys()))));
    if (f.rnd) pills.appendChild(pill("R&D · " + f.rndStage, "rnd"));
    d.appendChild(pills);

    d.appendChild(el("p", "desc" + (f.note ? "" : " muted"), f.note || "No description yet. Add one so the team knows what this is."));

    if (f.rnd && f.rndQuestion) {
      d.appendChild(el("div", "lab", "Research question"));
      d.appendChild(el("p", "desc", f.rndQuestion));
    }

    d.appendChild(el("div", "lab", "Artifacts"));
    if (f.link) {
      var a = document.createElement("a");
      a.className = "drivebtn";
      a.href = f.link; a.target = "_blank"; a.rel = "noopener";
      a.appendChild(el("div", "g", "▲"));
      var t = el("div");
      t.appendChild(el("b", null, "Open the Drive folder"));
      t.appendChild(el("span", null, f.link.replace(/^https?:\/\//, "").slice(0, 54)));
      a.appendChild(t);
      d.appendChild(a);
    } else {
      var inp = el("input", "link");
      inp.placeholder = "Paste the Google Drive link";
      inp.setAttribute("aria-label", "Drive link");
      inp.onchange = function () { f.link = inp.value.trim(); touch(f); save(); preview(f.id); };
      d.appendChild(inp);
    }

    d.appendChild(el("div", "lab", "Change"));
    var fields = el("div");
    var rows = [
      ["State", selectOf(STATES, f.state, function (v) { setState(f, v); render(); save(); preview(f.id); }, "State")],
      ["Owner", selectOf(S.people, f.owner, function (v) { f.owner = v; touch(f); render(); save(); preview(f.id); }, "Owner")],
      ["When", selectOf([["none", "No date yet"]].concat(keys().map(function (k) { return [k, laneLabel(k)]; })).concat([["later", "Later"]]),
        f.period ? laneOfPeriod(f, keys()) : "none",
        function (v) { f.period = periodFor(v); touch(f); render(); save(); preview(f.id); }, "When")],
      ["R&D", selectOf([["no", "Not in R&D"], ["yes", "In R&D"]], f.rnd ? "yes" : "no",
        function (v) { setRnd(f, v === "yes"); render(); save(); preview(f.id); toast(f.rnd ? f.name + " pushed to R&D." : f.name + " removed from R&D."); }, "R&D")]
    ];
    if (f.rnd) {
      rows.push(["Stage", selectOf(RND_STAGES, f.rndStage, function (v) { f.rndStage = v; touch(f); render(); save(); preview(f.id); }, "R&D stage")]);
      rows.push(["Student", selectOf([["", "Nobody yet"]].concat(S.students.map(function (s) { return [s, s]; })), f.student,
        function (v) { f.student = v; if (v && f.rndStage === "Backlog") f.rndStage = "Assigned"; touch(f); render(); save(); preview(f.id); }, "Student")]);
    }
    rows.forEach(function (pair) {
      var row = el("div", "field");
      row.appendChild(el("label", null, pair[0]));
      row.appendChild(pair[1]);
      fields.appendChild(row);
    });
    d.appendChild(fields);

    var acts = el("div", "acts");
    var full = el("button", "btn", "Open full page");
    full.onclick = function () { closePreview(); open(f.id); };
    acts.appendChild(full);
    var del = el("button", "btn ghost", "Delete");
    del.onclick = function () { closePreview(); deleteFeature(f); };
    acts.appendChild(del);
    var cl = el("button", "btn ghost", "Close");
    cl.onclick = closePreview;
    acts.appendChild(cl);
    d.appendChild(acts);

    document.body.appendChild(d);
    x.focus();
  }

  function deleteFeature(f) {
    return askConfirm("Delete " + f.name + "?", "The feature and its notes will be removed. This cannot be undone.", { danger: true, ok: "Delete" })
      .then(function (yes) {
        if (!yes) return false;
        S.features = S.features.filter(function (x) { return x.id !== f.id; });
        tombstones[f.id] = true;
        if (ui.feature === f.id) ui.feature = null;
        render(); save(); toast(f.name + " deleted.");
        return true;
      });
  }

  function featureRow(f, seq, laneKey) {
    var row = el("div", "frow");
    row.draggable = true;
    row.dataset.id = f.id;

    row.appendChild(el("span", "seq", seq ? seq + "." : "—"));
    row.appendChild(el("span", "grip", "⠿"));

    var body = el("div", "body");
    body.appendChild(el("b", null, f.name));
    body.appendChild(el("span", null, f.note || "No description yet."));
    row.appendChild(body);

    var tags = el("div", "tags");
    tags.appendChild(statePill(f));
    (f.spaces || []).forEach(function (sp) { tags.appendChild(pill(sp)); });
    if (f.rnd) tags.appendChild(pill("R&D", "rnd"));
    row.appendChild(tags);

    row.appendChild(selectOf(S.people, f.owner, function (v) { f.owner = v; touch(f); render(); save(); }, "Owner of " + f.name));

    var ks = keys();
    var opts = [["none", "No date"]].concat(ks.map(function (k) { return [k, ui.grain === "quarter" ? qLabel(k) : mShort(k)]; })).concat([["later", "Later"]]);
    row.appendChild(selectOf(opts, laneKey === "none" ? "none" : laneOfPeriod(f, ks), function (v) {
      f.period = periodFor(v); touch(f); render(); save();
    }, "Period of " + f.name));

    var go = el("button", "go", "→");
    go.setAttribute("aria-label", "Open " + f.name);
    go.onclick = function (e) { e.stopPropagation(); open(f.id); };
    row.appendChild(go);

    wireDrag(row, f, function (d) {
      d.period = laneKey !== "none" ? periodFor(laneKey) : null;
      moveBefore(d.id, f.id);
      touch(d); render(); save();
    });
    row.onclick = function () { preview(f.id); };
    row.ondblclick = function () { open(f.id); };
    return row;
  }

  /* --- features index: space cards --- */

  function renderFeatures(host) {
    var p = project();
    host.appendChild(header("FEATURES", p.name + " feature spaces", [newBtn("NEW FEATURE", function () { create(); })]));

    var bar = el("div", "bar");
    spaceChips(bar);
    bar.appendChild(ownerSelect(renderView));
    host.appendChild(bar);

    var pad = el("div", "pad");
    var note = el("div", "note");
    note.style.marginBottom = "20px";
    note.textContent = "Open a space to work inside it, or drag a feature onto a space in the left nav to tag it.";
    pad.appendChild(note);

    var cards = el("div", "cards");
    S.spaces.forEach(function (sp) {
      var list = inSpace(sp);
      var c = el("button", "dcard");
      c.appendChild(el("h3", null, sp));
      c.appendChild(el("p", null, list.length + (list.length === 1 ? " feature" : " features") + " tagged " + sp.toLowerCase()));
      var stats = el("div", "stats");
      STATES.forEach(function (st) {
        var n = list.filter(function (f) { return f.state === st; }).length;
        if (n) stats.appendChild(pill(n + " " + st.toLowerCase()));
      });
      if (!list.length) stats.appendChild(pill("empty"));
      c.appendChild(stats);
      c.onclick = function () { ui.view = "space"; ui.space = sp; render(); };
      c.addEventListener("dragover", function (e) { e.preventDefault(); c.classList.add("dragover"); });
      c.addEventListener("dragleave", function () { c.classList.remove("dragover"); });
      c.addEventListener("drop", function (e) {
        e.preventDefault(); c.classList.remove("dragover");
        var f = feature(e.dataTransfer.getData("text/plain"));
        if (!f) return;
        f.spaces = f.spaces || [];
        if (f.spaces.indexOf(sp) === -1) f.spaces.push(sp);
        touch(f); render(); save();
      });
      cards.appendChild(c);
    });

    var addc = el("button", "dcard");
    addc.style.borderStyle = "dashed";
    addc.appendChild(el("h3", null, "+"));
    addc.appendChild(el("p", null, "New space"));
    addc.onclick = newSpace;
    cards.appendChild(addc);
    pad.appendChild(cards);

    pad.appendChild(sectionTitle("All features", 36));
    var list = feats().filter(passes);
    if (!list.length) pad.appendChild(el("div", "empty", "No features yet. Create one with New feature."));
    var rows = el("div", "rows");
    list.forEach(function (f) { rows.appendChild(featureRow(f, null, f.period ? laneOfPeriod(f, keys()) : "none")); });
    pad.appendChild(rows);

    host.appendChild(pad);
  }

  /* --- space view --- */

  function renderSpace(host, sp) {
    var list = inSpace(sp).filter(function (f) { return !ui.ownerFilter || f.owner === ui.ownerFilter; });

    var acts = [newBtn("NEW FEATURE", function () { create([sp]); })];
    acts.push(menu("More", [
      ["Rename space", function () {
        askText("Rename space", { value: sp, ok: "Rename",
          validate: function (v) { return v !== sp && S.spaces.indexOf(v) !== -1 ? "That space already exists." : ""; } })
          .then(function (n) {
            if (!n || n === sp) return;
            S.spaces[S.spaces.indexOf(sp)] = n;
            S.features.forEach(function (f) {
              var i = (f.spaces || []).indexOf(sp);
              if (i !== -1) f.spaces[i] = n;
            });
            if (ui.spaceFilter === sp) ui.spaceFilter = n;
            ui.space = n; render(); save();
          });
      }],
      ["Delete space", function () {
        askConfirm("Delete the " + sp + " space?", "Features stay, they only lose the tag.", { danger: true, ok: "Delete space" }).then(function (yes) {
          if (!yes) return;
          S.spaces = S.spaces.filter(function (x) { return x !== sp; });
          S.features.forEach(function (f) { f.spaces = (f.spaces || []).filter(function (x) { return x !== sp; }); });
          if (ui.spaceFilter === sp) ui.spaceFilter = null;
          ui.view = "features"; ui.space = null; render(); save();
        });
      }, true]
    ]));

    host.appendChild(header(sp.toUpperCase() + " SPACE", "Everything tagged " + sp, acts));

    var bar = el("div", "bar");
    var seg = el("div", "seg");
    [["By state", "state"], ["By date", "month"], ["By owner", "owner"]].forEach(function (m) {
      var b = el("button", null, m[0]);
      b.setAttribute("aria-pressed", String(ui.group === m[1]));
      b.onclick = function () { ui.group = m[1]; renderView(); };
      seg.appendChild(b);
    });
    bar.appendChild(seg);
    bar.appendChild(ownerSelect(renderView));
    host.appendChild(bar);

    var pad = el("div", "pad");
    if (!list.length) {
      pad.appendChild(el("div", "empty", "Nothing here yet. Create a feature, or drag one onto " + sp + " in the left nav."));
      host.appendChild(pad);
      return;
    }
    pad.appendChild(lanesFor(list, sp));
    host.appendChild(pad);
  }

  function lanesFor(list, spaceCtx) {
    var ks = keys();
    var lanes;
    if (ui.group === "month") {
      lanes = [{ key: "none", label: laneLabel("none") }]
        .concat(ks.map(function (k) { return { key: k, label: laneLabel(k) }; }))
        .concat([{ key: "later", label: "Later" }]);
    } else if (ui.group === "owner") {
      lanes = S.people.map(function (p) { return { key: p, label: p }; });
    } else {
      lanes = STATES.map(function (s) { return { key: s, label: s }; });
    }

    function keyOf(f) {
      if (ui.group === "month") return laneOfPeriod(f, ks);
      if (ui.group === "owner") return f.owner;
      return f.state;
    }
    function apply(f, k) {
      if (ui.group === "month") f.period = periodFor(k);
      else if (ui.group === "owner") f.owner = k;
      else setState(f, k);
      touch(f);
    }

    var wrap = el("div", "lanes");
    lanes.forEach(function (lane) {
      var items = list.filter(function (f) { return keyOf(f) === lane.key; });
      var col = el("div", "lane");
      var h = el("h2");
      h.appendChild(el("span", null, lane.label));
      h.appendChild(el("em", null, String(items.length)));
      col.appendChild(h);

      var drop = el("div", "drop");
      drop.addEventListener("dragover", function (e) { e.preventDefault(); drop.classList.add("over"); });
      drop.addEventListener("dragleave", function () { drop.classList.remove("over"); });
      drop.addEventListener("drop", function (e) {
        e.preventDefault(); drop.classList.remove("over");
        var f = feature(e.dataTransfer.getData("text/plain"));
        if (!f) return;
        apply(f, lane.key);
        if (spaceCtx && (f.spaces || []).indexOf(spaceCtx) === -1) f.spaces.push(spaceCtx);
        render(); save();
      });

      var plus = el("button", "colplus", "+  New here");
      plus.onclick = function () {
        var f = create(spaceCtx ? [spaceCtx] : [], null, true);
        if (f) { apply(f, lane.key); open(f.id); save(); }
      };
      drop.appendChild(plus);

      if (!items.length) drop.appendChild(el("div", "note", "Empty."));
      items.forEach(function (f) { drop.appendChild(featureCard(f, lane.key, lanes, apply)); });

      col.appendChild(drop);
      wrap.appendChild(col);
    });
    return wrap;
  }

  function featureCard(f, laneKey, lanes, apply) {
    var c = el("div", "card");
    c.draggable = true;
    c.dataset.id = f.id;
    c.appendChild(el("h3", null, f.name));
    c.appendChild(el("p", null, (f.note || "").slice(0, 92)));

    var tags = el("div", "tags");
    if (ui.group !== "state") tags.appendChild(statePill(f));
    if (ui.group !== "owner") tags.appendChild(pill(f.owner));
    if (ui.group !== "month" && f.period) tags.appendChild(pill(periodShort(f)));
    (f.spaces || []).forEach(function (sp) { tags.appendChild(pill(sp)); });
    if (f.rnd) tags.appendChild(pill("R&D", "rnd"));
    c.appendChild(tags);

    var sel = el("select", "cardsel");
    sel.setAttribute("aria-label", "Move " + f.name);
    lanes.forEach(function (l) {
      var o = el("option", null, l.label);
      o.value = l.key;
      if (l.key === laneKey) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = function (e) { e.stopPropagation(); apply(f, sel.value); render(); save(); };
    sel.onclick = function (e) { e.stopPropagation(); };
    c.appendChild(sel);

    wireDrag(c, f, function (d) {
      apply(d, laneKey);
      moveBefore(d.id, f.id);
      render(); save();
    });
    c.onclick = function () { preview(f.id); };
    c.ondblclick = function () { open(f.id); };
    return c;
  }

  /* --- parallel: one lane per space --- */

  function renderParallel(host) {
    var title = S.spaces.length ? S.spaces.slice(0, 2).join(" and ") + " side by side" : "Spaces side by side";
    host.appendChild(header("PARALLEL VIEW", title, [newBtn("NEW FEATURE", function () { create(); })]));

    var bar = el("div", "bar");
    bar.appendChild(ownerSelect(renderView));
    bar.appendChild(el("span", "note", "Drag a card into another column to tag it for that space. A feature can sit in more than one."));
    host.appendChild(bar);

    var pad = el("div", "pad");
    var wrap = el("div", "lanes");
    var list = feats().filter(function (f) { return !ui.ownerFilter || f.owner === ui.ownerFilter; });

    S.spaces.concat(["Untagged"]).forEach(function (sp) {
      var items = sp === "Untagged"
        ? list.filter(function (f) { return !(f.spaces || []).length; })
        : list.filter(function (f) { return (f.spaces || []).indexOf(sp) !== -1; });

      var col = el("div", "lane");
      var h = el("h2");
      h.appendChild(el("span", null, sp));
      h.appendChild(el("em", null, String(items.length)));
      col.appendChild(h);

      var drop = el("div", "drop");
      drop.addEventListener("dragover", function (e) { e.preventDefault(); drop.classList.add("over"); });
      drop.addEventListener("dragleave", function () { drop.classList.remove("over"); });
      drop.addEventListener("drop", function (e) {
        e.preventDefault(); drop.classList.remove("over");
        var f = feature(e.dataTransfer.getData("text/plain"));
        if (!f) return;
        f.spaces = f.spaces || [];
        if (sp === "Untagged") f.spaces = [];
        else if (f.spaces.indexOf(sp) === -1) f.spaces.push(sp);
        touch(f); render(); save();
      });

      if (sp !== "Untagged") {
        var plus = el("button", "colplus", "+  New " + sp.toLowerCase() + " feature");
        plus.onclick = function () { create([sp]); };
        drop.appendChild(plus);
      }
      if (!items.length) drop.appendChild(el("div", "note", "Empty."));

      items.forEach(function (f) {
        var c = el("div", "card");
        c.draggable = true;
        c.dataset.id = f.id;
        c.appendChild(el("h3", null, f.name));
        c.appendChild(el("p", null, (f.note || "").slice(0, 88)));
        var tags = el("div", "tags");
        tags.appendChild(statePill(f));
        tags.appendChild(pill(f.owner));
        if (f.period) tags.appendChild(pill(periodShort(f)));
        if (f.rnd) tags.appendChild(pill("R&D", "rnd"));
        (f.spaces || []).filter(function (x) { return x !== sp; }).forEach(function (x) { tags.appendChild(pill("also " + x)); });
        c.appendChild(tags);

        if (sp !== "Untagged") {
          var rm = el("button", "cardsel");
          rm.textContent = "Remove from " + sp;
          rm.onclick = function (e) {
            e.stopPropagation();
            f.spaces = (f.spaces || []).filter(function (x) { return x !== sp; });
            touch(f); render(); save();
          };
          c.appendChild(rm);
        }

        wireDrag(c, f, null);
        c.onclick = function () { preview(f.id); };
        c.ondblclick = function () { open(f.id); };
        drop.appendChild(c);
      });

      col.appendChild(drop);
      wrap.appendChild(col);
    });

    pad.appendChild(wrap);
    host.appendChild(pad);
  }

  /* --- timeline --- */

  function renderTimeline(host) {
    var word = ui.grain === "week" ? "week" : ui.grain === "quarter" ? "quarter" : "month";
    host.appendChild(header("TIMELINE", project().name + " by " + word, [newBtn("NEW FEATURE", function () { create(); })]));

    var bar = el("div", "bar");
    var seg = el("div", "seg");
    [["Weekly", "week"], ["Monthly", "month"], ["Quarterly", "quarter"]].forEach(function (m) {
      var b = el("button", null, m[0]);
      b.setAttribute("aria-pressed", String(ui.grain === m[1]));
      b.onclick = function () { ui.grain = m[1]; renderView(); };
      seg.appendChild(b);
    });
    bar.appendChild(seg);
    spaceChips(bar);
    bar.appendChild(ownerSelect(renderView));
    host.appendChild(bar);

    var saved = ui.group;
    ui.group = "month";
    var pad = el("div", "pad");
    pad.appendChild(lanesFor(feats().filter(passes), null));
    ui.group = saved;
    host.appendChild(pad);
  }

  /* --- research & development --- */

  function renderRnd(host) {
    var p = project();
    var all = rndFeats();
    var acts = [newBtn("NEW RESEARCH ITEM", function () {
      create(ui.spaceFilter ? [ui.spaceFilter] : [], { rnd: true, state: "Research", name: "New research item" });
    })];
    acts.push(menu("More", [
      ["Manage students", function () { managePeople("students"); }],
      ["Print board", function () { window.print(); }]
    ]));
    host.appendChild(header("RESEARCH & DEVELOPMENT", p.name + " research pipeline", acts));

    var bar = el("div", "bar");
    var seg = el("div", "seg");
    [["By stage", "stage"], ["By student", "student"], ["By space", "space"]].forEach(function (m) {
      var b = el("button", null, m[0]);
      b.setAttribute("aria-pressed", String(ui.rgroup === m[1]));
      b.onclick = function () { ui.rgroup = m[1]; renderView(); };
      seg.appendChild(b);
    });
    bar.appendChild(seg);
    spaceChips(bar);
    var ss = el("select", "selbox");
    ss.setAttribute("aria-label", "Student filter");
    [["", "Any student"], ["__none", "Unassigned"]].concat(S.students.map(function (s) { return [s, s]; })).forEach(function (o) {
      var e = el("option", null, o[1]); e.value = o[0];
      if (o[0] === ui.studentFilter) e.selected = true;
      ss.appendChild(e);
    });
    ss.onchange = function () { ui.studentFilter = ss.value; renderView(); };
    bar.appendChild(ss);
    host.appendChild(bar);

    var pad = el("div", "pad");

    var stats = el("div", "rndhead");
    [["In R&D", all.length],
     ["Unassigned", all.filter(function (f) { return !f.student; }).length],
     ["In progress", all.filter(function (f) { return f.rndStage === "In progress"; }).length],
     ["With findings", all.filter(function (f) { return f.rndStage === "Findings"; }).length],
     ["Concluded", all.filter(function (f) { return f.rndStage === "Concluded"; }).length]].forEach(function (s) {
      var box = el("div", "stat");
      box.appendChild(el("b", null, String(s[1])));
      box.appendChild(el("span", null, s[0]));
      stats.appendChild(box);
    });
    pad.appendChild(stats);

    var note = el("div", "note");
    note.style.marginBottom = "16px";
    note.textContent = "Anything tagged R&D lands here. Assign a student, move it through the stages, and record findings. Concluded items can be scheduled on the roadmap from the feature page.";
    pad.appendChild(note);

    var list = all.filter(function (f) {
      if (ui.spaceFilter && (f.spaces || []).indexOf(ui.spaceFilter) === -1) return false;
      if (ui.studentFilter === "__none") return !f.student;
      if (ui.studentFilter) return f.student === ui.studentFilter;
      return true;
    });

    if (!all.length) {
      pad.appendChild(el("div", "empty", "Nothing in R&D yet. Create a research item, set a feature's state to Research, or drag a feature onto Research & Development in the left nav."));
      host.appendChild(pad);
      return;
    }

    var lanes, keyOf, apply;
    if (ui.rgroup === "student") {
      lanes = [{ key: "", label: "Nobody yet" }].concat(S.students.map(function (s) { return { key: s, label: s }; }));
      keyOf = function (f) { return S.students.indexOf(f.student) === -1 ? "" : f.student; };
      apply = function (f, k) { f.student = k; if (k && f.rndStage === "Backlog") f.rndStage = "Assigned"; touch(f); };
    } else if (ui.rgroup === "space") {
      lanes = S.spaces.map(function (s) { return { key: s, label: s }; }).concat([{ key: "__untagged", label: "Untagged" }]);
      keyOf = function (f) { return null; };
      apply = function (f, k) {
        f.spaces = f.spaces || [];
        if (k === "__untagged") f.spaces = [];
        else if (f.spaces.indexOf(k) === -1) f.spaces.push(k);
        touch(f);
      };
    } else {
      lanes = RND_STAGES.map(function (s) { return { key: s, label: s }; });
      keyOf = function (f) { return f.rndStage; };
      apply = function (f, k) { f.rndStage = k; touch(f); };
    }

    var wrap = el("div", "lanes");
    lanes.forEach(function (lane) {
      var items = ui.rgroup === "space"
        ? (lane.key === "__untagged" ? list.filter(function (f) { return !(f.spaces || []).length; })
                                     : list.filter(function (f) { return (f.spaces || []).indexOf(lane.key) !== -1; }))
        : list.filter(function (f) { return keyOf(f) === lane.key; });
      var col = el("div", "lane");
      var h = el("h2");
      h.appendChild(el("span", null, lane.label));
      h.appendChild(el("em", null, String(items.length)));
      col.appendChild(h);

      var drop = el("div", "drop");
      drop.addEventListener("dragover", function (e) { e.preventDefault(); drop.classList.add("over"); });
      drop.addEventListener("dragleave", function () { drop.classList.remove("over"); });
      drop.addEventListener("drop", function (e) {
        e.preventDefault(); drop.classList.remove("over");
        var f = feature(e.dataTransfer.getData("text/plain"));
        if (!f) return;
        if (!f.rnd) setRnd(f, true);
        apply(f, lane.key);
        render(); save();
      });

      if (ui.rgroup === "stage" && lane.key === "Backlog") {
        var plus = el("button", "colplus", "+  New research item");
        plus.onclick = function () { create(ui.spaceFilter ? [ui.spaceFilter] : [], { rnd: true, state: "Research", name: "New research item" }); };
        drop.appendChild(plus);
      }
      if (!items.length) drop.appendChild(el("div", "note", "Empty."));
      items.forEach(function (f) { drop.appendChild(rndCard(f, lane.key, lanes, apply)); });

      col.appendChild(drop);
      wrap.appendChild(col);
    });
    pad.appendChild(wrap);
    host.appendChild(pad);
  }

  function rndCard(f, laneKey, lanes, apply) {
    var c = el("div", "card");
    c.draggable = true;
    c.dataset.id = f.id;
    c.appendChild(el("h3", null, f.name));
    if (f.rndQuestion) c.appendChild(el("p", "q", f.rndQuestion.slice(0, 140)));
    else c.appendChild(el("p", null, (f.note || "No research question yet.").slice(0, 92)));
    c.appendChild(el("div", "stu", f.student ? "Student: " + f.student : "No student assigned"));

    var tags = el("div", "tags");
    if (ui.rgroup !== "stage") tags.appendChild(pill(f.rndStage, "rnd"));
    tags.appendChild(statePill(f));
    tags.appendChild(pill(f.owner));
    (f.spaces || []).forEach(function (sp) { tags.appendChild(pill(sp)); });
    if (f.rndFindings) tags.appendChild(pill("findings", "gold"));
    if (f.link) tags.appendChild(pill("Drive"));
    c.appendChild(tags);

    if (ui.rgroup !== "space") {
      var sel = el("select", "cardsel");
      sel.setAttribute("aria-label", "Move " + f.name);
      lanes.forEach(function (l) {
        var o = el("option", null, l.label);
        o.value = l.key;
        if (l.key === laneKey) o.selected = true;
        sel.appendChild(o);
      });
      sel.onchange = function (e) { e.stopPropagation(); apply(f, sel.value); render(); save(); };
      sel.onclick = function (e) { e.stopPropagation(); };
      c.appendChild(sel);
    }

    wireDrag(c, f, function (d) {
      if (!d.rnd) setRnd(d, true);
      apply(d, laneKey);
      moveBefore(d.id, f.id);
      render(); save();
    });
    c.onclick = function () { preview(f.id); };
    c.ondblclick = function () { open(f.id); };
    return c;
  }

  /* --- feature detail --- */

  function renderFeature(host, f) {
    var back = el("button", "btn ghost", "Back");
    back.onclick = function () { ui.feature = null; render(); };
    var more = menu("More", [
      [f.rnd ? "Remove from R&D" : "Push to R&D", function () {
        setRnd(f, !f.rnd); render(); save();
        toast(f.rnd ? f.name + " pushed to R&D." : f.name + " removed from R&D.");
      }],
      ["Duplicate", function () {
        var c = JSON.parse(JSON.stringify(f));
        c.id = uid(); c.name = f.name + " copy"; c.created = c.updated = Date.now();
        S.features.push(c); open(c.id); save();
      }],
      ["Move to another project", function () {
        if (S.projects.length < 2) { toast("There is only one project.", true); return; }
        dialog(function (box, close) {
          box.appendChild(el("h2", null, "Move " + f.name));
          box.appendChild(el("p", null, "Pick the project this feature belongs to."));
          var sel = el("select");
          S.projects.forEach(function (p) { var o = el("option", null, p.name); o.value = p.id; if (p.id === f.project) o.selected = true; sel.appendChild(o); });
          box.appendChild(sel);
          var acts = el("div", "acts");
          var cancel = el("button", "btn ghost", "Cancel"); cancel.onclick = function () { close(null); };
          var ok = el("button", "btn", "Move"); ok.onclick = function () { close(sel.value); };
          acts.appendChild(cancel); acts.appendChild(ok); box.appendChild(acts);
        }).then(function (pid) {
          if (!pid || pid === f.project) return;
          f.project = pid; touch(f); S.current = pid; render(); save();
          toast("Moved to " + project().name + ".");
        });
      }],
      "-",
      ["Delete", function () { deleteFeature(f); }, true]
    ]);

    host.appendChild(header((f.spaces || []).join(" · ").toUpperCase() || "FEATURE", f.name, [back, more]));

    var pad = el("div", "pad");
    var g = el("div", "grid2");

    var left = el("div");
    var nameIn = el("input");
    nameIn.value = f.name;
    nameIn.setAttribute("aria-label", "Feature name");
    nameIn.style.cssText = "width:100%;font-size:22px;font-weight:600;letter-spacing:-.02em;border:1px solid transparent;border-radius:12px;padding:10px 12px;margin-bottom:14px;";
    nameIn.onfocus = function () { nameIn.style.borderColor = "var(--line)"; };
    nameIn.onblur = function () { nameIn.style.borderColor = "transparent"; if (!f.name.trim()) { f.name = "Untitled"; nameIn.value = f.name; } render(); };
    nameIn.oninput = function () { f.name = nameIn.value; touch(f); renderNav(); var h = host.querySelector(".head h1"); if (h) h.textContent = f.name; save(); };
    left.appendChild(nameIn);

    var ta = el("textarea", "writer");
    ta.value = f.note;
    ta.placeholder = "What this feature is, where it stands, what has to happen next, and what the team needs to know.";
    ta.setAttribute("aria-label", "Description");
    ta.oninput = function () { f.note = ta.value; touch(f); save(); };
    left.appendChild(ta);

    if (f.rnd) {
      left.appendChild(el("div", "sublab", "Research question"));
      var q = el("textarea", "writer small");
      q.style.marginTop = "0";
      q.value = f.rndQuestion;
      q.placeholder = "The question the student should answer. What would a good result look like?";
      q.setAttribute("aria-label", "Research question");
      q.oninput = function () { f.rndQuestion = q.value; touch(f); save(); };
      left.appendChild(q);

      left.appendChild(el("div", "sublab", "Findings"));
      var fd = el("textarea", "writer small");
      fd.style.marginTop = "0";
      fd.value = f.rndFindings;
      fd.placeholder = "What was learned, what was tried, and the recommendation for the product.";
      fd.setAttribute("aria-label", "Findings");
      fd.oninput = function () { f.rndFindings = fd.value; touch(f); save(); };
      left.appendChild(fd);
    }
    g.appendChild(left);

    var right = el("div");

    var p1 = el("div", "panel");
    p1.appendChild(el("h3", null, "Status"));
    [["State", selectOf(STATES, f.state, function (v) { setState(f, v); render(); save(); }, "State")],
     ["Owner", selectOf(S.people.concat(["+ Add someone"]), f.owner, function (v) {
        if (v === "+ Add someone") {
          askText("Add a team member", { placeholder: "Name", ok: "Add" }).then(function (n) {
            if (n) { if (S.people.indexOf(n) === -1) S.people.splice(Math.max(0, S.people.indexOf("Unassigned")), 0, n); f.owner = n; touch(f); }
            render(); save();
          });
          return;
        }
        f.owner = v; touch(f); render(); save();
     }, "Owner")],
     ["When", selectOf([["none", "No date yet"]].concat(keys().map(function (k) { return [k, laneLabel(k)]; })).concat([["later", "Later"]]),
        f.period ? laneOfPeriod(f, keys()) : "none",
        function (v) { f.period = periodFor(v); touch(f); render(); save(); }, "When")]
    ].forEach(function (pair) {
      var row = el("div", "field");
      row.appendChild(el("label", null, pair[0]));
      row.appendChild(pair[1]);
      p1.appendChild(row);
    });
    right.appendChild(p1);

    var pr = el("div", "panel");
    pr.style.marginTop = "18px";
    pr.appendChild(el("h3", null, "Research & Development"));
    if (f.rnd) {
      [["Stage", selectOf(RND_STAGES, f.rndStage, function (v) { f.rndStage = v; touch(f); render(); save(); }, "R&D stage")],
       ["Student", selectOf([["", "Nobody yet"]].concat(S.students.map(function (s) { return [s, s]; })).concat([["+ Add student", "+ Add a student"]]), f.student, function (v) {
          if (v === "+ Add student") {
            askText("Add a student", { placeholder: "Name", ok: "Add" }).then(function (n) {
              if (n) { if (S.students.indexOf(n) === -1) S.students.push(n); f.student = n; if (f.rndStage === "Backlog") f.rndStage = "Assigned"; touch(f); }
              render(); save();
            });
            return;
          }
          f.student = v; if (v && f.rndStage === "Backlog") f.rndStage = "Assigned"; touch(f); render(); save();
       }, "Student")]
      ].forEach(function (pair) {
        var row = el("div", "field");
        row.appendChild(el("label", null, pair[0]));
        row.appendChild(pair[1]);
        pr.appendChild(row);
      });
      var out = el("button", "btn ghost rowbtn", "Remove from R&D");
      out.onclick = function () { setRnd(f, false); render(); save(); toast(f.name + " removed from R&D."); };
      pr.appendChild(out);
    } else {
      pr.appendChild(el("div", "note", "Not in R&D. Push it there to have a student research it before it is scoped."));
      var push = el("button", "btn rowbtn", "Push to R&D");
      push.onclick = function () { setRnd(f, true); render(); save(); toast(f.name + " pushed to R&D."); };
      pr.appendChild(push);
    }
    right.appendChild(pr);

    var p2 = el("div", "panel");
    p2.style.marginTop = "18px";
    p2.appendChild(el("h3", null, "Spaces"));
    var chips = el("div");
    chips.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;";
    S.spaces.forEach(function (sp) {
      var c = el("button", "chip", sp);
      c.setAttribute("aria-pressed", String((f.spaces || []).indexOf(sp) !== -1));
      c.onclick = function () {
        f.spaces = f.spaces || [];
        var i = f.spaces.indexOf(sp);
        if (i === -1) f.spaces.push(sp); else f.spaces.splice(i, 1);
        touch(f); render(); save();
      };
      chips.appendChild(c);
    });
    var addSp = el("button", "chip", "+ New space");
    addSp.onclick = function () {
      askText("New space", { placeholder: "For example Health or Legal", ok: "Create space",
        validate: function (v) { return S.spaces.indexOf(v) !== -1 ? "That space already exists." : ""; } }).then(function (n) {
        if (!n) return;
        S.spaces.push(n); f.spaces.push(n); touch(f); render(); save();
      });
    };
    chips.appendChild(addSp);
    p2.appendChild(chips);
    right.appendChild(p2);

    var p3 = el("div", "panel");
    p3.style.marginTop = "18px";
    p3.appendChild(el("h3", null, "Artifacts"));
    var lk = el("input");
    lk.value = f.link || "";
    lk.placeholder = "Google Drive folder link";
    lk.setAttribute("aria-label", "Drive link");
    lk.style.cssText = "width:100%;border:1px solid var(--line);border-radius:999px;padding:9px 14px;font-size:12.5px;font-family:var(--mono);";
    lk.oninput = function () { f.link = lk.value.trim(); touch(f); save(); };
    lk.onchange = function () { render(); };
    p3.appendChild(lk);
    if (f.link) {
      var a = el("a", null, "Open in Drive");
      a.href = f.link; a.target = "_blank"; a.rel = "noopener";
      a.style.cssText = "display:inline-block;margin-top:12px;font-size:13px;color:var(--ink);";
      p3.appendChild(a);
    }
    right.appendChild(p3);

    var p4 = el("div", "panel");
    p4.style.marginTop = "18px";
    p4.appendChild(el("h3", null, "Ships after"));
    var order = feats().filter(function (x) { return x.period; });
    var idx = order.indexOf(f);
    var line = el("div", "note");
    if (idx === -1) {
      line.textContent = "Not on the roadmap yet. Pick a date under Status to place it.";
    } else {
      var prev = idx > 0 ? order[idx - 1] : null;
      var next = idx < order.length - 1 ? order[idx + 1] : null;
      line.innerHTML = (prev ? "After <b>" + esc(prev.name) + "</b>" : "First on the roadmap") +
        (next ? ", before <b>" + esc(next.name) + "</b>" : "") + ".";
    }
    p4.appendChild(line);
    var meta = el("div", "note");
    meta.style.marginTop = "10px";
    meta.textContent = "Updated " + new Date(f.updated).toLocaleString();
    p4.appendChild(meta);
    right.appendChild(p4);

    g.appendChild(right);
    pad.appendChild(g);
    host.appendChild(pad);
  }

  /* --- search --- */

  function renderSearch(host) {
    var q = ui.query.trim().toLowerCase();
    var hits = S.features.filter(function (f) {
      return (f.name + " " + f.note + " " + f.owner + " " + f.state + " " + f.student + " " + f.rndQuestion + " " + (f.spaces || []).join(" ") + (f.rnd ? " r&d research" : "")).toLowerCase().indexOf(q) !== -1;
    });
    host.appendChild(header("SEARCH", hits.length + (hits.length === 1 ? " result" : " results") + " for “" + ui.query.trim() + "”", []));
    var pad = el("div", "pad");
    if (!hits.length) pad.appendChild(el("div", "empty", "No match."));
    var rows = el("div", "rows");
    hits.forEach(function (f) {
      var r = featureRow(f, null, f.period ? laneOfPeriod(f, keys()) : "none");
      var pr = S.projects.filter(function (p) { return p.id === f.project; })[0];
      if (pr && pr.id !== S.current) r.querySelector(".body").appendChild(el("span", "meta", "In " + pr.name));
      rows.appendChild(r);
    });
    pad.appendChild(rows);
    host.appendChild(pad);
  }

  /* ---------- actions ---------- */

  function create(spaces, extra, silent) {
    var f = { id: uid(), project: S.current, name: "New feature", state: "Planned", owner: "Unassigned",
              spaces: spaces || [], period: null, note: "", link: "", rnd: false, rndStage: "Backlog",
              student: "", rndQuestion: "", rndFindings: "", created: Date.now(), updated: Date.now() };
    if (extra) Object.keys(extra).forEach(function (k) { f[k] = extra[k]; });
    S.features.push(f);
    if (!silent) { open(f.id); save(); }
    return f;
  }
  function open(id) {
    closePreview();
    var f = feature(id);
    if (f && f.project !== S.current) S.current = f.project;
    ui.feature = id; ui.query = "";
    document.getElementById("find").value = "";
    render();
    var n = document.querySelector('input[aria-label="Feature name"]');
    if (n && f && (f.name === "New feature" || f.name === "New research item")) { n.focus(); n.select(); }
  }

  /* ---------- global wiring ---------- */

  document.getElementById("burger").onclick = function () {
    var a = document.getElementById("app");
    a.dataset.nav = a.dataset.nav === "open" ? "closed" : "open";
    document.getElementById("scrim").style.display = a.dataset.nav === "open" && narrow() ? "block" : "none";
  };
  document.getElementById("expand").onclick = function () {
    document.getElementById("app").dataset.nav = "open";
    document.getElementById("scrim").style.display = narrow() ? "block" : "none";
  };
  document.getElementById("scrim").onclick = function () {
    document.getElementById("app").dataset.nav = "closed";
    document.getElementById("scrim").style.display = "none";
  };
  document.getElementById("find").oninput = function (e) { ui.query = e.target.value; renderView(); };
  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); document.getElementById("find").focus(); document.getElementById("find").select(); }
    if (e.key === "Escape") {
      if (ui.preview) { closePreview(); return; }
      var find = document.getElementById("find");
      if (ui.query) { ui.query = ""; find.value = ""; find.blur(); renderView(); }
    }
  });
  window.addEventListener("hashchange", function () {
    var before = JSON.stringify([ui.view, ui.feature, ui.space]);
    readHash();
    if (JSON.stringify([ui.view, ui.feature, ui.space]) !== before) render();
  });

  load().then(function () {
    readHash();
    if (narrow()) document.getElementById("app").dataset.nav = "closed";
    render();
  });

  /* Exposed for tests and debugging only. */
  window.__alie = { state: function () { return S; }, version: function () { return VERSION; }, ui: ui, render: render, flush: flush, save: save, open: open, preview: preview };
})();
