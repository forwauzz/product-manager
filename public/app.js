(function () {
  "use strict";

  var STATES = ["Research", "Planned", "Building", "Live", "Needs work", "Feature flag"];
  var RND_STAGES = ["Backlog", "Assigned", "In progress", "Findings", "Concluded"];
  var ICONS = { roadmap: "▤", features: "◫", parallel: "⋔", timeline: "▦", rnd: "⚗", icp: "◎", space: "◆" };

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
             spaceFilter: null, ownerFilter: "", studentFilter: "", rgroup: "stage", query: "", menu: null,
             icpFilter: "", stateFilter: "", requestedOnly: false, imode: "matrix", itab: "buyers", icpOpen: null, fview: "grouped", fmode: "cards", smode: "browse", spaceSel: null };
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
    out.icps = (out.icps || []).filter(function (i) { return !tombstones[i.id]; });
    (mine.icps || []).forEach(function (i) {
      var t = out.icps.filter(function (x) { return x.id === i.id; })[0];
      if (!t) out.icps.push(i); else Object.keys(i).forEach(function (k) { t[k] = i[k]; });
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
  function stateClass(st) { return "st-" + String(st || "").toLowerCase().replace(/[^a-z]+/g, "-"); }
  function statePill(f) { return pill(f.state, "st " + stateClass(f.state)); }
  function childrenOf(f) { return feats().filter(function (x) { return x.parent === f.id; }); }
  function parentOf(f) { return f.parent ? feature(f.parent) : null; }
  function dimIf(sel, when) { sel.classList.toggle("dim", !!when); return sel; }
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
    else if (ui.view === "icp" && ui.icpOpen) h = "#/icp/" + ui.icpOpen;
    else if (ui.view === "space" && ui.space) h = "#/space/" + encodeURIComponent(ui.space) + (ui.spaceSel ? "/" + ui.spaceSel : "");
    if (location.hash !== h) history.replaceState(null, "", h);
  }
  function readHash() {
    var m = (location.hash || "").replace(/^#\/?/, "").split("/");
    if (!m[0]) return;
    if (m[0] === "feature" && m[1] && feature(m[1])) { ui.feature = m[1]; S.current = feature(m[1]).project; return; }
    if (m[0] === "icp" && m[1] && S.icps.some(function (x) { return x.id === m[1]; })) { ui.view = "icp"; ui.icpOpen = m[1]; return; }
    if (m[0] === "space" && m[1]) { var sp = decodeURIComponent(m[1]); if (S.spaces.indexOf(sp) !== -1) { ui.view = "space"; ui.space = sp; if (m[2] && feature(m[2])) ui.spaceSel = m[2]; } return; }
    if (["roadmap", "features", "parallel", "timeline", "rnd", "icp"].indexOf(m[0]) !== -1) ui.view = m[0];
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
     ["rnd", "Research & Development", ICONS.rnd, rndFeats().length],
     ["icp", "Market / ICP", ICONS.icp, S.icps.length]].forEach(function (it) {
      var b = el("button", "navitem" + (it[0] === "rnd" ? " rnd" : ""));
      b.setAttribute("aria-current", String(ui.view === it[0] && !ui.feature));
      b.dataset.view = it[0];
      b.appendChild(el("span", "ic", it[2]));
      b.appendChild(el("span", "nm", it[1]));
      if (it[3] !== null) b.appendChild(el("span", "ct", String(it[3])));
      b.onclick = function () { ui.view = it[0]; ui.feature = null; ui.space = null; ui.icpOpen = null; if (it[0] === "features") ui.fmode = "cards"; closeNavIfNarrow(); render(); };
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
    if (actions && actions.length) {
      var acts = el("div", "headacts");
      actions.forEach(function (a) { acts.appendChild(a); });
      row.appendChild(acts);
    }
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
    if (ui.icpFilter && (f.icps || []).indexOf(ui.icpFilter) === -1) return false;
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
    if (ui.view === "icp") {
      if (ui.icpOpen) { var ic = icpById(ui.icpOpen); if (ic) return renderIcpPage(host, ic); ui.icpOpen = null; }
      return renderIcp(host);
    }
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
    if (S.icps.length) bar.appendChild(icpSelect(renderView));
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
    icpsOf(f).forEach(function (icp) { tags.appendChild(pill(icp.name, "icp")); });
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
    icpsOf(f).forEach(function (icp) { pills.appendChild(pill(icp.name, "icp")); });
    var dpar = parentOf(f);
    if (dpar) pills.appendChild(pill("Part of " + dpar.name, "sub"));
    var dkids = childrenOf(f).length;
    if (dkids) pills.appendChild(pill(dkids + " sub-feature" + (dkids === 1 ? "" : "s"), "sub"));
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
        S.features.forEach(function (x) { if (x.parent === f.id) { x.parent = null; touch(x); } });
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
    var par = parentOf(f);
    if (par && !row.classList.contains("sub")) body.appendChild(el("span", "meta", "Part of " + par.name));
    row.appendChild(body);

    var tags = el("div", "tags");
    tags.appendChild(statePill(f));
    (f.spaces || []).forEach(function (sp) { tags.appendChild(pill(sp)); });
    if (f.rnd) tags.appendChild(pill("R&D", "rnd"));
    var kids = childrenOf(f).length;
    if (kids) tags.appendChild(pill(kids + " sub", "sub"));
    row.appendChild(tags);

    row.appendChild(dimIf(selectOf(S.people, f.owner, function (v) { f.owner = v; touch(f); render(); save(); }, "Owner of " + f.name), f.owner === "Unassigned"));

    var ks = keys();
    var opts = [["none", "No date"]].concat(ks.map(function (k) { return [k, ui.grain === "quarter" ? qLabel(k) : mShort(k)]; })).concat([["later", "Later"]]);
    row.appendChild(dimIf(selectOf(opts, laneKey === "none" ? "none" : laneOfPeriod(f, ks), function (v) {
      f.period = periodFor(v); touch(f); render(); save();
    }, "Period of " + f.name), !f.period));

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

  /* --- feature thumbnails: small line illustrations chosen from what the feature does --- */

  var THUMBS = [
    ["auto", "Automatic"], ["document", "Document"], ["editor", "Editor"], ["upload", "Upload"], ["list", "List"], ["board", "Dashboard"],
    ["chat", "Chat"], ["calendar", "Calendar"], ["search", "Search"], ["settings", "Settings"], ["people", "People"], ["mic", "Dictation"],
    ["workflow", "Workflow"], ["bin", "Recycle bin"], ["shield", "Security"], ["globe", "Language"], ["exam", "Examination"], ["matrix", "Matrix"], ["spark", "Other"]
  ];
  var THUMB_SVG = {
    document: '<rect x="52" y="18" width="56" height="70" rx="6"/><path d="M64 36h32M64 48h32M64 60h22M64 72h28"/>',
    editor: '<rect x="40" y="18" width="80" height="66" rx="6"/><path d="M40 34h80M52 48h20M52 58h36M52 68h28"/><rect x="92" y="46" width="18" height="26" rx="3"/>',
    upload: '<path d="M44 72v10a6 6 0 0 0 6 6h60a6 6 0 0 0 6-6V72"/><path d="M80 66V22M64 38l16-16 16 16"/>',
    list: '<rect x="40" y="22" width="80" height="14" rx="4"/><rect x="40" y="43" width="80" height="14" rx="4"/><rect x="40" y="64" width="80" height="14" rx="4"/><circle cx="49" cy="29" r="2.5"/><circle cx="49" cy="50" r="2.5"/><circle cx="49" cy="71" r="2.5"/>',
    board: '<rect x="36" y="20" width="40" height="28" rx="5"/><rect x="84" y="20" width="40" height="28" rx="5"/><rect x="36" y="56" width="88" height="26" rx="5"/><path d="M44 32h24M92 32h24M44 68h50"/>',
    chat: '<path d="M40 30a8 8 0 0 1 8-8h44a8 8 0 0 1 8 8v22a8 8 0 0 1-8 8H66l-14 12V60h-4a8 8 0 0 1-8-8z"/><path d="M110 46h4a8 8 0 0 1 8 8v18a8 8 0 0 1-8 8h-2v10l-12-10H84"/><path d="M54 36h34M54 46h22"/>',
    calendar: '<rect x="40" y="24" width="80" height="62" rx="6"/><path d="M40 40h80M56 18v12M104 18v12"/><rect x="52" y="50" width="12" height="10" rx="2"/><rect x="74" y="50" width="12" height="10" rx="2"/><rect x="96" y="50" width="12" height="10" rx="2"/><rect x="52" y="66" width="12" height="10" rx="2"/><rect x="74" y="66" width="12" height="10" rx="2"/>',
    search: '<circle cx="72" cy="48" r="22"/><path d="M88 64l22 22M62 48h20M72 38v20"/>',
    settings: '<path d="M44 34h72M44 54h72M44 74h72"/><circle cx="66" cy="34" r="6" fill="var(--bone)"/><circle cx="96" cy="54" r="6" fill="var(--bone)"/><circle cx="72" cy="74" r="6" fill="var(--bone)"/>',
    people: '<circle cx="64" cy="38" r="11"/><path d="M40 84a24 24 0 0 1 48 0"/><circle cx="100" cy="42" r="9"/><path d="M92 84a20 20 0 0 1 32-16"/>',
    mic: '<rect x="68" y="16" width="24" height="42" rx="12"/><path d="M52 50a28 28 0 0 0 56 0M80 78v10M66 88h28"/>',
    workflow: '<rect x="30" y="40" width="26" height="20" rx="5"/><rect x="67" y="18" width="26" height="20" rx="5"/><rect x="67" y="62" width="26" height="20" rx="5"/><rect x="104" y="40" width="26" height="20" rx="5"/><path d="M56 50h6l5-22h0M62 50l5 22M93 28l11 22M93 72l11-22"/>',
    bin: '<path d="M48 32h64M68 32v-8h24v8M56 32l4 56h40l4-56M72 44v32M88 44v32"/>',
    shield: '<path d="M80 16l32 12v24c0 20-14 32-32 40-18-8-32-20-32-40V28z"/><path d="M68 52l9 9 16-18"/>',
    globe: '<circle cx="80" cy="52" r="32"/><path d="M48 52h64M80 20c14 14 14 50 0 64M80 20c-14 14-14 50 0 64"/>',
    exam: '<circle cx="80" cy="24" r="8"/><path d="M80 32v30M60 44h40M80 62l-14 26M80 62l14 26"/>',
    matrix: '<rect x="38" y="22" width="84" height="60" rx="5"/><path d="M38 42h84M38 62h84M66 22v60M94 22v60"/><path d="M48 32l4 4 6-8M76 52l4 4 6-8M104 72l4 4 6-8"/>',
    spark: '<path d="M80 20v20M80 64v20M48 52h20M92 52h20M60 32l8 8M92 64l8 8M60 72l8-8M92 40l8-8"/>'
  };
  var THUMB_RULES = [
    ["mic", /dictat|voice|record/i], ["bin", /recycle|bin\b|delete|trash/i], ["calendar", /schedule|calendar|appointment/i],
    ["chat", /chat|ask alie|message|conversation|slash|command/i], ["search", /search|find|duplicate|filter/i],
    ["upload", /upload|source|file|document registry|ocr/i], ["people", /collaborat|share|portal|member|consent|opinion|request/i],
    ["shield", /security|password|two-factor|law 25|breach/i], ["globe", /language|bilingual|theme|french|english/i],
    ["settings", /setting|profile|billing|configuration|default|preference|account|workspace|tour|letterhead|signature/i],
    ["workflow", /workflow|segmentation|automation|prompt|studio|engine|generat|chronolog|extract|brief/i],
    ["exam", /examination|physical|body/i], ["matrix", /matrix|overlap|queue|review|unreadable/i],
    ["editor", /editor|section|draft|letter|report|package|conclusion|questionnaire|mandate|diagnos|identif|history|medication|paraclinical/i],
    ["board", /dashboard|command center|overview|widget|context|home|registry|case file|left panel|tracker/i],
    ["list", /list|library|registry|tab|drafts|monitor|menu|legend/i]
  ];
  function thumbKind(f) {
    if (f.thumb && f.thumb !== "auto" && THUMB_SVG[f.thumb]) return f.thumb;
    var hay = f.name + " " + (f.note || "").slice(0, 80);
    for (var i = 0; i < THUMB_RULES.length; i++) if (THUMB_RULES[i][1].test(hay)) return THUMB_RULES[i][0];
    return "spark";
  }
  function thumbEl(f, cls) {
    var d = el("div", "thumb " + stateClass(f.state) + (cls ? " " + cls : ""));
    d.innerHTML = '<svg viewBox="0 0 160 104" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (THUMB_SVG[thumbKind(f)] || THUMB_SVG.spark) + "</svg>";
    return d;
  }
  function thumbPicker(f, onPick) {
    var row = el("div", "thumbs");
    THUMBS.forEach(function (t) {
      var b = el("button", "thbtn");
      b.type = "button";
      b.title = t[1];
      b.setAttribute("aria-label", t[1]);
      b.setAttribute("aria-pressed", String((f.thumb || "auto") === t[0]));
      var probe = { name: f.name, note: f.note, state: f.state, thumb: t[0] === "auto" ? "" : t[0] };
      b.appendChild(thumbEl(probe, "sm"));
      if (t[0] === "auto") b.appendChild(el("span", null, "Auto"));
      b.onclick = function () {
        onPick(t[0] === "auto" ? "" : t[0]);
        Array.prototype.forEach.call(row.children, function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      };
      row.appendChild(b);
    });
    return row;
  }

  /* --- features: three large cards, then a space with a sub-menu of main features --- */

  function spaceIcon(sp) {
    var n = sp.toLowerCase();
    if (n.indexOf("health") !== -1 || n.indexOf("clinic") !== -1 || n.indexOf("medic") !== -1) return "clinic";
    if (n.indexOf("legal") !== -1 || n.indexOf("law") !== -1) return "lawyer";
    if (n.indexOf("admin") !== -1 || n.indexOf("setting") !== -1) return "institution";
    return "other";
  }
  function spaceBlurb(sp) {
    var n = sp.toLowerCase();
    if (n.indexOf("health") !== -1) return "The clinical workspace: cases, review, the report editor.";
    if (n.indexOf("legal") !== -1) return "The legal workspace: case files, chat, chronologies, letters.";
    if (n.indexOf("admin") !== -1) return "Accounts, security, workspaces, billing and settings.";
    return "";
  }
  /* Main features of a space: top-level features tagged with it, plus parents of tagged sub-features. */
  function mainsIn(sp) {
    var out = [], seen = {};
    feats().forEach(function (f) {
      var p = f.parent ? feature(f.parent) : null;
      var tagged = (f.spaces || []).indexOf(sp) !== -1;
      if (!f.parent && tagged && !seen[f.id]) { seen[f.id] = true; out.push(f); }
      else if (p && tagged && !seen[p.id]) { seen[p.id] = true; out.push(p); }
    });
    return out;
  }
  function subsOf(f) { return childrenOf(f); }

  function renderFeatures(host) {
    var p = project();
    if (ui.fmode === "all") return renderAllFeatures(host);
    host.appendChild(header("FEATURES", p.name + " features", [newBtn("NEW FEATURE", function () { create(); })]));
    var pad = el("div", "pad");
    var cards = el("div", "spacecards");
    S.spaces.forEach(function (sp) {
      var mains = mainsIn(sp);
      var subs = 0;
      mains.forEach(function (m) { subs += subsOf(m).length; });
      var all = inSpace(sp);
      var c = el("button", "spacecard");
      c.appendChild(avatarEl(spaceIcon(sp), "lg"));
      c.appendChild(el("h2", null, sp));
      var blurb = spaceBlurb(sp);
      if (blurb) c.appendChild(el("p", null, blurb));
      c.appendChild(el("div", "count", mains.length + " main feature" + (mains.length === 1 ? "" : "s") + (subs ? " · " + subs + " sub-functionalit" + (subs === 1 ? "y" : "ies") : "")));
      var dots = el("div", "dots");
      STATES.forEach(function (st) {
        var n = all.filter(function (f) { return f.state === st; }).length;
        if (!n) return;
        var d = el("span", "dot " + stateClass(st));
        d.appendChild(el("i"));
        d.appendChild(document.createTextNode(n + " " + st.toLowerCase()));
        dots.appendChild(d);
      });
      if (!all.length) dots.appendChild(el("span", "note", "Nothing tagged yet."));
      c.appendChild(dots);
      c.onclick = function () { ui.view = "space"; ui.space = sp; ui.spaceSel = null; ui.smode = "browse"; render(); };
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
    pad.appendChild(cards);
    var foot = el("div", "spacefoot");
    var all = el("button", "chip", "Browse all " + feats().length + " features as a list");
    all.onclick = function () { ui.fmode = "all"; renderView(); };
    foot.appendChild(all);
    var addSp = el("button", "chip", "+ New space");
    addSp.onclick = newSpace;
    foot.appendChild(addSp);
    pad.appendChild(foot);
    host.appendChild(pad);
  }

  /* The former flat views (grouped, grid, list), one click away from the cards. */
  function renderAllFeatures(host) {
    var p = project();
    var back = el("button", "btn ghost", "Spaces");
    back.onclick = function () { ui.fmode = "cards"; renderView(); };
    host.appendChild(header("FEATURES", p.name + " · all features", [back, newBtn("NEW FEATURE", function () { create(); })]));

    var bar = el("div", "bar");
    var vseg = el("div", "seg");
    [["Grouped", "grouped"], ["Grid", "grid"], ["List", "list"]].forEach(function (m) {
      var b = el("button", null, m[0]);
      b.setAttribute("aria-pressed", String(ui.fview === m[1]));
      b.onclick = function () { ui.fview = m[1]; renderView(); };
      vseg.appendChild(b);
    });
    bar.appendChild(vseg);
    spaceChips(bar);
    var stf = el("select", "selbox");
    stf.setAttribute("aria-label", "State filter");
    [["", "Any state"]].concat(STATES.map(function (x) { return [x, x]; })).forEach(function (o) {
      var e = el("option", null, o[1]); e.value = o[0];
      if (o[0] === ui.stateFilter) e.selected = true;
      stf.appendChild(e);
    });
    stf.onchange = function () { ui.stateFilter = stf.value; renderView(); };
    bar.appendChild(stf);
    bar.appendChild(ownerSelect(renderView));
    if (S.icps.length) bar.appendChild(icpSelect(renderView));
    host.appendChild(bar);

    var pad = el("div", "pad");
    pad.appendChild(stateLegend());
    var list = feats().filter(function (f) { return passes(f) && (!ui.stateFilter || f.state === ui.stateFilter); });
    if (!list.length) pad.appendChild(el("div", "empty", "No features match."));
    else if (ui.fview === "grid") pad.appendChild(featureGrid(list));
    else if (ui.fview === "list") {
      var rows = el("div", "rows");
      list.forEach(function (f) { rows.appendChild(featureRow(f, null, f.period ? laneOfPeriod(f, keys()) : "none")); });
      pad.appendChild(rows);
    } else pad.appendChild(featureGroups(list));
    host.appendChild(pad);
  }

  /* --- space view: sub-menu on the left, the selected feature as large cards on the right --- */

  function renderSpace(host, sp) {
    var acts = [newBtn("NEW FEATURE", function () { create([sp]); })];
    acts.push(menu("More", [
      [ui.smode === "board" ? "Browse view" : "Board view", function () { ui.smode = ui.smode === "board" ? "browse" : "board"; renderView(); }],
      "-",
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
    var back = el("button", "btn ghost", "Spaces");
    back.onclick = function () { ui.view = "features"; ui.space = null; ui.fmode = "cards"; render(); };
    host.appendChild(header(sp.toUpperCase() + " SPACE", sp + " features", [back].concat(acts)));

    if (ui.smode === "board") {
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
      var list = inSpace(sp).filter(function (f) { return !ui.ownerFilter || f.owner === ui.ownerFilter; });
      if (!list.length) pad.appendChild(el("div", "empty", "Nothing here yet."));
      else pad.appendChild(lanesFor(list, sp));
      host.appendChild(pad);
      return;
    }

    var mains = mainsIn(sp).sort(function (a, b) { return a.name.localeCompare(b.name); });
    var pad2 = el("div", "pad");
    if (!mains.length) {
      pad2.appendChild(el("div", "empty", "Nothing here yet. Create a feature, or drag one onto " + sp + " in the left nav."));
      host.appendChild(pad2);
      return;
    }
    var sel = ui.spaceSel ? feature(ui.spaceSel) : null;
    if (!sel || (sel.spaces.indexOf(sp) === -1 && !(sel.parent && feature(sel.parent) && feature(sel.parent).spaces.indexOf(sp) !== -1) && mains.indexOf(sel) === -1)) sel = mains[0];
    var selMain = sel.parent ? feature(sel.parent) || sel : sel;
    ui.spaceSel = sel.id;

    var grid = el("div", "spacegrid");

    /* sub-menu */
    var nav = el("nav", "subnav");
    nav.setAttribute("aria-label", sp + " features");
    var lab = el("div", "sublab", mains.length + " main features");
    lab.style.margin = "0 0 8px";
    nav.appendChild(lab);
    var list2 = el("div", "subnav-list");
    mains.forEach(function (m) {
      var kids = subsOf(m);
      var item = el("button", "sn" + (m.id === selMain.id ? " on" : ""));
      item.appendChild(el("i", "sd " + stateClass(m.state)));
      item.appendChild(el("span", "nm", m.name));
      if (kids.length) item.appendChild(el("span", "ct", String(kids.length)));
      item.onclick = function () { ui.spaceSel = m.id; renderView(); };
      list2.appendChild(item);
      if (m.id === selMain.id && kids.length) {
        var sub = el("div", "snsub");
        kids.forEach(function (k) {
          var b = el("button", "sn kid" + (k.id === sel.id ? " on" : ""));
          b.appendChild(el("i", "sd " + stateClass(k.state)));
          b.appendChild(el("span", "nm", k.name));
          b.onclick = function () { ui.spaceSel = k.id; renderView(); };
          sub.appendChild(b);
        });
        list2.appendChild(sub);
      }
    });
    nav.appendChild(list2);
    /* narrow screens get a dropdown instead of the list */
    var dd = el("select", "subnav-select selbox");
    dd.setAttribute("aria-label", "Pick a feature");
    mains.forEach(function (m) {
      var o = el("option", null, m.name); o.value = m.id; if (m.id === sel.id) o.selected = true; dd.appendChild(o);
      subsOf(m).forEach(function (k) { var ok = el("option", null, " — " + k.name); ok.value = k.id; if (k.id === sel.id) ok.selected = true; dd.appendChild(ok); });
    });
    dd.onchange = function () { ui.spaceSel = dd.value; renderView(); };
    nav.appendChild(dd);
    grid.appendChild(nav);

    grid.appendChild(featureSheet(sel, sp));
    pad2.appendChild(grid);
    host.appendChild(pad2);
  }

  function domainBadges(f) {
    var w = el("div", "domains");
    (f.spaces || []).forEach(function (s) {
      var b = el("span", "dom");
      b.appendChild(avatarEl(spaceIcon(s), "xs"));
      b.appendChild(document.createTextNode(s));
      w.appendChild(b);
    });
    if (!(f.spaces || []).length) w.appendChild(el("span", "note", "No space yet"));
    return w;
  }

  /* One feature as a large card, with its sub-functionalities as large cards under it. */
  function featureSheet(f, sp) {
    var box = el("div", "sheet");
    var par = parentOf(f);
    var top = el("div", "sheetcard");
    top.appendChild(thumbEl(f, "sheet"));
    top.appendChild(el("div", "eyebrow", par ? "SUB-FUNCTIONALITY" : "MAIN FEATURE"));
    if (par) {
      var pl = el("button", "parentlink", "Part of " + par.name);
      pl.onclick = function () { ui.spaceSel = par.id; renderView(); };
      top.appendChild(pl);
    }
    top.appendChild(el("h2", null, f.name));
    var meta = el("div", "pills");
    meta.appendChild(statePill(f));
    if (f.owner && f.owner !== "Unassigned") meta.appendChild(pill(f.owner));
    if (f.period) meta.appendChild(pill(laneLabel(laneOfPeriod(f, keys()))));
    if (f.rnd) meta.appendChild(pill("R&D · " + f.rndStage, "rnd"));
    icpsOf(f).forEach(function (i) { meta.appendChild(pill(i.name, "icp")); });
    top.appendChild(meta);
    top.appendChild(domainBadges(f));
    top.appendChild(el("p", "desc" + (f.note ? "" : " muted"), f.note || "No description yet. Open the page to write what this is."));
    var acts = el("div", "acts");
    var edit = el("button", "btn", "Open page");
    edit.onclick = function () { open(f.id); };
    acts.appendChild(edit);
    var quick = el("button", "btn ghost", "Quick edit");
    quick.onclick = function () { preview(f.id); };
    acts.appendChild(quick);
    if (f.link) { var lk = el("a", "btn ghost", "Drive"); lk.href = f.link; lk.target = "_blank"; lk.rel = "noopener"; acts.appendChild(lk); }
    top.appendChild(acts);
    box.appendChild(top);

    var kids = par ? [] : subsOf(f);
    if (!par) {
      var h = el("div", "sheethead");
      h.appendChild(el("h3", null, "Sub-functionalities"));
      h.appendChild(el("em", null, kids.length ? String(kids.length) : "none yet"));
      box.appendChild(h);
      var cards = el("div", "bigcards");
      kids.forEach(function (k) {
        var c = el("div", "bigcard " + stateClass(k.state));
        c.setAttribute("role", "button");
        c.tabIndex = 0;
        c.draggable = true;
        c.dataset.id = k.id;
        c.appendChild(thumbEl(k));
        var ch = el("div", "bch");
        ch.appendChild(el("h4", null, k.name));
        ch.appendChild(statePill(k));
        c.appendChild(ch);
        c.appendChild(el("p", null, k.note || "No description yet."));
        var extra = el("div", "bcf");
        if (k.spaces.some(function (s) { return s !== sp; })) extra.appendChild(domainBadges(k));
        if (k.owner && k.owner !== "Unassigned") extra.appendChild(pill(k.owner));
        if (k.period) extra.appendChild(pill(periodShort(k)));
        c.appendChild(extra);
        wireDrag(c, k, null);
        c.onclick = function () { ui.spaceSel = k.id; renderView(); };
        c.ondblclick = function () { open(k.id); };
        c.onkeydown = function (e) { if (e.key === "Enter") { ui.spaceSel = k.id; renderView(); } };
        cards.appendChild(c);
      });
      var add = el("button", "bigcard add");
      add.appendChild(el("h4", null, "+ Add a sub-functionality"));
      add.appendChild(el("p", null, "It shows up here and in the sub-menu."));
      add.onclick = function () { create(f.spaces.slice(), { parent: f.id, name: "New sub-feature" }); };
      cards.appendChild(add);
      box.appendChild(cards);
    } else {
      var sibs = subsOf(par).filter(function (x) { return x.id !== f.id; });
      if (sibs.length) {
        var h2 = el("div", "sheethead");
        h2.appendChild(el("h3", null, "Also under " + par.name));
        h2.appendChild(el("em", null, String(sibs.length)));
        box.appendChild(h2);
        var row = el("div", "chips");
        sibs.forEach(function (x) {
          var c = el("button", "chip", x.name);
          c.onclick = function () { ui.spaceSel = x.id; renderView(); };
          row.appendChild(c);
        });
        box.appendChild(row);
      }
    }
    return box;
  }

  /* --- grouped and grid views of features --- */

  function stateLegend() {
    var lg = el("div", "legend");
    STATES.forEach(function (st) {
      var b = el("button", "lg " + stateClass(st));
      b.setAttribute("aria-pressed", String(ui.stateFilter === st));
      b.appendChild(el("i"));
      b.appendChild(document.createTextNode(st));
      b.onclick = function () { ui.stateFilter = ui.stateFilter === st ? "" : st; renderView(); };
      lg.appendChild(b);
    });
    return lg;
  }

  /* Groups: every top-level feature with its sub-features under it. A sub-feature whose parent
     is filtered out still shows, under its parent, so nothing disappears. */
  function groupsFor(list) {
    var inList = {};
    list.forEach(function (f) { inList[f.id] = true; });
    var groups = [], seen = {};
    function add(parent) {
      if (seen[parent.id]) return;
      seen[parent.id] = true;
      groups.push({ parent: parent, kids: childrenOf(parent).filter(function (k) { return inList[k.id]; }), own: !!inList[parent.id] });
    }
    feats().forEach(function (f) {
      if (f.parent) { var p = feature(f.parent); if (p && inList[f.id]) add(p); }
      else if (inList[f.id]) add(f);
    });
    return groups;
  }

  function featureGroups(list) {
    var wrap = el("div");
    groupsFor(list).forEach(function (g) {
      var box = el("div", "group" + (g.own ? "" : " ghost"));
      var head = featureRow(g.parent, null, g.parent.period ? laneOfPeriod(g.parent, keys()) : "none");
      head.classList.add("head");
      box.appendChild(head);
      if (g.kids.length) {
        var sub = el("div", "subrows");
        g.kids.forEach(function (k) {
          var r = featureRow(k, null, k.period ? laneOfPeriod(k, keys()) : "none");
          r.classList.add("sub");
          sub.appendChild(r);
        });
        box.appendChild(sub);
      }
      var addSub = el("button", "addsub", "+ Sub-feature");
      addSub.onclick = function (e) { e.stopPropagation(); create(g.parent.spaces.slice(), { parent: g.parent.id, name: "New sub-feature" }); };
      box.appendChild(addSub);
      wrap.appendChild(box);
    });
    return wrap;
  }

  function featureGrid(list) {
    var wrap = el("div");
    groupsFor(list).forEach(function (g) {
      var sec = el("div", "gridsec");
      var h = el("div", "gridhead");
      var t = el("button", null, g.parent.name);
      t.onclick = function () { preview(g.parent.id); };
      h.appendChild(t);
      h.appendChild(statePill(g.parent));
      h.appendChild(el("em", null, g.kids.length ? g.kids.length + " sub-feature" + (g.kids.length === 1 ? "" : "s") : ""));
      sec.appendChild(h);
      var tiles = el("div", "tiles");
      (g.kids.length ? g.kids : [g.parent]).forEach(function (f) { tiles.appendChild(tile(f)); });
      sec.appendChild(tiles);
      wrap.appendChild(sec);
    });
    return wrap;
  }

  function tile(f) {
    var t = el("div", "tile " + stateClass(f.state));
    t.draggable = true;
    t.dataset.id = f.id;
    t.setAttribute("role", "button");
    t.tabIndex = 0;
    t.appendChild(thumbEl(f, "tile"));
    t.appendChild(el("b", null, f.name));
    if (f.note) t.appendChild(el("p", null, f.note));
    var foot = el("div", "tf");
    foot.appendChild(el("span", "st", f.state));
    if (f.owner && f.owner !== "Unassigned") foot.appendChild(el("span", null, f.owner));
    if (f.period) foot.appendChild(el("span", null, periodShort(f)));
    if (f.rnd) foot.appendChild(el("span", null, "R&D"));
    t.appendChild(foot);
    wireDrag(t, f, null);
    t.onclick = function () { preview(f.id); };
    t.ondblclick = function () { open(f.id); };
    t.onkeydown = function (e) { if (e.key === "Enter") open(f.id); };
    return t;
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

  /* --- market / ICP: ideal client profiles --- */

  var ICP_AVATARS = [["regime", "Regime"], ["institution", "Institution"], ["physician", "Physician"], ["lawyer", "Lawyer"], ["paralegal", "Paralegal"],
                     ["person", "Person"], ["law-firm", "Law firm"], ["clinic", "Clinic"], ["insurer", "Insurer"], ["employer", "Employer"], ["other", "Other"]];
  var AVATAR_SVG = {
    "regime": '<path d="M3 9.5 12 4l9 5.5H3z"/><path d="M5 9.5v8M10 9.5v8M14 9.5v8M19 9.5v8M3 17.5h18M3 20.5h18"/>',
    "institution": '<path d="M4 20h16M5 20V9h14v11M9 20v-5h6v5M3 9h18M12 3v3M9.5 6h5"/>',
    "physician": '<circle cx="11" cy="7" r="3.5"/><path d="M4 20a7 7 0 0 1 12.5-4.3"/><path d="M17.5 13.5v6M14.5 16.5h6"/>',
    "lawyer": '<path d="M12 4v16M7 20h10M12 6 5 8.5M12 6l7 2.5"/><path d="M2.5 13.5a2.5 2.5 0 0 0 5 0L5 8.5zM16.5 13.5a2.5 2.5 0 0 0 5 0L19 8.5z"/>',
    "paralegal": '<circle cx="10" cy="7" r="3.5"/><path d="M3 20a7 7 0 0 1 11-5.7"/><path d="M15 12h6v8h-6zM17 15h2M17 17.5h2"/>',
    "person": '<circle cx="12" cy="7.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    "law-firm": '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 12.5h18M10 12.5v2h4v-2"/>',
    "clinic": '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 8.5v7M8.5 12h7"/>',
    "insurer": '<path d="M3 12a9 9 0 0 1 18 0zM12 12v6a2 2 0 0 0 4 0M12 3v1.5"/>',
    "employer": '<path d="M3 20V9l5 3V9l5 3V9l5 3v8zM3 20h18M7 16.5h2M11 16.5h2M15 16.5h2"/>',
    "other": '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1.5"/>'
  };
  function avatarLabel(key) { var m = ICP_AVATARS.filter(function (a) { return a[0] === key; })[0]; return m ? m[1] : "Profile"; }
  function avatarEl(key, cls) {
    var d = el("div", "avatar" + (cls ? " " + cls : ""));
    d.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (AVATAR_SVG[key] || AVATAR_SVG.other) + "</svg>";
    d.title = avatarLabel(key);
    return d;
  }

  function icpById(id) { return S.icps.filter(function (x) { return x.id === id; })[0]; }
  function icpsOf(f) { return (f.icps || []).map(icpById).filter(Boolean); }
  function regimes() { return S.icps.filter(function (x) { return x.kind === "Regime"; }); }
  function buyers() { return S.icps.filter(function (x) { return x.kind !== "Regime"; }); }
  function featuresFor(icp) { return feats().filter(function (f) { return (f.icps || []).indexOf(icp.id) !== -1; }); }
  function buyersIn(regime) { return buyers().filter(function (b) { return (b.regimes || []).indexOf(regime.id) !== -1; }); }
  function coverageLabel(n, total) {
    if (!n) return "untagged";
    if (total > 1 && n === total) return "core";
    if (n === 1) return "independent";
    return "shared";
  }
  function blankIcp(kind) {
    return { id: uid(), name: "", kind: kind === "Regime" ? "Regime" : "Buyer", avatar: kind === "Regime" ? "regime" : "person",
             description: "", tam: "", sam: "", som: "", notes: "", regimes: [], facts: [] };
  }

  /* Avatar picker: a row of icon buttons. */
  function avatarPicker(current, onPick) {
    var row = el("div", "avatars");
    ICP_AVATARS.forEach(function (a) {
      var b = el("button", "avbtn");
      b.type = "button";
      b.setAttribute("aria-pressed", String(current === a[0]));
      b.setAttribute("aria-label", a[1]);
      b.title = a[1];
      b.appendChild(avatarEl(a[0], "sm"));
      b.onclick = function () {
        onPick(a[0]);
        Array.prototype.forEach.call(row.children, function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      };
      row.appendChild(b);
    });
    return row;
  }
  function regimeChips(selected, onToggle) {
    var wrap = el("div", "chips");
    var rs = regimes();
    if (!rs.length) { wrap.appendChild(el("span", "note", "No regimes yet. Add them under the Regimes tab.")); return wrap; }
    rs.forEach(function (r) {
      var c = el("button", "chip", r.name);
      c.type = "button";
      c.setAttribute("aria-pressed", String(selected.indexOf(r.id) !== -1));
      c.onclick = function () {
        var i = selected.indexOf(r.id);
        if (i === -1) selected.push(r.id); else selected.splice(i, 1);
        c.setAttribute("aria-pressed", String(i === -1));
        onToggle(selected);
      };
      wrap.appendChild(c);
    });
    return wrap;
  }

  /* Quick create / edit dialog. The profile page carries the rest (notes, facts). */
  function askIcp(title, current) {
    var draft = JSON.parse(JSON.stringify(current || blankIcp("Buyer")));
    return dialog(function (box, close) {
      box.appendChild(el("h2", null, title));
      var name = el("input"); name.placeholder = draft.kind === "Regime" ? "Regime name, for example CNESST" : "Segment name, for example Worker-side law firms"; name.value = draft.name;
      name.setAttribute("aria-label", "Profile name");
      box.appendChild(name);
      var kindRow = el("div", "seg");
      kindRow.style.marginBottom = "12px";
      var regimeBox;
      [["Regime", "Regime"], ["Buyer", "Buyer"]].forEach(function (k) {
        var b = el("button", null, k[1]);
        b.type = "button";
        b.setAttribute("aria-pressed", String(draft.kind === k[0]));
        b.onclick = function () {
          draft.kind = k[0];
          Array.prototype.forEach.call(kindRow.children, function (x) { x.setAttribute("aria-pressed", String(x === b)); });
          regimeBox.style.display = draft.kind === "Regime" ? "none" : "block";
        };
        kindRow.appendChild(b);
      });
      box.appendChild(kindRow);
      box.appendChild(el("label", "sm", "Icon"));
      box.appendChild(avatarPicker(draft.avatar, function (v) { draft.avatar = v; }));
      var desc = el("textarea"); desc.placeholder = "One or two lines: who they are and what the statute makes them produce."; desc.value = draft.description;
      desc.setAttribute("aria-label", "Description");
      box.appendChild(desc);
      box.appendChild(el("label", "sm", "Market size"));
      var cols = el("div", "cols");
      var tam = el("input"); tam.placeholder = "TAM"; tam.value = draft.tam; tam.setAttribute("aria-label", "TAM");
      var sam = el("input"); sam.placeholder = "SAM"; sam.value = draft.sam; sam.setAttribute("aria-label", "SAM");
      var som = el("input"); som.placeholder = "SOM"; som.value = draft.som; som.setAttribute("aria-label", "SOM");
      cols.appendChild(tam); cols.appendChild(sam); cols.appendChild(som);
      box.appendChild(cols);
      regimeBox = el("div");
      regimeBox.appendChild(el("label", "sm", "Regimes they work in"));
      regimeBox.appendChild(regimeChips(draft.regimes, function () {}));
      regimeBox.style.display = draft.kind === "Regime" ? "none" : "block";
      box.appendChild(regimeBox);
      var err = el("div", "err", ""); err.style.display = "none"; box.appendChild(err);
      var acts = el("div", "acts");
      var cancel = el("button", "btn ghost", "Cancel"); cancel.onclick = function () { close(null); };
      var ok = el("button", "btn", current ? "Save" : "Create");
      function submit() {
        if (!name.value.trim()) { err.textContent = "Give it a name."; err.style.display = "block"; name.focus(); return; }
        draft.name = name.value.trim(); draft.description = desc.value.trim();
        draft.tam = tam.value.trim(); draft.sam = sam.value.trim(); draft.som = som.value.trim();
        if (draft.kind === "Regime") { draft.regimes = []; if (draft.avatar === "person") draft.avatar = "regime"; }
        close(draft);
      }
      ok.onclick = submit;
      name.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); submit(); } };
      acts.appendChild(cancel); acts.appendChild(ok);
      box.appendChild(acts);
      setTimeout(function () { name.focus(); }, 0);
    });
  }

  function newIcp(kind) {
    askIcp(kind === "Regime" ? "New regime" : "New buyer profile", blankIcp(kind)).then(function (v) {
      if (!v) return;
      S.icps.push(v); render(); save(); toast((v.kind === "Regime" ? "Regime " : "Profile ") + v.name + " created.");
    });
  }
  function editIcp(icp) {
    askIcp("Edit " + icp.name, icp).then(function (v) {
      if (!v) return;
      Object.keys(v).forEach(function (k) { icp[k] = v[k]; });
      if (icp.kind === "Regime") S.icps.forEach(function (b) { b.regimes = (b.regimes || []).filter(function (r) { return r !== icp.id || b.kind !== "Regime"; }); });
      render(); save();
    });
  }
  function deleteIcp(icp) {
    var n = featuresFor(icp).length;
    askConfirm("Delete " + icp.name + "?", n ? n + " feature" + (n === 1 ? "" : "s") + " will lose the tag. Features themselves stay." : "Features stay untouched.", { danger: true, ok: "Delete" })
      .then(function (yes) {
        if (!yes) return;
        S.icps = S.icps.filter(function (x) { return x.id !== icp.id; });
        S.features.forEach(function (f) { f.icps = (f.icps || []).filter(function (x) { return x !== icp.id; }); });
        S.icps.forEach(function (b) { b.regimes = (b.regimes || []).filter(function (r) { return r !== icp.id; }); });
        tombstones[icp.id] = true;
        if (ui.icpFilter === icp.id) ui.icpFilter = "";
        if (ui.icpOpen === icp.id) ui.icpOpen = null;
        render(); save(); toast(icp.name + " deleted.");
      });
  }
  function toggleIcp(f, id) {
    f.icps = f.icps || [];
    var i = f.icps.indexOf(id);
    if (i === -1) f.icps.push(id); else f.icps.splice(i, 1);
    touch(f);
  }
  function openIcp(id) { ui.icpOpen = id; ui.view = "icp"; ui.feature = null; render(); }

  function icpSelect(onChange) {
    var s = el("select", "selbox");
    s.setAttribute("aria-label", "Profile filter");
    var o0 = el("option", null, "Any profile"); o0.value = ""; s.appendChild(o0);
    [["Regimes", regimes()], ["Buyers", buyers()]].forEach(function (g) {
      if (!g[1].length) return;
      var og = document.createElement("optgroup"); og.label = g[0];
      g[1].forEach(function (i) { var e = el("option", null, i.name); e.value = i.id; if (i.id === ui.icpFilter) e.selected = true; og.appendChild(e); });
      s.appendChild(og);
    });
    s.onchange = function () { ui.icpFilter = s.value; onChange(); };
    return s;
  }

  /* ---- the Market / ICP page: Regimes | Buyers | Overlap ---- */

  function renderIcp(host) {
    var p = project();
    var tab = ui.itab || "buyers";
    var acts = [];
    if (tab === "regimes") acts.push(newBtn("NEW REGIME", function () { newIcp("Regime"); }));
    else acts.push(newBtn("NEW BUYER", function () { newIcp("Buyer"); }));
    acts.push(menu("More", [
      ["New regime", function () { newIcp("Regime"); }],
      ["New buyer profile", function () { newIcp("Buyer"); }],
      "-",
      ["Print", function () { window.print(); }]
    ]));
    host.appendChild(header("MARKET / ICP", p.name + " · who we serve", acts));

    var bar = el("div", "bar");
    var seg = el("div", "seg");
    [["Regimes", "regimes", regimes().length], ["Buyers", "buyers", buyers().length], ["Overlap", "overlap", null]].forEach(function (m) {
      var b = el("button", null, m[0] + (m[2] !== null ? "  " + m[2] : ""));
      b.setAttribute("aria-pressed", String(tab === m[1]));
      b.onclick = function () { ui.itab = m[1]; renderView(); };
      seg.appendChild(b);
    });
    bar.appendChild(seg);
    if (tab === "overlap") {
      var seg2 = el("div", "seg");
      [["Matrix", "matrix"], ["Lanes", "lanes"]].forEach(function (m) {
        var b = el("button", null, m[0]);
        b.setAttribute("aria-pressed", String((ui.imode || "matrix") === m[1]));
        b.onclick = function () { ui.imode = m[1]; renderView(); };
        seg2.appendChild(b);
      });
      bar.appendChild(seg2);
      spaceChips(bar);
      var st = el("select", "selbox");
      st.setAttribute("aria-label", "State filter");
      [["", "Any state"]].concat(STATES.map(function (x) { return [x, x]; })).forEach(function (o) {
        var e = el("option", null, o[1]); e.value = o[0];
        if (o[0] === ui.stateFilter) e.selected = true;
        st.appendChild(e);
      });
      st.onchange = function () { ui.stateFilter = st.value; renderView(); };
      bar.appendChild(st);
      var req = el("button", "chip", "Requested only");
      req.setAttribute("aria-pressed", String(!!ui.requestedOnly));
      req.onclick = function () { ui.requestedOnly = !ui.requestedOnly; renderView(); };
      bar.appendChild(req);
    }
    host.appendChild(bar);

    var pad = el("div", "pad");
    if (tab === "regimes") renderRegimesTab(pad);
    else if (tab === "buyers") renderBuyersTab(pad);
    else renderOverlapTab(pad);
    host.appendChild(pad);
  }

  function renderRegimesTab(pad) {
    var note = el("p", "icpdesc");
    note.textContent = "The statute that commissions the work. Each regime sets the volume, the buyer and the price. Open one to keep its numbers and notes.";
    pad.appendChild(note);
    var rs = regimes();
    var grid = el("div", "icpcards");
    rs.forEach(function (r) { grid.appendChild(icpCard(r)); });
    var add = el("button", "icpcard add");
    add.appendChild(el("h3", null, "+"));
    add.appendChild(el("p", null, "New regime"));
    add.onclick = function () { newIcp("Regime"); };
    grid.appendChild(add);
    pad.appendChild(grid);
  }

  function renderBuyersTab(pad) {
    var note = el("p", "icpdesc");
    note.textContent = "Who we serve. Open a profile for its notebook: what matters to them, their numbers, and the features they ask for.";
    pad.appendChild(note);
    var grid = el("div", "icpcards");
    buyers().forEach(function (b) { grid.appendChild(icpCard(b)); });
    var add = el("button", "icpcard add");
    add.appendChild(el("h3", null, "+"));
    add.appendChild(el("p", null, "New buyer profile"));
    add.onclick = function () { newIcp("Buyer"); };
    grid.appendChild(add);
    pad.appendChild(grid);
  }

  function icpCard(icp) {
    var c = el("div", "icpcard");
    c.setAttribute("role", "button");
    c.tabIndex = 0;
    var top = el("div", "top");
    top.appendChild(avatarEl(icp.avatar));
    var t = el("div", "t");
    t.appendChild(el("div", "kind", icp.kind === "Regime" ? "Regime" : avatarLabel(icp.avatar)));
    t.appendChild(el("h3", null, icp.name));
    top.appendChild(t);
    var more = menu("⋯", [
      ["Open", function () { openIcp(icp.id); }],
      ["Edit", function () { editIcp(icp); }],
      "-",
      ["Delete", function () { deleteIcp(icp); }, true]
    ], "go");
    more.querySelector("button").setAttribute("aria-label", "Options for " + icp.name);
    more.querySelector(".menu").style.cssText += ";top:34px;";
    top.appendChild(more);
    c.appendChild(top);
    if (icp.description) c.appendChild(el("p", null, icp.description));
    var tam = el("div", "tam");
    var d = el("div");
    d.appendChild(el("b", null, icp.tam || "—"));
    d.appendChild(el("span", null, icp.tam ? "TAM" : "TAM not set"));
    if (icp.tam) d.title = "TAM: " + icp.tam;
    tam.appendChild(d);
    c.appendChild(tam);
    var foot = el("div", "foot");
    if (icp.kind === "Regime") {
      var bs = buyersIn(icp);
      bs.forEach(function (b) { foot.appendChild(pill(b.name, "icp")); });
      if (!bs.length) foot.appendChild(pill("no buyers tagged"));
    } else {
      (icp.regimes || []).map(icpById).filter(Boolean).forEach(function (r) { foot.appendChild(pill(r.name, "rnd")); });
      if (!(icp.regimes || []).length) foot.appendChild(pill("no regime"));
    }
    var n = featuresFor(icp).length;
    foot.appendChild(pill(n + (n === 1 ? " feature" : " features")));
    c.appendChild(foot);
    c.onclick = function (e) { if (e.target.closest(".menu-wrap")) return; openIcp(icp.id); };
    c.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openIcp(icp.id); } };
    return c;
  }

  function renderOverlapTab(pad) {
    var all = feats();
    var total = S.icps.length;
    var counts = { core: 0, shared: 0, independent: 0, untagged: 0 };
    all.forEach(function (f) { counts[coverageLabel(icpsOf(f).length, total)]++; });
    var stats = el("div", "rndhead");
    [["Profiles", total], ["Core", counts.core], ["Shared", counts.shared], ["Independent", counts.independent], ["Not yet tagged", counts.untagged]].forEach(function (s) {
      var box = el("div", "stat");
      box.appendChild(el("b", null, String(s[1])));
      box.appendChild(el("span", null, s[0]));
      stats.appendChild(box);
    });
    pad.appendChild(stats);
    var note = el("p", "icpdesc");
    note.textContent = "Core features are asked for by every profile; independent ones by a single profile. Tick a column to tag, or drag cards between lanes.";
    pad.appendChild(note);
    if (!total) { pad.appendChild(el("div", "empty", "No profiles yet. Add regimes and buyers first.")); return; }

    var list = all.filter(function (f) {
      if (ui.spaceFilter && (f.spaces || []).indexOf(ui.spaceFilter) === -1) return false;
      if (ui.stateFilter && f.state !== ui.stateFilter) return false;
      if (ui.icpFilter && (f.icps || []).indexOf(ui.icpFilter) === -1) return false;
      if (ui.requestedOnly && !icpsOf(f).length) return false;
      return true;
    });
    if (ui.icpFilter && icpById(ui.icpFilter)) {
      var focus = el("div", "note");
      focus.style.cssText = "margin:0 0 14px;display:flex;align-items:center;gap:10px;";
      focus.appendChild(document.createTextNode("Showing what " + icpById(ui.icpFilter).name + " asks for."));
      var clear = el("button", "chip", "Show all");
      clear.onclick = function () { ui.icpFilter = ""; renderView(); };
      focus.appendChild(clear);
      pad.appendChild(focus);
    }
    if ((ui.imode || "matrix") === "lanes") pad.appendChild(icpLanes(list));
    else pad.appendChild(icpMatrix(list));
  }

  function icpMatrix(list) {
    var cols = regimes().concat(buyers());
    var total = cols.length;
    var groups = [
      ["core", "Core · every profile asks for it"],
      ["shared", "Shared · several profiles"],
      ["independent", "Independent · one profile only"],
      ["untagged", "Not yet tagged"]
    ];
    var wrap = el("div", "matrix");
    var table = el("table");
    var thead = el("thead");
    var hr = el("tr");
    hr.appendChild(el("th", null, "Feature"));
    hr.appendChild(el("th", null, "State"));
    cols.forEach(function (icp) {
      var th = el("th", "icp" + (icp.kind === "Regime" ? " reg" : ""));
      th.appendChild(avatarEl(icp.avatar, "xs"));
      th.appendChild(el("span", null, icp.name));
      th.title = (ui.icpFilter === icp.id ? "Show all" : "Focus on " + icp.name);
      th.onclick = function () { ui.icpFilter = ui.icpFilter === icp.id ? "" : icp.id; renderView(); };
      hr.appendChild(th);
    });
    hr.appendChild(el("th", null, "Coverage"));
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el("tbody");
    var any = false;
    groups.forEach(function (g) {
      var rows = list.filter(function (f) { return coverageLabel(icpsOf(f).length, total) === g[0]; })
        .sort(function (a, b) { return icpsOf(b).length - icpsOf(a).length || a.name.localeCompare(b.name); });
      if (!rows.length) return;
      any = true;
      var gr = el("tr", "group");
      var gtd = el("td");
      gtd.colSpan = total + 3;
      gtd.appendChild(document.createTextNode(g[1]));
      gtd.appendChild(el("em", null, String(rows.length)));
      gr.appendChild(gtd);
      tbody.appendChild(gr);
      rows.forEach(function (f) {
        var tr = el("tr");
        var td0 = el("td");
        var b = el("b", null, f.name);
        b.onclick = function () { preview(f.id); };
        td0.appendChild(b);
        if (f.note) td0.appendChild(el("span", null, f.note));
        tr.appendChild(td0);
        var tds = el("td");
        tds.appendChild(statePill(f));
        tr.appendChild(tds);
        cols.forEach(function (icp) {
          var td = el("td", icp.kind === "Regime" ? "reg" : "");
          var on = (f.icps || []).indexOf(icp.id) !== -1;
          var t = el("button", "tick", "✓");
          t.setAttribute("aria-pressed", String(on));
          t.setAttribute("aria-label", (on ? "Untag " : "Tag ") + f.name + " for " + icp.name);
          t.onclick = function () { toggleIcp(f, icp.id); renderView(); save(); };
          td.appendChild(t);
          tr.appendChild(td);
        });
        var n = icpsOf(f).length;
        var cov = el("td");
        cov.appendChild(el("span", "cov" + (total > 1 && n === total ? " core" : ""), n + " / " + total));
        tr.appendChild(cov);
        tbody.appendChild(tr);
      });
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    if (!any) return el("div", "empty", "No features match these filters.");
    return wrap;
  }

  function icpLanes(list) {
    var wrap = el("div", "lanes");
    var lanes = regimes().concat(buyers()).map(function (i) { return { key: i.id, label: i.name, icp: i }; }).concat([{ key: "__none", label: "Not yet tagged" }]);
    lanes.forEach(function (lane) {
      var items = lane.key === "__none"
        ? list.filter(function (f) { return !icpsOf(f).length; })
        : list.filter(function (f) { return (f.icps || []).indexOf(lane.key) !== -1; });
      var col = el("div", "lane");
      var h = el("h2");
      if (lane.icp) h.appendChild(avatarEl(lane.icp.avatar, "xs"));
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
        if (lane.key === "__none") f.icps = [];
        else if ((f.icps || []).indexOf(lane.key) === -1) { f.icps = f.icps || []; f.icps.push(lane.key); }
        touch(f); render(); save();
      });
      if (!items.length) drop.appendChild(el("div", "note", "Empty."));
      items.forEach(function (f) {
        var c = el("div", "card");
        c.draggable = true;
        c.dataset.id = f.id;
        c.appendChild(el("h3", null, f.name));
        c.appendChild(el("p", null, (f.note || "").slice(0, 88)));
        var tags = el("div", "tags");
        tags.appendChild(statePill(f));
        icpsOf(f).filter(function (x) { return x.id !== lane.key; }).forEach(function (x) { tags.appendChild(pill("also " + x.name, "icp")); });
        c.appendChild(tags);
        if (lane.key !== "__none") {
          var rm = el("button", "cardsel", "Remove from " + lane.label);
          rm.onclick = function (e) { e.stopPropagation(); toggleIcp(f, lane.key); render(); save(); };
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
    return wrap;
  }

  /* ---- profile page: the notebook for one segment ---- */

  function renderIcpPage(host, icp) {
    var isRegime = icp.kind === "Regime";
    var back = el("button", "btn ghost", "Back");
    back.onclick = function () { ui.icpOpen = null; ui.itab = isRegime ? "regimes" : "buyers"; render(); };
    var more = menu("More", [
      ["Quick edit", function () { editIcp(icp); }],
      ["See its features in the overlap", function () { ui.icpOpen = null; ui.itab = "overlap"; ui.icpFilter = icp.id; render(); }],
      "-",
      ["Delete", function () { deleteIcp(icp); }, true]
    ]);
    host.appendChild(header((isRegime ? "REGIME" : "BUYER · " + avatarLabel(icp.avatar).toUpperCase()), icp.name, [back, more]));

    var pad = el("div", "pad");
    var g = el("div", "grid2");

    /* left: identity, description, notebook */
    var left = el("div");
    var idRow = el("div", "idrow");
    idRow.appendChild(avatarEl(icp.avatar, "lg"));
    var nameIn = el("input");
    nameIn.value = icp.name;
    nameIn.setAttribute("aria-label", "Profile name");
    nameIn.className = "namein";
    nameIn.oninput = function () { icp.name = nameIn.value; renderNav(); var h = host.querySelector(".head h1"); if (h) h.textContent = icp.name || "Untitled"; save(); };
    nameIn.onblur = function () { if (!icp.name.trim()) { icp.name = "Untitled profile"; nameIn.value = icp.name; } render(); };
    idRow.appendChild(nameIn);
    left.appendChild(idRow);

    left.appendChild(el("div", "sublab", "Who they are"));
    var desc = el("textarea", "writer small");
    desc.style.marginTop = "0";
    desc.value = icp.description;
    desc.placeholder = isRegime ? "What this regime is, who it commissions, what it pays for." : "Who they are, what they buy, what matters to them.";
    desc.setAttribute("aria-label", "Description");
    desc.oninput = function () { icp.description = desc.value; save(); };
    left.appendChild(desc);

    left.appendChild(el("div", "sublab", "Notebook"));
    var notes = el("textarea", "writer");
    notes.value = icp.notes;
    notes.placeholder = "Anything you learn about this segment: pricing, volumes, pains, quotes, sources. Add to it whenever you find something new.";
    notes.setAttribute("aria-label", "Notes");
    notes.oninput = function () { icp.notes = notes.value; save(); };
    left.appendChild(notes);
    g.appendChild(left);

    /* right: numbers and links */
    var right = el("div");

    var pm = el("div", "panel");
    pm.appendChild(el("h3", null, "Market size"));
    [["TAM", "tam", "Total addressable market"], ["SAM", "sam", "Serviceable addressable"], ["SOM", "som", "Serviceable obtainable"]].forEach(function (x) {
      var row = el("div", "field");
      var lab = el("label", null, x[0]); lab.title = x[2];
      row.appendChild(lab);
      var inp = el("input");
      inp.value = icp[x[1]] || "";
      inp.placeholder = x[2];
      inp.setAttribute("aria-label", x[0]);
      inp.oninput = function () { icp[x[1]] = inp.value.trim(); save(); };
      row.appendChild(inp);
      pm.appendChild(row);
    });
    right.appendChild(pm);

    var pf = el("div", "panel");
    pf.style.marginTop = "18px";
    pf.appendChild(el("h3", null, "Facts & numbers"));
    var facts = el("div", "facts");
    function drawFacts() {
      facts.innerHTML = "";
      icp.facts.forEach(function (fact, idx) {
        var row = el("div", "fact");
        var l = el("input"); l.value = fact.label; l.placeholder = "Label, e.g. Paralegal hourly rate"; l.setAttribute("aria-label", "Fact label");
        l.oninput = function () { fact.label = l.value; save(); };
        var v = el("input"); v.value = fact.value; v.placeholder = "Value, e.g. $45 / h"; v.setAttribute("aria-label", "Fact value");
        v.oninput = function () { fact.value = v.value; save(); };
        var x = el("button", "x", "×"); x.setAttribute("aria-label", "Remove fact");
        x.onclick = function () { icp.facts.splice(idx, 1); drawFacts(); save(); };
        row.appendChild(l); row.appendChild(v); row.appendChild(x);
        facts.appendChild(row);
      });
      if (!icp.facts.length) facts.appendChild(el("div", "note", "Numbers you want at hand: rates, hours per file, cases per month, prices."));
    }
    drawFacts();
    pf.appendChild(facts);
    var addF = el("button", "btn ghost rowbtn", "+ Add a fact");
    addF.onclick = function () { icp.facts.push({ label: "", value: "" }); drawFacts(); var last = facts.querySelector(".fact:last-child input"); if (last) last.focus(); };
    pf.appendChild(addF);
    right.appendChild(pf);

    var pr = el("div", "panel");
    pr.style.marginTop = "18px";
    if (isRegime) {
      pr.appendChild(el("h3", null, "Buyers in this regime"));
      var bs = buyersIn(icp);
      if (!bs.length) pr.appendChild(el("div", "note", "No buyer tagged with this regime yet. Tag regimes from a buyer's page."));
      var bl = el("div", "chips");
      bs.forEach(function (b) {
        var c = el("button", "chip", b.name);
        c.onclick = function () { openIcp(b.id); };
        bl.appendChild(c);
      });
      pr.appendChild(bl);
    } else {
      pr.appendChild(el("h3", null, "Regimes they work in"));
      pr.appendChild(regimeChips(icp.regimes, function () { save(); renderNav(); }));
    }
    right.appendChild(pr);

    var pa = el("div", "panel");
    pa.style.marginTop = "18px";
    pa.appendChild(el("h3", null, "Icon"));
    pa.appendChild(avatarPicker(icp.avatar, function (v) {
      icp.avatar = v; save();
      var big = host.querySelector(".idrow .avatar");
      if (big) big.replaceWith(avatarEl(v, "lg"));
      var eb = host.querySelector(".head .eyebrow");
      if (eb && !isRegime) eb.textContent = "BUYER · " + avatarLabel(v).toUpperCase();
    }));
    right.appendChild(pa);

    var pfeat = el("div", "panel");
    pfeat.style.marginTop = "18px";
    var mine = featuresFor(icp);
    pfeat.appendChild(el("h3", null, "Features they ask for · " + mine.length));
    if (!mine.length) pfeat.appendChild(el("div", "note", "Nothing tagged yet."));
    var fl = el("div", "featlist");
    mine.forEach(function (f) {
      var row = el("div", "fl");
      var b = el("button", null, f.name);
      b.onclick = function () { preview(f.id); };
      row.appendChild(b);
      row.appendChild(statePill(f));
      var x = el("button", "x", "×"); x.setAttribute("aria-label", "Untag " + f.name);
      x.onclick = function () { toggleIcp(f, icp.id); render(); save(); };
      row.appendChild(x);
      fl.appendChild(row);
    });
    pfeat.appendChild(fl);
    var addFeat = el("select", "selbox");
    addFeat.style.cssText = "width:100%;margin-top:10px;";
    addFeat.setAttribute("aria-label", "Tag a feature");
    var o0 = el("option", null, "+ Tag a feature…"); o0.value = ""; addFeat.appendChild(o0);
    feats().filter(function (f) { return (f.icps || []).indexOf(icp.id) === -1; }).sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (f) {
      var o = el("option", null, f.name); o.value = f.id; addFeat.appendChild(o);
    });
    addFeat.onchange = function () { var f = feature(addFeat.value); if (!f) return; toggleIcp(f, icp.id); render(); save(); };
    pfeat.appendChild(addFeat);
    right.appendChild(pfeat);

    g.appendChild(right);
    pad.appendChild(g);
    host.appendChild(pad);
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

    var pt = el("div", "panel");
    pt.style.marginTop = "18px";
    pt.appendChild(el("h3", null, "Thumbnail"));
    pt.appendChild(thumbPicker(f, function (v) { f.thumb = v; touch(f); save(); }));
    right.appendChild(pt);

    var ps = el("div", "panel");
    ps.style.marginTop = "18px";
    ps.appendChild(el("h3", null, "Structure"));
    var kids = childrenOf(f);
    var prow = el("div", "field");
    prow.appendChild(el("label", null, "Part of"));
    var parents = feats().filter(function (x) { return x.id !== f.id && !x.parent; });
    var psel = selectOf([["", kids.length ? "Top level (has sub-features)" : "Top level"]].concat(parents.map(function (x) { return [x.id, x.name]; })), f.parent || "",
      function (v) { if (v && kids.length) { toast("Move its sub-features out first.", true); render(); return; } f.parent = v || null; touch(f); render(); save(); }, "Part of");
    prow.appendChild(psel);
    ps.appendChild(prow);
    if (kids.length) {
      var kl = el("div", "featlist");
      kids.forEach(function (k) {
        var row = el("div", "fl");
        var b = el("button", null, k.name);
        b.onclick = function () { open(k.id); };
        row.appendChild(b);
        row.appendChild(statePill(k));
        kl.appendChild(row);
      });
      ps.appendChild(kl);
    }
    if (!f.parent) {
      var addK = el("button", "btn ghost rowbtn", "+ Add a sub-feature");
      addK.onclick = function () { create(f.spaces.slice(), { parent: f.id, name: "New sub-feature" }); };
      ps.appendChild(addK);
    }
    right.appendChild(ps);

    var pi = el("div", "panel");
    pi.style.marginTop = "18px";
    pi.appendChild(el("h3", null, "Market / ICP"));
    var ichips = el("div");
    ichips.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;";
    regimes().concat(buyers()).forEach(function (icp) {
      var c = el("button", "chip" + (icp.kind === "Regime" ? " reg" : ""), icp.name);
      c.setAttribute("aria-pressed", String((f.icps || []).indexOf(icp.id) !== -1));
      c.title = (icp.kind === "Regime" ? "Regime" : avatarLabel(icp.avatar)) + (icp.description ? " · " + icp.description : "");
      c.onclick = function () { toggleIcp(f, icp.id); render(); save(); };
      ichips.appendChild(c);
    });
    var addIcp = el("button", "chip", "+ New profile");
    addIcp.onclick = function () {
      askIcp("New buyer profile", blankIcp("Buyer")).then(function (v) {
        if (!v) return;
        S.icps.push(v); f.icps = f.icps || []; f.icps.push(v.id); touch(f); render(); save();
      });
    };
    ichips.appendChild(addIcp);
    pi.appendChild(ichips);
    var covN = icpsOf(f).length;
    var covNote = el("div", "note");
    covNote.style.marginTop = "12px";
    covNote.textContent = !S.icps.length ? "No profiles yet." : covN === 0 ? "No profile has asked for this yet." :
      covN === S.icps.length && S.icps.length > 1 ? "Core: every profile asks for this." :
      covN === 1 ? "Independent: only " + icpsOf(f)[0].name + " asks for this." : "Shared by " + covN + " of " + S.icps.length + " profiles.";
    pi.appendChild(covNote);
    right.appendChild(pi);

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
      return (f.name + " " + f.note + " " + f.owner + " " + f.state + " " + f.student + " " + f.rndQuestion + " " + (f.spaces || []).join(" ") + " " + icpsOf(f).map(function (i) { return i.name; }).join(" ") + (f.rnd ? " r&d research" : "")).toLowerCase().indexOf(q) !== -1;
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
              student: "", rndQuestion: "", rndFindings: "", parent: null, thumb: "", created: Date.now(), updated: Date.now() };
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
    if (n && f && (f.name === "New feature" || f.name === "New research item" || f.name === "New sub-feature")) { n.focus(); n.select(); }
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
