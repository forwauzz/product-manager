(function () {
  "use strict";

  var STATES = ["Proposed", "Research", "Planned", "Building", "Live", "Needs work", "Feature flag"];
  var BUILT_STATES = ["Building", "Live", "Needs work", "Feature flag"];
  var RND_STAGES = ["Backlog", "Assigned", "In progress", "Findings", "Concluded"];
  /* Nav items switched off for now. Remove a key here to bring the item back. */
  var HIDDEN_NAV = { parallel: true, timeline: true };
  var ICONS = { home: "◉", decisions: "◈", roadmap: "▤", features: "◫", parallel: "⋔", timeline: "▦", rnd: "⚗", icp: "◎", space: "◆", changes: "◷", pilots: "◔" };

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
  var ui = { view: "home", space: null, feature: null, grain: "month", group: "state", rmode: "plan", preview: null,
             spaceFilter: null, ownerFilter: "", studentFilter: "", rgroup: "stage", query: "", menu: null,
             icpFilter: "", stateFilter: "", requestedOnly: false, imode: "matrix", itab: "buyers", icpOpen: null, fview: "grouped", fmode: "cards", smode: "dir", spaceSel: null, pilot: null };
  var timer = null, dirty = false, saving = false, conflicts = 0, tombstones = {}, SESSION = { authed: true, required: false };

  function setSaveState(text, isErr) {
    var e = document.getElementById("savestate");
    e.textContent = text;
    e.className = "savestate" + (isErr ? " err" : "");
  }

  var ME = "Uzziel";
  function save() {
    dirty = true;
    setSaveState("Unsaved");
    clearTimeout(timer);
    timer = setTimeout(flush, 350);
  }
  var inflight = null;
  function flush() {
    /* a save already on the wire: wait for it, then send whatever is still unsaved */
    if (saving) return inflight ? inflight.then(function () { return flush(); }) : Promise.resolve();
    if (!dirty) return Promise.resolve();
    saving = true; dirty = false;
    setSaveState("Saving…");
    inflight = fetch("/api/state", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: VERSION, state: S, who: ME })
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
        try { localStorage.removeItem("alie.capq"); } catch (e2) {}
        if (body.state && Array.isArray(body.state.log)) { S.log = body.state.log; if (document.querySelector(".loglist")) render(); }
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
    return inflight;
  }
  /* resolves once nothing is left unsaved: a save that conflicted and merged is sent again before this settles */
  function saveSettled(tries) {
    tries = tries === undefined ? 40 : tries;
    return flush().then(function () {
      if (!dirty && !saving) return true;
      if (tries <= 0) return false;
      return new Promise(function (r) { setTimeout(r, 200); }).then(function () { return saveSettled(tries - 1); });
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
    out.pilots = (out.pilots || []).filter(function (p) { return !tombstones[p.id]; });
    (mine.pilots || []).forEach(function (p) {
      var t3 = out.pilots.filter(function (x) { return x.id === p.id; })[0];
      if (!t3) out.pilots.push(p); else if ((p.updated || 0) >= (t3.updated || 0)) Object.keys(p).forEach(function (k) { t3[k] = p[k]; });
    });
    var byLog = {};
    out.log = (out.log || []).filter(Boolean);
    out.log.forEach(function (e) { byLog[e.id] = e; });
    (mine.log || []).forEach(function (e) {
      if (!e) return;
      var t2 = byLog[e.id];
      if (!t2) { out.log.push(e); byLog[e.id] = e; }
      else if (e.why && e.why !== t2.why) t2.why = e.why; // a reason typed here beats an older copy from the server
    });
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
        restoreCaptureQueue();
      }).catch(function (e) {
        setSaveState("Offline", true);
        var host = document.getElementById("scroll"); host.innerHTML = "";
        var box = el("div", "loadfail");
        box.appendChild(el("b", null, "Could not load your data."));
        box.appendChild(el("p", "note", e.message + ". Nothing was lost: captures made offline stay on this device."));
        var retry = el("button", "btn", "Try again"); retry.onclick = function () { location.reload(); };
        box.appendChild(retry); host.appendChild(box);
        toast("Could not reach the server: " + e.message, true);
        return new Promise(function () {});
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
    if (needsGate(f, v)) { openGate("feature", f, v, pilotsFor(f)[0] || null); return; }
    f.state = v;
    if (v === "Planned") f.agreed = true; // Planned is the agreement
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
  var EFFORT_UNITS = ["days", "weeks", "months"];
  function effortDays(f) {
    var n = Number(f.effort) || 0;
    if (!n) return 0;
    return n * (f.effortUnit === "days" ? 1 : f.effortUnit === "months" ? 30 : 7);
  }
  function effortLabel(f, long) {
    var n = Number(f.effort) || 0;
    if (!n) return "";
    var u = f.effortUnit || "weeks";
    if (long) return n + " " + (n === 1 ? u.slice(0, -1) : u);
    return n + " " + (u === "days" ? "d" : u === "months" ? "mo" : "wk");
  }
  /* number + unit, saved as you go */
  function effortControl(f, after) {
    var w = el("div", "effortctl");
    var n = el("input");
    n.type = "number"; n.min = "0"; n.step = "1"; n.placeholder = "0";
    n.value = f.effort ? String(f.effort) : "";
    n.setAttribute("aria-label", "How long " + f.name + " takes");
    n.onchange = function () { f.effort = Math.max(0, Math.round(Number(n.value) || 0)); touch(f); save(); if (after) after(); };
    var u = selectOf(EFFORT_UNITS.map(function (x) { return [x, x]; }), f.effortUnit || "weeks", function (v) { f.effortUnit = v; touch(f); save(); if (after) after(); }, "Unit");
    w.appendChild(n); w.appendChild(u);
    return w;
  }
  /* Expected end = start + estimate. Running over = past that and not shipped. */
  var SHIPPED_STATES = ["Live", "Needs work", "Feature flag"];
  function expectedEnd(f) {
    if (!f.period || !effortDays(f)) return null;
    var d = toDate(f.period);
    d.setDate(d.getDate() + effortDays(f));
    return d;
  }
  function overrunDays(f) {
    var end = expectedEnd(f);
    if (!end || SHIPPED_STATES.indexOf(f.state) !== -1) return 0;
    var today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((today - end) / 86400000));
  }
  function overrunList() { return feats().filter(function (f) { return overrunDays(f) > 0; }).sort(function (a, b) { return overrunDays(b) - overrunDays(a); }); }
  function dueLabel(f) { var e = expectedEnd(f); return e ? e.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""; }
  function overrunPanel() {
    var list = overrunList();
    if (!list.length) return null;
    var p = el("div", "drift over");
    var h = el("div", "drifthead");
    h.appendChild(el("b", null, list.length + (list.length === 1 ? " feature running over its estimate" : " features running over their estimates")));
    h.appendChild(el("span", "note", "Start date plus estimate is in the past and it is not live. Extend the estimate with a reason, or mark it live."));
    p.appendChild(h);
    list.forEach(function (f) {
      var r = el("div", "driftrow");
      var nm = el("button", "fname", f.name);
      nm.onclick = function () { open(f.id); };
      r.appendChild(nm);
      r.appendChild(pill(f.state, stateClass(f.state)));
      r.appendChild(el("span", "note", (f.owner && f.owner !== "Unassigned" ? f.owner + " · " : "") + "due " + dueLabel(f) + " · " + overrunDays(f) + (overrunDays(f) === 1 ? " day over" : " days over")));
      var ext = el("button", "btn ghost small", "Extend");
      ext.onclick = function () { preview(f.id); };
      r.appendChild(ext);
      p.appendChild(r);
    });
    return p;
  }
  function unschedule(f) {
    f.period = null; touch(f); render(); save();
    toast(f.name + " removed from the roadmap. The feature itself stays.");
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

  /* the server stamps the build into the page; when a newer one is live, offer a reload rather than running stale code */
  var buildId = (document.querySelector('meta[name="build"]') || {}).content || "";
  var lastBuildCheck = 0;
  function checkBuild() {
    if (!buildId || Date.now() - lastBuildCheck < 120000) return;
    lastBuildCheck = Date.now();
    fetch("/api/version", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || !j.build || j.build === buildId || document.getElementById("newbuild")) return;
      var bar = el("div", "newbuild"); bar.id = "newbuild";
      bar.appendChild(el("span", null, "A newer version of the app is live."));
      var b = el("button", "btn small", "Reload"); b.onclick = function () { location.reload(); };
      bar.appendChild(b);
      document.body.appendChild(bar);
    }).catch(function () {});
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) checkBuild(); });
  setTimeout(checkBuild, 15000);
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
    if (["home", "decisions", "roadmap", "features", "parallel", "timeline", "rnd", "icp", "changes", "pilots"].indexOf(m[0]) !== -1) ui.view = m[0];
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

    function navItem(it) {
      var b = el("button", "navitem" + (it[0] === "rnd" ? " rnd" : ""));
      b.setAttribute("aria-current", String(ui.view === it[0] && !ui.feature));
      b.dataset.view = it[0];
      b.appendChild(el("span", "ic", it[2]));
      b.appendChild(el("span", "nm", it[1]));
      if (it[3] !== null && it[3] !== undefined) b.appendChild(el("span", "ct", String(it[3])));
      b.onclick = function () { ui.view = it[0]; ui.feature = null; ui.space = null; ui.icpOpen = null; ui.pilot = null; if (it[0] === "features") ui.fmode = "cards"; closeNavIfNarrow(); render(); };
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
      return b;
    }
    var needDec = decisions().filter(function (d) { return d.state === "Proposed" || decisionBlocked(d); }).length + undecidedRequestsAll().length;
    scroll.appendChild(el("div", "navlabel", "MAIN"));
    [["home", "Home", ICONS.home, null],
     ["pilots", "Pilots", ICONS.pilots, (S.pilots || []).length || null],
     ["decisions", "Decisions", ICONS.decisions, needDec || null],
     ["features", "Features", ICONS.features, feats().length]].forEach(function (it) { scroll.appendChild(navItem(it)); });

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

    scroll.appendChild(el("div", "navlabel", "PLANNING"));
    [["roadmap", "Product Roadmap", ICONS.roadmap, null],
     ["rnd", "Research & Development", ICONS.rnd, rndFeats().length],
     ["icp", "Market / ICP", ICONS.icp, S.icps.length],
     ["changes", "What changed", ICONS.changes, (S.log || []).filter(function (e) { return e.t > Date.now() - 7 * 86400000; }).length || null]].filter(function (it) { return !HIDDEN_NAV[it[0]]; }).forEach(function (it) { scroll.appendChild(navItem(it)); });
    nav.appendChild(scroll);

    var foot = el("div", "navfoot");
    foot.appendChild(el("div", "av", "UT"));
    var who = el("div");
    who.appendChild(el("b", null, "Uzziel Tamon"));
    who.appendChild(el("span", null, "Chief Product Officer · Product Manager"));
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
      ui.feature = null; ui.view = "home"; ui.space = null;
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

  function barGroup(label) { var g = el("div", "bgroup"); g.appendChild(el("label", null, label)); return g; }

  /* the morning check: what is late, what was built without agreement, what pilots are waiting on */
  function daysSince(t) { return Math.max(0, Math.floor((Date.now() - (Number(t) || 0)) / 86400000)); }
  function stalePilots() { return pilots().filter(function (p) { return p.status !== "Paused" && daysSince(p.updated) >= 14; }); }
  function undecidedRequests() { return allRequests().filter(function (x) { return x.r.decision === "Undecided"; }); }
  function needsYouStrip() {
    var over = overrunList(), drift = driftList(), rq = undecidedRequests(), stale = stalePilots();
    var total = over.length + drift.length + rq.length + stale.length;
    var wrap = el("div", "needs" + (total ? "" : " calm"));
    var row = el("div", "needsrow");
    row.appendChild(el("b", null, total ? "Needs you" : "Nothing needs you"));
    var detail = el("div", "needsdetail"); detail.hidden = true;
    var openKey = null;
    function toggle(key, build, btn) {
      var same = openKey === key;
      openKey = same ? null : key;
      detail.innerHTML = "";
      Array.prototype.forEach.call(row.querySelectorAll(".needchip"), function (b) { b.setAttribute("aria-pressed", "false"); });
      if (same) { detail.hidden = true; return; }
      var node = build(); if (node) detail.appendChild(node);
      detail.hidden = false; btn.setAttribute("aria-pressed", "true");
    }
    function item(n, one, many, cls, onClick) {
      var b = el("button", "needchip" + (n ? " " + cls : " zero"));
      b.appendChild(el("strong", null, String(n)));
      b.appendChild(document.createTextNode(" " + (n === 1 ? one : many)));
      b.setAttribute("aria-pressed", "false");
      if (n) b.onclick = function () { onClick(b); }; else b.disabled = true;
      row.appendChild(b);
    }
    item(over.length, "feature over its estimate", "features over their estimates", "warn", function (b) { toggle("over", overrunPanel, b); });
    item(drift.length, "feature built without agreement", "features built without agreement", "warn", function (b) { toggle("drift", driftPanel, b); });
    item(rq.length, "request to decide", "requests to decide", "info", function () {
      var counts = {}; rq.forEach(function (x) { counts[x.pilot.id] = (counts[x.pilot.id] || 0) + 1; });
      var top = rq.slice().sort(function (a, b) { return counts[b.pilot.id] - counts[a.pilot.id]; })[0];
      ui.view = "pilots"; ui.pilot = top.pilot.id; ui.pilotTab = "requests"; ui.feature = null; render();
    });
    item(stale.length, "pilot untouched for two weeks", "pilots untouched for two weeks", "info", function () {
      ui.view = "pilots"; ui.pilot = stale.length === 1 ? stale[0].id : null; ui.pilotTab = "overview"; ui.feature = null; render();
    });
    if (!total) row.appendChild(el("span", "note", "No overruns, no drift, no requests waiting, every pilot touched this fortnight."));
    wrap.appendChild(row);
    wrap.appendChild(detail);
    return wrap;
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
    if (ui.view === "home") return renderHome(host);
    if (ui.view === "decisions") return renderDecisionsView(host);
    if (ui.view === "roadmap") return renderRoadmap(host);
    if (ui.view === "changes") return renderChanges(host);
    if (ui.view === "pilots") return renderPilots(host);
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
    renderHome(host);
  }

  /* --- product roadmap: deployment order --- */

  function renderRoadmap(host) {
    var p = project();
    var acts = [];
    var addB = el("button", "btn", "+ Add feature");
    addB.onclick = function () { pickForRoadmap(); };
    acts.push(addB);
    var pr = el("button", "btn ghost", "Print");
    pr.onclick = function () { window.print(); };
    acts.push(pr);

    host.appendChild(header("PRODUCT ROADMAP", ui.rmode === "plan" ? p.name + " · now, next, later" : ui.rmode === "quarters" ? p.name + " by quarter" : ui.rmode === "months" ? p.name + " by month" : p.name + " deployment order", acts));

    var bar = el("div", "bar");
    var seg = el("div", "seg");
    [["Plan", "plan"], ["Quarters", "quarters"], ["Months", "months"], ["List", "order"], ["Gantt", "gantt"]].forEach(function (m) {
      var b = el("button", null, m[0]);
      b.setAttribute("aria-pressed", String(ui.rmode === m[1]));
      b.onclick = function () { ui.rmode = m[1]; renderView(); };
      seg.appendChild(b);
    });
    bar.appendChild(seg);

    if (ui.rmode !== "quarters" && ui.rmode !== "months" && ui.rmode !== "plan") {
      var g = el("div", "seg");
      [["Weekly", "week"], ["Monthly", "month"], ["Quarterly", "quarter"]].forEach(function (m) {
        var b = el("button", null, m[0]);
        b.setAttribute("aria-pressed", String(ui.grain === m[1]));
        b.onclick = function () { ui.grain = m[1]; renderView(); };
        g.appendChild(b);
      });
      bar.appendChild(g);
    }
    var vg = barGroup("View"); Array.prototype.slice.call(bar.children).forEach(function (c) { vg.appendChild(c); }); bar.appendChild(vg);
    var fg = barGroup("Filter");
    spaceChips(fg);
    fg.appendChild(ownerSelect(renderView));
    if (S.icps.length) fg.appendChild(icpSelect(renderView));
    bar.appendChild(fg);
    host.appendChild(bar);
    host.appendChild(needsYouStrip());
    if (ui.rmode === "plan") { renderPlanBoard(host); return; }

    if (ui.rmode === "quarters" || ui.rmode === "months") return renderPeriodGrid(host, ui.rmode);
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

    if (f.note) c.appendChild(el("p", null, plain(f.note).slice(0, 88)));

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

  /* --- roadmap: pick any feature from the whole inventory and give it a month --- */
  function pickForRoadmap() {
    var months = [], m0 = mKey(new Date()), i;
    for (i = 0; i < 18; i++) months.push(mAdd(m0, i));
    var when = m0;
    return dialog(function (box, close) {
      box.classList.add("wide");
      box.appendChild(el("h2", null, "Add to the roadmap"));
      box.appendChild(el("p", null, "Search the whole inventory, including sub-features. Pick one and the month it ships."));
      var row = el("div", "pickrow");
      var inp = el("input");
      inp.type = "search";
      inp.placeholder = "Search features…";
      inp.setAttribute("aria-label", "Search features");
      var sel = el("select");
      sel.setAttribute("aria-label", "Month");
      months.forEach(function (k) { var o = el("option", null, mLong(k)); o.value = k; sel.appendChild(o); });
      sel.onchange = function () { when = sel.value; };
      row.appendChild(inp); row.appendChild(sel);
      var est = { n: 0, u: "weeks" };
      var ec = el("div", "effortctl");
      var en = el("input"); en.type = "number"; en.min = "0"; en.step = "1"; en.placeholder = "Takes";
      en.setAttribute("aria-label", "Estimated duration");
      en.onchange = function () { est.n = Math.max(0, Math.round(Number(en.value) || 0)); };
      var eu = selectOf(EFFORT_UNITS.map(function (x) { return [x, x]; }), "weeks", function (v) { est.u = v; }, "Unit");
      ec.appendChild(en); ec.appendChild(eu);
      row.appendChild(ec);
      box.appendChild(row);
      var list = el("div", "picklist");
      box.appendChild(list);
      function pick(f) {
        f.period = when; touch(f);
        if (est.n) { f.effort = est.n; f.effortUnit = est.u; }
        if (ui.spaceFilter && (f.spaces || []).indexOf(ui.spaceFilter) === -1) f.spaces = (f.spaces || []).concat([ui.spaceFilter]);
        close(f); render(); save();
        toast(f.name + " scheduled for " + mLong(when) + ".");
      }
      function draw() {
        list.innerHTML = "";
        var q = inp.value.trim().toLowerCase();
        var all = feats().filter(function (f) {
          if (!q) return true;
          var par = f.parent ? feature(f.parent) : null;
          return (f.name + " " + plain(f.note) + " " + (f.spaces || []).join(" ") + " " + f.state + " " + f.owner + " " + (par ? par.name : "")).toLowerCase().indexOf(q) !== -1;
        });
        all.sort(function (a, b) {
          var na = q && a.name.toLowerCase().indexOf(q) !== -1 ? 0 : 1, nb = q && b.name.toLowerCase().indexOf(q) !== -1 ? 0 : 1;
          if (na !== nb) return na - nb;
          var pa = a.period ? 1 : 0, pb = b.period ? 1 : 0;
          if (pa !== pb) return pa - pb;
          if (!!a.parent !== !!b.parent) return a.parent ? 1 : -1;
          return a.name.localeCompare(b.name);
        });
        if (!all.length) { list.appendChild(el("div", "note pkempty", "Nothing matches.")); return; }
        all.slice(0, 120).forEach(function (f) {
          var par = f.parent ? feature(f.parent) : null;
          var b = el("button", "pk");
          b.appendChild(el("i", "sd " + stateClass(f.state)));
          var t = el("div", "t");
          var nm = el("b");
          if (par) nm.appendChild(el("span", "pp", par.name + " › "));
          nm.appendChild(document.createTextNode(f.name));
          t.appendChild(nm);
          var meta = [(f.spaces || []).join(" · ") || "No space", f.state];
          if (f.period) meta.push("On the roadmap: " + laneLabelOf(f));
          t.appendChild(el("span", null, meta.join("  ·  ")));
          b.appendChild(t);
          b.appendChild(el("span", "go", f.period ? "Move" : "Add"));
          b.onclick = function () { pick(f); };
          list.appendChild(b);
        });
        if (all.length > 120) list.appendChild(el("div", "note pkempty", (all.length - 120) + " more. Keep typing to narrow it down."));
      }
      inp.oninput = draw;
      inp.onkeydown = function (e) { if (e.key === "Enter") { var first = list.querySelector(".pk"); if (first) { e.preventDefault(); first.click(); } } };
      draw();
      var acts = el("div", "acts");
      var mk = el("button", "btn ghost", "Create a new feature");
      mk.onclick = function () { close(null); create(ui.spaceFilter ? [ui.spaceFilter] : [], { period: when }); };
      var cancel = el("button", "btn ghost", "Cancel");
      cancel.onclick = function () { close(null); };
      acts.appendChild(mk); acts.appendChild(cancel);
      box.appendChild(acts);
      setTimeout(function () { inp.focus(); }, 0);
    });
  }

  /* --- period grid: the roadmap as a simple grid, one row per space, four quarters or four months across --- */
  var WEEK_STARTS = [1, 8, 15, 22];
  function gridMode(mode) {
    var i, j, groups = [], slots = [];
    if (mode === "months") {
      var m = mKey(new Date());
      for (i = 0; i < 4; i++) groups.push(mAdd(m, i));
      groups.forEach(function (g) {
        for (j = 0; j < 4; j++) slots.push(j === 0 ? g : g + "-" + ("0" + WEEK_STARTS[j]).slice(-2));
      });
      var today = new Date(), dd = today.getDate(), wi = dd >= 22 ? 3 : dd >= 15 ? 2 : dd >= 8 ? 1 : 0;
      return {
        per: 4, groups: groups, slots: slots, span: 4,
        label: function (g) { var d = toDate(g); return [d.toLocaleDateString(undefined, { month: "long" }), String(d.getFullYear())]; },
        slotTitle: function (k) { var d = toDate(k); return d.toLocaleDateString(undefined, { month: "long", day: "numeric" }) + " week"; },
        posOf: function (f) {
          var d = toDate(f.period), mk = mKey(d), gi = groups.indexOf(mk);
          if (mk < groups[0]) return 0;
          if (gi === -1) return -1;
          var day = f.period.length > 7 ? d.getDate() : 1;
          return gi * 4 + (day >= 22 ? 3 : day >= 15 ? 2 : day >= 8 ? 1 : 0);
        },
        nowSlot: mKey(today) + (wi ? "-" + ("0" + WEEK_STARTS[wi]).slice(-2) : ""),
        laterKey: mAdd(groups[3], 1),
        pillTag: function (f) { var d = toDate(f.period); return f.period.length > 7 ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""; }
      };
    }
    var q = qOf(mKey(new Date()));
    for (i = 0; i < 4; i++) { groups.push(q); q = qOf(mAdd(qFirst(q), 3)); }
    groups.forEach(function (qq) { for (j = 0; j < 3; j++) slots.push(mAdd(qFirst(qq), j)); });
    return {
      per: 3, groups: groups, slots: slots, span: 4,
      label: function (g) { return [g.split("-")[1], g.split("-")[0]]; },
      slotTitle: function (k) { return mLong(k); },
      posOf: function (f) { var mk = mKey(toDate(f.period)); if (mk < slots[0]) return 0; return slots.indexOf(mk); },
      nowSlot: mKey(new Date()),
      laterKey: mAdd(slots[slots.length - 1], 1),
      pillTag: function () { return ""; }
    };
  }

  function renderPeriodGrid(host, mode) {
    var M = gridMode(mode);
    var total = M.slots.length;
    var list = feats().filter(passes);
    var scheduled = list.filter(function (f) { return f.period; });
    var pending = list.filter(function (f) { return !f.parent && !f.period && f.state !== "Live"; });
    var shipped = list.filter(function (f) { return !f.period && f.state === "Live"; }).length;
    var hasLater = scheduled.some(function (f) { return M.posOf(f) === -1; });
    var cols = "repeat(" + total + ", minmax(" + (mode === "months" ? 68 : 96) + "px, 1fr))" + (hasLater ? " minmax(120px, .8fr)" : "");
    var rowsSp = ui.spaceFilter ? [ui.spaceFilter] : S.spaces.slice();

    var pad = el("div", "pad");
    var frame = el("div", "qframe");
    var head = el("div", "qrow qhead");
    head.appendChild(el("div", "qteam", "Spaces"));
    var hl = el("div", "qlanes");
    hl.style.gridTemplateColumns = cols;
    M.groups.forEach(function (g, gi) {
      var h = el("div", "qcol" + (gi === 0 ? " now" : ""));
      h.style.gridColumn = (gi * M.per + 1) + " / span " + M.per;
      var lb = M.label(g);
      h.appendChild(el("b", null, lb[0]));
      h.appendChild(el("span", null, lb[1]));
      hl.appendChild(h);
    });
    if (hasLater) { var lh = el("div", "qcol later"); lh.style.gridColumn = String(total + 1); lh.appendChild(el("b", null, "Later")); hl.appendChild(lh); }
    head.appendChild(hl);
    frame.appendChild(head);

    function schedule(f, k, sp) {
      f.period = k;
      if (sp && (f.spaces || []).indexOf(sp) === -1) { f.spaces = (f.spaces || []).concat([sp]); toast(f.name + " added to " + sp + "."); }
      touch(f); render(); save();
    }
    function dropCell(cell, k, sp) {
      cell.addEventListener("dragover", function (e) { e.preventDefault(); cell.classList.add("over"); });
      cell.addEventListener("dragleave", function () { cell.classList.remove("over"); });
      cell.addEventListener("drop", function (e) {
        e.preventDefault(); cell.classList.remove("over");
        var d = feature(e.dataTransfer.getData("text/plain"));
        if (d) schedule(d, k, sp);
      });
    }

    rowsSp.forEach(function (sp) {
      var items = scheduled.filter(function (f) { return (f.spaces || []).indexOf(sp) !== -1; });
      /* where and how long each pill is, then pack them into as few rows as possible, earliest first */
      var placed = items.map(function (f) {
        var pos = M.posOf(f);
        var days = effortDays(f), slotDays = mode === "months" ? 7 : 30, est = days > 0;
        var span = est ? Math.max(1, Math.round(days / slotDays)) : (mode === "months" ? 2 : 1);
        if (pos === -1) { pos = total; span = 1; }
        if (pos + span > total && pos < total) span = total - pos;
        return { f: f, pos: pos, span: span, est: est };
      });
      placed.sort(function (a, b) { return a.pos - b.pos || b.span - a.span || a.f.name.localeCompare(b.f.name); });
      var rowEnds = [];
      placed.forEach(function (it) {
        var r = 0;
        while (r < rowEnds.length && rowEnds[r] > it.pos) r++;
        rowEnds[r] = it.pos + it.span;
        it.row = r;
      });
      var row = el("div", "qrow tone-" + (S.spaces.indexOf(sp) % 4));
      var name = el("div", "qteam");
      name.appendChild(el("b", null, sp));
      name.appendChild(el("span", "qn", items.length ? items.length + (items.length === 1 ? " feature" : " features") : "Nothing scheduled"));
      row.appendChild(name);
      var lanes = el("div", "qlanes");
      var n = Math.max(rowEnds.length, 1);
      lanes.style.gridTemplateColumns = cols;
      lanes.style.gridTemplateRows = "repeat(" + n + ", 54px)";
      M.slots.forEach(function (k, si) {
        var cell = el("div", "qcell" + (si % M.per === 0 ? " qb" : "") + (k === M.nowSlot ? " nowm" : ""));
        cell.style.gridColumn = String(si + 1);
        cell.style.gridRow = "1 / span " + n;
        cell.title = M.slotTitle(k);
        dropCell(cell, k, sp);
        lanes.appendChild(cell);
      });
      if (hasLater) {
        var lc = el("div", "qcell qb later");
        lc.style.gridColumn = String(total + 1); lc.style.gridRow = "1 / span " + n;
        dropCell(lc, M.laterKey, sp);
        lanes.appendChild(lc);
      }
      placed.forEach(function (it) {
        var f = it.f, pos = it.pos, span = it.span, est = it.est;
        var wide = mode === "months" ? span >= 3 : span >= 2;
        var pill = el("button", "qpill " + stateClass(f.state) + (est ? "" : " noest"));
        pill.style.gridColumn = (pos + 1) + " / span " + span;
        pill.style.gridRow = String(it.row + 1);
        pill.draggable = true;
        var par = f.parent ? feature(f.parent) : null;
        pill.title = (par ? par.name + " › " : "") + f.name + " · " + laneLabelOf(f) + " · " + f.state + " · " + f.owner;
        pill.appendChild(el("i", "sd " + stateClass(f.state)));
        var nmEl = el("span", "nm");
        if (par) nmEl.appendChild(el("span", "pp", par.name + " › "));
        nmEl.appendChild(document.createTextNode(f.name));
        pill.appendChild(nmEl);
        var over = overrunDays(f);
        if (over) pill.classList.add("over");
        var tag = [M.pillTag(f), effortLabel(f), over ? over + "d over" : ""].filter(Boolean).join(" · ");
        if (tag) pill.title += " · " + tag;
        if (tag && wide) pill.appendChild(el("span", "mo" + (over ? " overtag" : ""), tag));
        if (over) pill.title += " · running " + over + " days over";
        if (!est) pill.title += " · no estimate yet";
        var x = el("span", "x", "×");
        x.setAttribute("role", "button");
        x.setAttribute("aria-label", "Remove " + f.name + " from the roadmap");
        x.title = "Remove from roadmap";
        x.onclick = function (e) { e.stopPropagation(); unschedule(f); };
        pill.appendChild(x);
        wireDrag(pill, f, null);
        pill.onclick = function () { preview(f.id); };
        lanes.appendChild(pill);
      });
      row.appendChild(lanes);
      frame.appendChild(row);
    });
    pad.appendChild(frame);

    var foot = el("div", "qfoot");
    var lg = el("div", "legend");
    STATES.forEach(function (st) { var s = el("span", "lg " + stateClass(st)); s.appendChild(el("i")); s.appendChild(document.createTextNode(st)); lg.appendChild(s); });
    foot.appendChild(lg);
    foot.appendChild(el("span", "note", (mode === "months" ? "Each month is split into weeks. " : "") + "Pill length is the estimate; dashed pills have none yet. Hover for dates. Drag to move, × to take off the roadmap, click for details." + (shipped ? " " + shipped + " live features without a date are not shown." : "")));
    pad.appendChild(foot);

    if (pending.length) {
      var pk = el("div", "qpending");
      var ph = el("div", "qph");
      ph.appendChild(el("b", null, "Not scheduled yet"));
      ph.appendChild(el("span", "note", "Drag one onto the grid, or open it and pick when."));
      pk.appendChild(ph);
      var chips = el("div", "qchips");
      pending.forEach(function (f) {
        var c = el("button", "qpill ghost " + stateClass(f.state));
        c.draggable = true;
        c.appendChild(el("i", "sd " + stateClass(f.state)));
        c.appendChild(el("span", "nm", f.name));
        if ((f.spaces || []).length) c.appendChild(el("span", "mo", f.spaces.join(" · ")));
        wireDrag(c, f, null);
        c.onclick = function () { preview(f.id); };
        chips.appendChild(c);
      });
      pk.appendChild(chips);
      pad.appendChild(pk);
    }
    host.appendChild(pad);
  }
  function laneLabelOf(f) {
    var d = toDate(f.period);
    return f.period.length > 7 ? d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }) : mLong(mKey(d));
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

    d.appendChild(f.note ? richView(f.note, "desc") : el("p", "desc muted", "No description yet. Add one so the team knows what this is."));

    if (f.rnd && f.rndQuestion) {
      d.appendChild(el("div", "lab", "Research question"));
      d.appendChild(richView(f.rndQuestion, "desc"));
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
      ["Takes", effortControl(f, function () { render(); preview(f.id); })],
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
    if (f.period) {
      var unsch = el("button", "btn ghost", "Remove from roadmap");
      unsch.onclick = function () { closePreview(); unschedule(f); };
      acts.appendChild(unsch);
    }
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
    body.appendChild(el("span", null, plain(f.note) || "No description yet."));
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
    var i;
    for (i = 0; i < THUMB_RULES.length; i++) if (THUMB_RULES[i][1].test(f.name)) return THUMB_RULES[i][0];
    var note = plain(f.note).slice(0, 80);
    for (i = 0; i < THUMB_RULES.length; i++) if (THUMB_RULES[i][1].test(note)) return THUMB_RULES[i][0];
    return "spark";
  }
  function thumbEl(f, cls) {
    var d = el("div", "thumb " + stateClass(f.state) + (cls ? " " + cls : ""));
    if (f.image) {
      d.classList.add("shot");
      var img = document.createElement("img");
      img.src = f.image; img.alt = ""; img.loading = "lazy";
      img.onerror = function () { d.classList.remove("shot"); img.remove(); };
      d.appendChild(img);
      return d;
    }
    d.innerHTML = '<svg viewBox="0 0 160 104" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (THUMB_SVG[thumbKind(f)] || THUMB_SVG.spark) + "</svg>";
    return d;
  }
  function uploadShot(f, file) {
    if (!file || !/^image\//.test(file.type)) { toast("Pick an image file.", true); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var src = new Image();
      src.onload = function () {
        // Shrink to at most 1600px wide and re-encode as JPEG so it stays small on every device.
        var scale = Math.min(1, 1600 / src.width);
        var c = document.createElement("canvas");
        c.width = Math.round(src.width * scale); c.height = Math.round(src.height * scale);
        c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
        var data = c.toDataURL("image/jpeg", 0.82);
        fetch("/api/shots", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feature: f.id, data: data }) })
          .then(function (r) { return r.json().then(function (b) { if (!r.ok) throw new Error(b.error || "Upload failed"); return b; }); })
          .then(function (b) { f.image = b.image; VERSION += 1; refreshIfStaleNow(); toast("Screenshot saved."); })
          .catch(function (e) { toast(e.message, true); });
      };
      src.src = reader.result;
    };
    reader.readAsDataURL(file);
  }
  function removeShot(f) {
    fetch("/api/shots/" + f.id, { method: "DELETE" }).then(function () { f.image = ""; refreshIfStaleNow(); toast("Screenshot removed."); });
  }
  /* After the server changed the document on our behalf, take its copy so versions line up. */
  function refreshIfStaleNow() {
    fetch("/api/state", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (doc) {
      if (dirty || saving) { render(); return; }
      S = doc.state; VERSION = doc.version; render();
    }).catch(function () { render(); });
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

  var UPCOMING_STATES = ["Building", "Planned", "Research", "Proposed"];
  function upcoming() { return feats().filter(function (f) { return UPCOMING_STATES.indexOf(f.state) !== -1; }); }

  function renderFeatures(host) {
    var p = project();
    if (ui.fmode === "all") return renderAllFeatures(host);
    if (ui.fmode === "upcoming") return renderUpcoming(host);
    return renderFeaturesHome(host);
    host.appendChild(header("FEATURES", p.name + " features", [newBtn("NEW FEATURE", function () { create(); })]));
    var pad = el("div", "pad");
    var sbox = el("div", "fsearch");
    var sin = el("input");
    sin.placeholder = "Search a feature by name or description…";
    sin.setAttribute("aria-label", "Search features");
    sin.oninput = function () { ui.query = sin.value; document.getElementById("find").value = sin.value; renderView(); };
    sbox.appendChild(sin);
    pad.appendChild(sbox);
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
    (function () {
      var up = upcoming();
      var c = el("button", "spacecard upcoming");
      c.appendChild(avatarEl("upcoming", "lg"));
      c.appendChild(el("h2", null, "Upcoming"));
      c.appendChild(el("p", null, "What is being built, planned or researched across all spaces."));
      var dated = up.filter(function (f) { return f.period; }).length;
      c.appendChild(el("div", "count", up.length + " feature" + (up.length === 1 ? "" : "s") + (dated ? " · " + dated + " on the roadmap" : "")));
      var dots = el("div", "dots");
      UPCOMING_STATES.forEach(function (st) {
        var n = up.filter(function (f) { return f.state === st; }).length;
        if (!n) return;
        var d = el("span", "dot " + stateClass(st));
        d.appendChild(el("i"));
        d.appendChild(document.createTextNode(n + " " + st.toLowerCase()));
        dots.appendChild(d);
      });
      if (!up.length) dots.appendChild(el("span", "note", "Everything is live."));
      c.appendChild(dots);
      c.onclick = function () { ui.fmode = "upcoming"; renderView(); };
      cards.appendChild(c);
    })();
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

  /* --- change log: every edit is recorded by the server; here we show it --- */
  var LOG_FIELDS = { created: "Created", deleted: "Deleted", name: "Name", state: "State", owner: "Owner", period: "Date", effort: "Estimate", agreed: "Agreed", rndPlan: "R&D plan", rndFindings: "Findings",
    spaces: "Spaces", parent: "Parent", rnd: "R&D", rndStage: "R&D stage", student: "Student", link: "Drive link", note: "Description", image: "Screenshot" };
  /* Drift: exists in the product (Building or beyond) without ever having been Planned, and not marked agreed.
     Features with no history at all were inventoried from the live apps and are left alone. */
  function driftList() {
    var byF = {}, batch = {};
    (S.log || []).forEach(function (e) {
      (byF[e.fid] = byF[e.fid] || []).push(e);
      if (e.field === "created") { var k = e.who + ":" + Math.floor(e.t / 60000); batch[k] = (batch[k] || 0) + 1; }
    });
    /* ten or more features created in the same minute by the same hand is an import, not someone building unagreed work */
    function imported(e) { return batch[e.who + ":" + Math.floor(e.t / 60000)] >= 10; }
    return feats().filter(function (f) {
      if (f.agreed || BUILT_STATES.indexOf(f.state) === -1) return false;
      var es = byF[f.id];
      if (!es || !es.length) return false;
      if (es.some(function (e) { return e.field === "state" && e.to === "Planned"; })) return false;
      var born = es.filter(function (e) { return e.field === "created"; })[0];
      if (born && imported(born)) return false;
      if (born && BUILT_STATES.indexOf(born.from) !== -1) return true;
      return es.some(function (e) { return e.field === "state" && BUILT_STATES.indexOf(e.to) !== -1 && ["Proposed", "Research", ""].indexOf(e.from) !== -1; });
    });
  }
  function driftPanel() {
    var list = driftList();
    var p = el("div", "drift" + (list.length ? "" : " ok"));
    var h = el("div", "drifthead");
    h.appendChild(el("b", null, list.length ? list.length + (list.length === 1 ? " feature built without agreement" : " features built without agreement") : "No drift"));
    h.appendChild(el("span", "note", list.length ? "Reached Building or Live without ever being Planned. Mark it agreed, or move it back to Proposed and talk." : "Everything that is being built went through Planned first."));
    p.appendChild(h);
    list.forEach(function (f) {
      var r = el("div", "driftrow");
      var nm = el("button", "fname", f.name);
      nm.onclick = function () { open(f.id); };
      r.appendChild(nm);
      r.appendChild(pill(f.state, stateClass(f.state)));
      r.appendChild(el("span", "note", f.owner && f.owner !== "Unassigned" ? f.owner : ""));
      var ok = el("button", "btn ghost small", "Mark agreed");
      ok.onclick = function () { f.agreed = true; touch(f); save(); render(); toast(f.name + " marked as agreed."); };
      r.appendChild(ok);
      var back = el("button", "btn ghost small", "Back to Proposed");
      back.onclick = function () { setState(f, "Proposed"); save(); render(); toast(f.name + " is Proposed again."); };
      r.appendChild(back);
      p.appendChild(r);
    });
    return p;
  }
  function logEntries() { return (S.log || []).slice().sort(function (a, b) { return (b.t || 0) - (a.t || 0); }); }
  function logVal(field, v) {
    if (v === null || v === undefined || v === "") return "none";
    if (field === "period") { var d = toDate(String(v)); return String(v).length > 7 ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : mLong(String(v)); }
    return String(v);
  }
  function logLine(e) {
    var lab = LOG_FIELDS[e.field] || e.field;
    if (e.field === "created") return "Created" + (e.from ? " as " + e.from : "");
    if (e.field === "deleted") return "Deleted";
    if (e.field === "note" || e.field === "image") return lab + " " + (e.to || "edited");
    return lab + ": " + logVal(e.field, e.from) + " → " + logVal(e.field, e.to);
  }
  function logWhen(t) {
    var d = new Date(t || 0);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  function logDay(t) { var d = new Date(t || 0); return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }); }
  function setWhy(e) {
    askText("Why did this change?", { value: e.why || "", placeholder: "For example: David needs two more weeks, the external page took longer.", ok: "Save reason" })
      .then(function (v) { if (v === null) return; e.why = v; save(); render(); });
  }
  function logRow(e, showFeature) {
    var r = el("div", "logrow");
    var top = el("div", "logtop");
    top.appendChild(el("span", "when", logWhen(e.t)));
    if (e.who) top.appendChild(el("span", "who", e.who));
    r.appendChild(top);
    var body = el("div", "logbody");
    if (showFeature) {
      var f = feature(e.fid);
      var nm = el("button", "fname", e.fname || "Feature");
      if (f) nm.onclick = function () { open(f.id); }; else nm.disabled = true;
      body.appendChild(nm);
    }
    body.appendChild(el("span", "chg", logLine(e)));
    r.appendChild(body);
    var why = el("button", "why" + (e.why ? "" : " empty"), e.why ? "Why: " + e.why : "+ Add a reason");
    why.onclick = function () { setWhy(e); };
    r.appendChild(why);
    return r;
  }
  function historyPanel(f) {
    var p = el("div", "panel");
    p.style.marginTop = "18px";
    p.appendChild(el("h3", null, "History"));
    var list = logEntries().filter(function (e) { return e.fid === f.id; });
    if (!list.length) { p.appendChild(el("div", "note", "No changes recorded yet. From now on every edit lands here.")); return p; }
    var wrap = el("div", "loglist");
    list.slice(0, 12).forEach(function (e) { wrap.appendChild(logRow(e, false)); });
    p.appendChild(wrap);
    if (list.length > 12) {
      var moreB = el("button", "btn ghost rowbtn", "All " + list.length + " changes");
      moreB.onclick = function () { ui.view = "changes"; ui.feature = null; ui.logFeature = f.id; render(); };
      p.appendChild(moreB);
    }
    return p;
  }

  function renderChanges(host) {
    var p = project();
    host.appendChild(header("WHAT CHANGED", p.name + " · change log", []));
    var bar = el("div", "bar");
    var all = logEntries().filter(function (e) { var f = feature(e.fid); return !f || f.project === S.current; });
    var people = [];
    all.forEach(function (e) { if (e.who && people.indexOf(e.who) === -1) people.push(e.who); });
    var whoSel = selectOf([["", "Anyone"]].concat(people.map(function (x) { return [x, x]; })), ui.logWho || "", function (v) { ui.logWho = v; renderView(); }, "Who");
    whoSel.classList.add("selbox"); bar.appendChild(whoSel);
    var fieldSel = selectOf([["", "Any field"]].concat(Object.keys(LOG_FIELDS).map(function (k) { return [k, LOG_FIELDS[k]]; })), ui.logField || "", function (v) { ui.logField = v; renderView(); }, "Field");
    fieldSel.classList.add("selbox"); bar.appendChild(fieldSel);
    if (ui.logFeature) {
      var ff = feature(ui.logFeature);
      var chip = el("button", "chip", (ff ? ff.name : "Feature") + "  ×");
      chip.setAttribute("aria-pressed", "true");
      chip.onclick = function () { ui.logFeature = null; renderView(); };
      bar.appendChild(chip);
    }
    host.appendChild(bar);
    var pad = el("div", "pad");
    pad.appendChild(driftPanel());
    var op = overrunPanel();
    if (op) pad.appendChild(op);
    var list = all.filter(function (e) {
      if (ui.logWho && e.who !== ui.logWho) return false;
      if (ui.logField && e.field !== ui.logField) return false;
      if (ui.logFeature && e.fid !== ui.logFeature) return false;
      return true;
    });
    if (!list.length) { pad.appendChild(el("div", "empty", "Nothing recorded yet. Every change to a feature will show up here, with who made it and when.")); host.appendChild(pad); return; }
    var days = {}, order = [];
    list.forEach(function (e) { var k = logDay(e.t); if (!days[k]) { days[k] = []; order.push(k); } days[k].push(e); });
    order.forEach(function (k) {
      pad.appendChild(sectionTitle(k + " · " + days[k].length));
      var wrap = el("div", "loglist wide");
      days[k].forEach(function (e) { wrap.appendChild(logRow(e, true)); });
      pad.appendChild(wrap);
    });
    host.appendChild(pad);
  }

  /* --- pilots: who we are piloting with, what they asked for, what is live for them, what we think they will need --- */
  var PILOT_STATUS = ["Prospect", "Discovery", "Preparing trial", "Piloting", "Live client", "Paused"];
  var PILOT_STATUS_CLASS = { "Prospect": "st-planned", "Discovery": "st-research", "Preparing trial": "st-planned", "Piloting": "st-building", "Live client": "st-live", "Paused": "st-feature-flag" };
  function pilots() { return S.pilots || []; }
  function pilotById(id) { return pilots().filter(function (p) { return p.id === id; })[0]; }
  function pilotFeats(p, key) { return (p[key] || []).map(feature).filter(Boolean); }
  function pilotLive(p) { return pilotFeats(p, "wants").filter(function (f) { return f.state === "Live" || f.state === "Needs work"; }); }
  function pilotStatusPill(p) { return pill(p.status, PILOT_STATUS_CLASS[p.status] || ""); }
  function pilotsFor(f) { return pilots().filter(function (p) { return (p.wants || []).indexOf(f.id) !== -1 || (p.needs || []).indexOf(f.id) !== -1; }); }

  function newPilot() {
    askText("New pilot", { placeholder: "Firm, clinic or insurer", ok: "Create" }).then(function (n) {
      if (!n) return;
      var p = { id: uid(), name: n, status: "Prospect", contact: "", icp: "", since: mKey(new Date()), notes: "", link: "", wants: [], needs: [], deliverables: [], requests: [], stack: [], created: Date.now(), updated: Date.now() };
      S.pilots = pilots().concat([p]);
      ui.pilot = p.id; ui.view = "pilots"; render(); save();
    });
  }
  function deletePilot(p) {
    askConfirm("Delete " + p.name + "?", "Its lists go away. Features stay untouched.", { danger: true, ok: "Delete" }).then(function (yes) {
      if (!yes) return;
      tombstones[p.id] = true;
      S.pilots = pilots().filter(function (x) { return x.id !== p.id; });
      ui.pilot = null; render(); save();
    });
  }

  /* search the whole inventory and pick one feature */
  function pickFeature(title, exclude) {
    return dialog(function (box, close) {
      box.classList.add("wide");
      box.appendChild(el("h2", null, title));
      box.appendChild(el("p", null, "Search the inventory, sub-features included."));
      var row = el("div", "pickrow");
      var inp = el("input"); inp.type = "search"; inp.placeholder = "Search features…"; inp.setAttribute("aria-label", "Search features");
      row.appendChild(inp); box.appendChild(row);
      var list = el("div", "picklist"); box.appendChild(list);
      function draw() {
        list.innerHTML = "";
        var q = inp.value.trim().toLowerCase();
        var all = feats().filter(function (f) {
          if ((exclude || []).indexOf(f.id) !== -1) return false;
          if (!q) return true;
          var par = f.parent ? feature(f.parent) : null;
          return (f.name + " " + plain(f.note) + " " + (f.spaces || []).join(" ") + " " + f.state + " " + (par ? par.name : "")).toLowerCase().indexOf(q) !== -1;
        }).sort(function (a, b) {
          var na = q && a.name.toLowerCase().indexOf(q) !== -1 ? 0 : 1, nb = q && b.name.toLowerCase().indexOf(q) !== -1 ? 0 : 1;
          if (na !== nb) return na - nb;
          if (!!a.parent !== !!b.parent) return a.parent ? 1 : -1;
          return a.name.localeCompare(b.name);
        });
        if (!all.length) { list.appendChild(el("div", "note pkempty", "Nothing matches.")); return; }
        all.slice(0, 120).forEach(function (f) {
          var par = f.parent ? feature(f.parent) : null;
          var b = el("button", "pk");
          b.appendChild(el("i", "sd " + stateClass(f.state)));
          var t = el("div", "t");
          var nm = el("b");
          if (par) nm.appendChild(el("span", "pp", par.name + " › "));
          nm.appendChild(document.createTextNode(f.name));
          t.appendChild(nm);
          t.appendChild(el("span", null, [(f.spaces || []).join(" · ") || "No space", f.state].join("  ·  ")));
          b.appendChild(t);
          b.appendChild(el("span", "go", "Add"));
          b.onclick = function () { close(f); };
          list.appendChild(b);
        });
        if (all.length > 120) list.appendChild(el("div", "note pkempty", (all.length - 120) + " more. Keep typing."));
      }
      inp.oninput = draw;
      inp.onkeydown = function (e) { if (e.key === "Enter") { var first = list.querySelector(".pk"); if (first) { e.preventDefault(); first.click(); } } };
      draw();
      var acts = el("div", "acts");
      var cancel = el("button", "btn ghost", "Cancel");
      cancel.onclick = function () { close(null); };
      acts.appendChild(cancel); box.appendChild(acts);
      setTimeout(function () { inp.focus(); }, 0);
    });
  }

  /* Drive copy: the Worker keeps a Google Doc per pilot and the two sheets in step with the app. */
  var driveState = null;
  function driveStatusLine() {
    var line = el("div", "drivesync");
    function paint() {
      line.innerHTML = "";
      if (!driveState) { line.appendChild(el("span", "note", "Checking the Drive copy…")); return; }
      if (driveState.error && !driveState.configured) {
        line.appendChild(el("span", "note", "Drive copy: not available on this server."));
        return;
      }
      if (!driveState.configured && driveState.canConnect) {
        line.appendChild(el("span", "note", "Drive copy: not connected yet. Connect your Google account once and every change reaches Drive on its own."));
        var con = el("a", "btn", "Connect Google Drive");
        con.href = "/api/drive/connect";
        line.appendChild(con);
        return;
      }
      if (!driveState.configured) {
        line.appendChild(el("span", "note", "Drive copy: not set up yet. Every change stays in the app; the Drive copy updates once Google access is configured."));
        var how = el("button", "chip", "How to set it up");
        how.onclick = driveSetupHelp;
        line.appendChild(how);
        return;
      }
      var when = driveState.at ? new Date(driveState.at) : null;
      var ago = when ? Math.round((Date.now() - when.getTime()) / 60000) : null;
      var txt = driveState.ok === false ? "Drive copy: last attempt failed" + (driveState.error ? " (" + driveState.error.slice(0, 120) + ")" : "")
        : driveState.pending ? "Drive copy: changes waiting, updates within 10 minutes" + (when ? " · last synced " + (ago < 1 ? "just now" : ago + " min ago") : "")
        : when ? "Drive copy: up to date · synced " + (ago < 1 ? "just now" : ago < 90 ? ago + " min ago" : when.toLocaleString()) : "Drive copy: never synced yet";
      if (driveState.account) txt += " · as " + driveState.account;
      line.appendChild(el("span", "note" + (driveState.ok === false ? " bad" : ""), txt));
      var now = el("button", "chip", "Sync now");
      now.onclick = function () {
        now.disabled = true; now.textContent = "Syncing…";
        fetch("/api/drive/sync", { method: "POST" }).then(function (r) { return r.json(); }).then(function (j) {
          toast(j.ok ? "Drive copy updated." : "Drive sync failed: " + (j.error || ""), !j.ok);
          driveState = null; loadDriveStatus(paint);
        }).catch(function () { toast("Could not reach the server.", true); now.disabled = false; now.textContent = "Sync now"; });
      };
      line.appendChild(now);
      if (driveState.mode === "user") {
        var cal = el("div", "calsync");
        var cs = driveState.calendar || {};
        if (driveState.calendarConnected) {
          var cwhen = cs.at ? new Date(cs.at) : null, cago = cwhen ? Math.round((Date.now() - cwhen.getTime()) / 60000) : null;
          var ctxt = cs.ok === false ? "Calendar: last sync failed" + (cs.error ? " (" + cs.error.slice(0, 140) + ")" : "")
            : cwhen ? "Calendar: in sync · " + (cago < 1 ? "just now" : cago < 90 ? cago + " min ago" : cwhen.toLocaleString()) : "Calendar: connected, first sync pending";
          ctxt += " · dated sessions from today on go to your calendar; meetings booked with pilot people come back as planned sessions";
          cal.appendChild(el("span", "note" + (cs.ok === false ? " bad" : ""), ctxt));
          if ((cs.created || []).length) cal.appendChild(el("span", "note", "New from the calendar: " + cs.created.slice(0, 3).join("; ") + (cs.created.length > 3 ? " and " + (cs.created.length - 3) + " more" : "")));
          var cnow = el("button", "chip", "Sync calendar");
          cnow.onclick = function () {
            cnow.disabled = true; cnow.textContent = "Syncing…";
            fetch("/api/calendar/sync", { method: "POST" }).then(function (r) { return r.json(); }).then(function (j) {
              var n = (j.created || []).length, u = (j.updated || []).length, k = (j.pushed || []).length;
              toast(j.ok ? "Calendar in sync" + (n || u || k ? ": " + [n ? n + " new session" + (n > 1 ? "s" : "") : "", u ? u + " updated" : "", k ? k + " pushed" : ""].filter(Boolean).join(", ") : ", nothing to change") + "." : "Calendar sync failed: " + (j.error || ""), !j.ok);
              driveState = null; loadDriveStatus(paint); if (n || u || k) load();
            }).catch(function () { toast("Could not reach the server.", true); cnow.disabled = false; cnow.textContent = "Sync calendar"; });
          };
          cal.appendChild(cnow);
        } else {
          cal.appendChild(el("span", "note", "Calendar: not connected. Connect once with the same Google account and sessions meet your calendar both ways."));
          var ccon = el("a", "btn small", "Connect Google Calendar"); ccon.href = "/api/drive/connect"; cal.appendChild(ccon);
        }
        line.appendChild(cal);
        var dis = el("button", "chip", "Disconnect");
        dis.onclick = function () {
          askConfirm("Disconnect Google Drive?", "The app stops updating the Drive copies until you connect again.", { danger: true, ok: "Disconnect" }).then(function (yes) {
            if (!yes) return;
            fetch("/api/drive/disconnect", { method: "POST" }).then(function () { driveState = null; loadDriveStatus(paint); toast("Google Drive disconnected."); });
          });
        };
        line.appendChild(dis);
      }
    }
    paint();
    if (!driveState) loadDriveStatus(paint);
    return line;
  }
  /* after the Google round-trip */
  (function () {
    var m = /[#&?]drive=(connected|denied|failed)(?:&why=([^&]*))?/.exec(location.hash + location.search);
    if (!m) return;
    setTimeout(function () {
      if (m[1] === "connected") toast(/calendar=1/.test(location.hash + location.search) ? "Google Drive and Calendar connected. The first sync is running." : "Google Drive connected. The first sync is running.");
      else if (m[1] === "denied") toast("Google Drive was not connected.", true);
      else toast("Google Drive connection failed: " + decodeURIComponent(m[2] || ""), true);
    }, 600);
    try { history.replaceState(null, "", location.pathname + "#pilots"); } catch (e) { /* fine */ }
  })();
  function loadDriveStatus(done) {
    fetch("/api/drive/status").then(function (r) { return r.ok ? r.json() : { configured: false, error: "status " + r.status }; })
      .then(function (j) { driveState = j; done(); })
      .catch(function () { driveState = { configured: false, error: "unreachable" }; done(); });
  }
  function driveSetupHelp() {
    dialog(function (box, close) {
      box.classList.add("wide");
      box.appendChild(el("h2", null, "Let the app write to Drive"));
      var steps = el("ol", "steps");
      ["In Google Cloud console, project Andere, create an OAuth client of type Web application with the redirect URI " + location.origin + "/api/drive/callback.",
       "Store its id and secret on Cloudflare:  npx wrangler secret put GOOGLE_OAUTH_CLIENT_ID  and  npx wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET.",
       "Come back to the Pilots page and press Connect Google Drive; approve once with your Google account.",
       "From then on every change reaches Drive within ten minutes, written as you. Disconnect here or from your Google account at any time."].forEach(function (s) { steps.appendChild(el("li", null, s)); });
      box.appendChild(steps);
      box.appendChild(el("p", null, "The client secret is stored as a Cloudflare secret and the Google refresh token in the app's database. Nobody, including Claude, needs to see either."));
      var acts = el("div", "acts");
      var ok = el("button", "btn", "Close"); ok.onclick = function () { close(null); };
      acts.appendChild(ok); box.appendChild(acts);
    });
  }

  function renderPilots(host) {
    if (ui.pilot) { var cur = pilotById(ui.pilot); if (cur) return renderPilotPage(host, cur); ui.pilot = null; }
    host.appendChild(header("PILOTS", project().name + " · who we are piloting with", [newBtn("NEW PILOT", newPilot)]));
    var pad = el("div", "pad");
    var dir = el("div", "dir");
    dir.appendChild(driveStatusLine());
    var list = pilots().slice().sort(function (a, b) { return PILOT_STATUS.indexOf(a.status) - PILOT_STATUS.indexOf(b.status) || a.name.localeCompare(b.name); });
    if (!list.length) {
      dir.appendChild(el("div", "empty", "No pilots yet. Add the firm or clinic you are piloting with, then list what they asked for."));
    }
    var tiles = el("div", "cattiles");
    list.forEach(function (p) {
      var t = el("button", "cattile pilot");
      var icp = p.icp ? icpById(p.icp) : null;
      t.appendChild(avatarEl(icp ? icp.avatar : "law-firm", "lg"));
      var tx = el("div", "tx");
      var nm = el("b"); nm.appendChild(document.createTextNode(p.name + " ")); nm.appendChild(pilotStatusPill(p));
      tx.appendChild(nm);
      var w = pilotFeats(p, "wants").length, l = pilotLive(p).length;
      var dl = p.deliverables || [];
      var next = dl.filter(function (d) { var pr = delivProgress(d); return d.tag !== "Blocked" && !(pr && pr.live === pr.total); })[0];
      var blocked = dl.filter(function (d) { return d.tag === "Blocked"; }).length;
      var rqU = (p.requests || []).filter(function (r) { return r.decision === "Undecided"; }).length;
      ensurePilot(p);
      var ls = lastSession(p), oa = openActions(p), oq = openQuestions(p), un = unsortedCount(p);
      var since = daysSince(ls && ls.date ? new Date(ls.date + "T12:00:00").getTime() : p.updated);
      var first = p.objective ? plain(p.objective).slice(0, 110) : next ? "Next: " + next.title : dl.length ? "Every deliverable is shipped" : "No deliverables outlined yet";
      tx.appendChild(el("span", null, first));
      var l2 = [];
      if (p.nextTouch && p.nextTouch.date) l2.push("next touch " + stamp(p.nextTouch.date));
      if (oa.length) l2.push(oa.length + (oa.length === 1 ? " open action" : " open actions"));
      if (oq.length) l2.push(oq.length + (oq.length === 1 ? " open question" : " open questions"));
      if (rqU) l2.push(rqU + (rqU === 1 ? " request to decide" : " requests to decide"));
      if (blocked) l2.push(blocked + " blocked");
      if (un) l2.push(un + " unsorted");
      if (!l2.length) l2.push(w ? l + " of " + w + " asks live" : "Nothing asked for yet");
      tx.appendChild(el("span", "sub", l2.join(" · ")));
      t.appendChild(tx);
      var nn = el("div", "n" + (since >= 14 ? " stale" : ""));
      nn.appendChild(el("b", null, since === 0 ? "Today" : since + "d"));
      nn.appendChild(el("span", null, since === 0 ? "last touched" : "since last touch"));
      t.appendChild(nn);
      t.onclick = function () { ui.pilot = p.id; ui.pilotTab = "overview"; renderView(); };
      tiles.appendChild(t);
    });
    dir.appendChild(tiles);
    pad.appendChild(dir);
    host.appendChild(pad);
  }

  /* collapsible cards and panels: remembered per item on this device; everything starts open */
  var folds = {};
  var FOLD_KEY = "alie.fold.v2";
  try { folds = JSON.parse(localStorage.getItem(FOLD_KEY) || "{}") || {}; } catch (e) { folds = {}; }
  function foldOpen(key, dflt) { return folds[key] === undefined ? dflt : !!folds[key]; }
  function foldSet(key, open) { folds[key] = open; try { localStorage.setItem(FOLD_KEY, JSON.stringify(folds)); } catch (e) {} }
  function setFold(node, open) { node.classList.toggle("open", open); foldSet(node.dataset.fold, open); }
  /* peek: one line shown while the card is closed, so folding never hides what the card is about */
  function foldable(node, key, dflt, headSel, peek) {
    node.classList.add("fold");
    node.dataset.fold = key;
    if (foldOpen(key, dflt)) node.classList.add("open");
    var head = node.querySelector(headSel);
    if (!head) return node;
    var chev = el("button", "fchev", "›");
    chev.type = "button"; chev.title = "Collapse or expand"; chev.setAttribute("aria-label", "Collapse or expand");
    chev.onclick = function (e) { e.stopPropagation(); setFold(node, !node.classList.contains("open")); };
    head.insertBefore(chev, head.firstChild);
    head.addEventListener("click", function (e) {
      if (e.target.closest("input, select, button, a, .rte, .pill")) return;
      setFold(node, !node.classList.contains("open"));
    });
    if (peek) {
      var pk = el("div", "fpeek", peek);
      pk.title = "Open";
      pk.onclick = function () { setFold(node, true); };
      head.insertAdjacentElement("afterend", pk);
    }
    return node;
  }
  function foldAllButtons(scope) {
    var w = el("div", "foldall");
    [["Expand all", true], ["Collapse all", false]].forEach(function (m) {
      var b = el("button", "chip", m[0]);
      b.onclick = function () { Array.prototype.forEach.call(scope.querySelectorAll(".fold"), function (n) { setFold(n, m[1]); }); };
      w.appendChild(b);
    });
    return w;
  }
  function peekText(html, fallback) { var t = plain(isHtml(html) ? html : "<p>" + String(html || "") + "</p>"); return t ? (t.length > 180 ? t.slice(0, 177) + "…" : t) : fallback; }
  function pilotListMode() { try { return localStorage.getItem("alie.pilotlist") === "grid" ? "grid" : "list"; } catch (e) { return "list"; } }
  function setPilotListMode(m) { try { localStorage.setItem("alie.pilotlist", m); } catch (e) {} }
  function pilotFeatureRow(f, onRemove) {
    var r = el("div", "dirrow prow");
    r.appendChild(dirIcon(f));
    var t = el("div", "t");
    var b = el("button", "pname");
    var par = f.parent ? feature(f.parent) : null;
    if (par) b.appendChild(el("span", "pp", par.name + " › "));
    b.appendChild(document.createTextNode(f.name));
    b.onclick = function () { open(f.id); };
    t.appendChild(b);
    var meta = el("span", "d");
    meta.appendChild(statePill(f));
    if (f.period) meta.appendChild(document.createTextNode("  " + laneLabelOf(f)));
    if (f.owner && f.owner !== "Unassigned") meta.appendChild(document.createTextNode("  ·  " + f.owner));
    t.appendChild(meta);
    r.appendChild(t);
    if (onRemove) {
      var x = el("button", "act x", "×");
      x.title = "Remove from this list"; x.setAttribute("aria-label", "Remove " + f.name);
      x.onclick = function () { onRemove(f); };
      r.appendChild(x);
    }
    return r;
  }

  /* =====================================================================
     Pilot page, second design: three calm levels (Overview, Discovery, Delivery),
     one centred column, compact rows that expand, forms in a side drawer, and a
     capture composer that is always within reach. Software & partners stays as
     a context pane. Everything below reads and writes the same pilot record.
     ===================================================================== */
  var EV_KINDS = ["Unsorted", "Direct quote", "Client paraphrase", "Observed", "Product inference", "Explicit request"];
  var EV_CLASS = { "Unsorted": "", "Direct quote": "ev-quote", "Client paraphrase": "ev-para", "Observed": "ev-obs", "Product inference": "ev-inf", "Explicit request": "ev-req" };
  var FIT_VALUES = ["Not assessed", "Keep", "Simplify", "Rework", "Hide from pilot", "Retire candidate"];
  var FIT_CLASS = { "Not assessed": "", "Keep": "st-live", "Simplify": "st-planned", "Rework": "st-building", "Hide from pilot": "st-feature-flag", "Retire candidate": "st-needs-work" };
  var DELIV_STATUS = ["Proposed", "Agreed", "In delivery", "Ready for client testing", "Accepted"];
  var DELIV_STATUS_CLASS = { "Proposed": "", "Agreed": "st-planned", "In delivery": "st-building", "Ready for client testing": "st-feature-flag", "Accepted": "st-live" };
  var VALIDATION = ["Not validated", "Client validated", "Rejected"];
  var VALIDATION_CLASS = { "Not validated": "", "Client validated": "st-live", "Rejected": "st-needs-work" };
  var ACTION_STATUS = ["Open", "Done", "Blocked"];
  var ARTIFACT_KINDS = ["Prototype", "Document", "Recording", "Other"];
  var SIDES = ["Client", "Internal"];

  function ensurePilot(p) {
    ["people", "sessions", "evidence", "steps", "workflowHistory", "questions", "actions", "recaps", "artifacts", "decisions", "problems", "reviews", "wants", "needs", "deliverables", "requests", "stack"].forEach(function (k) { if (!Array.isArray(p[k])) p[k] = []; });
    if (!p.fit || typeof p.fit !== "object") p.fit = {};
    if (!p.nextTouch || typeof p.nextTouch !== "object") p.nextTouch = { date: "", note: "" };
    if (typeof p.objective !== "string") p.objective = "";
    if (typeof p.workflowVersion !== "number") p.workflowVersion = 1;
    return p;
  }
  function stamp(d) { return d ? new Date(d.length > 10 ? d : d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : ""; }
  function today() { return dKey(new Date()); }
  function byDateDesc(a, b) { return (b.date || "") < (a.date || "") ? -1 : (b.date || "") > (a.date || "") ? 1 : (b.created || 0) - (a.created || 0); }
  function sessionById(p, id) { return p.sessions.filter(function (s) { return s.id === id; })[0]; }
  function sessionLabel(p, id) { var s = sessionById(p, id); return s ? (s.date ? stamp(s.date) + " · " : "") + (s.title || s.purpose || "Session") : ""; }
  function evidenceFor(p, pred) { return p.evidence.filter(pred); }
  function openQuestions(p) { return p.questions.filter(function (q) { return q.status !== "Answered"; }); }
  function openActions(p) { return p.actions.filter(function (a) { return a.status !== "Done"; }).sort(function (a, b) { return (a.due || "9999") < (b.due || "9999") ? -1 : 1; }); }
  function lastSession(p) { return p.sessions.slice().sort(byDateDesc)[0]; }
  function pilotFeatureSet(p) {
    var ids = {};
    p.wants.concat(p.needs).forEach(function (id) { ids[id] = true; });
    p.deliverables.forEach(function (d) { (d.features || []).forEach(function (id) { ids[id] = true; }); });
    p.requests.forEach(function (r) { if (r.feature) ids[r.feature] = true; });
    Object.keys(p.fit).forEach(function (id) { ids[id] = true; });
    return Object.keys(ids).map(feature).filter(Boolean).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }
  function fitOf(p, f) { return p.fit[f.id] || { fit: "Not assessed", supports: "", evidence: [], unknown: "", next: "" }; }

  /* ---------- small building blocks ---------- */
  function sideDrawer(title, build, o) {
    o = o || {};
    closeSideDrawer();
    var sc = el("div", "dscrim"); sc.id = "escrim"; sc.onclick = closeSideDrawer;
    document.body.appendChild(sc);
    var d = el("div", "drawer edrawer" + (o.wide ? " wide" : "") + (o.cls ? " " + o.cls : "")); d.id = "edrawer";
    d.setAttribute("role", "dialog"); d.setAttribute("aria-label", title);
    var x = el("button", "dclose", "×"); x.setAttribute("aria-label", "Close"); x.onclick = closeSideDrawer;
    d.appendChild(x);
    if (o.eyebrow) d.appendChild(el("div", "eyebrow", o.eyebrow));
    d.appendChild(el("h2", null, title));
    var body = el("div", "ebody");
    d.appendChild(body);
    build(body, closeSideDrawer);
    document.body.appendChild(d);
    function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); closeSideDrawer(); } }
    document.addEventListener("keydown", onKey);
    d._onKey = onKey;
    var first = body.querySelector("input, textarea, select, [contenteditable]");
    if (first && !narrow()) setTimeout(function () { first.focus(); }, 0);
    return closeSideDrawer;
  }
  function closeSideDrawer() {
    var d = document.getElementById("edrawer"), sc = document.getElementById("escrim");
    if (d) { if (d._onKey) document.removeEventListener("keydown", d._onKey); d.remove(); }
    if (sc) sc.remove();
  }
  function fld(label, control, hint) {
    var w = el("div", "fld");
    var l = el("label", null, label);
    w.appendChild(l);
    w.appendChild(control);
    if (hint) w.appendChild(el("span", "hint", hint));
    return w;
  }
  function txtIn(value, ph, on, type) {
    var i = el("input"); i.type = type || "text"; i.value = value || ""; i.placeholder = ph || "";
    i.oninput = function () { on(i.value); };
    return i;
  }
  function areaIn(value, ph, on, rows) {
    var t = el("textarea"); t.value = value || ""; t.placeholder = ph || ""; t.rows = rows || 3;
    t.oninput = function () { on(t.value); };
    return t;
  }
  function selIn(options, value, on) {
    var s = el("select");
    options.forEach(function (o) { var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o; var op = el("option", null, l); op.value = v; if (v === value) op.selected = true; s.appendChild(op); });
    s.onchange = function () { on(s.value); };
    return s;
  }
  function drawerActs(onSave, onCancel, extra) {
    var acts = el("div", "acts");
    (extra || []).forEach(function (b) { acts.appendChild(b); });
    var sp = el("span", "grow"); acts.appendChild(sp);
    var c = el("button", "btn ghost", "Cancel"); c.onclick = onCancel; acts.appendChild(c);
    var s = el("button", "btn", "Save"); s.onclick = onSave; acts.appendChild(s);
    return acts;
  }
  function quietPill(text, cls) { return pill(text, "quiet " + (cls || "")); }
  function metaLine(parts) {
    var m = el("div", "rmeta");
    parts.filter(Boolean).forEach(function (x) { m.appendChild(typeof x === "string" ? el("span", null, x) : x); });
    return m;
  }
  /* compact row that expands into details; remembered per row */
  function xrow(o) {
    var r = el("div", "xrow" + (o.cls ? " " + o.cls : ""));
    r.dataset.fold = o.key;
    var head = el("div", "xhead");
    var chev = el("button", "fchev", "›"); chev.type = "button"; chev.setAttribute("aria-label", "Expand");
    head.appendChild(chev);
    var main = el("div", "xmain");
    var t = el("div", "xtitle");
    if (typeof o.title === "string") t.textContent = o.title; else t.appendChild(o.title);
    main.appendChild(t);
    if (o.meta) main.appendChild(o.meta);
    head.appendChild(main);
    if (o.side) { var sd = el("div", "xside"); o.side.forEach(function (n) { sd.appendChild(n); }); head.appendChild(sd); }
    r.appendChild(head);
    var det = el("div", "xdet");
    r.appendChild(det);
    var built = false;
    function setOpen(v) {
      r.classList.toggle("open", v);
      foldSet(o.key, v);
      if (v && !built) { built = true; o.details(det); }
    }
    if (foldOpen(o.key, !!o.open)) setOpen(true);
    head.addEventListener("click", function (e) {
      if (e.target.closest("input, select, button:not(.fchev), a, .rte, textarea")) return;
      setOpen(!r.classList.contains("open"));
    });
    chev.onclick = function (e) { e.stopPropagation(); setOpen(!r.classList.contains("open")); };
    return r;
  }
  function emptyNote(text) { return el("div", "note empty2", text); }
  function secHead(title, count, hint, actions) {
    var h = el("div", "sechead");
    var t = el("h2", null, title);
    if (count !== undefined && count !== null) t.appendChild(el("em", null, String(count)));
    h.appendChild(t);
    if (actions && actions.length) { var a = el("div", "secacts"); actions.forEach(function (b) { a.appendChild(b); }); h.appendChild(a); }
    var w = el("div", "sec");
    w.appendChild(h);
    if (hint) w.appendChild(el("p", "note", hint));
    return w;
  }
  function chipBtn(label, fn, cls) { var b = el("button", "chip" + (cls ? " " + cls : ""), label); b.onclick = fn; return b; }
  function primaryBtn(label, fn) { var b = el("button", "btn small", label); b.onclick = fn; return b; }

  /* source ids such as CM-20260908-01 become links into the Inbox */
  var SRC_RE = /\b[A-Z]{2,4}-\d{8}-\d{2}\b/g;
  function linkSources(root, p) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    while (walker.nextNode()) { var n = walker.currentNode; if (SRC_RE.test(n.nodeValue) && !n.parentNode.closest("a, button, input, textarea, .srcid")) nodes.push(n); SRC_RE.lastIndex = 0; }
    nodes.forEach(function (n) {
      var frag = document.createDocumentFragment(), text = n.nodeValue, last = 0, m;
      SRC_RE.lastIndex = 0;
      while ((m = SRC_RE.exec(text))) {
        frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        var a = el("button", "srcid", m[0]);
        var has = p.evidence.some(function (e) { return e.source === m[0]; });
        a.title = has ? "Open in the Inbox" : "Not in the Inbox yet: search it there";
        if (!has) a.classList.add("missing");
        a.onclick = (function (id) { return function (ev) { ev.stopPropagation(); ui.pilotTab = "discovery"; ui.pilotSub = "inbox"; ui.inboxQ = id; ui.inboxKind = ""; renderView(); }; })(m[0]);
        frag.appendChild(a);
        last = m.index + m[0].length;
      }
      frag.appendChild(document.createTextNode(text.slice(last)));
      n.parentNode.replaceChild(frag, n);
    });
  }
  function richBlock(html, p, cls) { var v = richView(html, cls || "readtext"); linkSources(v, p); return v; }

  /* ---------- page ---------- */
  var PILOT_LEVELS = [["overview", "Overview"], ["discovery", "Discovery"], ["delivery", "Delivery"]];
  var PILOT_SUBS = { discovery: [["sessions", "Sessions"], ["workflow", "Workflow"], ["problems", "Problems"], ["reviews", "Client reviews"], ["inbox", "Inbox"]],
                     delivery: [["requests", "Requests"], ["deliverables", "Deliverables"], ["fit", "Feature fit"], ["decisions", "Decisions"], ["artifacts", "Artifacts"], ["validation", "Validation"], ["recaps", "Recaps"]] };
  function renderPilotPage(host, p) {
    ensurePilot(p);
    /* older links */
    if (ui.pilotTab === "requests" || ui.pilotTab === "deliverables") { ui.pilotSub = ui.pilotTab; ui.pilotTab = "delivery"; }
    if (ui.pilotTab === "stack") { ui.pilotTab = "overview"; setTimeout(function () { contextPane(p); }, 0); }
    if (["overview", "discovery", "delivery"].indexOf(ui.pilotTab) === -1) ui.pilotTab = "overview";
    if (ui.pilotTab !== "overview" && !PILOT_SUBS[ui.pilotTab].some(function (s) { return s[0] === ui.pilotSub; })) ui.pilotSub = PILOT_SUBS[ui.pilotTab][0][0];

    var col = el("div", "pilotcol");
    /* compact head */
    var head = el("div", "phead");
    var crumbs = el("div", "pcrumb");
    var back = el("button", null, "Pilots"); back.onclick = function () { ui.pilot = null; renderView(); };
    crumbs.appendChild(back);
    crumbs.appendChild(el("span", null, "›"));
    crumbs.appendChild(el("span", null, p.name));
    head.appendChild(crumbs);
    var row = el("div", "prow2");
    var h1 = el("h1", null, p.name);
    row.appendChild(h1);
    var acts = el("div", "pacts");
    var ctx = el("button", "btn ghost small", "Context");
    ctx.title = "Software, partners and people around the firm";
    ctx.onclick = function () { contextPane(p); };
    acts.appendChild(ctx);
    if (p.driveDoc) { var dd = el("a", "btn ghost small", "Drive copy ↗"); dd.href = "https://docs.google.com/document/d/" + p.driveDoc + "/edit"; dd.target = "_blank"; dd.rel = "noopener"; acts.appendChild(dd); }
    acts.appendChild(menu("More", [
      ["Edit overview", function () { editOverview(p); }],
      ["Software, partners and people", function () { contextPane(p); }],
      ["Push pilot record to Drive now", function () { fetch("/api/drive/sync", { method: "POST" }).then(function (r) { return r.json(); }).then(function (j) { toast(j.ok ? "Drive copy updated." : "Drive: " + (j.error || "failed"), !j.ok); }).catch(function () { toast("Could not reach the server.", true); }); }],
      ["Rename", function () { askText("Rename pilot", { value: p.name, ok: "Rename" }).then(function (n) { if (n) { p.name = n; touchPilot(p); render(); save(); } }); }],
      ["Expand all rows", function () { Array.prototype.forEach.call(document.querySelectorAll(".xrow"), function (r) { if (!r.classList.contains("open")) r.querySelector(".fchev").click(); }); }],
      ["Collapse all rows", function () { Array.prototype.forEach.call(document.querySelectorAll(".xrow.open"), function (r) { r.querySelector(".fchev").click(); }); }],
      "-",
      ["Delete pilot", function () { deletePilot(p); }, true]
    ]));
    row.appendChild(acts);
    head.appendChild(row);
    var sub = el("div", "psub");
    sub.appendChild(pilotStatusPill(p));
    if (p.since) sub.appendChild(el("span", "note", "since " + mLong(p.since)));
    if (!p.objective) { var so = el("button", "chip", "Set the discovery objective"); so.onclick = function () { editOverview(p); }; sub.appendChild(so); }
    head.appendChild(sub);
    col.appendChild(head);

    /* levels */
    var tabs = el("div", "ptabs");
    PILOT_LEVELS.forEach(function (m) {
      var b = el("button", null, m[1]);
      b.setAttribute("aria-pressed", String(ui.pilotTab === m[0]));
      if (m[0] === "discovery" && unsortedCount(p)) b.appendChild(el("i", "dotn", String(unsortedCount(p))));
      b.onclick = function () { ui.pilotTab = m[0]; renderView(); };
      tabs.appendChild(b);
    });
    col.appendChild(tabs);
    if (PILOT_SUBS[ui.pilotTab] && narrow()) {
      var psel = selIn(PILOT_SUBS[ui.pilotTab].map(function (s2) { var n = subCount(p, s2[0]); return [s2[0], s2[1] + (n ? " · " + n : "")]; }), ui.pilotSub, function (v) { ui.pilotSub = v; ui.inboxQ = ""; renderView(); });
      psel.className = "psubsel"; psel.setAttribute("aria-label", "Section");
      col.appendChild(psel);
    } else if (PILOT_SUBS[ui.pilotTab]) {
      var subs = el("div", "psubs");
      PILOT_SUBS[ui.pilotTab].forEach(function (s) {
        var b = el("button", null, s[1]);
        var n = subCount(p, s[0]);
        if (n) b.appendChild(el("em", null, String(n)));
        b.setAttribute("aria-pressed", String(ui.pilotSub === s[0]));
        b.onclick = function () { ui.pilotSub = s[0]; ui.inboxQ = ""; renderView(); };
        subs.appendChild(b);
      });
      col.appendChild(subs);
    }
    var body = el("div", "pbody");
    if (ui.pilotTab === "overview") renderOverview(body, p);
    else if (ui.pilotTab === "discovery") ({ sessions: renderSessions, workflow: renderWorkflow, problems: renderProblems, reviews: renderReviews, inbox: renderInbox })[ui.pilotSub](body, p);
    else ({ requests: renderRequestsLevel, deliverables: renderDeliverablesLevel, fit: renderFit, decisions: renderDecisions, artifacts: renderArtifacts, validation: renderValidation, recaps: renderRecaps })[ui.pilotSub](body, p);
    col.appendChild(body);
    host.appendChild(col);
    host.appendChild(captureBar(p));
  }
  function subCount(p, key) {
    switch (key) {
      case "sessions": return p.sessions.length;
      case "workflow": return p.steps.length;
      case "inbox": return unsortedCount(p);
      case "problems": return (p.problems || []).length;
      case "reviews": return (p.reviews || []).reduce(function (n, r) { return n + (window.ALIE_REVIEWS ? window.ALIE_REVIEWS.feedbackCounts(r).open : 0); }, 0);
      case "requests": return p.requests.length;
      case "deliverables": return p.deliverables.length;
      case "fit": return pilotFeatureSet(p).length;
      case "decisions": return p.decisions.length + p.requests.filter(function (r) { return r.decision !== "Undecided"; }).length;
      case "artifacts": return p.artifacts.length;
      case "validation": return p.deliverables.filter(function (d) { return d.validation && d.validation.status === "Client validated"; }).length + p.requests.filter(function (r) { return r.validation && r.validation.status === "Client validated"; }).length;
      case "recaps": return p.recaps.length;
    }
    return 0;
  }

  /* ---------- overview ---------- */
  function editOverview(p) {
    var d = { status: p.status, objective: p.objective, since: p.since || "", link: p.link || "", nextDate: p.nextTouch.date || "", nextNote: p.nextTouch.note || "", icp: p.icp || "" };
    sideDrawer("Overview", function (body, close) {
      body.appendChild(fld("Phase", selIn(PILOT_STATUS, d.status, function (v) { d.status = v; }), "Discovery and Preparing trial come before any use of ALIE."));
      body.appendChild(fld("Discovery objective", areaIn(d.objective, "What we need to learn before this firm can start, in one or two sentences.", function (v) { d.objective = v; }, 3)));
      body.appendChild(fld("Buyer profile", selIn([["", "No profile"]].concat(S.icps.filter(function (x) { return x.kind === "Buyer"; }).map(function (x) { return [x.id, x.name]; })), d.icp, function (v) { d.icp = v; })));
      body.appendChild(fld("Since", txtIn(d.since, "2026-05", function (v) { d.since = v; }, "month")));
      body.appendChild(fld("Next touch", txtIn(d.nextDate, "", function (v) { d.nextDate = v; }, "date")));
      body.appendChild(fld("Next touch note", txtIn(d.nextNote, "For example: review the workflow map with Amélie", function (v) { d.nextNote = v; })));
      body.appendChild(fld("Drive folder", txtIn(d.link, "https://drive.google.com/drive/folders/…", function (v) { d.link = v; })));
      body.appendChild(drawerActs(function () {
        p.status = d.status; p.objective = d.objective.trim(); p.since = d.since; p.link = d.link.trim(); p.icp = d.icp; p.nextTouch = { date: d.nextDate, note: d.nextNote.trim() };
        touchPilot(p); close(); render(); save();
      }, close));
    });
  }
  function editPerson(p, person) {
    var isNew = !person;
    var d = person ? JSON.parse(JSON.stringify(person)) : { id: uid(), name: "", role: "", side: "Client", note: "" };
    sideDrawer(isNew ? "Add a person" : d.name, function (body, close) {
      body.appendChild(fld("Name", txtIn(d.name, "", function (v) { d.name = v; })));
      body.appendChild(fld("Role", txtIn(d.role, "Lawyer, paralegal, technicienne, our CTO…", function (v) { d.role = v; })));
      body.appendChild(fld("Side", selIn(SIDES, d.side, function (v) { d.side = v; })));
      body.appendChild(fld("Email", txtIn(d.email || "", "name@firm.ca", function (v) { d.email = v.trim(); }, "email"), "A calendar meeting with this address becomes a planned session here."));
      body.appendChild(fld("Note", areaIn(d.note, "What they care about, how to reach them.", function (v) { d.note = v; }, 3)));
      var extra = [];
      if (!isNew) { var del = el("button", "btn ghost danger", "Remove"); del.onclick = function () { p.people = p.people.filter(function (x) { return x.id !== d.id; }); touchPilot(p); close(); render(); save(); }; extra.push(del); }
      body.appendChild(drawerActs(function () {
        if (!d.name.trim()) return;
        d.name = d.name.trim();
        if (isNew) p.people = p.people.concat([d]); else Object.assign(person, d);
        touchPilot(p); close(); render(); save();
      }, close, extra));
    }, { eyebrow: "PEOPLE" });
  }
  function renderOverview(body, p) {
    var strip = el("div", "ostrip");
    var last = lastSession(p);
    var oq = openQuestions(p), oa = openActions(p);
    var pend = p.requests.filter(function (r) { return r.decision === "Undecided"; }).length;
    var accepted = p.deliverables.filter(function (d) { return d.status === "Accepted"; }).length;
    var validated = p.deliverables.filter(function (d) { return d.validation && d.validation.status === "Client validated"; }).length;
    [["Phase", p.status], ["Last touch", last ? (last.date ? stamp(last.date) : "undated") : "none yet"], ["Next touch", p.nextTouch.date ? stamp(p.nextTouch.date) : "not set"], ["Open questions", String(oq.length)], ["Next actions", String(oa.length)], ["To decide", String(pend)], ["Accepted", accepted + " of " + p.deliverables.length], ["Validated", String(validated)]].forEach(function (x) {
      var c = el("div", "ocell"); c.appendChild(el("span", null, x[0])); c.appendChild(el("b", null, x[1])); strip.appendChild(c);
    });
    body.appendChild(strip);

    /* objective + people */
    var s1 = secHead("Discovery objective", null, null, [chipBtn("Edit", function () { editOverview(p); })]);
    s1.appendChild(p.objective ? richBlock(p.objective, p) : emptyNote("Not written yet. What must we learn before this firm can start?"));
    if (p.nextTouch.note) s1.appendChild(el("p", "note", "Next touch: " + (p.nextTouch.date ? stamp(p.nextTouch.date) + " · " : "") + p.nextTouch.note));
    body.appendChild(s1);

    var s2 = secHead("People", p.people.length || null, null, [chipBtn("+ Add", function () { editPerson(p, null); })]);
    if (p.people.length) {
      var pl = el("div", "peoplelist");
      p.people.forEach(function (x) {
        var b = el("button", "person");
        b.appendChild(el("b", null, x.name));
        b.appendChild(el("span", null, [x.role, x.side].filter(Boolean).join(" · ")));
        b.onclick = function () { editPerson(p, x); };
        pl.appendChild(b);
      });
      s2.appendChild(pl);
    }
    if (p.contact) s2.appendChild(el("p", "note legacy", "Contact line, as recorded before: " + p.contact));
    if (!p.people.length && !p.contact) s2.appendChild(emptyNote("Nobody listed yet."));
    body.appendChild(s2);

    /* open questions */
    var s3 = secHead("Top open questions", oq.length || null, null, [chipBtn("+ Question", function () { editQuestion(p, null); }), chipBtn("All", function () { ui.pilotTab = "discovery"; ui.pilotSub = "workflow"; renderView(); })]);
    if (!oq.length) s3.appendChild(emptyNote("No open questions. Add the ones the next session must answer."));
    oq.slice(0, 6).forEach(function (q) { s3.appendChild(questionRow(p, q)); });
    body.appendChild(s3);

    /* next actions */
    var s4 = secHead("Next actions", oa.length || null, null, [chipBtn("+ Action", function () { editAction(p, null); })]);
    if (!oa.length) s4.appendChild(emptyNote("Nothing scheduled. Add what happens next, who owns it, and by when."));
    oa.slice(0, 8).forEach(function (a) { s4.appendChild(actionRow(p, a)); });
    body.appendChild(s4);

    var deps = oa.filter(function (a) { return a.side === "Client"; });
    var s5 = secHead("Client dependencies", deps.length || null, "What we are waiting on from the firm.");
    if (!deps.length) s5.appendChild(emptyNote("Nothing owed by the client right now."));
    deps.forEach(function (a) { s5.appendChild(actionRow(p, a)); });
    body.appendChild(s5);

    var pendReqs = p.requests.filter(function (r) { return r.decision === "Undecided"; });
    var pendDec = decisions().filter(function (d) { return d.pilot === p.id && (d.state === "Proposed" || decisionBlocked(d)); });
    var s6 = secHead("Pending decisions", pendReqs.length + pendDec.length || null, null, [chipBtn("Queue", function () { ui.view = "decisions"; ui.pilot = null; render(); })]);
    if (!pendReqs.length && !pendDec.length) s6.appendChild(emptyNote("Every request has a decision and nothing waits for alignment."));
    pendDec.forEach(function (d) { s6.appendChild(decisionRow(d)); });
    pendReqs.slice(0, 6).forEach(function (r) {
      var b = el("button", "linkrow");
      b.appendChild(el("b", null, r.title));
      b.appendChild(el("span", null, r.fit || "fit not assessed"));
      b.onclick = function () { ui.pilotTab = "delivery"; ui.pilotSub = "requests"; foldSet("r:" + r.id, true); renderView(); };
      s6.appendChild(b);
    });
    body.appendChild(s6);

    var s7 = secHead("Outcome progress", p.deliverables.length || null, "Deliverable status is ours; validation is the client's word.", [chipBtn("Deliverables", function () { ui.pilotTab = "delivery"; ui.pilotSub = "deliverables"; renderView(); })]);
    if (!p.deliverables.length) s7.appendChild(emptyNote("No deliverables outlined yet."));
    else {
      var bars = el("div", "outbars");
      DELIV_STATUS.forEach(function (st) {
        var n = p.deliverables.filter(function (d) { return (d.status || "Proposed") === st; }).length;
        var b = el("div", "outbar" + (n ? "" : " zero")); b.appendChild(el("b", null, String(n))); b.appendChild(el("span", null, st)); bars.appendChild(b);
      });
      s7.appendChild(bars);
    }
    body.appendChild(s7);

    /* legacy notebook stays reachable, clearly labelled */
    var s8 = secHead("Notebook", null, "Written before the discovery structure existed. Treat as draft and unverified until moved into sessions, evidence or the workflow.");
    var nb = xrow({ key: "p:" + p.id + ":notes", title: "Imported notes", meta: metaLine([quietPill("draft · unverified", "st-feature-flag")]), details: function (det) {
      det.appendChild(richEditor(p.notes, function (h) { p.notes = h; touchPilot(p); save(); }, "Nothing here.", "small"));
    } });
    s8.appendChild(nb);
    body.appendChild(s8);
  }

  /* ---------- questions and actions (shared rows) ---------- */
  function editAction(p, a, preset) {
    var isNew = !a;
    var d = a ? JSON.parse(JSON.stringify(a)) : Object.assign({ id: uid(), title: "", owner: "", due: "", side: "Internal", status: "Open", note: "", links: {}, created: Date.now(), updated: Date.now() }, preset || {});
    d.links = d.links || {};
    sideDrawer(isNew ? "New action" : "Action", function (body, close) {
      body.appendChild(fld("What", txtIn(d.title, "Send the workflow map for review", function (v) { d.title = v; })));
      body.appendChild(fld("Owner", txtIn(d.owner, "Uzziel, Amélie, David…", function (v) { d.owner = v; })));
      body.appendChild(fld("Side", selIn(SIDES, d.side, function (v) { d.side = v; }), "Client side means we are waiting on the firm."));
      body.appendChild(fld("Due", txtIn(d.due, "", function (v) { d.due = v; }, "date")));
      body.appendChild(fld("Status", selIn(ACTION_STATUS, d.status, function (v) { d.status = v; })));
      body.appendChild(fld("Note", areaIn(d.note, "", function (v) { d.note = v; }, 2)));
      body.appendChild(fld("Source session", selIn([["", "None"]].concat(p.sessions.slice().sort(byDateDesc).map(function (s) { return [s.id, sessionLabel(p, s.id)]; })), d.links.session || "", function (v) { d.links.session = v; })));
      body.appendChild(fld("Linked request", selIn([["", "None"]].concat(p.requests.map(function (r) { return [r.id, r.title]; })), d.links.request || "", function (v) { d.links.request = v; })));
      body.appendChild(fld("Linked deliverable", selIn([["", "None"]].concat(p.deliverables.map(function (r) { return [r.id, r.title]; })), d.links.deliverable || "", function (v) { d.links.deliverable = v; })));
      var extra = [];
      if (!isNew) { var del = el("button", "btn ghost danger", "Delete"); del.onclick = function () { p.actions = p.actions.filter(function (x) { return x.id !== d.id; }); touchPilot(p); close(); render(); save(); }; extra.push(del); }
      body.appendChild(drawerActs(function () {
        if (!d.title.trim()) return;
        d.title = d.title.trim(); d.updated = Date.now();
        if (isNew) p.actions = p.actions.concat([d]); else Object.assign(a, d);
        touchPilot(p); close(); render(); save();
      }, close, extra));
    }, { eyebrow: "NEXT ACTION" });
  }
  function actionRow(p, a) {
    var r = el("div", "qrow" + (a.status === "Done" ? " done" : ""));
    var tick = el("button", "tick" + (a.status === "Done" ? " on" : ""), a.status === "Done" ? "✓" : "");
    tick.setAttribute("aria-label", a.status === "Done" ? "Reopen" : "Mark done");
    tick.onclick = function () { a.status = a.status === "Done" ? "Open" : "Done"; a.updated = Date.now(); touchPilot(p); render(); save(); };
    r.appendChild(tick);
    var t = el("button", "qtext");
    t.appendChild(el("b", null, a.title));
    var m = [a.owner, a.side, a.due ? "due " + stamp(a.due) : "", a.status === "Blocked" ? "blocked" : ""].filter(Boolean);
    var links = [];
    if (a.links && a.links.session && sessionById(p, a.links.session)) links.push(sessionLabel(p, a.links.session));
    if (a.links && a.links.request) { var rq = p.requests.filter(function (x) { return x.id === a.links.request; })[0]; if (rq) links.push("request: " + rq.title); }
    if (a.links && a.links.deliverable) { var dl = p.deliverables.filter(function (x) { return x.id === a.links.deliverable; })[0]; if (dl) links.push("deliverable: " + dl.title); }
    t.appendChild(el("span", null, m.concat(links).join(" · ")));
    t.onclick = function () { editAction(p, a); };
    r.appendChild(t);
    if (a.due && a.status !== "Done" && a.due < today()) r.appendChild(quietPill("overdue", "st-needs-work"));
    return r;
  }

  /* ---------- discovery: workflow ---------- */
  function editStep(p, s, preset) {
    var isNew = !s;
    var d = s ? JSON.parse(JSON.stringify(s)) : Object.assign({ id: uid(), title: "", version: "current", actor: "", trigger: "", action: "", reasoning: "", output: "", next: "", systems: "", evidence: [], draft: false, created: Date.now(), updated: Date.now() }, preset || {});
    sideDrawer(isNew ? "New workflow step" : d.title, function (body, close) {
      body.appendChild(fld("Step", txtIn(d.title, "Build the medical chronology", function (v) { d.title = v; })));
      body.appendChild(fld("Version", selIn([["current", "Current: how they work today"], ["proposed", "Proposed: how it could work with ALIE"]], d.version, function (v) { d.version = v; })));
      body.appendChild(fld("Actor", txtIn(d.actor, "Who does it", function (v) { d.actor = v; })));
      body.appendChild(fld("Trigger or input", areaIn(d.trigger, "What starts the step and what comes in", function (v) { d.trigger = v; }, 2)));
      body.appendChild(fld("Action", areaIn(d.action, "What they actually do", function (v) { d.action = v; }, 3)));
      body.appendChild(fld("Reasoning and decisions", areaIn(d.reasoning, "How they decide what to include, exclude, quote or summarise", function (v) { d.reasoning = v; }, 3)));
      body.appendChild(fld("Output", areaIn(d.output, "What the step produces", function (v) { d.output = v; }, 2)));
      body.appendChild(fld("Next recipient", txtIn(d.next, "Who uses it next and for which decision", function (v) { d.next = v; })));
      body.appendChild(fld("Systems used", txtIn(d.systems, "Juris Évolution, Outlook, paper…", function (v) { d.systems = v; })));
      var dr = el("label", "chk"); var cb = el("input"); cb.type = "checkbox"; cb.checked = !!d.draft; cb.onchange = function () { d.draft = cb.checked; }; dr.appendChild(cb); dr.appendChild(document.createTextNode(" Draft: our reading, not yet confirmed by the firm"));
      body.appendChild(dr);
      var extra = [];
      if (!isNew) { var del = el("button", "btn ghost danger", "Delete"); del.onclick = function () { p.steps = p.steps.filter(function (x) { return x.id !== d.id; }); p.questions.forEach(function (q) { if (q.step === d.id) q.step = ""; }); touchPilot(p); close(); render(); save(); }; extra.push(del); }
      body.appendChild(drawerActs(function () {
        if (!d.title.trim()) return;
        d.title = d.title.trim(); d.updated = Date.now();
        if (isNew) { d.order = p.steps.length; p.steps = p.steps.concat([d]); } else Object.assign(s, d);
        touchPilot(p); close(); render(); save();
      }, close, extra));
    }, { eyebrow: "WORKFLOW STEP", wide: true });
  }
  function renderWorkflow(body, p) {
    var mode = ui.wfMode || "current";
    var all = p.steps.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    var shown = mode === "all" ? all : all.filter(function (s) { return (s.version || "current") === mode; });
    var seg = el("div", "psubs mini");
    [["current", "Current"], ["proposed", "Proposed"], ["all", "Both"]].forEach(function (m) {
      var b = el("button", null, m[1]); b.setAttribute("aria-pressed", String(mode === m[0])); b.onclick = function () { ui.wfMode = m[0]; renderView(); }; seg.appendChild(b);
    });
    var snap = chipBtn("Snapshot v" + p.workflowVersion, function () {
      askText("Name this version", { placeholder: "After the session with Amélie", ok: "Snapshot" }).then(function (n) {
        if (n === null) return;
        p.workflowHistory = p.workflowHistory.concat([{ id: uid(), v: p.workflowVersion, label: n || "", at: Date.now(), steps: JSON.parse(JSON.stringify(p.steps)) }]);
        p.workflowVersion += 1; touchPilot(p); render(); save(); toast("Workflow v" + (p.workflowVersion - 1) + " kept.");
      });
    });
    var sec = secHead("Workflow map", all.length || null, "How the firm actually reasons, step by step. Current is what they do today; Proposed is what it could become. Every step carries its evidence and what we still do not know.", [snap, primaryBtn("+ Step", function () { editStep(p, null, { version: mode === "proposed" ? "proposed" : "current" }); })]);
    sec.insertBefore(seg, sec.children[1]);
    if (!shown.length) sec.appendChild(emptyNote(all.length ? "No " + mode + " steps yet." : "No steps yet. Start with the step you understand least."));
    shown.forEach(function (s, i) {
      var ev = (s.evidence || []).map(function (id) { return p.evidence.filter(function (e) { return e.id === id; })[0]; }).filter(Boolean);
      var qs = p.questions.filter(function (q) { return q.step === s.id; });
      var oq = qs.filter(function (q) { return q.status !== "Answered"; });
      var titleNode = el("span"); titleNode.appendChild(el("i", "stepn", String(i + 1))); titleNode.appendChild(document.createTextNode(s.title));
      if (s.draft) titleNode.appendChild(quietPill("draft", "st-feature-flag"));
      var side = [];
      var up = el("button", "dmove", "↑"); up.title = "Move up"; up.onclick = function (e) { e.stopPropagation(); moveStep(p, s, -1); };
      var dn = el("button", "dmove", "↓"); dn.title = "Move down"; dn.onclick = function (e) { e.stopPropagation(); moveStep(p, s, 1); };
      side.push(up, dn);
      sec.appendChild(xrow({ key: "w:" + s.id, title: titleNode,
        meta: metaLine([quietPill(s.version === "proposed" ? "proposed" : "current", s.version === "proposed" ? "st-planned" : ""), s.actor ? s.actor : "actor unknown", s.output ? "→ " + s.output.slice(0, 60) : "", ev.length ? ev.length + " evidence" : "no evidence yet", oq.length ? oq.length + " open" : ""]),
        side: side,
        details: function (det) {
          var g = el("div", "stepgrid");
          [["Actor", s.actor], ["Trigger or input", s.trigger], ["Action", s.action], ["Reasoning and decisions", s.reasoning], ["Output", s.output], ["Next recipient", s.next], ["Systems used", s.systems]].forEach(function (x) {
            var c = el("div", "stepcell"); c.appendChild(el("div", "lab", x[0])); c.appendChild(x[1] ? el("p", "readtext", x[1]) : el("p", "readtext muted", "unknown")); g.appendChild(c);
          });
          det.appendChild(g);
          det.appendChild(el("div", "lab", "Supporting evidence"));
          if (!ev.length) det.appendChild(emptyNote("Nothing linked yet. Open an Inbox item and attach it to this step."));
          ev.forEach(function (e) { det.appendChild(evidenceRow(p, e, true)); });
          det.appendChild(el("div", "lab", "Open questions")); if (!qs.length) det.appendChild(emptyNote("None.")); qs.forEach(function (q) { det.appendChild(questionRow(p, q)); });
          var acts = el("div", "rowacts");
          acts.appendChild(chipBtn("Edit step", function () { editStep(p, s); }));
          acts.appendChild(chipBtn("+ Question", function () { editQuestion(p, null, { step: s.id }); }));
          acts.appendChild(chipBtn(s.version === "proposed" ? "Copy as current" : "Propose a change", function () {
            var c = JSON.parse(JSON.stringify(s)); c.id = uid(); c.version = s.version === "proposed" ? "current" : "proposed"; c.draft = true; c.created = c.updated = Date.now(); c.order = (s.order || 0) + 0.5;
            p.steps = p.steps.concat([c]); renumber(p); touchPilot(p); ui.wfMode = c.version; render(); save();
          }));
          det.appendChild(acts);
        } }));
    });
    if (p.workflowHistory.length) {
      var hist = xrow({ key: "wh:" + p.id, title: "Earlier versions", meta: metaLine([p.workflowHistory.length + " kept"]), details: function (det) {
        p.workflowHistory.slice().reverse().forEach(function (h) {
          var r = el("div", "qrow"); var t = el("div", "qtext"); t.appendChild(el("b", null, "v" + h.v + (h.label ? " · " + h.label : ""))); t.appendChild(el("span", null, new Date(h.at).toLocaleString() + " · " + h.steps.length + " steps: " + h.steps.map(function (s) { return s.title; }).join(", "))); r.appendChild(t); det.appendChild(r);
        });
      } });
      sec.appendChild(hist);
    }
    body.appendChild(sec);
  }
  function renumber(p) { p.steps.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); }).forEach(function (s, i) { s.order = i; }); }
  function moveStep(p, s, dir) {
    renumber(p);
    var same = p.steps.slice().sort(function (a, b) { return a.order - b.order; });
    var i = same.indexOf(s), j = i + dir;
    if (j < 0 || j >= same.length) return;
    var o = same[j].order; same[j].order = s.order; s.order = o;
    touchPilot(p); render(); save();
  }

  /* ---------- discovery: inbox ---------- */
  function editEvidence(p, e) {
    var d = JSON.parse(JSON.stringify(e)); d.links = d.links || {};
    sideDrawer("Evidence", function (body, close) {
      body.appendChild(fld("Original wording", areaIn(d.text, "", function (v) { d.text = v; }, 4), "Keep it as it was said or seen. Interpretation goes in the note."));
      body.appendChild(fld("Kind", selIn(EV_KINDS, d.kind, function (v) { d.kind = v; }), "A product inference is ours. It never becomes a client request on its own."));
      body.appendChild(fld("Session", selIn([["", "None"]].concat(p.sessions.slice().sort(byDateDesc).map(function (s) { return [s.id, sessionLabel(p, s.id)]; })), d.session, function (v) { d.session = v; })));
      body.appendChild(fld("Who said or did it", txtIn(d.speaker, "Amélie, Sarah, Claudine…", function (v) { d.speaker = v; })));
      body.appendChild(fld("Source id", txtIn(d.source, "CM-20260908-01, a Drive link, a page", function (v) { d.source = v; })));
      body.appendChild(fld("Our note", areaIn(d.note, "What we make of it.", function (v) { d.note = v; }, 2)));
      body.appendChild(fld("Workflow step", selIn([["", "None"]].concat(p.steps.map(function (s) { return [s.id, s.title]; })), d.links.step || "", function (v) { d.links.step = v; })));
      body.appendChild(fld("Request", selIn([["", "None"]].concat(p.requests.map(function (r) { return [r.id, r.title]; })), d.links.request || "", function (v) { d.links.request = v; })));
      body.appendChild(fld("Deliverable", selIn([["", "None"]].concat(p.deliverables.map(function (r) { return [r.id, r.title]; })), d.links.deliverable || "", function (v) { d.links.deliverable = v; })));
      var frow = el("div", "fld"); frow.appendChild(el("label", null, "Feature"));
      var fb = el("button", "btn ghost small", d.links.feature && feature(d.links.feature) ? feature(d.links.feature).name : "Pick a feature");
      fb.onclick = function () { pickFeature("Link to a feature", []).then(function (f) { if (f) { d.links.feature = f.id; fb.textContent = f.name; } }); };
      frow.appendChild(fb);
      if (d.links.feature) { var clr = el("button", "chip", "Clear"); clr.onclick = function () { d.links.feature = ""; fb.textContent = "Pick a feature"; }; frow.appendChild(clr); }
      body.appendChild(frow);
      var del = el("button", "btn ghost danger", "Delete"); del.onclick = function () { askConfirm("Delete this evidence?", "", { danger: true, ok: "Delete" }).then(function (y) { if (!y) return; p.evidence = p.evidence.filter(function (x) { return x.id !== d.id; }); p.steps.forEach(function (s) { s.evidence = (s.evidence || []).filter(function (id) { return id !== d.id; }); }); touchPilot(p); close(); render(); save(); }); };
      body.appendChild(drawerActs(function () {
        d.text = d.text.trim(); d.updated = Date.now();
        Object.assign(e, d);
        if (d.links.step) { var st = p.steps.filter(function (s) { return s.id === d.links.step; })[0]; if (st && (st.evidence || []).indexOf(e.id) === -1) st.evidence = (st.evidence || []).concat([e.id]); }
        touchPilot(p); close(); render(); save();
      }, close, [del]));
    }, { eyebrow: (e.kind || "Unsorted").toUpperCase() });
  }
  function promoteEvidence(p, e) {
    if (e.kind === "Product inference") { toast("A product inference stays ours. Record it as a proposed solution on a request, or ask the firm first.", true); return; }
    askConfirm("Turn this into a request?", "The wording is kept as the request title and stays linked as evidence. You decide fit and decision afterwards.", { ok: "Create request" }).then(function (y) {
      if (!y) return;
      var r = { id: uid(), title: e.text.length > 90 ? e.text.slice(0, 87) + "…" : e.text, bottleneck: "", need: "", solution: "", fit: "", decision: "Undecided", reason: "", source: [e.speaker, e.source, e.session ? sessionLabel(p, e.session) : ""].filter(Boolean).join(" · "), feature: "", evidence: [e.id], validation: { status: "Not validated", note: "", date: "" }, created: Date.now(), updated: Date.now() };
      p.requests = p.requests.concat([r]);
      e.links = e.links || {}; e.links.request = r.id;
      if (e.kind === "Unsorted") e.kind = "Explicit request";
      touchPilot(p); save(); ui.pilotTab = "delivery"; ui.pilotSub = "requests"; foldSet("r:" + r.id, true); render();
    });
  }
  function evidenceRow(p, e, compact) {
    var r = el("div", "evrow " + (EV_CLASS[e.kind] || ""));
    var k = el("button", "evkind", e.kind || "Unsorted");
    k.title = "Classify"; k.onclick = function () { editEvidence(p, e); };
    r.appendChild(k);
    var t = el("div", "evtext");
    var q = el("div", "evq" + (e.kind === "Direct quote" ? " quote" : ""), e.text);
    t.appendChild(q);
    var m = [];
    if (e.speaker) m.push(e.speaker);
    if (e.session && sessionById(p, e.session)) m.push(sessionLabel(p, e.session));
    if (e.source) m.push(e.source);
    m.push(stamp(dKey(new Date(e.created || Date.now()))));
    if (e.links && e.links.feature && feature(e.links.feature)) m.push("→ " + feature(e.links.feature).name);
    if (e.links && e.links.request) { var rq = p.requests.filter(function (x) { return x.id === e.links.request; })[0]; if (rq) m.push("→ request: " + rq.title); }
    if (e.links && e.links.step) { var st = p.steps.filter(function (x) { return x.id === e.links.step; })[0]; if (st) m.push("→ step: " + st.title); }
    t.appendChild(el("div", "rmeta", m.join(" · ")));
    if (e.note) t.appendChild(el("div", "evnote", e.note));
    r.appendChild(t);
    if (!compact) {
      var acts = el("div", "evacts");
      acts.appendChild(chipBtn("Sort", function () { editEvidence(p, e); }));
      if (e.kind !== "Product inference" && !(e.links && e.links.request)) acts.appendChild(chipBtn("→ Request", function () { promoteEvidence(p, e); }));
      acts.appendChild(chipBtn("→ Question", function () { editQuestion(p, null, { text: e.text, session: e.session || "" }); }));
      if (p.questions.some(qOpen)) acts.appendChild(chipBtn("→ Answers…", function () { proposeAnswer(p, e); }));
      acts.appendChild(chipBtn("→ Problem", function () { frameFromEvidence(p, e); }));
      r.appendChild(acts);
    }
    return r;
  }
  function renderInbox(body, p) {
    var kind = ui.inboxKind || "", q = (ui.inboxQ || "").toLowerCase();
    var list = p.evidence.slice().sort(function (a, b) { return (b.created || 0) - (a.created || 0); }).filter(function (e) { return (!kind || e.kind === kind) && (!q || (e.text + " " + e.source + " " + e.speaker + " " + e.note).toLowerCase().indexOf(q) !== -1); });
    var sec = secHead("Inbox and evidence", p.evidence.length || null, "Everything captured, in the words it came in. Sort each item by provenance and link it to a session, a step, a request or a feature. Nothing here is a commitment.");
    var filt = el("div", "psubs mini wrap");
    [["", "All"]].concat(EV_KINDS.map(function (k) { return [k, k]; })).forEach(function (m) {
      var n = m[0] ? p.evidence.filter(function (e) { return e.kind === m[0]; }).length : p.evidence.length;
      var b = el("button", null, m[1]); if (n) b.appendChild(el("em", null, String(n)));
      b.setAttribute("aria-pressed", String(kind === m[0])); b.onclick = function () { ui.inboxKind = m[0]; renderView(); }; filt.appendChild(b);
    });
    sec.insertBefore(filt, sec.children[1]);
    var srow = el("div", "inboxsearch");
    var sin = el("input"); sin.type = "search"; sin.placeholder = "Search wording, source id, speaker…"; sin.value = ui.inboxQ || ""; sin.setAttribute("aria-label", "Search evidence");
    sin.oninput = function () { ui.inboxQ = sin.value; var host = sec.querySelector(".evlist"); host.innerHTML = ""; fill(host); };
    srow.appendChild(sin);
    sec.appendChild(srow);
    var host = el("div", "evlist");
    function fill(h) {
      var qq = (ui.inboxQ || "").toLowerCase();
      var items = p.evidence.slice().sort(function (a, b) { return (b.created || 0) - (a.created || 0); }).filter(function (e) { return (!kind || e.kind === kind) && (!qq || (e.text + " " + e.source + " " + e.speaker + " " + e.note).toLowerCase().indexOf(qq) !== -1); });
      if (!items.length) h.appendChild(emptyNote(p.evidence.length ? "Nothing matches." : "Empty. Use the capture box below: one line, then sort it later."));
      items.forEach(function (e) { h.appendChild(evidenceRow(p, e, false)); });
    }
    fill(host);
    sec.appendChild(host);
    body.appendChild(sec);
    void list;
  }

  /* ---------- delivery: requests as rows, edited in a drawer ---------- */
  var REQ_FIT_CLASS = { "Core to ALIE": "st-live", "Adjacent": "st-planned", "Out of scope": "st-needs-work" };
  function evidenceOfRequest(p, r) {
    var ids = (r.evidence || []).slice();
    p.evidence.forEach(function (e) { if (e.links && e.links.request === r.id && ids.indexOf(e.id) === -1) ids.push(e.id); });
    return ids.map(function (id) { return p.evidence.filter(function (e) { return e.id === id; })[0]; }).filter(Boolean);
  }
  function editRequest(p, r) {
    var isNew = !r;
    var d = r ? JSON.parse(JSON.stringify(r)) : { id: uid(), title: "", bottleneck: "", need: "", solution: "", fit: "", decision: "Undecided", reason: "", source: "", feature: "", evidence: [], validation: { status: "Not validated", note: "", date: "" }, created: Date.now(), updated: Date.now() };
    d.evidence = d.evidence || [];
    sideDrawer(isNew ? "New request" : d.title, function (body, close) {
      body.appendChild(fld("What they asked for, in their words", txtIn(d.title, "", function (v) { d.title = v; })));
      body.appendChild(fld("Source", txtIn(d.source, "Who said it, when · a source id · a Drive link", function (v) { d.source = v; })));
      body.appendChild(fld("Current bottleneck", richEditor(d.bottleneck, function (h) { d.bottleneck = h; }, "What happens today, who does it, how often, how long it takes.", "small")));
      body.appendChild(fld("Business need", richEditor(d.need, function (h) { d.need = h; }, "Why it matters to them: what it costs, what it blocks.", "small")));
      body.appendChild(fld("Possible solution", richEditor(d.solution, function (h) { d.solution = h; }, "Build, integrate with what they use, partner, or nothing. First take, not a commitment.", "small")));
      body.appendChild(fld("Fit", selIn(REQ_FIT.map(function (x) { return [x, x || "Not assessed"]; }), d.fit || "", function (v) { d.fit = v; })));
      body.appendChild(fld("Decision", selIn(REQ_DECISION, d.decision || "Undecided", function (v) { d.decision = v; })));
      body.appendChild(fld("Why", txtIn(d.reason, "One line the team will understand in six months.", function (v) { d.reason = v; })));
      var evl = el("div", "fld"); evl.appendChild(el("label", null, "Evidence"));
      var chosen = el("div", "linklist");
      function drawEv() { chosen.innerHTML = ""; d.evidence.forEach(function (id) { var e = p.evidence.filter(function (x) { return x.id === id; })[0]; if (!e) return; var c = el("button", "chip", (e.kind || "") + ": " + e.text.slice(0, 60)); c.title = "Remove"; c.onclick = function () { d.evidence = d.evidence.filter(function (x) { return x !== id; }); drawEv(); }; chosen.appendChild(c); }); }
      drawEv(); evl.appendChild(chosen);
      var pickEv = selIn([["", "Attach evidence…"]].concat(p.evidence.map(function (e) { return [e.id, (e.kind || "") + ": " + e.text.slice(0, 70)]; })), "", function (v) { if (v && d.evidence.indexOf(v) === -1) { d.evidence.push(v); drawEv(); } pickEv.value = ""; });
      evl.appendChild(pickEv); body.appendChild(evl);
      var frow = el("div", "fld"); frow.appendChild(el("label", null, "Feature that answers it"));
      var fb = el("button", "btn ghost small", d.feature && feature(d.feature) ? feature(d.feature).name : "Pick a feature");
      fb.onclick = function () { pickFeature("Link to a feature", []).then(function (f) { if (f) { d.feature = f.id; fb.textContent = f.name; } }); };
      frow.appendChild(fb);
      if (d.feature) { var clr = el("button", "chip", "Clear"); clr.onclick = function () { d.feature = ""; fb.textContent = "Pick a feature"; }; frow.appendChild(clr); }
      body.appendChild(frow);
      var extra = [];
      if (!isNew) { var del = el("button", "btn ghost danger", "Delete"); del.onclick = function () { askConfirm("Delete “" + d.title + "”?", "The record of this request goes away. Evidence stays.", { danger: true, ok: "Delete" }).then(function (y) { if (!y) return; p.requests = p.requests.filter(function (x) { return x.id !== d.id; }); p.evidence.forEach(function (e) { if (e.links && e.links.request === d.id) delete e.links.request; }); touchPilot(p); close(); render(); save(); }); }; extra.push(del); }
      body.appendChild(drawerActs(function () {
        if (!d.title.trim()) return;
        d.title = d.title.trim(); d.updated = Date.now();
        var BUILDISH = ["Build", "Integrate or partner"];
        var wanted = d.decision, gated = false;
        if (BUILDISH.indexOf(d.decision) !== -1 && (isNew || r.decision !== d.decision) && !gatePasses("request", isNew ? d : r)) { gated = true; d.decision = isNew ? "Undecided" : r.decision; }
        if (isNew) p.requests = p.requests.concat([d]); else Object.assign(r, d);
        touchPilot(p); close(); render(); save();
        if (gated) openGate("request", isNew ? d : r, wanted, p, "Decide: " + d.title);
      }, close, extra));
    }, { eyebrow: "REQUEST", wide: true });
  }
  function promoteRequest(p, r) {
    askConfirm("Promote “" + r.title + "” to a feature?", "It starts as Proposed, carries the bottleneck, need and solution as its description, and joins this pilot's asks. Nothing is agreed until you move it to Planned.", { ok: "Promote" }).then(function (yes) {
      if (!yes) return;
      var note = "<p><b>From " + escapeHtml(p.name) + "'s request.</b></p>" +
        (r.bottleneck ? "<h4>Current bottleneck</h4>" + richHtml(r.bottleneck) : "") +
        (r.need ? "<h4>Business need</h4>" + richHtml(r.need) : "") +
        (r.solution ? "<h4>Possible solution</h4>" + richHtml(r.solution) : "");
      var f = create([], { name: r.title, state: "Proposed", note: note }, true);
      r.feature = f.id; if (r.decision === "Undecided") r.decision = "Build";
      if (p.wants.indexOf(f.id) === -1) p.wants = p.wants.concat([f.id]);
      r.updated = Date.now(); touchPilot(p); save();
      toast(r.title + " is now a Proposed feature. Give it a space and a division.");
      open(f.id);
    });
  }
  function renderRequestsLevel(body, p) {
    var undecided = p.requests.filter(function (r) { return r.decision === "Undecided"; }).length;
    var sec = secHead("Requests", p.requests.length || null, "What the firm asked for, in their words, whether or not it fits ALIE. Each one carries its evidence, our decision, and whether the client validated the outcome." + (undecided ? " " + undecided + " still to decide." : ""), [primaryBtn("+ Request", function () { editRequest(p, null); })]);
    if (!p.requests.length) sec.appendChild(emptyNote("No requests yet. Capture their words in the Inbox, then turn the explicit ones into requests."));
    p.requests.forEach(function (r, i) {
      var ev = evidenceOfRequest(p, r);
      var lf = r.feature ? feature(r.feature) : null;
      var titleNode = el("span"); titleNode.appendChild(el("i", "stepn", String(i + 1))); titleNode.appendChild(document.createTextNode(r.title));
      var side = [quietPill(r.decision || "Undecided", REQ_DECISION_CLASS[r.decision] || "")];
      sec.appendChild(xrow({ key: "r:" + r.id, title: titleNode,
        meta: metaLine([r.fit ? quietPill(r.fit, REQ_FIT_CLASS[r.fit]) : "fit not assessed", ev.length ? ev.length + " evidence" : "no evidence linked", lf ? "→ " + lf.name + " · " + lf.state : "", r.source ? r.source : ""]),
        side: side,
        details: function (det) {
          if (r.decision !== "Undecided" && r.reason) { det.appendChild(el("div", "lab", "Why " + r.decision.toLowerCase())); det.appendChild(el("p", "readtext", r.reason)); }
          var g = el("div", "stepgrid three");
          [["Current bottleneck", r.bottleneck], ["Business need", r.need], ["Possible solution", r.solution]].forEach(function (x) { var c = el("div", "stepcell"); c.appendChild(el("div", "lab", x[0])); c.appendChild(x[1] ? richBlock(x[1], p) : el("p", "readtext muted", "not written")); g.appendChild(c); });
          det.appendChild(g);
          det.appendChild(el("div", "lab", "Evidence"));
          if (!ev.length) det.appendChild(emptyNote("Nothing linked. Attach the quote or observation this came from."));
          ev.forEach(function (e) { det.appendChild(evidenceRow(p, e, true)); });
          if (lf) { det.appendChild(el("div", "lab", "Feature")); var chip = el("button", "chip", lf.name + " · " + lf.state); chip.onclick = function () { open(lf.id); }; det.appendChild(chip); }
          det.appendChild(chainLine(p, r));
          var acts = el("div", "rowacts");
          var linkedPb = problemsOf(p).filter(function (x) { return (x.requests || []).indexOf(r.id) !== -1; });
          if (linkedPb.length) { det.appendChild(el("div", "lab", "Customer problems")); linkedPb.forEach(function (x) { det.appendChild(problemChip(p, x.id)); }); }
          acts.appendChild(chipBtn("Edit", function () { editRequest(p, r); }));
          acts.appendChild(chipBtn("Frame as customer problem", function () { frameFromRequest(p, r); }));
          if (!lf) acts.appendChild(chipBtn("↑ Promote to a Proposed feature", function () { promoteRequest(p, r); }));
          acts.appendChild(chipBtn("+ Action", function () { editAction(p, null, { links: { request: r.id } }); }));
          det.appendChild(acts);
        } }));
    });
    body.appendChild(sec);
  }

  /* ---------- delivery: deliverables as rows ---------- */
  function editDeliverable(p, d0) {
    var isNew = !d0;
    var d = d0 ? JSON.parse(JSON.stringify(d0)) : { id: uid(), title: "", note: "", tag: "", status: "Proposed", validation: { status: "Not validated", note: "", date: "" }, features: [] };
    sideDrawer(isNew ? "New deliverable" : d.title, function (body, close) {
      body.appendChild(fld("Deliverable", txtIn(d.title, "What the firm gets, in one line", function (v) { d.title = v; })));
      body.appendChild(fld("Status", selIn(DELIV_STATUS, d.status || "Proposed", function (v) { d.status = v; }), "Our delivery state. Client validation is set separately."));
      body.appendChild(fld("Tag", selIn(DELIV_TAGS.map(function (t) { return [t, t || "No tag"]; }), d.tag || "", function (v) { d.tag = v; })));
      body.appendChild(fld("Note", richEditor(d.note, function (h) { d.note = h; }, "Why it matters, what done looks like, what it depends on.", "small")));
      var extra = [];
      if (!isNew) { var del = el("button", "btn ghost danger", "Delete"); del.onclick = function () { askConfirm("Delete “" + d.title + "”?", "Features stay untouched.", { danger: true, ok: "Delete" }).then(function (y) { if (!y) return; p.deliverables = p.deliverables.filter(function (x) { return x.id !== d.id; }); touchPilot(p); close(); render(); save(); }); }; extra.push(del); }
      body.appendChild(drawerActs(function () {
        if (!d.title.trim()) return;
        d.title = d.title.trim();
        var GATED = ["In delivery", "Ready for client testing"];
        var wanted = d.status, gated = false;
        if (GATED.indexOf(d.status) !== -1 && !(isNew ? false : GATED.concat(["Accepted"]).indexOf(d0.status) !== -1) && !gatePasses("deliverable", isNew ? d : d0)) { gated = true; d.status = isNew ? "Proposed" : d0.status; }
        if (isNew) p.deliverables = p.deliverables.concat([d]); else Object.assign(d0, d);
        touchPilot(p); close(); render(); save();
        if (gated) openGate("deliverable", isNew ? d : d0, wanted, p, "Move “" + d.title + "” to " + wanted);
      }, close, extra));
    }, { eyebrow: "DELIVERABLE" });
  }
  function renderDeliverablesLevel(body, p) {
    var sec = secHead("Deliverables and outcomes", p.deliverables.length || null, "What the firm should get, which features provide it, and where each one stands. Order is the build order. Status is our delivery state; validation is the client's judgement, kept apart.", [primaryBtn("+ Deliverable", function () { editDeliverable(p, null); })]);
    if (!p.deliverables.length) sec.appendChild(emptyNote("No deliverables outlined yet."));
    p.deliverables.forEach(function (d, i) {
      var fs = delivFeats(d), pr = delivProgress(d);
      var v = d.validation && d.validation.status ? d.validation.status : "Not validated";
      var titleNode = el("span"); titleNode.appendChild(el("i", "stepn", String(i + 1))); titleNode.appendChild(document.createTextNode(d.title));
      if (d.tag) titleNode.appendChild(quietPill(d.tag, DELIV_TAG_CLASS[d.tag]));
      var side = [];
      var up = el("button", "dmove", "↑"); up.title = "Build earlier"; up.onclick = function (e) { e.stopPropagation(); if (i === 0) return; p.deliverables.splice(i, 1); p.deliverables.splice(i - 1, 0, d); touchPilot(p); render(); save(); };
      var dn = el("button", "dmove", "↓"); dn.title = "Build later"; dn.onclick = function (e) { e.stopPropagation(); if (i === p.deliverables.length - 1) return; p.deliverables.splice(i, 1); p.deliverables.splice(i + 1, 0, d); touchPilot(p); render(); save(); };
      side.push(up, dn);
      sec.appendChild(xrow({ key: "d:" + d.id, title: titleNode,
        meta: metaLine([quietPill(d.status || "Proposed", DELIV_STATUS_CLASS[d.status || "Proposed"]), pr ? pr.live + " of " + pr.total + " features live" : "no features tagged", quietPill(v, VALIDATION_CLASS[v])]),
        side: side,
        details: function (det) {
          det.appendChild(el("div", "lab", "Note")); det.appendChild(d.note ? richBlock(d.note, p) : emptyNote("Nothing written."));
          det.appendChild(el("div", "lab", "Features that deliver it"));
          if (!fs.length) det.appendChild(emptyNote("None tagged yet."));
          fs.forEach(function (f) {
            det.appendChild(pilotFeatureRow(f, function (x) { d.features = (d.features || []).filter(function (id) { return id !== x.id; }); touchPilot(p); render(); save(); }));
          });
          if (d.validation && d.validation.note) { det.appendChild(el("div", "lab", "Client validation")); det.appendChild(el("p", "readtext", (d.validation.date ? stamp(d.validation.date) + " · " : "") + d.validation.note)); }
          var acts = el("div", "rowacts");
          acts.appendChild(chipBtn("Edit", function () { editDeliverable(p, d); }));
          acts.appendChild(chipBtn("+ Feature", function () { pickFeature(d.title, d.features || []).then(function (f) { if (!f) return; d.features = (d.features || []).concat([f.id]); touchPilot(p); render(); save(); }); }));
          acts.appendChild(chipBtn("Set validation", function () { editValidation(p, d, "deliverable"); }));
          acts.appendChild(chipBtn("+ Action", function () { editAction(p, null, { links: { deliverable: d.id } }); }));
          det.appendChild(acts);
        } }));
    });
    body.appendChild(sec);
  }
  function chainLine(p, r) {
    var ev = (r.evidence || []).length + p.evidence.filter(function (e) { return e.links && e.links.request === r.id && (r.evidence || []).indexOf(e.id) === -1; }).length;
    var f = r.feature ? feature(r.feature) : null;
    var v = r.validation && r.validation.status ? r.validation.status : "Not validated";
    var line = el("div", "chain");
    [["Evidence", ev ? ev + " linked" : "none", ev ? "on" : ""], ["Problem", r.bottleneck ? "written" : "empty", r.bottleneck ? "on" : ""], ["Solution", r.solution ? "proposed" : "none", r.solution ? "on" : ""], ["Decision", r.decision, r.decision !== "Undecided" ? "on" : ""], ["Build", f ? f.state : "no feature", f ? "on" : ""], ["Available", f && (f.state === "Live" || f.state === "Feature flag") ? "yes" : "not yet", f && (f.state === "Live" || f.state === "Feature flag") ? "on" : ""], ["Client validation", v, v === "Client validated" ? "on good" : v === "Rejected" ? "on bad" : ""]].forEach(function (x, i) {
      if (i) line.appendChild(el("i", null, "›"));
      var c = el("span", "cnode " + x[2]); c.appendChild(el("b", null, x[0])); c.appendChild(el("span", null, x[1])); line.appendChild(c);
    });
    var vb = chipBtn("Set validation", function () { editValidation(p, r, "request"); });
    line.appendChild(vb);
    return line;
  }
  function editValidation(p, rec, kind) {
    var d = JSON.parse(JSON.stringify(rec.validation || { status: "Not validated", note: "", date: "" }));
    sideDrawer("Client validation", function (body, close) {
      body.appendChild(el("p", "note", "What the firm said after seeing or using it. Live in the product is not the same thing."));
      body.appendChild(fld("Status", selIn(VALIDATION, d.status, function (v) { d.status = v; })));
      body.appendChild(fld("Date", txtIn(d.date, "", function (v) { d.date = v; }, "date")));
      body.appendChild(fld("What they said", areaIn(d.note, "Who validated, on what, with which caveats.", function (v) { d.note = v; }, 4)));
      body.appendChild(drawerActs(function () { rec.validation = d; rec.updated = Date.now(); touchPilot(p); close(); render(); save(); }, close));
    }, { eyebrow: kind === "request" ? "REQUEST" : "DELIVERABLE" });
  }

  /* ---------- delivery: feature fit ---------- */
  function editFit(p, f) {
    var cur = fitOf(p, f);
    var d = JSON.parse(JSON.stringify(cur)); d.evidence = d.evidence || [];
    sideDrawer(f.name, function (body, close) {
      var st = el("div", "fitstate"); st.appendChild(el("span", null, "Engineering state")); st.appendChild(statePill(f)); body.appendChild(st);
      body.appendChild(fld("Workflow fit for this pilot", selIn(FIT_VALUES, d.fit, function (v) { d.fit = v; }), "Independent of whether it is built. A Live feature can still be Not assessed here."));
      body.appendChild(fld("Supports", areaIn(d.supports, "Which step or deliverable it serves, and how", function (v) { d.supports = v; }, 2)));
      body.appendChild(fld("Still unknown", areaIn(d.unknown, "What we could not confirm", function (v) { d.unknown = v; }, 2)));
      body.appendChild(fld("Next validation", areaIn(d.next, "What to show or ask, to whom, when", function (v) { d.next = v; }, 2)));
      var evl = el("div", "fld"); evl.appendChild(el("label", null, "Evidence"));
      var chosen = el("div", "linklist");
      function drawEv() { chosen.innerHTML = ""; d.evidence.forEach(function (id) { var e = p.evidence.filter(function (x) { return x.id === id; })[0]; if (!e) return; var c = el("button", "chip", (e.kind || "") + ": " + e.text.slice(0, 60)); c.title = "Remove"; c.onclick = function () { d.evidence = d.evidence.filter(function (x) { return x !== id; }); drawEv(); }; chosen.appendChild(c); }); }
      drawEv();
      evl.appendChild(chosen);
      var pickEv = selIn([["", "Attach evidence…"]].concat(p.evidence.map(function (e) { return [e.id, (e.kind || "") + ": " + e.text.slice(0, 70)]; })), "", function (v) { if (v && d.evidence.indexOf(v) === -1) { d.evidence.push(v); drawEv(); } pickEv.value = ""; });
      evl.appendChild(pickEv);
      body.appendChild(evl);
      body.appendChild(drawerActs(function () { d.updated = Date.now(); p.fit[f.id] = d; touchPilot(p); close(); render(); save(); }, close));
    }, { eyebrow: "FEATURE FIT" });
  }
  function renderFit(body, p) {
    var set = pilotFeatureSet(p);
    var sec = secHead("Feature fit", set.length || null, "Two independent facts per feature: where engineering stands, and whether it fits this firm's workflow. Assess against evidence, not against the roadmap.", [chipBtn("+ Asked for", function () { pickFeature("They asked for", p.wants).then(function (f) { if (f) { p.wants = p.wants.concat([f.id]); touchPilot(p); render(); save(); } }); }), chipBtn("+ We think they need", function () { pickFeature("We think they will need", p.needs).then(function (f) { if (f) { p.needs = p.needs.concat([f.id]); touchPilot(p); render(); save(); } }); }), chipBtn("+ Assess another", function () { pickFeature("Assess a feature", Object.keys(p.fit)).then(function (f) { if (f) editFit(p, f); }); })]);
    var counts = {};
    set.forEach(function (f) { var v = fitOf(p, f).fit; counts[v] = (counts[v] || 0) + 1; });
    var filt = el("div", "psubs mini wrap");
    [["", "All"]].concat(FIT_VALUES.map(function (v) { return [v, v]; })).forEach(function (m) {
      var n = m[0] ? counts[m[0]] || 0 : set.length;
      var b = el("button", null, m[1]); if (n) b.appendChild(el("em", null, String(n)));
      b.setAttribute("aria-pressed", String((ui.fitFilter || "") === m[0])); b.onclick = function () { ui.fitFilter = m[0]; renderView(); }; filt.appendChild(b);
    });
    sec.insertBefore(filt, sec.children[1]);
    var shown = set.filter(function (f) { return !ui.fitFilter || fitOf(p, f).fit === ui.fitFilter; });
    if (!shown.length) sec.appendChild(emptyNote(set.length ? "Nothing with that fit." : "No features linked to this pilot yet."));
    shown.forEach(function (f) {
      var ft = fitOf(p, f);
      var par = f.parent ? feature(f.parent) : null;
      var titleNode = el("span"); if (par) titleNode.appendChild(el("span", "pp", par.name + " › ")); titleNode.appendChild(document.createTextNode(f.name));
      var tags = [];
      if (p.wants.indexOf(f.id) !== -1) tags.push("asked for");
      if (p.needs.indexOf(f.id) !== -1) tags.push("we think they need");
      var dls = p.deliverables.filter(function (d) { return (d.features || []).indexOf(f.id) !== -1; });
      if (dls.length) tags.push(dls.length + (dls.length === 1 ? " deliverable" : " deliverables"));
      var side = [el("span", "twin"), statePill(f), quietPill(ft.fit, FIT_CLASS[ft.fit])];
      side[0].appendChild(el("i", null, "engineering")); side[0].appendChild(el("i", null, "pilot fit"));
      sec.appendChild(xrow({ key: "f:" + p.id + ":" + f.id, title: titleNode, meta: metaLine([tags.join(" · "), f.owner && f.owner !== "Unassigned" ? f.owner : ""]), side: side, details: function (det) {
        var g = el("div", "stepgrid two");
        [["Supports", ft.supports], ["Still unknown", ft.unknown], ["Next validation", ft.next]].forEach(function (x) { var c = el("div", "stepcell"); c.appendChild(el("div", "lab", x[0])); c.appendChild(el("p", "readtext" + (x[1] ? "" : " muted"), x[1] || "not written")); g.appendChild(c); });
        det.appendChild(g);
        det.appendChild(el("div", "lab", "Evidence"));
        var ev = (ft.evidence || []).map(function (id) { return p.evidence.filter(function (e) { return e.id === id; })[0]; }).filter(Boolean);
        if (!ev.length) det.appendChild(emptyNote("None attached."));
        ev.forEach(function (e) { det.appendChild(evidenceRow(p, e, true)); });
        var acts = el("div", "rowacts");
        acts.appendChild(chipBtn("Assess", function () { editFit(p, f); }));
        acts.appendChild(chipBtn("Open feature", function () { open(f.id); }));
        if (p.wants.indexOf(f.id) !== -1) acts.appendChild(chipBtn("Remove from asked for", function () { p.wants = p.wants.filter(function (id) { return id !== f.id; }); touchPilot(p); render(); save(); }));
        if (p.needs.indexOf(f.id) !== -1) acts.appendChild(chipBtn("Remove from we think they need", function () { p.needs = p.needs.filter(function (id) { return id !== f.id; }); touchPilot(p); render(); save(); }));
        det.appendChild(acts);
      } }));
    });
    body.appendChild(sec);
  }

  /* ---------- delivery: decisions, artifacts, validation, recaps ---------- */
  function renderValidation(body, p) {
    var sec = secHead("Client validation", null, "Two different truths, side by side: what is live in ALIE, and what the firm has confirmed works for them. Only the second one counts as validated.");
    var rows = [];
    p.deliverables.forEach(function (d) { rows.push({ kind: "Deliverable", rec: d, title: d.title, live: delivProgress(d), status: d.status || "Proposed" }); });
    p.requests.forEach(function (r) { var f = r.feature ? feature(r.feature) : null; rows.push({ kind: "Request", rec: r, title: r.title, live: f ? { live: f.state === "Live" || f.state === "Feature flag" ? 1 : 0, total: 1 } : null, status: r.decision }); });
    if (!rows.length) sec.appendChild(emptyNote("Nothing to validate yet."));
    var tbl = el("div", "vtable");
    rows.forEach(function (x) {
      var v = x.rec.validation && x.rec.validation.status ? x.rec.validation.status : "Not validated";
      var r = el("div", "vrow");
      var t = el("div", "vt"); t.appendChild(el("b", null, x.title)); t.appendChild(el("span", null, x.kind + " · " + x.status)); r.appendChild(t);
      r.appendChild(el("span", "vl", x.live ? (x.live.live + " of " + x.live.total + " live") : "no feature"));
      r.appendChild(quietPill(v, VALIDATION_CLASS[v]));
      r.appendChild(chipBtn("Set", function () { editValidation(p, x.rec, x.kind === "Request" ? "request" : "deliverable"); }));
      if (x.rec.validation && x.rec.validation.note) { var n = el("div", "vnote", (x.rec.validation.date ? stamp(x.rec.validation.date) + " · " : "") + x.rec.validation.note); r.appendChild(n); }
      tbl.appendChild(r);
    });
    sec.appendChild(tbl);
    body.appendChild(sec);
  }
  function weekStart(d) { var x = new Date(d); var day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); return dKey(x); }
  function editRecap(p, rc) {
    var isNew = !rc;
    var d = rc ? JSON.parse(JSON.stringify(rc)) : { id: uid(), week: weekStart(new Date()), internal: "", client: "", clientReviewed: false, created: Date.now(), updated: Date.now() };
    sideDrawer(isNew ? "Weekly recap" : "Week of " + stamp(d.week), function (body, close) {
      body.appendChild(fld("Week starting", txtIn(d.week, "", function (v) { d.week = v; }, "date")));
      body.appendChild(fld("Internal notes", richEditor(d.internal, function (h) { d.internal = h; }, "For us only: what we learned, worries, what to push.", "small")));
      body.appendChild(fld("Recap shared with the client", richEditor(d.client, function (h) { d.client = h; }, "What we send the firm: progress, what we need from them, next steps.", "small")));
      var cr = el("label", "chk"); var cb = el("input"); cb.type = "checkbox"; cb.checked = !!d.clientReviewed; cb.onchange = function () { d.clientReviewed = cb.checked; }; cr.appendChild(cb); cr.appendChild(document.createTextNode(" The client has reviewed this recap"));
      body.appendChild(cr);
      var extra = [];
      if (!isNew) { var del = el("button", "btn ghost danger", "Delete"); del.onclick = function () { p.recaps = p.recaps.filter(function (x) { return x.id !== d.id; }); touchPilot(p); close(); render(); save(); }; extra.push(del); }
      body.appendChild(drawerActs(function () { d.updated = Date.now(); if (isNew) p.recaps = p.recaps.concat([d]); else Object.assign(rc, d); touchPilot(p); close(); render(); save(); }, close, extra));
    }, { eyebrow: "WEEKLY RECAP", wide: true });
  }
  function renderRecaps(body, p) {
    var list = p.recaps.slice().sort(function (a, b) { return b.week < a.week ? -1 : 1; });
    var sec = secHead("Weekly recaps", list.length || null, "Internal notes and the recap the client sees are kept apart. Mark a recap reviewed once the firm has read it.", [primaryBtn("+ This week", function () { editRecap(p, null); })]);
    if (!list.length) sec.appendChild(emptyNote("No recaps yet."));
    list.forEach(function (rc) {
      sec.appendChild(xrow({ key: "rc:" + rc.id, title: "Week of " + stamp(rc.week), meta: metaLine([rc.clientReviewed ? quietPill("client reviewed", "st-live") : quietPill("not reviewed by client"), rc.client ? "shared recap written" : "no client recap", rc.internal ? "internal notes" : ""]), details: function (det) {
        var g = el("div", "stepgrid two");
        var a = el("div", "stepcell"); a.appendChild(el("div", "lab", "Internal notes")); a.appendChild(rc.internal ? richBlock(rc.internal, p) : emptyNote("Empty.")); g.appendChild(a);
        var b = el("div", "stepcell client"); b.appendChild(el("div", "lab", "Shared with the client")); b.appendChild(rc.client ? richBlock(rc.client, p) : emptyNote("Empty.")); g.appendChild(b);
        det.appendChild(g);
        var acts = el("div", "rowacts"); acts.appendChild(chipBtn("Edit", function () { editRecap(p, rc); })); det.appendChild(acts);
      } }));
    });
    body.appendChild(sec);
  }

  /* =====================================================================
     Product decisions: the one gate through which anything moves toward Building or client testing.
     Decisions queue, Home ("what needs my attention"), Now / Next / Later / Watching plan.
     ===================================================================== */
  var DEC_STATE = ["Proposed", "Decided", "Deferred", "Rejected", "Revisit"];
  var DEC_CLASS = { "Proposed": "", "Decided": "st-live", "Deferred": "st-planned", "Rejected": "st-needs-work", "Revisit": "st-feature-flag" };
  var ALIGN = ["Needs discussion", "Discussed", "Agreed", "Disagreed", "Not required"];
  var ALIGN_CLASS = { "Needs discussion": "st-feature-flag", "Discussed": "st-planned", "Agreed": "st-live", "Disagreed": "st-needs-work", "Not required": "" };
  var GATE_STATES = ["Planned", "Building"];
  function decisions() { if (!Array.isArray(S.decisions)) S.decisions = []; return S.decisions; }
  function decisionById(id) { return decisions().filter(function (d) { return d.id === id; })[0]; }
  function decisionAligned(d) { return d.state === "Decided" && (d.alignment === "Agreed" || d.alignment === "Not required"); }
  function decisionBlocked(d) { return d.state === "Decided" && !decisionAligned(d); }
  function decisionsLinked(kind, id) { return decisions().filter(function (d) { return d.links && d.links[kind] === id; }); }
  function gatePasses(kind, rec) {
    var linked = decisionsLinked(kind, rec.id).concat(rec.decisionRef ? [decisionById(rec.decisionRef)].filter(Boolean) : []);
    return linked.some(decisionAligned);
  }
  function needsGate(f, v) {
    if (GATE_STATES.indexOf(v) === -1) return false;
    if (BUILT_STATES.indexOf(f.state) !== -1 || f.state === "Planned") return false; // already past the gate, historical
    return !gatePasses("feature", f);
  }
  /* Open (or reuse) a Proposed decision that carries the blocked transition; applying it happens when the decision is decided and aligned. */
  function openGate(kind, rec, to, pilot, label) {
    var d = decisions().filter(function (x) { return x.links && x.links[kind] === rec.id && x.state !== "Rejected"; })[0];
    if (!d) {
      d = { id: uid(), title: label || ("Move " + (rec.name || rec.title) + " to " + to), state: "Proposed", owner: ME, date: "", rationale: "", alignment: "Needs discussion", pilot: pilot ? pilot.id : "", links: {}, evidence: [], pending: null, applied: false, drive: { fileId: "", status: "Not in Drive", syncedAt: "", error: "" }, created: Date.now(), updated: Date.now() };
      d.links[kind] = rec.id;
      decisions().push(d);
    }
    d.pending = { kind: kind, id: rec.id, to: to, pilot: pilot ? pilot.id : "" }; d.applied = false; d.updated = Date.now();
    rec.decisionRef = d.id;
    save();
    toast((rec.name || rec.title) + " stays where it is: " + to + " waits for a product decision.", true);
    editDecision(d);
  }
  function applyPending(d) {
    if (!d.pending || d.applied || !decisionAligned(d)) return false;
    var pd = d.pending, p = pd.pilot ? pilotById(pd.pilot) : null;
    if (pd.kind === "feature") { var f = feature(pd.id); if (f) { f.state = pd.to; if (pd.to === "Planned" || pd.to === "Building") f.agreed = true; f.decisionRef = d.id; touch(f); } }
    if (pd.kind === "deliverable" && p) { var dl = p.deliverables.filter(function (x) { return x.id === pd.id; })[0]; if (dl) { dl.status = pd.to; dl.decisionRef = d.id; touchPilot(p); } }
    if (pd.kind === "request" && p) { var r = p.requests.filter(function (x) { return x.id === pd.id; })[0]; if (r) { r.decision = pd.to; r.decisionRef = d.id; r.updated = Date.now(); touchPilot(p); } }
    d.applied = true; d.updated = Date.now();
    toast("Decision applied: " + pd.kind + " moved to " + pd.to + ".");
    return true;
  }
  function decisionSubject(d) {
    var L = d.links || {}, p = d.pilot ? pilotById(d.pilot) : null, out = [];
    if (L.feature && feature(L.feature)) out.push("feature: " + feature(L.feature).name);
    if (p && L.request) { var r = p.requests.filter(function (x) { return x.id === L.request; })[0]; if (r) out.push("request: " + r.title); }
    if (p && L.deliverable) { var dl = p.deliverables.filter(function (x) { return x.id === L.deliverable; })[0]; if (dl) out.push("deliverable: " + dl.title); }
    if (p && L.step) { var st = p.steps.filter(function (x) { return x.id === L.step; })[0]; if (st) out.push("step: " + st.title); }
    if (p && L.artifact) { var a = p.artifacts.filter(function (x) { return x.id === L.artifact; })[0]; if (a) out.push("artifact: " + a.title); }
    if (p && L.problem) { var pb = problemById(p, L.problem); if (pb) out.push("problem: " + pb.title); }
    return out;
  }
  function editDecision(d0, preset) {
    var isNew = !d0;
    var d = d0 ? JSON.parse(JSON.stringify(d0)) : Object.assign({ id: uid(), title: "", state: "Proposed", owner: ME, date: today(), rationale: "", alignment: "Needs discussion", pilot: "", links: {}, evidence: [], pending: null, applied: false, drive: { fileId: "", status: "Not in Drive", syncedAt: "", error: "" }, created: Date.now(), updated: Date.now() }, preset || {});
    d.links = d.links || {}; d.evidence = d.evidence || [];
    sideDrawer(isNew ? "New product decision" : d.title, function (body, close) {
      body.appendChild(fld("Decision about", txtIn(d.title, "What is being decided, in one line", function (v) { d.title = v; })));
      var stateRow = el("div", "fld two");
      stateRow.appendChild(fld("State", selIn(DEC_STATE, d.state, function (v) { d.state = v; paintGate(); })));
      stateRow.appendChild(fld("Cofounder alignment", selIn(ALIGN, d.alignment, function (v) { d.alignment = v; paintGate(); })));
      body.appendChild(stateRow);
      var gateNote = el("div", "gatenote"); body.appendChild(gateNote);
      function paintGate() {
        gateNote.innerHTML = "";
        if (d.state === "Decided" && !(d.alignment === "Agreed" || d.alignment === "Not required")) { gateNote.className = "gatenote blocked"; gateNote.textContent = "Build blocked until aligned: decided, but the cofounders have not agreed yet."; }
        else if (d.state === "Decided") { gateNote.className = "gatenote ok"; gateNote.textContent = d.pending && !d.applied ? "Saving applies the gated change: " + d.pending.kind + " → " + d.pending.to + "." : "Decided and aligned. Linked items may move."; }
        else { gateNote.className = "gatenote"; gateNote.textContent = d.pending && !d.applied ? "Waiting: " + d.pending.kind + " → " + d.pending.to + " happens only once this is Decided and aligned." : "Nothing moves to Building or client testing on this until it is Decided and aligned."; }
      }
      paintGate();
      var ownerRow = el("div", "fld two");
      ownerRow.appendChild(fld("Owner (CPO)", txtIn(d.owner, "Uzziel", function (v) { d.owner = v; })));
      ownerRow.appendChild(fld("Decision date", txtIn(d.date, "", function (v) { d.date = v; }, "date")));
      body.appendChild(ownerRow);
      body.appendChild(fld("Rationale", areaIn(d.rationale, "Why, in a few lines the team will still understand in six months.", function (v) { d.rationale = v; }, 4)));
      body.appendChild(fld("Pilot", selIn([["", "Product-wide"]].concat(pilots().map(function (p) { return [p.id, p.name]; })), d.pilot, function (v) { d.pilot = v; drawLinks(); })));
      var linksHost = el("div", "linkshost"); body.appendChild(linksHost);
      function drawLinks() {
        linksHost.innerHTML = "";
        var p = d.pilot ? pilotById(d.pilot) : null;
        var frow = el("div", "fld"); frow.appendChild(el("label", null, "Feature"));
        var fb = el("button", "btn ghost small", d.links.feature && feature(d.links.feature) ? feature(d.links.feature).name : "Pick a feature");
        fb.onclick = function () { pickFeature("Link to a feature", []).then(function (f) { if (f) { d.links.feature = f.id; fb.textContent = f.name; } }); };
        frow.appendChild(fb);
        if (d.links.feature) { var clr = el("button", "chip", "Clear"); clr.onclick = function () { delete d.links.feature; drawLinks(); }; frow.appendChild(clr); }
        linksHost.appendChild(frow);
        if (p) {
          ensurePilot(p);
          linksHost.appendChild(fld("Request", selIn([["", "None"]].concat(p.requests.map(function (r) { return [r.id, r.title]; })), d.links.request || "", function (v) { if (v) d.links.request = v; else delete d.links.request; })));
          linksHost.appendChild(fld("Workflow step", selIn([["", "None"]].concat(p.steps.map(function (s) { return [s.id, s.title]; })), d.links.step || "", function (v) { if (v) d.links.step = v; else delete d.links.step; })));
          linksHost.appendChild(fld("Artifact", selIn([["", "None"]].concat(p.artifacts.map(function (a) { return [a.id, a.title]; })), d.links.artifact || "", function (v) { if (v) d.links.artifact = v; else delete d.links.artifact; })));
          linksHost.appendChild(fld("Deliverable", selIn([["", "None"]].concat(p.deliverables.map(function (x) { return [x.id, x.title]; })), d.links.deliverable || "", function (v) { if (v) d.links.deliverable = v; else delete d.links.deliverable; })));
          linksHost.appendChild(fld("Customer problem", selIn([["", "None"]].concat(problemsOf(p).map(function (x) { return [x.id, x.title + " · " + x.status]; })), d.links.problem || "", function (v) { if (v) d.links.problem = v; else delete d.links.problem; }), "The problem this decision answers. Framing it is Discovery's job; deciding is this record's."));
          var evl = el("div", "fld"); evl.appendChild(el("label", null, "Evidence"));
          var chosen = el("div", "linklist");
          function drawEv() { chosen.innerHTML = ""; d.evidence.forEach(function (id) { var e = p.evidence.filter(function (x) { return x.id === id; })[0]; if (!e) return; var c = el("button", "chip", (e.kind || "") + ": " + e.text.slice(0, 60)); c.title = "Remove"; c.onclick = function () { d.evidence = d.evidence.filter(function (x) { return x !== id; }); drawEv(); }; chosen.appendChild(c); }); }
          drawEv(); evl.appendChild(chosen);
          var pickEv = selIn([["", "Attach evidence…"]].concat(p.evidence.map(function (e) { return [e.id, (e.kind || "") + ": " + e.text.slice(0, 70)]; })), "", function (v) { if (v && d.evidence.indexOf(v) === -1) { d.evidence.push(v); drawEv(); } pickEv.value = ""; });
          evl.appendChild(pickEv); linksHost.appendChild(evl);
        }
      }
      drawLinks();
      if (!isNew) body.appendChild(drivePushRow("decision", d0, d.pilot ? pilotById(d.pilot) : null, "drive"));
      var extra = [];
      if (!isNew) { var del = el("button", "btn ghost danger", "Delete"); del.onclick = function () { askConfirm("Delete this decision?", "Linked items keep their current state.", { danger: true, ok: "Delete" }).then(function (y) { if (!y) return; S.decisions = decisions().filter(function (x) { return x.id !== d.id; }); close(); render(); save(); }); }; extra.push(del); }
      body.appendChild(drawerActs(function () {
        if (!d.title.trim()) return;
        d.title = d.title.trim(); d.updated = Date.now();
        if (d.state === "Decided" && !d.date) d.date = today();
        if (isNew) decisions().push(d); else Object.assign(d0, d);
        var live = isNew ? d : d0;
        applyPending(live);
        close(); render(); save();
      }, close, extra));
    }, { eyebrow: "PRODUCT DECISION", wide: true });
  }
  function decisionRow(d) {
    var p = d.pilot ? pilotById(d.pilot) : null;
    var side = [quietPill(d.state, DEC_CLASS[d.state])];
    if (decisionBlocked(d)) side.push(quietPill("build blocked until aligned", "st-needs-work"));
    else if (d.state === "Decided") side.push(quietPill(d.alignment, ALIGN_CLASS[d.alignment]));
    return xrow({ key: "dec:" + d.id, title: d.title, meta: metaLine([p ? p.name : "product-wide", d.owner ? "owner " + d.owner : "", d.date ? stamp(d.date) : "", d.alignment !== "Not required" && d.state !== "Decided" ? "alignment: " + d.alignment : ""].concat(decisionSubject(d))), side: side, details: function (det) {
      det.appendChild(el("div", "lab", "Rationale")); det.appendChild(el("p", "readtext" + (d.rationale ? "" : " muted"), d.rationale || "not written"));
      if (d.pending) { det.appendChild(el("div", "lab", "Gated change")); det.appendChild(el("p", "readtext", d.pending.kind + " → " + d.pending.to + (d.applied ? " · applied" : " · waiting for Decided + aligned"))); }
      if (p && (d.evidence || []).length) { det.appendChild(el("div", "lab", "Evidence")); d.evidence.forEach(function (id) { var e = p.evidence.filter(function (x) { return x.id === id; })[0]; if (e) det.appendChild(evidenceRow(p, e, true)); }); }
      det.appendChild(drivePushRow("decision", d, p, "drive"));
      var acts = el("div", "rowacts");
      acts.appendChild(chipBtn("Edit", function () { editDecision(d); }));
      if (d.state === "Proposed") acts.appendChild(chipBtn("Decide now", function () { d.state = "Decided"; editDecision(d); }));
      det.appendChild(acts);
    } });
  }
  function undecidedRequestsAll() { var out = []; pilots().forEach(function (p) { ensurePilot(p); p.requests.forEach(function (r) { if (r.decision === "Undecided") out.push({ pilot: p, r: r }); }); }); return out; }
  function askedProposedFeatures() {
    var out = [];
    pilots().forEach(function (p) { ensurePilot(p); p.wants.forEach(function (id) { var f = feature(id); if (f && f.state === "Proposed" && !gatePasses("feature", f) && !decisionsLinked("feature", f.id).length && !out.some(function (x) { return x.f.id === f.id; })) out.push({ pilot: p, f: f }); }); });
    return out;
  }
  function renderDecisionsView(host) {
    var col = el("div", "pilotcol");
    var head = el("div", "phead");
    var row = el("div", "prow2");
    row.appendChild(el("h1", null, "Decisions"));
    var acts = el("div", "pacts");
    acts.appendChild(primaryBtn("+ Decision", function () { editDecision(null); }));
    row.appendChild(acts); head.appendChild(row);
    head.appendChild(el("p", "note", "Nothing moves to Building or client testing because someone had an idea. It moves through a decision here, owned by you, with the cofounders aligned."));
    col.appendChild(head);
    var all = decisions();
    var proposed = all.filter(function (d) { return d.state === "Proposed"; }).sort(function (a, b) { return b.updated - a.updated; });
    var blocked = all.filter(decisionBlocked);
    var later = all.filter(function (d) { return d.state === "Deferred" || d.state === "Revisit"; });
    var decided = all.filter(function (d) { return d.state === "Decided" && !decisionBlocked(d); }).sort(function (a, b) { return (b.date || "") < (a.date || "") ? -1 : 1; });
    var rejected = all.filter(function (d) { return d.state === "Rejected"; });
    var rq = undecidedRequestsAll(), pf = askedProposedFeatures();
    var s1 = secHead("Needs my decision", proposed.length + rq.length + pf.length || null, "Proposed decisions, requests without a decision, and features a firm asked for that have no decision yet.");
    if (!proposed.length && !rq.length && !pf.length) s1.appendChild(emptyNote("Nothing is waiting on you."));
    proposed.forEach(function (d) { s1.appendChild(decisionRow(d)); });
    rq.forEach(function (x) { var b = el("button", "linkrow"); b.appendChild(el("b", null, x.r.title)); b.appendChild(el("span", null, x.pilot.name + " · request · " + (x.r.fit || "fit not assessed"))); b.onclick = function () { ui.view = "pilots"; ui.pilot = x.pilot.id; ui.pilotTab = "delivery"; ui.pilotSub = "requests"; ui.feature = null; foldSet("r:" + x.r.id, true); render(); }; s1.appendChild(b); });
    pf.forEach(function (x) { var b = el("button", "linkrow"); b.appendChild(el("b", null, x.f.name)); b.appendChild(el("span", null, x.pilot.name + " asked for it · Proposed feature · no decision yet")); b.onclick = function () { editDecision(null, { title: "Build " + x.f.name + "?", pilot: x.pilot.id, links: { feature: x.f.id } }); }; s1.appendChild(b); });
    col.appendChild(s1);
    var s2 = secHead("Blocked until aligned", blocked.length || null, "Decided by you, not yet agreed with the cofounders. Nothing linked moves until that changes.");
    if (!blocked.length) s2.appendChild(emptyNote("Nothing blocked."));
    blocked.forEach(function (d) { s2.appendChild(decisionRow(d)); });
    col.appendChild(s2);
    if (later.length) { var s3 = secHead("Deferred or to revisit", later.length); later.forEach(function (d) { s3.appendChild(decisionRow(d)); }); col.appendChild(s3); }
    var s4 = secHead("Decided", decided.length || null);
    if (!decided.length) s4.appendChild(emptyNote("No decisions recorded yet."));
    decided.slice(0, 20).forEach(function (d) { s4.appendChild(decisionRow(d)); });
    col.appendChild(s4);
    if (rejected.length) { var s5 = secHead("Rejected", rejected.length); rejected.forEach(function (d) { s5.appendChild(decisionRow(d)); }); col.appendChild(s5); }
    host.appendChild(col);
  }

  /* ---------- Home: what needs my attention ---------- */
  function nextMeeting() {
    var best = null;
    pilots().forEach(function (p) { ensurePilot(p); p.sessions.forEach(function (s) { if (s.stage === "Planned" && s.date && s.date >= today() && (!best || s.date < best.s.date)) best = { p: p, s: s }; }); });
    return best;
  }
  function homeCard(title, big, lines, onOpen, tone) {
    var c = el("button", "hcard" + (tone ? " " + tone : ""));
    c.appendChild(el("span", "ht", title));
    c.appendChild(el("b", "hb", big));
    var ul = el("span", "hl");
    (lines || []).slice(0, 4).forEach(function (l) { ul.appendChild(el("span", null, l)); });
    c.appendChild(ul);
    c.onclick = onOpen;
    return c;
  }
  function renderHome(host) {
    var col = el("div", "pilotcol home");
    var head = el("div", "phead");
    head.appendChild(el("div", "pcrumb", new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })));
    var row = el("div", "prow2"); row.appendChild(el("h1", null, "What needs my attention"));
    var acts = el("div", "pacts");
    acts.appendChild(menu("More", [
      ["Plan a session", function () { var p = pilots()[0]; if (!p) return; ui.view = "pilots"; ui.pilot = p.id; ui.pilotTab = "discovery"; ui.pilotSub = "sessions"; render(); editSession(p, null); }],
      ["New decision", function () { editDecision(null); }],
      ["Product roadmap", function () { ui.view = "roadmap"; render(); }],
      ["What changed", function () { ui.view = "changes"; render(); }]
    ]));
    row.appendChild(acts); head.appendChild(row);
    col.appendChild(head);
    var grid = el("div", "homegrid");
    var nm = nextMeeting();
    if (nm) grid.appendChild(homeCard("Next pilot meeting", stamp(nm.s.date) + (nm.s.time ? " · " + nm.s.time : ""), [nm.p.name + " · " + (nm.s.title || nm.s.purpose), nm.p.questions.filter(function (q) { return q.session === nm.s.id && q.state !== "Confirmed by client" && q.state !== "Superseded"; }).length + " questions to ask", nm.s.agenda ? "agenda ready" : "no agenda yet"], function () { ui.view = "pilots"; ui.pilot = nm.p.id; ui.pilotTab = "discovery"; ui.pilotSub = "sessions"; foldSet("s:" + nm.s.id, true); render(); }, "gold"));
    else grid.appendChild(homeCard("Next pilot meeting", "None planned", ["Plan the next session so its questions are ready."], function () { var p = pilots()[0]; if (!p) return; ui.view = "pilots"; ui.pilot = p.id; ui.pilotTab = "discovery"; ui.pilotSub = "sessions"; render(); editSession(p, null); }));
    var proposed = decisions().filter(function (d) { return d.state === "Proposed"; }), blocked = decisions().filter(decisionBlocked), rq = undecidedRequestsAll(), pf = askedProposedFeatures();
    var nd = proposed.length + rq.length + pf.length;
    grid.appendChild(homeCard("Needs my decision", String(nd), [proposed.length + " proposed decisions", rq.length + " requests undecided", pf.length + " asked-for features without a decision"], function () { ui.view = "decisions"; render(); }, nd ? "warn" : ""));
    grid.appendChild(homeCard("Alignment needed", String(blocked.length), blocked.slice(0, 3).map(function (d) { return d.title; }).concat(blocked.length ? [] : ["No decision is waiting on the cofounders."]), function () { ui.view = "decisions"; render(); }, blocked.length ? "warn" : ""));
    var oq = 0, cand = 0, uns = 0, waitFirm = [], waitUs = [], perPilot = [];
    pilots().forEach(function (p) { ensurePilot(p); var q = p.questions.filter(function (x) { return x.state !== "Confirmed by client" && x.state !== "Superseded"; }); oq += q.length; cand += q.filter(function (x) { return x.state === "Candidate answer from transcript"; }).length; var u = unsortedCount(p); uns += u; perPilot.push(p.name + ": " + q.length + " open" + (u ? ", " + u + " unsorted" : "")); openActions(p).forEach(function (a) { (a.side === "Client" ? waitFirm : waitUs).push({ p: p, a: a }); }); });
    grid.appendChild(homeCard("Open questions", String(oq), (cand ? [cand + " candidate answers to review"] : []).concat(perPilot), function () { var p = pilots()[0]; if (!p) return; ui.view = "pilots"; ui.pilot = p.id; ui.pilotTab = "discovery"; ui.pilotSub = "sessions"; render(); }));
    grid.appendChild(homeCard("Unsorted evidence", String(uns), uns ? ["Sort it into quotes, observations, requests or inferences."] : ["Inbox is clear."], function () { var p = pilots().filter(function (x) { return unsortedCount(x); })[0] || pilots()[0]; if (!p) return; ui.view = "pilots"; ui.pilot = p.id; ui.pilotTab = "discovery"; ui.pilotSub = "inbox"; ui.inboxKind = "Unsorted"; render(); }, uns ? "info" : ""));
    var over = waitFirm.concat(waitUs).filter(function (x) { return x.a.due && x.a.due < today(); }).length;
    grid.appendChild(homeCard("Waiting on the firm", String(waitFirm.length), waitFirm.slice(0, 3).map(function (x) { return x.a.title + (x.a.due ? " · due " + stamp(x.a.due) : ""); }), function () { var p = waitFirm[0] ? waitFirm[0].p : pilots()[0]; if (!p) return; ui.view = "pilots"; ui.pilot = p.id; ui.pilotTab = "overview"; render(); }));
    grid.appendChild(homeCard("Waiting on us", String(waitUs.length) + (over ? " · " + over + " overdue" : ""), waitUs.slice(0, 3).map(function (x) { return x.a.title + (x.a.owner ? " · " + x.a.owner : "") + (x.a.due ? " · due " + stamp(x.a.due) : ""); }), function () { var p = waitUs[0] ? waitUs[0].p : pilots()[0]; if (!p) return; ui.view = "pilots"; ui.pilot = p.id; ui.pilotTab = "overview"; render(); }, over ? "warn" : ""));
    var npf = problemsNeedingFraming();
    grid.appendChild(homeCard("Problems needing framing", String(npf), npf ? ["Customer problems still Draft or with framing gaps."] : ["Every customer problem is framed."], function () { var p = pilots().filter(function (x) { return problemsOf(x).some(function (pr) { return pr.status !== "Superseded" && problemNeedsFraming(pr); }); })[0] || pilots()[0]; if (!p) return; ui.view = "pilots"; ui.pilot = p.id; ui.pilotTab = "discovery"; ui.pilotSub = "problems"; render(); }, npf ? "info" : ""));
    var since = Date.now() - 7 * 86400000;
    var logN = (S.log || []).filter(function (e) { return e.t > since; }).length;
    var changed = [];
    pilots().forEach(function (p) { var ns = p.sessions.filter(function (s) { return s.created > since; }).length, ne = p.evidence.filter(function (e) { return e.created > since; }).length, nq = p.questions.filter(function (q) { return q.updated > since && q.state === "Confirmed by client"; }).length; if (ns || ne || nq) changed.push(p.name + ": " + [ns ? ns + " sessions" : "", ne ? ne + " evidence" : "", nq ? nq + " questions answered" : ""].filter(Boolean).join(", ")); });
    var nd7 = decisions().filter(function (d) { return d.updated > since; }).length;
    grid.appendChild(homeCard("Changed since last week", String(logN + nd7), [logN + " feature changes", nd7 + " decisions touched"].concat(changed), function () { ui.view = "changes"; render(); }));
    col.appendChild(grid);
    /* what the week looks like: planned sessions */
    var planned = [];
    pilots().forEach(function (p) { p.sessions.forEach(function (s) { if (s.stage === "Planned" && s.date >= today()) planned.push({ p: p, s: s }); }); });
    planned.sort(function (a, b) { return a.s.date < b.s.date ? -1 : 1; });
    var s1 = secHead("Coming up", planned.length || null, null, [chipBtn("+ Plan a session", function () { var p = pilots()[0]; if (!p) return; ui.view = "pilots"; ui.pilot = p.id; ui.pilotTab = "discovery"; ui.pilotSub = "sessions"; render(); editSession(p, null); })]);
    if (!planned.length) s1.appendChild(emptyNote("No planned sessions."));
    planned.forEach(function (x) { var b = el("button", "linkrow"); b.appendChild(el("b", null, stamp(x.s.date) + (x.s.time ? " " + x.s.time : "") + " · " + (x.s.title || x.s.purpose))); b.appendChild(el("span", null, x.p.name + (x.s.participants ? " · " + x.s.participants : ""))); b.onclick = function () { ui.view = "pilots"; ui.pilot = x.p.id; ui.pilotTab = "discovery"; ui.pilotSub = "sessions"; foldSet("s:" + x.s.id, true); render(); }; s1.appendChild(b); });
    col.appendChild(s1);
    host.appendChild(col);
    var cp = ui.homePilot ? pilotById(ui.homePilot) : null;
    if (!cp) cp = pilots().slice().sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); })[0];
    if (cp) { ui.homePilot = cp.id; host.appendChild(captureBar(cp, true)); }
  }

  /* ---------- Now / Next / Later / Watching ---------- */
  function renderPlanBoard(host) {
    var list = feats().filter(passes);
    var now = mKey(new Date()), n1 = mAdd(now, 1), n2 = mAdd(now, 2);
    var cols = { now: [], next: [], later: [], watch: [] };
    list.forEach(function (f) {
      if (f.parent) return;
      var mk = f.period ? mKey(toDate(f.period)) : null;
      if (f.state === "Building" || (mk && mk <= now && f.state !== "Live")) cols.now.push(f);
      else if (mk && (mk === n1 || mk === n2)) cols.next.push(f);
      else if (mk && f.state !== "Live") cols.later.push(f);
      else if (!mk && (f.state === "Research" || f.state === "Proposed" || f.state === "Planned") && (pilotsFor(f).length || f.rnd || f.state === "Planned")) cols.watch.push(f);
    });
    var wrap = el("div", "plan");
    [["now", "Now", "Building, or dated this month"], ["next", "Next", "Dated in the next two months"], ["later", "Later", "Dated after that"], ["watch", "Watching", "Undated: research, proposed with a pilot ask, planned"]].forEach(function (c) {
      var colEl = el("div", "plancol");
      var h = el("h3", null, c[1]); h.appendChild(el("em", null, String(cols[c[0]].length))); colEl.appendChild(h);
      colEl.appendChild(el("div", "note", c[2]));
      if (!cols[c[0]].length) colEl.appendChild(emptyNote("Nothing here."));
      cols[c[0]].sort(function (a, b) { return (a.period || "9") < (b.period || "9") ? -1 : 1; }).forEach(function (f) {
        var r = el("button", "planrow");
        r.appendChild(el("b", null, f.name));
        var m = el("span"); m.appendChild(statePill(f)); m.appendChild(document.createTextNode(" " + [f.period ? laneLabelOf(f) : "", f.owner && f.owner !== "Unassigned" ? f.owner : "", pilotsFor(f).length ? pilotsFor(f).map(function (p) { return p.name; }).join(", ") : ""].filter(Boolean).join(" · ")));
        if (f.state === "Proposed" && !gatePasses("feature", f)) m.appendChild(quietPill("no decision", "st-feature-flag"));
        r.appendChild(m);
        r.onclick = function () { preview(f.id); };
        colEl.appendChild(r);
      });
      wrap.appendChild(colEl);
    });
    host.appendChild(wrap);
  }
  /* ---------- Drive per record: status, push, retry ---------- */
  function drivePushRow(kind, rec, pilot, slot) {
    var w = el("div", "driverec");
    function paint() {
      w.innerHTML = "";
      var d = rec[slot] || { status: "Not in Drive" };
      var st = d.status || "Not in Drive";
      w.appendChild(el("span", "drvlab", "Drive"));
      w.appendChild(quietPill(st, st === "Synced" ? "st-live" : st === "Error" ? "st-needs-work" : st === "Linked" ? "st-planned" : ""));
      if (d.syncedAt) w.appendChild(el("span", "note", "last sync " + new Date(d.syncedAt).toLocaleString()));
      if (d.error) w.appendChild(el("span", "note bad", d.error));
      if (d.fileId) { var a = el("a", "chip", "Open doc ↗"); a.href = "https://docs.google.com/document/d/" + d.fileId + "/edit"; a.target = "_blank"; a.rel = "noopener"; w.appendChild(a); }
      var b = el("button", "chip", st === "Error" ? "Retry" : d.fileId ? "Sync now" : "Push to Drive");
      b.onclick = function (e) {
        e.stopPropagation(); b.disabled = true; b.textContent = "Pushing…";
        saveSettled().then(function () { return fetch("/api/drive/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: kind, id: rec.id, pilot: pilot ? pilot.id : "" }) }); })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
          .then(function (x) {
            var j = x.j || {};
            if (j.drive) rec[slot] = j.drive;
            else rec[slot] = { fileId: (rec[slot] || {}).fileId || "", status: "Error", syncedAt: (rec[slot] || {}).syncedAt || "", error: j.error || ("HTTP error") };
            if (j.version && !dirty) VERSION = j.version;
            toast(j.ok ? "Pushed to Drive." : "Drive: " + (j.error || "failed"), !j.ok);
            paint();
          }).catch(function (e) { rec[slot] = { fileId: (rec[slot] || {}).fileId || "", status: "Error", syncedAt: (rec[slot] || {}).syncedAt || "", error: e.message }; toast("Drive: " + e.message, true); paint(); });
      };
      w.appendChild(b);
    }
    paint();
    return w;
  }
  function driveLinkPill(url) { if (!url) return null; var a = el("a", "chip", "Open ↗"); a.href = url; a.target = "_blank"; a.rel = "noopener"; return a; }

  /* ---------- questions: states, candidates from transcripts, review ---------- */
  var Q_STATES = ["Unanswered", "Candidate answer from transcript", "Confirmed by client", "Superseded"];
  var Q_CLASS = { "Unanswered": "", "Candidate answer from transcript": "st-feature-flag", "Confirmed by client": "st-live", "Superseded": "st-planned" };
  function qOpen(q) { return q.state !== "Confirmed by client" && q.state !== "Superseded"; }
  function setQState(q, state) { q.state = state; q.status = (state === "Confirmed by client" || state === "Superseded") ? "Answered" : "Open"; q.updated = Date.now(); }
  function editQuestion(p, q, preset) {
    var isNew = !q;
    var d = q ? JSON.parse(JSON.stringify(q)) : Object.assign({ id: uid(), text: "", state: "Unanswered", status: "Open", answer: "", note: "", candidate: null, session: ui.pilotSession || "", step: "", created: Date.now(), updated: Date.now() }, preset || {});
    sideDrawer(isNew ? "New question" : "Question", function (body, close) {
      body.appendChild(fld("Question", areaIn(d.text, "What do we still not know?", function (v) { d.text = v; }, 3)));
      body.appendChild(fld("Client stance or context", areaIn(d.note, "What we already heard, without treating it as an answer. For example: the firm is not keen on automating this even if it might help.", function (v) { d.note = v; }, 2)));
      body.appendChild(fld("Session", selIn([["", "None"]].concat(p.sessions.slice().sort(byDateDesc).map(function (s) { return [s.id, sessionLabel(p, s.id)]; })), d.session, function (v) { d.session = v; })));
      body.appendChild(fld("Workflow step", selIn([["", "None"]].concat(p.steps.map(function (s) { return [s.id, s.title]; })), d.step, function (v) { d.step = v; })));
      body.appendChild(fld("State", selIn(Q_STATES, d.state || "Unanswered", function (v) { d.state = v; }), "A transcript can only produce a candidate. Confirmed means the client said so and you reviewed it."));
      if (d.candidate && d.candidate.text) body.appendChild(fld("Candidate answer from transcript", el("p", "readtext", d.candidate.text)));
      body.appendChild(fld("Confirmed answer", areaIn(d.answer, "What we now know, and from whom.", function (v) { d.answer = v; }, 3)));
      var extra = [];
      if (!isNew) { var del = el("button", "btn ghost danger", "Delete"); del.onclick = function () { p.questions = p.questions.filter(function (x) { return x.id !== d.id; }); touchPilot(p); close(); render(); save(); }; extra.push(del); }
      body.appendChild(drawerActs(function () {
        if (!d.text.trim()) return;
        d.text = d.text.trim(); setQState(d, d.state || "Unanswered");
        if (isNew) p.questions = p.questions.concat([d]); else Object.assign(q, d);
        touchPilot(p); close(); render(); save();
      }, close, extra));
    }, { eyebrow: "QUESTION" });
  }
  function questionRow(p, q) {
    var st = q.state || (q.status === "Answered" ? "Confirmed by client" : "Unanswered");
    var r = el("div", "qrow" + (qOpen(q) ? "" : " done"));
    var tick = el("button", "tick" + (qOpen(q) ? "" : " on"), qOpen(q) ? "" : "✓");
    tick.setAttribute("aria-label", qOpen(q) ? "Mark confirmed by client" : "Reopen");
    tick.onclick = function () { setQState(q, qOpen(q) ? "Confirmed by client" : "Unanswered"); touchPilot(p); render(); save(); };
    r.appendChild(tick);
    var t = el("div", "qtext");
    var tb = el("button", "qopen"); tb.appendChild(el("b", null, q.text)); tb.onclick = function () { editQuestion(p, q); }; t.appendChild(tb);
    var m = [];
    if (q.session && sessionById(p, q.session)) m.push(sessionLabel(p, q.session));
    if (q.step) { var stp = p.steps.filter(function (s) { return s.id === q.step; })[0]; if (stp) m.push("step: " + stp.title); }
    if (q.note) m.push("stance: " + q.note);
    if (q.answer) m.push("answer: " + q.answer);
    if (m.length) t.appendChild(el("span", null, m.join(" · ")));
    if (st === "Candidate answer from transcript" && q.candidate) {
      var cand = el("div", "cand");
      cand.appendChild(el("span", "candlab", (q.candidate.contradicts ? "Contradicts: " : q.candidate.partial ? "Partial candidate: " : "Candidate from transcript: ")));
      cand.appendChild(document.createTextNode(q.candidate.text));
      var ca = el("div", "candacts");
      ca.appendChild(chipBtn("Confirm", function () { q.answer = q.candidate.text; setQState(q, "Confirmed by client"); touchPilot(p); render(); save(); }));
      ca.appendChild(chipBtn("Partial", function () { q.candidate.partial = !q.candidate.partial; q.updated = Date.now(); touchPilot(p); render(); save(); }));
      ca.appendChild(chipBtn("Contradicts", function () { q.candidate.contradicts = !q.candidate.contradicts; q.updated = Date.now(); touchPilot(p); render(); save(); }));
      ca.appendChild(chipBtn("Reject", function () { q.candidate = null; setQState(q, "Unanswered"); touchPilot(p); render(); save(); }));
      cand.appendChild(ca);
      t.appendChild(cand);
    }
    r.appendChild(t);
    r.appendChild(quietPill(st === "Candidate answer from transcript" ? "candidate" : st.toLowerCase(), Q_CLASS[st]));
    return r;
  }
  function proposeAnswer(p, e) {
    var open = p.questions.filter(qOpen);
    var pick = "";
    sideDrawer("Which question does this answer?", function (body, close) {
      body.appendChild(el("p", "readtext", e.text));
      body.appendChild(fld("Question", selIn([["", "Pick one"]].concat(open.map(function (q) { return [q.id, q.text]; })), "", function (v) { pick = v; })));
      body.appendChild(el("p", "note", "It becomes a candidate answer. Confirm it only once the client has said so."));
      body.appendChild(drawerActs(function () { var q = p.questions.filter(function (x) { return x.id === pick; })[0]; if (!q) return; q.candidate = { text: e.text, evidence: e.id, session: e.session || "", contradicts: false, partial: false }; setQState(q, "Candidate answer from transcript"); touchPilot(p); close(); render(); save(); }, close));
    }, { eyebrow: "CANDIDATE ANSWER" });
  }
  function questionSummary(p, qs) {
    var conf = qs.filter(function (q) { return q.state === "Confirmed by client"; }).length;
    var cand = qs.filter(function (q) { return q.state === "Candidate answer from transcript" && !(q.candidate && q.candidate.contradicts) && !(q.candidate && q.candidate.partial); }).length;
    var part = qs.filter(function (q) { return q.state === "Candidate answer from transcript" && q.candidate && q.candidate.partial && !q.candidate.contradicts; }).length;
    var contra = qs.filter(function (q) { return q.candidate && q.candidate.contradicts; }).length;
    var open = qs.filter(function (q) { return q.state === "Unanswered" || !q.state; }).length;
    return el("p", "note qsum", qs.length ? [conf + " answered", part + " partially", contra + " contradicted", cand + " candidate", open + " open"].join(" · ") : "No questions attached.");
  }

  /* ---------- transcript extraction: draft evidence, candidate answers, draft actions ---------- */
  function normWords(t) { return String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter(function (w) { return w.length >= 6; }).map(function (w) { return w.slice(0, 6); }).filter(function (w, i, a) { return a.indexOf(w) === i; }); }
  function extractTranscript(p, s) {
    var lines = String(s.transcript || "").replace(/\r\n?/g, "\n").split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
    if (!lines.length) { toast("Add the transcript first (Edit session).", true); return; }
    var made = { evidence: 0, actions: 0, candidates: 0 };
    var newEv = [];
    lines.slice(0, 400).forEach(function (line) {
      var m = /^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*[-–]?\s*(.*)$/.exec(line);
      var ts = m ? m[1] : "", rest = m ? m[2] : line;
      var act = /^(?:[A-ZÀ-Ý][\wÀ-ÿ'’ .-]{0,30}?\s*:\s+)?(action|todo|à faire|a faire|next step|suivi)s?\s*[:\-–]\s*(.+)$/i.exec(rest);
      if (act) { p.actions.push({ id: uid(), title: act[2].trim(), owner: "", due: "", side: "Internal", status: "Open", note: "Draft from the transcript of " + (s.title || "session") + (ts ? " at " + ts : ""), links: { session: s.id }, created: Date.now(), updated: Date.now() }); made.actions++; return; }
      var sp = /^([A-ZÀ-Ý][\wÀ-ÿ'’ .-]{0,30}?)\s*:\s+(.+)$/.exec(rest);
      var speaker = sp ? sp[1].trim() : "", text = sp ? sp[2].trim() : rest;
      if (text.length < 12) return;
      var quote = /[«“"]/.test(text) || (speaker && speaker.toLowerCase() !== "uzziel");
      var e = { id: uid(), text: text.replace(/^[«“"]|[»”"]$/g, "").trim(), kind: quote && speaker ? "Direct quote" : "Unsorted", session: s.id, source: (s.title || "Transcript") + (ts ? " @ " + ts : ""), speaker: speaker, timestamp: ts, draft: true, note: "", links: {}, created: Date.now(), updated: Date.now() };
      p.evidence.push(e); newEv.push(e); made.evidence++;
    });
    /* candidate answers: an open question whose words show up in a transcript line, kept as a candidate until reviewed */
    p.questions.filter(function (q) { return (q.state || "Unanswered") === "Unanswered"; }).forEach(function (q) {
      var qw = normWords(q.text); if (qw.length < 2) return;
      var best = null, bestN = 0;
      newEv.forEach(function (e) { if ((e.speaker || "").toLowerCase() === ME.toLowerCase()) return; var ew = normWords(e.text); var n = qw.filter(function (w) { return ew.indexOf(w) !== -1; }).length; if (n > bestN) { bestN = n; best = e; } });
      if (best && bestN >= 1) { q.candidate = { text: best.text, evidence: best.id, session: s.id, contradicts: false, partial: bestN < 2 }; setQState(q, "Candidate answer from transcript"); made.candidates++; }
    });
    s.stage = "Extracted draft"; s.extractedAt = Date.now(); s.updated = Date.now();
    touchPilot(p); render(); save();
    toast("Draft extracted: " + made.evidence + " evidence, " + made.candidates + " candidate answers, " + made.actions + " actions. Everything is marked draft until you review it.");
  }

  /* ---------- sessions: lifecycle, agenda, Drive links, files, review ---------- */
  var SESSION_STAGES = ["Planned", "Recorded", "Transcript added", "Extracted draft", "Human reviewed", "Follow-ups closed"];
  var STAGE_CLASS = { "Planned": "st-planned", "Recorded": "st-building", "Transcript added": "st-building", "Extracted draft": "st-feature-flag", "Human reviewed": "st-live", "Follow-ups closed": "st-live" };
  var LOOP = ["Received", "Needs analysis", "Action/prototype created", "Reviewed with firm", "Validated/Closed"];
  var LOOP_CLASS = { "Received": "", "Needs analysis": "st-feature-flag", "Action/prototype created": "st-building", "Reviewed with firm": "st-planned", "Validated/Closed": "st-live" };
  var FILE_KINDS = ["Recording", "Transcript", "Raw notes", "Summary", "Received file", "Output", "Other"];
  function ensureSession(s) { if (!s.drive || typeof s.drive !== "object") s.drive = { recording: "", transcript: "", rawNotes: "", summary: "", receivedFiles: "", folder: "" }; if (!Array.isArray(s.files)) s.files = []; if (!s.stage) s.stage = "Recorded"; if (!s.doc) s.doc = { fileId: "", status: "Not in Drive", syncedAt: "", error: "" }; if (!s.calendar || typeof s.calendar !== "object") s.calendar = { eventId: "", link: "", status: "Not in calendar", syncedAt: "", error: "", origin: "App", eventUpdated: "" }; return s; }
  /* the session's place in Google Calendar: a link when it is there, a button when it could be */
  function calendarPill(p, s) {
    var c = s.calendar || {};
    var w = el("span", "calpill");
    if (c.status === "Cancelled in calendar") { w.appendChild(quietPill("cancelled in calendar", "st-needs-work")); return w; }
    if (c.eventId) {
      if (c.origin === "Calendar") w.appendChild(quietPill("from calendar", "st-planned"));
      var a = el("a", "chip", "In calendar ↗"); a.href = c.link || "https://calendar.google.com/"; a.target = "_blank"; a.rel = "noopener"; a.onclick = function (e) { e.stopPropagation(); }; w.appendChild(a);
      if (c.error) w.appendChild(el("span", "note bad", c.error));
      return w;
    }
    if (!(driveState && driveState.calendarConnected) || !s.date) return null;
    var b = el("button", "chip", c.status === "Error" ? "Retry calendar" : "Add to calendar");
    b.title = c.error || "";
    b.onclick = function (e) {
      e.stopPropagation(); b.disabled = true; b.textContent = "Adding…";
      flush().then(function () { return fetch("/api/calendar/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pilot: p.id, id: s.id }) }); })
        .then(function (r) { return r.json(); })
        .then(function (j) { if (j.calendar) s.calendar = j.calendar; if (j.version && !dirty) VERSION = j.version; toast(j.ok ? "Added to your calendar." : "Calendar: " + (j.error || "failed"), !j.ok); render(); })
        .catch(function () { toast("Could not reach the server.", true); b.disabled = false; b.textContent = "Add to calendar"; });
    };
    w.appendChild(b);
    return w;
  }
  function editSession(p, s, preset) {
    var isNew = !s;
    var d = s ? JSON.parse(JSON.stringify(ensureSession(s))) : Object.assign({ id: uid(), date: today(), time: "", title: "", participants: "", purpose: "", agenda: "", links: "", summary: "", findings: "", draft: false, stage: "Planned", drive: { recording: "", transcript: "", rawNotes: "", summary: "", receivedFiles: "", folder: "" }, transcript: "", extractedAt: 0, files: [], doc: { fileId: "", status: "Not in Drive", syncedAt: "", error: "" }, created: Date.now(), updated: Date.now() }, preset || {});
    sideDrawer(isNew ? "Plan a session" : (d.title || "Session"), function (body, close) {
      var r1 = el("div", "fld two");
      r1.appendChild(fld("Date", txtIn(d.date, "", function (v) { d.date = v; }, "date")));
      r1.appendChild(fld("Time", txtIn(d.time, "", function (v) { d.time = v; }, "time")));
      body.appendChild(r1);
      body.appendChild(fld("Stage", selIn(SESSION_STAGES, d.stage, function (v) { d.stage = v; }), "Planned → Recorded → Transcript added → Extracted draft → Human reviewed → Follow-ups closed"));
      body.appendChild(fld("Title", txtIn(d.title, "Onsite with Amélie: SAAQ case, end to end", function (v) { d.title = v; })));
      body.appendChild(fld("Participants", txtIn(d.participants, "Names and roles, both sides", function (v) { d.participants = v; })));
      body.appendChild(fld("Purpose", areaIn(d.purpose, "What this session is meant to learn.", function (v) { d.purpose = v; }, 2)));
      body.appendChild(fld("Agenda", areaIn(d.agenda, "One item per line. Questions live below as records; list here what we walk through.", function (v) { d.agenda = v; }, 4)));
      body.appendChild(el("div", "lab", "Drive links"));
      var g = el("div", "fld two");
      [["recording", "Recording"], ["transcript", "Transcript"], ["rawNotes", "Raw notes"], ["summary", "Summary"], ["receivedFiles", "Received files"], ["folder", "Session folder"]].forEach(function (k) { g.appendChild(fld(k[1], txtIn(d.drive[k[0]], "https://drive.google.com/…", function (v) { d.drive[k[0]] = v.trim(); }, "url"))); });
      body.appendChild(g);
      body.appendChild(fld("Other notes and artifacts", areaIn(d.links, "One link per line.", function (v) { d.links = v; }, 2)));
      body.appendChild(fld("Transcript text", areaIn(d.transcript, "Paste the transcript here to extract draft evidence and candidate answers. Lines like “[00:12:03] Amélie: …” keep speaker and timestamp.", function (v) { d.transcript = v; if (v.trim() && d.stage === "Recorded") d.stage = "Transcript added"; }, 6)));
      body.appendChild(fld("Summary", richEditor(d.summary, function (h) { d.summary = h; }, "What happened, in a few lines.", "small")));
      body.appendChild(fld("Findings", richEditor(d.findings, function (h) { d.findings = h; }, "What we now believe, and how sure we are. Written by you, never extracted.", "small")));
      var dr = el("label", "chk"); var cb = el("input"); cb.type = "checkbox"; cb.checked = !!d.draft; cb.onchange = function () { d.draft = cb.checked; }; dr.appendChild(cb); dr.appendChild(document.createTextNode(" Draft: details still to confirm"));
      body.appendChild(dr);
      if (!isNew) body.appendChild(drivePushRow("session", s, p, "doc"));
      var extra = [];
      if (!isNew) { var del = el("button", "btn ghost danger", "Delete"); del.onclick = function () { askConfirm("Delete this session?", "Evidence, questions, files and actions linked to it stay, unlinked.", { danger: true, ok: "Delete" }).then(function (y) { if (!y) return; p.sessions = p.sessions.filter(function (x) { return x.id !== d.id; }); p.evidence.forEach(function (e) { if (e.session === d.id) e.session = ""; }); p.questions.forEach(function (e) { if (e.session === d.id) e.session = ""; }); touchPilot(p); close(); render(); save(); }); }; extra.push(del); }
      body.appendChild(drawerActs(function () {
        d.title = d.title.trim(); d.updated = Date.now();
        if (isNew) p.sessions = p.sessions.concat([d]); else Object.assign(s, d);
        touchPilot(p); close(); render(); save();
      }, close, extra));
    }, { eyebrow: "SESSION", wide: true });
  }
  function editFile(p, s, f0) {
    var isNew = !f0;
    var d = f0 ? JSON.parse(JSON.stringify(f0)) : { id: uid(), name: "", link: "", kind: "Received file", from: "Client", loop: "Received", owner: "", due: "", note: "", drive: { fileId: "", status: "Linked", syncedAt: "", error: "" }, created: Date.now(), updated: Date.now() };
    sideDrawer(isNew ? "Add a file or output" : d.name, function (body, close) {
      body.appendChild(fld("Name", txtIn(d.name, "Sommaire dossier 71864-1", function (v) { d.name = v; })));
      var r = el("div", "fld two");
      r.appendChild(fld("Kind", selIn(FILE_KINDS, d.kind, function (v) { d.kind = v; })));
      r.appendChild(fld("From", selIn([["Client", "Received from the firm"], ["Us", "Ours"]], d.from, function (v) { d.from = v; })));
      body.appendChild(r);
      body.appendChild(fld("Drive link", txtIn(d.link, "https://drive.google.com/…", function (v) { d.link = v.trim(); d.drive = { fileId: "", status: v.trim() ? "Linked" : "Not in Drive", syncedAt: "", error: "" }; }, "url")));
      body.appendChild(fld("Close the loop", selIn(LOOP, d.loop, function (v) { d.loop = v; }), "Received → Needs analysis → Action/prototype created → Reviewed with firm → Validated/Closed"));
      var r2 = el("div", "fld two");
      r2.appendChild(fld("Owner", txtIn(d.owner, "", function (v) { d.owner = v; })));
      r2.appendChild(fld("Due", txtIn(d.due, "", function (v) { d.due = v; }, "date")));
      body.appendChild(r2);
      body.appendChild(fld("Note", areaIn(d.note, "", function (v) { d.note = v; }, 2)));
      var extra = [];
      if (!isNew) { var del = el("button", "btn ghost danger", "Remove"); del.onclick = function () { askConfirm("Remove “" + d.name + "” from this session?", "The file itself stays in Drive.", { danger: true, ok: "Remove" }).then(function (y) { if (!y) return; s.files = s.files.filter(function (x) { return x.id !== d.id; }); touchPilot(p); close(); render(); save(); }); }; extra.push(del); }
      body.appendChild(drawerActs(function () { if (!d.name.trim()) return; d.name = d.name.trim(); d.updated = Date.now(); if (isNew) s.files = (s.files || []).concat([d]); else Object.assign(f0, d); touchPilot(p); close(); render(); save(); }, close, extra));
    }, { eyebrow: "SESSION FILE" });
  }
  function fileRow(p, s, f) {
    var r = el("div", "qrow filerow");
    var t = el("button", "qtext"); t.appendChild(el("b", null, f.name));
    t.appendChild(el("span", null, [f.kind, f.from === "Client" ? "received from the firm" : "ours", f.owner, f.due ? "due " + stamp(f.due) : "", f.note].filter(Boolean).join(" · ")));
    t.onclick = function () { editFile(p, s, f); };
    r.appendChild(t);
    r.appendChild(quietPill(f.loop || "Received", LOOP_CLASS[f.loop || "Received"]));
    if (f.due && f.loop !== "Validated/Closed" && f.due < today()) r.appendChild(quietPill("overdue", "st-needs-work"));
    var lk = driveLinkPill(f.link); if (lk) r.appendChild(lk); else r.appendChild(quietPill("not in Drive"));
    return r;
  }
  function renderSessions(body, p) {
    var list = p.sessions.slice().sort(byDateDesc);
    list.forEach(ensureSession);
    var sec = secHead("Sessions", list.length || null, "Plan the questions before, attach the recording and transcript after, extract a draft, then review it yourself. Capture into a session by selecting it.", [primaryBtn("+ Plan a session", function () { editSession(p, null); })]);
    if (!list.length) sec.appendChild(emptyNote("No sessions yet. Plan the first visit and write down what it must answer."));
    list.forEach(function (s) {
      var ev = p.evidence.filter(function (e) { return e.session === s.id; });
      var qs = p.questions.filter(function (q) { return q.session === s.id; });
      var as = p.actions.filter(function (a) { return a.links && a.links.session === s.id; });
      var side = [];
      var sel = el("button", "chip" + (ui.pilotSession === s.id ? " on" : ""), ui.pilotSession === s.id ? "Capturing here" : "Capture here");
      sel.onclick = function (e) { e.stopPropagation(); ui.pilotSession = ui.pilotSession === s.id ? "" : s.id; renderView(); };
      side.push(quietPill(s.stage, STAGE_CLASS[s.stage]));
      var cp = calendarPill(p, s); if (cp) side.push(cp);
      side.push(sel);
      var titleNode = el("span"); titleNode.appendChild(document.createTextNode(s.title || s.purpose || "Session"));
      if (s.draft) titleNode.appendChild(quietPill("draft", "st-feature-flag"));
      var drv = s.drive || {}, nLinks = ["recording", "transcript", "rawNotes", "summary", "receivedFiles", "folder"].filter(function (k) { return drv[k]; }).length;
      sec.appendChild(xrow({ key: "s:" + s.id, title: titleNode,
        meta: metaLine([s.date ? stamp(s.date) + (s.time ? " " + s.time : "") : "undated", s.participants, qs.length ? qs.length + " questions" : "", ev.length ? ev.length + " evidence" : "", as.length ? as.length + " actions" : "", (s.files || []).length ? s.files.length + " files" : "", nLinks ? nLinks + " Drive links" : "no Drive links"]),
        side: side,
        details: function (det) {
          if (s.purpose) { det.appendChild(el("div", "lab", "Purpose")); det.appendChild(el("p", "readtext", s.purpose)); }
          if (s.agenda) { det.appendChild(el("div", "lab", "Agenda")); var ag = el("ol", "agenda"); s.agenda.split(/\n+/).filter(Boolean).forEach(function (l) { ag.appendChild(el("li", null, l.replace(/^\s*[-*\d.)]+\s*/, ""))); }); det.appendChild(ag); }
          det.appendChild(el("div", "lab", "Questions"));
          det.appendChild(questionSummary(p, qs));
          if (!qs.length) det.appendChild(emptyNote("No questions attached. Add the ones this session must answer."));
          qs.forEach(function (q) { det.appendChild(questionRow(p, q)); });
          det.appendChild(el("div", "lab", "Drive"));
          var dl = el("div", "drivelinks");
          [["recording", "Recording"], ["transcript", "Transcript"], ["rawNotes", "Raw notes"], ["summary", "Summary"], ["receivedFiles", "Received files"], ["folder", "Session folder"]].forEach(function (k) {
            var c = el("span", "drivelink" + (drv[k[0]] ? "" : " missing"));
            c.appendChild(el("b", null, k[1]));
            if (drv[k[0]]) { var a = el("a", null, "open ↗"); a.href = drv[k[0]]; a.target = "_blank"; a.rel = "noopener"; c.appendChild(a); } else c.appendChild(el("i", null, "not linked"));
            dl.appendChild(c);
          });
          det.appendChild(dl);
          det.appendChild(drivePushRow("session", s, p, "doc"));
          det.appendChild(el("div", "lab", "Files and outputs"));
          if (!(s.files || []).length) det.appendChild(emptyNote("Nothing received or produced yet."));
          (s.files || []).forEach(function (f) { det.appendChild(fileRow(p, s, f)); });
          if (s.summary) { det.appendChild(el("div", "lab", "Summary")); det.appendChild(richBlock(s.summary, p)); }
          if (s.findings) { det.appendChild(el("div", "lab", "Findings")); det.appendChild(richBlock(s.findings, p)); }
          det.appendChild(el("div", "lab", "Evidence from this session"));
          if (!ev.length) det.appendChild(emptyNote("Nothing captured against this session yet."));
          ev.slice(0, 12).forEach(function (e) { det.appendChild(evidenceRow(p, e, true)); });
          if (ev.length > 12) { var more = chipBtn("See all " + ev.length + " in the Inbox", function () { ui.pilotSub = "inbox"; ui.inboxQ = ""; ui.inboxKind = ""; renderView(); }); det.appendChild(more); }
          det.appendChild(el("div", "lab", "Next actions")); if (!as.length) det.appendChild(emptyNote("None.")); as.forEach(function (a) { det.appendChild(actionRow(p, a)); });
          var acts = el("div", "rowacts");
          acts.appendChild(chipBtn("Edit session", function () { editSession(p, s); }));
          acts.appendChild(chipBtn(s.transcript ? "Extract draft from transcript" : "Add transcript", function () { if (s.transcript) { askConfirm("Extract a draft from the transcript?", "Creates draft evidence, candidate answers and draft actions. Nothing is confirmed until you review it.", { ok: "Extract" }).then(function (y) { if (y) extractTranscript(p, s); }); } else editSession(p, s); }));
          if (s.stage === "Extracted draft") acts.appendChild(chipBtn("Mark human reviewed", function () { s.stage = "Human reviewed"; s.updated = Date.now(); p.evidence.forEach(function (e) { if (e.session === s.id) e.draft = false; }); touchPilot(p); render(); save(); }));
          if (s.stage === "Human reviewed" && !as.some(function (a) { return a.status !== "Done"; })) acts.appendChild(chipBtn("Close follow-ups", function () { s.stage = "Follow-ups closed"; s.updated = Date.now(); touchPilot(p); render(); save(); }));
          acts.appendChild(chipBtn("+ Question", function () { editQuestion(p, null, { session: s.id }); }));
          acts.appendChild(chipBtn("+ Action", function () { editAction(p, null, { links: { session: s.id } }); }));
          acts.appendChild(chipBtn("+ File", function () { editFile(p, s, null); }));
          det.appendChild(acts);
        } }));
    });
    body.appendChild(sec);
  }

  /* ---------- artifacts and prototypes ---------- */
  var ART_STATUS = ["Draft", "Shared", "Reviewed", "Final", "Retired"];
  function editArtifact(p, a) {
    var isNew = !a;
    var d = a ? JSON.parse(JSON.stringify(a)) : { id: uid(), title: "", link: "", kind: "Prototype", note: "", feature: "", request: "", audience: "Internal", version: "", status: "Draft", owner: ME, session: ui.pilotSession || "", origin: "Created", step: "", evidence: [], decision: "", loop: "Received", loopOwner: "", loopDue: "", drive: { fileId: "", status: "Not in Drive", syncedAt: "", error: "" }, created: Date.now(), updated: Date.now() };
    d.evidence = d.evidence || [];
    sideDrawer(isNew ? "New artifact" : d.title, function (body, close) {
      body.appendChild(fld("Title", txtIn(d.title, "Portal prototype", function (v) { d.title = v; })));
      var r0 = el("div", "fld two");
      r0.appendChild(fld("Origin", selIn([["Created", "Created by us"], ["Received", "Received from the firm"]], d.origin, function (v) { d.origin = v; })));
      r0.appendChild(fld("Kind", selIn(ARTIFACT_KINDS, d.kind, function (v) { d.kind = v; })));
      body.appendChild(r0);
      var r1 = el("div", "fld two");
      r1.appendChild(fld("Version", txtIn(d.version, "2", function (v) { d.version = v; })));
      r1.appendChild(fld("Status", selIn(ART_STATUS, d.status, function (v) { d.status = v; })));
      body.appendChild(r1);
      var r2 = el("div", "fld two");
      r2.appendChild(fld("Audience", selIn(["Internal", "Client", "Both"], d.audience, function (v) { d.audience = v; })));
      r2.appendChild(fld("Owner", txtIn(d.owner, "", function (v) { d.owner = v; })));
      body.appendChild(r2);
      body.appendChild(fld("Link (Drive or prototype)", txtIn(d.link, "https://…", function (v) { d.link = v.trim(); if (v.trim() && !(d.drive && d.drive.fileId)) d.drive = { fileId: "", status: "Linked", syncedAt: "", error: "" }; }, "url")));
      body.appendChild(fld("Note", areaIn(d.note, "What it shows, what it is for, what we want to learn from showing it.", function (v) { d.note = v; }, 3)));
      body.appendChild(fld("Session or source", selIn([["", "None"]].concat(p.sessions.slice().sort(byDateDesc).map(function (s) { return [s.id, sessionLabel(p, s.id)]; })), d.session, function (v) { d.session = v; })));
      body.appendChild(fld("Workflow bottleneck it addresses", selIn([["", "None"]].concat(p.steps.map(function (s) { return [s.id, s.title]; })), d.step, function (v) { d.step = v; })));
      body.appendChild(fld("Request", selIn([["", "None"]].concat(p.requests.map(function (r) { return [r.id, r.title]; })), d.request, function (v) { d.request = v; })));
      var frow = el("div", "fld"); frow.appendChild(el("label", null, "Feature"));
      var fb = el("button", "btn ghost small", d.feature && feature(d.feature) ? feature(d.feature).name : "Pick a feature");
      fb.onclick = function () { pickFeature("Link to a feature", []).then(function (f) { if (f) { d.feature = f.id; fb.textContent = f.name; } }); };
      frow.appendChild(fb); body.appendChild(frow);
      body.appendChild(fld("Product decision", selIn([["", "None"]].concat(decisions().filter(function (x) { return !x.pilot || x.pilot === p.id; }).map(function (x) { return [x.id, x.title + " · " + x.state]; })), d.decision, function (v) { d.decision = v; })));
      body.appendChild(fld("Customer problem it addresses", selIn([["", "None"]].concat(problemsOf(p).map(function (x) { return [x.id, x.title + " · " + x.status]; })), d.problem || "", function (v) { d.problem = v; })));
      var evl = el("div", "fld"); evl.appendChild(el("label", null, "Evidence"));
      var chosen = el("div", "linklist");
      function drawEv() { chosen.innerHTML = ""; d.evidence.forEach(function (id) { var e = p.evidence.filter(function (x) { return x.id === id; })[0]; if (!e) return; var c = el("button", "chip", (e.kind || "") + ": " + e.text.slice(0, 60)); c.title = "Remove"; c.onclick = function () { d.evidence = d.evidence.filter(function (x) { return x !== id; }); drawEv(); }; chosen.appendChild(c); }); }
      drawEv(); evl.appendChild(chosen);
      var pickEv = selIn([["", "Attach evidence…"]].concat(p.evidence.map(function (e) { return [e.id, (e.kind || "") + ": " + e.text.slice(0, 70)]; })), "", function (v) { if (v && d.evidence.indexOf(v) === -1) { d.evidence.push(v); drawEv(); } pickEv.value = ""; });
      evl.appendChild(pickEv); body.appendChild(evl);
      body.appendChild(el("div", "lab", "Close the loop"));
      body.appendChild(fld("State", selIn(LOOP, d.loop, function (v) { d.loop = v; }), "Received → Needs analysis → Action/prototype created → Reviewed with firm → Validated/Closed"));
      var r3 = el("div", "fld two");
      r3.appendChild(fld("Loop owner", txtIn(d.loopOwner, "", function (v) { d.loopOwner = v; })));
      r3.appendChild(fld("Due", txtIn(d.loopDue, "", function (v) { d.loopDue = v; }, "date")));
      body.appendChild(r3);
      if (!isNew) body.appendChild(drivePushRow("artifact", a, p, "drive"));
      var extra = [];
      if (!isNew) { var del = el("button", "btn ghost danger", "Delete"); del.onclick = function () { askConfirm("Delete “" + d.title + "”?", "The file stays in Drive.", { danger: true, ok: "Delete" }).then(function (y) { if (!y) return; p.artifacts = p.artifacts.filter(function (x) { return x.id !== d.id; }); touchPilot(p); close(); render(); save(); }); }; extra.push(del); }
      body.appendChild(drawerActs(function () { if (!d.title.trim()) return; d.title = d.title.trim(); d.updated = Date.now(); if (isNew) p.artifacts = p.artifacts.concat([d]); else Object.assign(a, d); touchPilot(p); close(); render(); save(); }, close, extra));
    }, { eyebrow: "ARTIFACT", wide: true });
  }
  function renderArtifacts(body, p) {
    var sec = secHead("Prototypes and artifacts", p.artifacts.length || null, "What we showed or gave the firm, and what they gave us. Each one carries its audience, version, status, owner, source, the bottleneck it addresses, and where it stands in the loop.", [primaryBtn("+ Artifact", function () { editArtifact(p, null); })]);
    if (!p.artifacts.length) sec.appendChild(emptyNote("Nothing listed yet."));
    p.artifacts.forEach(function (a) {
      var titleNode = el("span"); titleNode.appendChild(document.createTextNode(a.title + (a.version ? " v" + a.version : "")));
      titleNode.appendChild(quietPill(a.origin === "Received" ? "received from the firm" : "ours", a.origin === "Received" ? "st-building" : ""));
      var side = [quietPill(a.loop || "Received", LOOP_CLASS[a.loop || "Received"])];
      var lk = driveLinkPill(a.link); if (lk) side.push(lk);
      sec.appendChild(xrow({ key: "a:" + a.id, title: titleNode, meta: metaLine([a.kind, a.status, a.audience === "Both" ? "internal + client" : (a.audience || "Internal").toLowerCase(), a.owner, a.session && sessionById(p, a.session) ? sessionLabel(p, a.session) : "", a.loopDue ? "loop due " + stamp(a.loopDue) : "", (a.drive && a.drive.status) || "Not in Drive"]), side: side, details: function (det) {
        if (a.note) { det.appendChild(el("div", "lab", "Note")); det.appendChild(el("p", "readtext", a.note)); }
        var g = el("div", "stepgrid two");
        [["Customer problem", (function () { var x = problemById(p, a.problem); return x ? x.title + " · " + x.status : ""; })()], ["Feature", a.feature && feature(a.feature) ? feature(a.feature).name + " · " + feature(a.feature).state : ""], ["Request", (function () { var r = p.requests.filter(function (x) { return x.id === a.request; })[0]; return r ? r.title : ""; })()], ["Workflow bottleneck", (function () { var s = p.steps.filter(function (x) { return x.id === a.step; })[0]; return s ? s.title : ""; })()], ["Product decision", (function () { var d = decisionById(a.decision); return d ? d.title + " · " + d.state : ""; })()], ["Loop owner", [a.loopOwner, a.loopDue ? "due " + stamp(a.loopDue) : ""].filter(Boolean).join(" · ")]].forEach(function (x) { if (!x[1]) return; var c = el("div", "stepcell"); c.appendChild(el("div", "lab", x[0])); c.appendChild(el("p", "readtext", x[1])); g.appendChild(c); });
        det.appendChild(g);
        var ev = (a.evidence || []).map(function (id) { return p.evidence.filter(function (e) { return e.id === id; })[0]; }).filter(Boolean);
        if (ev.length) { det.appendChild(el("div", "lab", "Evidence")); ev.forEach(function (e) { det.appendChild(evidenceRow(p, e, true)); }); }
        det.appendChild(drivePushRow("artifact", a, p, "drive"));
        var acts = el("div", "rowacts");
        acts.appendChild(chipBtn("Edit", function () { editArtifact(p, a); }));
        acts.appendChild(chipBtn("+ Action", function () { editAction(p, null, { title: "Follow up on " + a.title, links: { session: a.session || "" } }); }));
        det.appendChild(acts);
      } }));
    });
    body.appendChild(sec);
  }

  /* ---------- context pane: software and partners, read first, edit one at a time ---------- */
  function editStackItem(p, x, kind) {
    var isNew = !x;
    var d = x ? JSON.parse(JSON.stringify(x)) : { id: uid(), name: "", kind: kind || "Software", category: "", usage: "", link: "", created: Date.now(), updated: Date.now() };
    sideDrawer(isNew ? (d.kind === "Partner" ? "Add a partner" : "Add a software") : d.name, function (body, close) {
      body.appendChild(fld("Name", txtIn(d.name, d.kind === "Partner" ? "Firm name" : "Product name", function (v) { d.name = v; })));
      var r = el("div", "fld two");
      r.appendChild(fld("Kind", selIn(STACK_KINDS, d.kind, function (v) { d.kind = v; })));
      r.appendChild(fld("Category", selIn([["", "Pick one"]].concat(STACK_CATS.map(function (c) { return [c, c]; })), d.category, function (v) { d.category = v; })));
      body.appendChild(r);
      body.appendChild(fld(d.kind === "Partner" ? "Contact" : "Link", txtIn(d.link, d.kind === "Partner" ? "Name, email, phone" : "Website or login page", function (v) { d.link = v.trim(); })));
      body.appendChild(fld(d.kind === "Partner" ? "What they do for them" : "How they use it", richEditor(d.usage, function (h) { d.usage = h; }, d.kind === "Partner" ? "Scope, cadence, cost, who the contact is." : "Who uses it, for what, how often, what it costs, what they like and hate.", "small")));
      var extra = [];
      if (!isNew) { var del = el("button", "btn ghost danger", "Remove"); del.onclick = function () { askConfirm("Remove “" + d.name + "”?", "", { danger: true, ok: "Remove" }).then(function (y) { if (!y) return; p.stack = p.stack.filter(function (y2) { return y2.id !== d.id; }); touchPilot(p); close(); contextPane(p); save(); }); }; extra.push(del); }
      body.appendChild(drawerActs(function () { if (!d.name.trim()) return; d.name = d.name.trim(); d.updated = Date.now(); if (isNew) p.stack = p.stack.concat([d]); else Object.assign(x, d); touchPilot(p); close(); contextPane(p); save(); }, close, extra));
    }, { eyebrow: d.kind === "Partner" ? "PARTNER" : "SOFTWARE" });
  }
  function contextPane(p) {
    ensurePilot(p);
    sideDrawer("Context", function (body) {
      body.appendChild(el("p", "note", "The firm's tools, the firms around them, and the people. Read first; open one to edit."));
      var sw = p.stack.filter(function (x) { return x.kind === "Software"; }), pt = p.stack.filter(function (x) { return x.kind === "Partner"; });
      function section(title, items, kind) {
        var sec = secHead(title, items.length || null, null, [chipBtn("+ Add", function () { editStackItem(p, null, kind); })]);
        if (!items.length) sec.appendChild(emptyNote("None yet."));
        items.forEach(function (x) {
          var r = el("div", "qrow ctxrow");
          var t = el("button", "qtext"); t.appendChild(el("b", null, x.name));
          t.appendChild(el("span", null, [x.category, peekText(x.usage, "")].filter(Boolean).join(" · ")));
          t.onclick = function () { editStackItem(p, x); };
          r.appendChild(t);
          if (/^https?:\/\//.test(x.link || "")) { var go = el("a", "chip", "Open ↗"); go.href = x.link; go.target = "_blank"; go.rel = "noopener"; r.appendChild(go); }
          var m = menu("⋯", [["Edit", function () { editStackItem(p, x); }], "-", ["Remove", function () { askConfirm("Remove “" + x.name + "”?", "", { danger: true, ok: "Remove" }).then(function (y) { if (!y) return; p.stack = p.stack.filter(function (y2) { return y2.id !== x.id; }); touchPilot(p); contextPane(p); save(); }); }, true]], "rowmenu");
          r.appendChild(m);
          sec.appendChild(r);
        });
        return sec;
      }
      body.appendChild(section("Software they use", sw, "Software"));
      body.appendChild(section("Firms and partners", pt, "Partner"));
      var ppl = secHead("People", p.people.length || null, null, [chipBtn("+ Add", function () { editPerson(p, null); })]);
      if (!p.people.length) ppl.appendChild(emptyNote(p.contact ? "Contact line as recorded before: " + p.contact : "Nobody listed."));
      p.people.forEach(function (x) { var r = el("div", "qrow ctxrow"); var t = el("button", "qtext"); t.appendChild(el("b", null, x.name)); t.appendChild(el("span", null, [x.role, x.side, x.note].filter(Boolean).join(" · "))); t.onclick = function () { editPerson(p, x); }; r.appendChild(t); ppl.appendChild(r); });
      body.appendChild(ppl);
    }, { eyebrow: "SOFTWARE, PARTNERS, PEOPLE", wide: true });
  }

  /* ---------- capture composer: two taps, dictation, autosave, survives reload ---------- */
  function capKey(p) { return "alie.capdraft:" + p.id; }
  function captureQueue() { try { return JSON.parse(localStorage.getItem("alie.capq") || "[]") || []; } catch (e) { return []; } }
  function setCaptureQueue(q) { try { localStorage.setItem("alie.capq", JSON.stringify(q)); } catch (e) {} }
  function restoreCaptureQueue() {
    var q = captureQueue(); if (!q.length) return;
    var added = 0;
    q.forEach(function (it) { var p = pilotById(it.pilot); if (!p) return; ensurePilot(p); if (p.evidence.some(function (e) { return e.id === it.id; })) return; p.evidence.push({ id: it.id, text: it.text, kind: "Unsorted", session: it.session || "", source: "", speaker: "", timestamp: "", draft: false, note: "", links: {}, created: it.created, updated: it.created }); touchPilot(p); added++; });
    if (added) { save(); toast(added + " captured note" + (added === 1 ? "" : "s") + " from before the interruption " + (added === 1 ? "was" : "were") + " added."); }
  }
  function captureBar(p, withPilot) {
    ensurePilot(p);
    var bar = el("div", "capture");
    if (withPilot && pilots().length > 1) {
      var sel = selIn(pilots().map(function (x) { return [x.id, x.name]; }), p.id, function (v) { ui.homePilot = v; renderView(); });
      sel.className = "capsel"; sel.setAttribute("aria-label", "Pilot");
      bar.appendChild(sel);
    }
    var form = el("div", "capbox");
    var inp = el("textarea", "capin");
    inp.rows = 1;
    inp.placeholder = "Capture a quote, observation, request, question, or idea…";
    inp.setAttribute("aria-label", "Capture a note for " + p.name);
    inp.setAttribute("enterkeyhint", "send"); inp.setAttribute("autocapitalize", "sentences"); inp.setAttribute("autocomplete", "off");
    try { inp.value = localStorage.getItem(capKey(p)) || ""; } catch (e) {}
    function grow() { inp.style.height = "auto"; inp.style.height = Math.min(160, inp.scrollHeight) + "px"; }
    inp.oninput = function () { grow(); try { localStorage.setItem(capKey(p), inp.value); } catch (e) {} };
    function submit() {
      var t = inp.value.trim();
      if (!t) { inp.focus(); return; }
      var e = { id: uid(), text: t, kind: "Unsorted", session: ui.pilotSession || "", source: "", speaker: "", timestamp: "", draft: false, note: "", links: {}, created: Date.now(), updated: Date.now() };
      p.evidence = p.evidence.concat([e]);
      setCaptureQueue(captureQueue().concat([{ pilot: p.id, id: e.id, text: t, session: e.session, created: e.created }]));
      touchPilot(p); save();
      inp.value = ""; try { localStorage.removeItem(capKey(p)); } catch (err) {}
      grow();
      toast("Captured to " + p.name + "'s Inbox as Unsorted.");
      if (ui.view === "pilots" && ui.pilotTab === "discovery" && ui.pilotSub === "inbox") renderView();
      else { var c = document.querySelector(".capcount"); if (c) c.textContent = unsortedCount(p) ? unsortedCount(p) + " unsorted" : ""; }
      inp.focus();
    }
    inp.onkeydown = function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } };
    form.appendChild(inp);
    var go = el("button", "btn capgo", "Capture"); go.setAttribute("aria-label", "Capture");
    go.onclick = submit;
    form.appendChild(go);
    bar.appendChild(form);
    var foot = el("div", "capfoot");
    var cnt = el("button", "capcount", unsortedCount(p) ? unsortedCount(p) + " unsorted" : "");
    cnt.onclick = function () { ui.view = "pilots"; ui.pilot = p.id; ui.pilotTab = "discovery"; ui.pilotSub = "inbox"; ui.inboxKind = "Unsorted"; ui.inboxQ = ""; render(); };
    foot.appendChild(cnt);
    foot.appendChild(el("span", "note", ui.pilotSession && sessionById(p, ui.pilotSession) ? "Linked to " + sessionLabel(p, ui.pilotSession) : "Saved as Unsorted with today's date, kept on this device until the server confirms."));
    bar.appendChild(foot);
    setTimeout(grow, 0);
    return bar;
  }
  /* keep the composer above the on-screen keyboard */
  if (window.visualViewport) {
    var kbTimer = null;
    window.visualViewport.addEventListener("resize", function () {
      clearTimeout(kbTimer);
      kbTimer = setTimeout(function () { var kb = Math.max(0, window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop); document.documentElement.style.setProperty("--kb", kb + "px"); }, 60);
    });
  }
  /* offline banner and loading/error states for the whole app */
  function netBanner(on) {
    var b = document.getElementById("netbar");
    if (!b) { b = el("div", "netbar"); b.id = "netbar"; b.textContent = "Offline. Captures and edits are kept on this device and sent when you are back."; document.body.appendChild(b); }
    b.hidden = !on;
  }
  window.addEventListener("offline", function () { netBanner(true); });
  window.addEventListener("online", function () { netBanner(false); if (dirty) flush(); });

  function unsortedCount(p) { return (p.evidence || []).filter(function (e) { return e.kind === "Unsorted"; }).length; }
  /* pilot-level decisions view: product decisions that concern this pilot, plus what was decided on requests and fit */
  function renderDecisions(body, p) {
    var mine = decisions().filter(function (d) { return d.pilot === p.id; }).sort(function (a, b) { return b.updated - a.updated; });
    var decided = p.requests.filter(function (r) { return r.decision !== "Undecided"; });
    var fits = pilotFeatureSet(p).filter(function (f) { return fitOf(p, f).fit !== "Not assessed"; });
    var legacy = p.decisions || [];
    var sec = secHead("Product decisions", mine.length + legacy.length || null, "What we chose to do, not do, or change for this firm. Nothing linked moves to Building or client testing until a decision here is Decided and aligned with the cofounders.", [primaryBtn("+ Decision", function () { editDecision(null, { pilot: p.id }); }), chipBtn("Queue", function () { ui.view = "decisions"; ui.pilot = null; render(); })]);
    if (!mine.length && !legacy.length) sec.appendChild(emptyNote("No decisions recorded for this pilot yet."));
    mine.forEach(function (d) { sec.appendChild(decisionRow(d)); });
    legacy.forEach(function (d) { sec.appendChild(xrow({ key: "ldc:" + d.id, title: d.title, meta: metaLine([quietPill("earlier record"), d.date ? stamp(d.date) : "", (d.decision || "").slice(0, 80)]), details: function (det) { det.appendChild(el("div", "lab", "Decision")); det.appendChild(el("p", "readtext", d.decision || "—")); det.appendChild(el("div", "lab", "Why")); det.appendChild(el("p", "readtext", d.reason || "—")); } })); });
    body.appendChild(sec);
    if (decided.length || fits.length) {
      var s2 = secHead("Decided on requests and fit", decided.length + fits.length, "Set on the request or the fit assessment itself.");
      decided.forEach(function (r) { var b = el("button", "linkrow"); b.appendChild(el("b", null, r.title)); b.appendChild(el("span", null, r.decision + (r.reason ? " · " + r.reason : "") + (r.decisionRef && decisionById(r.decisionRef) ? " · decision: " + decisionById(r.decisionRef).state : ""))); b.onclick = function () { ui.pilotSub = "requests"; foldSet("r:" + r.id, true); renderView(); }; s2.appendChild(b); });
      fits.forEach(function (f) { var ft = fitOf(p, f); var b = el("button", "linkrow"); b.appendChild(el("b", null, f.name)); b.appendChild(el("span", null, "fit: " + ft.fit + (ft.supports ? " · " + ft.supports.slice(0, 80) : ""))); b.onclick = function () { ui.pilotSub = "fit"; foldSet("f:" + p.id + ":" + f.id, true); renderView(); }; s2.appendChild(b); });
      body.appendChild(s2);
    }
  }
  /* feature page: evidence and fit from pilots, and the decisions that gate it */
  function evidencePanel(f) {
    var pnl = el("div", "panel"); pnl.style.marginTop = "18px";
    pnl.appendChild(el("h3", null, "Evidence and fit"));
    var n = 0;
    pilots().forEach(function (p) {
      ensurePilot(p);
      var ft = p.fit[f.id];
      if (ft) { n++; var r = el("div", "fl"); var b = el("button", null, p.name + " · fit: " + ft.fit + (ft.supports ? " · " + ft.supports.slice(0, 60) : "")); b.onclick = function () { ui.view = "pilots"; ui.pilot = p.id; ui.pilotTab = "delivery"; ui.pilotSub = "fit"; ui.feature = null; foldSet("f:" + p.id + ":" + f.id, true); render(); }; r.appendChild(b); r.appendChild(quietPill(ft.fit, FIT_CLASS[ft.fit])); pnl.appendChild(r); }
      p.evidence.filter(function (e) { return e.links && e.links.feature === f.id; }).slice(0, 6).forEach(function (e) { n++; pnl.appendChild(evidenceRow(p, e, true)); });
    });
    if (!n) pnl.appendChild(el("div", "note", "No pilot has assessed this yet and no evidence points at it. A Live feature can still be unassessed for a pilot."));
    return pnl;
  }
  function decisionsPanel(f) {
    var pnl = el("div", "panel"); pnl.style.marginTop = "18px";
    pnl.appendChild(el("h3", null, "Decisions"));
    var list = decisionsLinked("feature", f.id);
    if (!list.length) pnl.appendChild(el("div", "note", BUILT_STATES.indexOf(f.state) !== -1 ? "Built before the decision gate existed; kept as history." : "No decision yet. Planned or Building will wait for one."));
    list.forEach(function (d) { var r = el("div", "fl"); var b = el("button", null, d.title + " · " + d.state + (decisionBlocked(d) ? " · blocked until aligned" : d.state === "Decided" ? " · " + d.alignment : "")); b.onclick = function () { editDecision(d); }; r.appendChild(b); r.appendChild(quietPill(d.state, DEC_CLASS[d.state])); pnl.appendChild(r); });
    var add = el("button", "btn ghost rowbtn", "+ Product decision"); add.onclick = function () { editDecision(null, { title: "Build " + f.name + "?", links: { feature: f.id }, pilot: (pilotsFor(f)[0] || {}).id || "" }); }; pnl.appendChild(add);
    return pnl;
  }
  /* =====================================================================
     Customer problems: evidence-backed, framed in seven steps, neither a request nor a product decision.
     ===================================================================== */
  var PB = window.ALIE_PROBLEMS;
  var PROBLEM_CLASS = { "Draft": "", "Framed": "st-planned", "Validating": "st-building", "Validated": "st-live", "Superseded": "st-feature-flag" };
  function problemsOf(p) { ensurePilot(p); if (!Array.isArray(p.problems)) p.problems = []; return p.problems; }
  function problemById(p, id) { return problemsOf(p).filter(function (x) { return x.id === id; })[0]; }
  function problemNeedsFraming(pr) { return pr.status === "Draft" || !PB.completeness(pr).complete; }
  function problemsNeedingFraming() { var n = 0; pilots().forEach(function (p) { problemsOf(p).forEach(function (pr) { if (pr.status !== "Superseded" && problemNeedsFraming(pr)) n++; }); }); return n; }
  function plannedSessions(p) { return p.sessions.filter(function (s) { return s.stage === "Planned" && (!s.date || s.date >= today()); }).sort(function (a, b) { return (a.date || "9") < (b.date || "9") ? -1 : 1; }); }
  function addGapsToSession(p, pr, sessionId) {
    var made = PB.mergeGapQuestions(p.questions, pr, sessionId, Date.now(), uid);
    if (!made.length) { toast("Every gap already has a question."); return 0; }
    p.questions = p.questions.concat(made); touchPilot(p); save();
    toast(made.length + (made.length === 1 ? " question added" : " questions added") + " to " + sessionLabel(p, sessionId) + ".");
    return made.length;
  }
  function askGapsSession(p, pr) {
    var opts = plannedSessions(p);
    if (!opts.length) { toast("Plan a session first; the gaps become its questions.", true); return; }
    var pick = opts[0].id;
    sideDrawer("Add gaps to a session", function (body, close) {
      var gaps = PB.gapQuestions(pr);
      body.appendChild(el("p", "note", gaps.length ? gaps.length + " unanswered framing steps become planned questions. Steps that already have a question are skipped." : "Nothing missing: every framing step is filled."));
      gaps.forEach(function (g) { var r = el("div", "qrow"); var t = el("div", "qtext"); t.appendChild(el("b", null, g.text)); t.appendChild(el("span", null, g.label)); r.appendChild(t); body.appendChild(r); });
      body.appendChild(fld("Session", selIn(opts.map(function (s) { return [s.id, sessionLabel(p, s.id)]; }), pick, function (v) { pick = v; })));
      body.appendChild(drawerActs(function () { addGapsToSession(p, pr, pick); close(); render(); }, close));
    }, { eyebrow: "FRAMING GAPS" });
  }
  function problemChain(p, pr) {
    var line = el("div", "chain");
    var ev = (pr.evidence || []).length;
    var req = (pr.requests || []).length, art = (pr.artifacts || []).length;
    var dec = pr.decision ? decisionById(pr.decision) : null;
    var f = pr.feature ? feature(pr.feature) : null;
    var val = "none";
    (pr.requests || []).forEach(function (id) { var r = p.requests.filter(function (x) { return x.id === id; })[0]; if (r && r.validation && r.validation.status === "Client validated") val = "Client validated"; });
    [["Evidence", ev ? ev + " linked" : "none", ev ? "on" : ""], ["Problem", pr.status, pr.status !== "Draft" ? "on" : ""], ["Request / artifact", req || art ? [req ? req + " request" + (req > 1 ? "s" : "") : "", art ? art + " artifact" + (art > 1 ? "s" : "") : ""].filter(Boolean).join(", ") : "none", req || art ? "on" : ""], ["Product decision", dec ? dec.state : "none", dec ? "on" : ""], ["Feature / deliverable", f ? f.state : "none", f ? "on" : ""], ["Client validation", val, val === "Client validated" ? "on good" : ""]].forEach(function (x, i) {
      if (i) line.appendChild(el("i", null, "›"));
      var c = el("span", "cnode " + x[2]); c.appendChild(el("b", null, x[0])); c.appendChild(el("span", null, x[1])); line.appendChild(c);
    });
    return line;
  }
  /* =====================================================================
     Client reviews: a curated "what I understand about your business" document, published as one link the client
     opens without an account, reads in ten short pages, and corrects in place. Corrections come back here as
     proposals; nothing becomes evidence, a requirement or an accepted deliverable on its own.
     ===================================================================== */
  function RV() { if (!window.ALIE_REVIEWS) { toast("Reviews module not loaded yet. Reload the page.", true); throw new Error("reviews module missing"); } return window.ALIE_REVIEWS; }
  var REVIEW_SECTIONS = ["Start here", "How a matter moves", "How the team works", "Where work is difficult", "What we should clarify"];
  function reviewLink(rev) { return location.origin + "/r/" + rev.token; }
  function reviewCurrent(r) { return r.revisions.length ? r.revisions[r.revisions.length - 1] : null; }
  function reviewCardTitle(r, id) { var c = r.cards.filter(function (x) { return x.id === id; })[0]; if (c) return c.title; var rv = reviewCurrent(r); var sc = rv && rv.snapshot ? RV().snapshotCards(rv.snapshot).filter(function (x) { return x.id === id; })[0] : null; return sc ? sc.title : "(page removed)"; }
  function renderReviews(body, p) {
    var list = p.reviews.slice().sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); });
    var sec = secHead("Client reviews", list.length || null, "One link, no account: the firm reads what we think we understand and corrects it in place. What comes back stays a proposal until you apply it; it never becomes evidence or a requirement on its own.", [primaryBtn("+ Create review link", function () { newReview(p); })]);
    if (!list.length) sec.appendChild(emptyNote("No review yet. Create one to draft the pages, preview exactly what the firm will see, then publish a fixed revision and copy the link."));
    list.forEach(function (r) { sec.appendChild(reviewRow(p, r)); });
    body.appendChild(sec);
  }
  function reviewRow(p, r) {
    var R = RV(), cur = reviewCurrent(r), open = cur && R.revisionOpen(cur), counts = R.feedbackCounts(r);
    var finTxt = "";
    if (cur && counts.finished) finTxt = "revision " + cur.n + " finished by " + (counts.finished.name || "the reader") + " on " + stamp(new Date(counts.finished.created).toISOString().slice(0, 10));
    else if (cur && counts.finishedEarlier) { var fr = r.revisions.filter(function (x) { return x.id === counts.finishedEarlier.revision; })[0]; finTxt = "revision " + cur.n + " not finished yet" + (fr ? " (revision " + fr.n + " was finished by " + (counts.finishedEarlier.name || "the reader") + ")" : ""); }
    else if (cur) finTxt = "revision " + cur.n + " not finished yet";
    var meta = [r.subtitle, cur ? "revision " + cur.n + " · published " + stamp(cur.publishedAt.slice(0, 10)) : "not published yet", r.cards.length + " pages", counts.total ? counts.open + " open of " + counts.total + " feedback" : "no feedback yet", finTxt, R.hasFrench(r) ? (r.lang === "fr" ? "French first, English available" : "English first, French available") : (r.lang === "fr" ? "French only" : "English only")];
    var side = [quietPill(r.status, r.status === "Published" ? "st-live" : r.status === "Disabled" ? "st-needs-work" : "")];
    if (open) side.push(chipBtn("Copy link", function (e) { e.stopPropagation(); copyReviewLink(cur); }));
    side.push(chipBtn("Open preview", function (e) { e.stopPropagation(); window.open("/review?preview=" + encodeURIComponent(p.id + "/" + r.id), "_blank", "noopener"); }));
    return xrow({ key: "rv:" + r.id, title: r.title || "Untitled review", meta: metaLine(meta), side: side, open: true, details: function (det) {
      var acts = el("div", "rowacts");
      acts.appendChild(chipBtn("Edit draft", function () { editReview(p, r, false); }));
      acts.appendChild(chipBtn(cur ? "Publish new revision" : "Publish", function () { publishReview(p, r); }));
      if (cur) acts.appendChild(chipBtn(cur.disabled ? "Re-enable link" : "Disable link", function () { toggleReviewLink(p, r, cur); }));
      var del = chipBtn("Delete", function () { askConfirm("Delete this review?", "Its feedback goes with it. Published links stop working.", { danger: true, ok: "Delete" }).then(function (y) { if (!y) return; p.reviews = p.reviews.filter(function (x) { return x.id !== r.id; }); touchPilot(p); render(); save(); }); }, "danger");
      acts.appendChild(del);
      det.appendChild(acts);
      if (cur) {
        var share = el("div", "rvshare");
        share.appendChild(el("div", "lab", "Share"));
        var inp = el("input", "rvlink"); inp.readOnly = true; inp.value = reviewLink(cur); inp.onclick = function () { inp.select(); };
        share.appendChild(inp);
        var srow = el("div", "row");
        srow.appendChild(chipBtn("Copy link", function () { copyReviewLink(cur); }));
        var exp = el("div", "fld inline"); exp.appendChild(el("label", null, "Expires")); var ed = txtIn(cur.expires || "", "", function (v) { cur.expires = v; r.updated = Date.now(); touchPilot(p); save(); }, "date"); exp.appendChild(ed); srow.appendChild(exp);
        share.appendChild(srow);
        share.appendChild(el("p", "note", "Anyone who has this link can read this revision. Having the link is not proof that the reader is " + (p.people.filter(function (x) { return x.side === "Client"; })[0] || { name: "the client" }).name + ". Comments carry a self-reported name only. The page is marked noindex and loads no third-party scripts." + (cur.disabled ? " This link is disabled." : cur.expires ? " It expires on " + stamp(cur.expires) + "." : "")));
        det.appendChild(share);
      }
      det.appendChild(el("div", "lab", "Feedback"));
      var fbs = r.feedback.slice().sort(function (a, b) { return b.created - a.created; });
      if (!fbs.length) det.appendChild(emptyNote(cur ? "Nothing yet. Comments and suggested corrections appear here as soon as they are saved." : "Publish and share the link to receive feedback."));
      fbs.forEach(function (fb) { det.appendChild(feedbackRow(p, r, fb)); });
    } });
  }
  function copyReviewLink(rev) {
    var url = reviewLink(rev);
    var done = function () { toast("Link copied. Anyone with it can read this revision."); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { window.prompt("Copy this link", url); });
    else window.prompt("Copy this link", url);
  }
  function toggleReviewLink(p, r, cur) {
    var off = !cur.disabled;
    askConfirm(off ? "Disable this link?" : "Re-enable this link?", off ? "The page shows “This link is no longer active” to anyone who opens it. Feedback already received stays here." : "The same link works again.", { danger: off, ok: off ? "Disable" : "Enable" }).then(function (y) {
      if (!y) return; cur.disabled = off; r.status = off ? "Disabled" : "Published"; r.updated = Date.now(); touchPilot(p); render(); save();
    });
  }
  function publishReview(p, r) {
    if (!r.cards.length) { toast("Add at least one page first.", true); return; }
    var cur = reviewCurrent(r);
    askConfirm(cur ? "Publish revision " + (cur.n + 1) + "?" : "Publish this review?", cur ? "The current link stops working and a new link is created for the new revision. Earlier feedback keeps its quotes; anchors that no longer match are flagged, never moved." : "A fixed copy of the pages is frozen behind a new link. Later edits need a new revision.", { ok: "Publish" }).then(function (y) {
      if (!y) return;
      saveSettled().then(function (ok) { if (!ok) throw new Error("The draft could not be saved yet. Try again in a moment."); return fetch("/api/reviews/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pilot: p.id, review: r.id, who: ME }) }); })
        .then(function (res) { return res.json().then(function (j) { return { ok: res.ok, j: j }; }); })
        .then(function (x) {
          if (!x.ok || !x.j.ok) { toast("Could not publish: " + (x.j.error || "server error"), true); return; }
          /* keep our own copy: add the revision the server made, and take its version number. Anything else written on the
             server meanwhile (feedback, revisions) is unioned back in by the server on the next save. */
          var rv = x.j.state && x.j.state.pilots.filter(function (pp) { return pp.id === p.id; })[0];
          var srv = rv && rv.reviews.filter(function (rr) { return rr.id === r.id; })[0];
          var made = srv && srv.revisions.filter(function (z) { return z.id === x.j.revision.id; })[0];
          if (made) { r.revisions.forEach(function (z) { z.disabled = true; }); r.revisions.push(made); r.status = "Published"; r.updated = Date.now(); touchPilot(p); }
          VERSION = x.j.version;
          render(); toast("Revision " + x.j.revision.n + " published. Copy the link to share it.");
        }).catch(function () { toast("Could not reach the server.", true); });
    });
  }
  function feedbackRow(p, r, fb) {
    var R = RV();
    var row = el("div", "rvfb");
    var head = el("div", "rvfb-head");
    head.appendChild(quietPill(fb.kind === "suggestion" ? "suggested correction" : fb.kind === "finish" ? "finished review" : "comment", fb.kind === "suggestion" ? "st-planned" : fb.kind === "finish" ? "st-live" : ""));
    if (R.hasFrench(r)) head.appendChild(quietPill(R.feedbackLang(r, fb) === "fr" ? "FR" : "EN", "st-planned"));
    var rev = r.revisions.filter(function (x) { return x.id === fb.revision; })[0];
    head.appendChild(el("span", "note", [fb.name || "unnamed", new Date(fb.created).toLocaleString(), rev ? "revision " + rev.n : "", fb.card ? reviewCardTitle(r, fb.card) : ""].filter(Boolean).join(" · ")));
    var anchor = R.anchorStatus(r, fb);
    if (anchor === "changed" || anchor === "card missing" || anchor === "ambiguous") head.appendChild(quietPill(anchor === "changed" ? "passage changed since" : anchor === "ambiguous" ? "passage appears twice" : "page removed", "st-needs-work"));
    if (fb.kind !== "finish") {
      var stateSel = selIn(R.FEEDBACK_STATES, fb.state, function (v) { fb.state = v; r.updated = Date.now(); touchPilot(p); save(); });
      stateSel.className = "selbox"; head.appendChild(stateSel);
    }
    row.appendChild(head);
    if (fb.quote) { var q = el("blockquote", "rvquote", fb.quote); row.appendChild(q); }
    if (fb.suggestion) { var sg = el("div", "rvsug"); sg.appendChild(el("span", "lab", "Proposed wording")); sg.appendChild(el("p", null, fb.suggestion)); row.appendChild(sg); }
    if (fb.text) row.appendChild(el("p", "readtext", fb.text));
    if (fb.applied) row.appendChild(el("p", "note", "Applied to the draft on " + new Date(fb.applied.at).toLocaleString() + "; it reaches the firm with the next revision."));
    if (fb.kind !== "finish") {
      var acts = el("div", "rowacts");
      if (fb.kind === "suggestion" && fb.state !== "Applied" && anchor === "intact") acts.appendChild(chipBtn("Apply to draft", function () {
        askConfirm("Apply this wording to the draft?", "The published revision does not change. The draft page is edited and this correction is marked Applied; publish a new revision when you are ready.", { ok: "Apply" }).then(function (y) {
          if (!y) return; var out = R.applySuggestion(r, fb, Date.now()); if (!out.ok) { toast(out.error, true); return; } touchPilot(p); render(); save(); toast("Draft updated.");
        });
      }));
      var steps = p.steps.slice().sort(function (a, b) { return a.order - b.order; }).map(function (s) { return [s.id, s.title]; });
      var qs = p.questions.filter(function (x) { return x.status !== "Answered"; }).map(function (x) { return [x.id, x.text.slice(0, 80)]; });
      var lk = el("div", "rvlinks");
      var stepSel = selIn([["", "Link to a workflow step…"]].concat(steps), fb.links.step, function (v) { fb.links.step = v; r.updated = Date.now(); touchPilot(p); save(); }); stepSel.className = "selbox"; lk.appendChild(stepSel);
      var qSel = selIn([["", "Link to an open question…"]].concat(qs), fb.links.question, function (v) { fb.links.question = v; r.updated = Date.now(); touchPilot(p); save(); }); qSel.className = "selbox"; lk.appendChild(qSel);
      acts.appendChild(lk);
      row.appendChild(acts);
    }
    return row;
  }
  function newReview(p) {
    var R = RV();
    var r = /cabinet\s*m/i.test(p.name) ? R.cabinetMDraft() : R.emptyReview({ title: p.name, subtitle: "What I understand about your business so far", cards: REVIEW_SECTIONS.map(function (s, i) { return { id: uid(), section: s, title: "", body: "" }; }) });
    p.reviews = p.reviews.concat([r]); touchPilot(p); save();
    editReview(p, r, true);
  }
  function editReview(p, r, isNew) {
    var d = JSON.parse(JSON.stringify(r));
    sideDrawer(isNew ? "Draft the review" : d.title || "Review", function (body, close) {
      body.appendChild(el("p", "note", "Write for the firm, not for us: short pages, one idea each, “my understanding” and “to confirm” where you are not sure. No case names, client details or internal notes. Publishing freezes a copy; edits here need a new revision."));
      var r1 = el("div", "fld two");
      r1.appendChild(fld("Title", txtIn(d.title, "Le Cabinet M", function (v) { d.title = v; })));
      r1.appendChild(fld("Subtitle", txtIn(d.subtitle, "What I understand about your business so far", function (v) { d.subtitle = v; })));
      body.appendChild(r1);
      var r2 = el("div", "fld two");
      r2.appendChild(fld("Prepared by", txtIn(d.author, "", function (v) { d.author = v; })));
      r2.appendChild(fld("Date shown", txtIn(d.date, "", function (v) { d.date = v; }, "date")));
      body.appendChild(r2);
      body.appendChild(fld("Language shown first", selIn([["en", "English"], ["fr", "Français"]], d.lang, function (v) { d.lang = v; }), "The reader can switch to the other language when its text is filled in below. Comments keep the language, page and revision they were written against."));
      body.appendChild(fld("Welcome text", areaIn(d.intro, "Why this exists and how to correct it.", function (v) { d.intro = v; }, 3)));
      body.appendChild(fld("Closing text", areaIn(d.closing, "Shown on the last page above Finish review.", function (v) { d.closing = v; }, 2)));
      var frTop = el("div", "rvfr");
      frTop.appendChild(el("div", "lab", "En français"));
      var rf = el("div", "fld two");
      rf.appendChild(fld("Titre", txtIn(d.titleFr || "", "Le Cabinet M", function (v) { d.titleFr = v; })));
      rf.appendChild(fld("Sous-titre", txtIn(d.subtitleFr || "", "Ce que je comprends de votre cabinet jusqu’ici", function (v) { d.subtitleFr = v; })));
      frTop.appendChild(rf);
      frTop.appendChild(fld("Texte d’accueil", areaIn(d.introFr || "", "", function (v) { d.introFr = v; }, 3)));
      frTop.appendChild(fld("Mot de la fin", areaIn(d.closingFr || "", "", function (v) { d.closingFr = v; }, 2)));
      if (/cabinet\s*m/i.test(p.name)) frTop.appendChild(chipBtn("Fill the French from the approved text", function () { var n = RV().addCabinetMFrench(d); toast(n.length ? "French text added to " + n.length + " fields. Save to keep it." : "French text is already there."); close(); editReview(p, Object.assign(r, d), isNew); }));
      body.appendChild(frTop);
      body.appendChild(el("div", "lab", "Pages"));
      body.appendChild(el("p", "note", "Blank line between blocks. “## ” a subheading, “> ” a callout, “1. ” numbered steps, “- ” bullets, “| left | right |” rows for a two-column comparison (first row is the headings), **bold** and *italic*. Aim for 60 to 160 words a page."));
      var list = el("div", "rvcards");
      function draw() {
        list.innerHTML = "";
        d.cards.forEach(function (c, i) {
          var box = el("div", "rvcard-edit");
          var top = el("div", "row between");
          top.appendChild(el("b", null, "Page " + (i + 1)));
          var mv = el("div", "row");
          mv.appendChild(chipBtn("↑", function () { if (i > 0) { d.cards.splice(i - 1, 0, d.cards.splice(i, 1)[0]); draw(); } }));
          mv.appendChild(chipBtn("↓", function () { if (i < d.cards.length - 1) { d.cards.splice(i + 1, 0, d.cards.splice(i, 1)[0]); draw(); } }));
          mv.appendChild(chipBtn("Remove", function () { d.cards.splice(i, 1); draw(); }, "danger"));
          top.appendChild(mv); box.appendChild(top);
          var rr = el("div", "fld two");
          var secIn = txtIn(c.section, "Section", function (v) { c.section = v; }); secIn.setAttribute("list", "rvsections"); rr.appendChild(fld("Section", secIn));
          rr.appendChild(fld("Page title", txtIn(c.title, "", function (v) { c.title = v; })));
          box.appendChild(rr);
          var r3 = el("div", "fld two");
          r3.appendChild(fld("Composition", selIn([["article", "Reading column"], ["visual", "Visual left, text right"], ["visual-right", "Text left, visual right"]], c.layout || "article", function (v) { c.layout = v; })));
          var vis = [["", "None"], ["1", "Visual 1 · pink to blue"], ["2", "Visual 2 · peach to lilac"], ["3", "Visual 3 · sky to rose"], ["4", "Visual 4 · gold to blue"], ["5", "Visual 5 · violet to mint"], ["6", "Visual 6 · mint to violet"]];
          r3.appendChild(fld((c.layout || "article") === "article" ? "Figure beside the last block" : "Visual", selIn(vis, (c.layout || "article") === "article" ? (c.figure || "") : (c.visual || ""), function (v) { if ((c.layout || "article") === "article") c.figure = v; else c.visual = v; })));
          box.appendChild(r3);
          var words = c.body.split(/\s+/).filter(Boolean).length;
          var wc = el("span", "note", words + " words");
          box.appendChild(fld("Text", areaIn(c.body, "", function (v) { c.body = v; wc.textContent = v.split(/\s+/).filter(Boolean).length + " words"; }, 9)));
          box.appendChild(wc);
          var frBox = el("div", "rvfr");
          frBox.appendChild(el("div", "lab", "En français" + ((c.bodyFr || "").trim() ? "" : " · not written yet")));
          var rfr = el("div", "fld two");
          rfr.appendChild(fld("Section", txtIn(c.sectionFr || "", "", function (v) { c.sectionFr = v; })));
          rfr.appendChild(fld("Titre de la page", txtIn(c.titleFr || "", "", function (v) { c.titleFr = v; })));
          frBox.appendChild(rfr);
          frBox.appendChild(fld("Texte", areaIn(c.bodyFr || "", "Same markup as the English text.", function (v) { c.bodyFr = v; }, 7)));
          box.appendChild(frBox);
          list.appendChild(box);
        });
      }
      draw();
      var dl = el("datalist"); dl.id = "rvsections"; REVIEW_SECTIONS.forEach(function (s) { var o = el("option"); o.value = s; dl.appendChild(o); }); body.appendChild(dl);
      body.appendChild(list);
      body.appendChild(chipBtn("+ Page", function () { d.cards.push({ id: uid(), section: d.cards.length ? d.cards[d.cards.length - 1].section : REVIEW_SECTIONS[0], title: "", body: "" }); draw(); }));
      body.appendChild(drawerActs(function () {
        d.title = d.title.trim(); d.updated = Date.now();
        d.cards = d.cards.filter(function (c) { return c.title.trim() || c.body.trim(); });
        Object.assign(r, d); touchPilot(p); close(); render(); save();
      }, close));
    }, { eyebrow: "CLIENT REVIEW", wide: true });
  }
  function renderProblems(body, p) {
    var list = problemsOf(p);
    var filt = ui.probFilter || "";
    var shown = list.filter(function (pr) { return !filt || pr.status === filt; });
    var sec = secHead("Customer problems", list.length || null, "What the firm struggles with, framed from evidence: trigger, pain, who, workaround, consequence, what is at stake, and what better looks like. Not what they asked for (that is Requests) and not what we decide to build (that is Decisions).", [primaryBtn("+ Customer problem", function () { var pr = PB.empty(); pr.id = uid(); pr.created = pr.updated = Date.now(); pr.owner = ME; editProblem(p, pr, true); })]);
    var chips = el("div", "psubs mini wrap");
    [["", "All"]].concat(PB.STATUS.map(function (st) { return [st, st]; })).forEach(function (m) {
      var n = m[0] ? list.filter(function (x) { return x.status === m[0]; }).length : list.length;
      if (m[0] && !n) return;
      var b = el("button", null, m[1]); if (n) b.appendChild(el("em", null, String(n)));
      b.setAttribute("aria-pressed", String(filt === m[0])); b.onclick = function () { ui.probFilter = m[0]; renderView(); }; chips.appendChild(b);
    });
    if (list.length) sec.insertBefore(chips, sec.children[1]);
    if (!list.length) sec.appendChild(emptyNote("No customer problems framed yet. Start from evidence: open an Inbox item or a request and choose “Frame as customer problem”, or add one here and attach the quotes behind it. A problem is what hurts them and what is at stake, in their words, before anyone talks about features."));
    else if (!shown.length) sec.appendChild(emptyNote("Nothing with that status."));
    shown.forEach(function (pr) {
      var c = PB.completeness(pr);
      var titleNode = el("span"); titleNode.appendChild(document.createTextNode(pr.title || "Untitled problem"));
      var side = [quietPill(pr.status, PROBLEM_CLASS[pr.status])];
      sec.appendChild(xrow({ key: "pb:" + pr.id, title: titleNode,
        meta: metaLine([pr.frame.role ? pr.frame.role : "role not set", pr.frame.consequence ? pr.frame.consequence.slice(0, 70) : "consequence not set", c.done + " of " + c.total + " framed", pr.routing.validation.next ? "next: " + pr.routing.validation.next.slice(0, 50) : "no next validation", pr.confidence ? "confidence " + pr.confidence.toLowerCase() : ""]),
        side: side,
        details: function (det) {
          if (pr.statement) { det.appendChild(el("div", "lab", "Specific problem")); var st = el("p", "readtext", pr.statement); det.appendChild(st); if (pr.statementDraft) det.appendChild(quietPill("draft synthesis · not client evidence", "st-feature-flag")); }
          if (c.gaps.length) { det.appendChild(el("div", "lab", "Gaps")); det.appendChild(el("p", "readtext muted", c.gaps.map(function (k) { return PB.FRAME.filter(function (s) { return s.key === k; })[0].label; }).join(" · "))); }
          det.appendChild(el("div", "lab", "Evidence"));
          var ev = (pr.evidence || []).map(function (id) { return p.evidence.filter(function (e) { return e.id === id; })[0]; }).filter(Boolean);
          if (!ev.length) det.appendChild(emptyNote("No evidence attached yet. Attach the quotes or observations behind it."));
          ev.forEach(function (e) { det.appendChild(evidenceRow(p, e, true)); });
          det.appendChild(problemChain(p, pr));
          det.appendChild(drivePushRow("problem", pr, p, "drive"));
          var acts = el("div", "rowacts");
          acts.appendChild(chipBtn("Open", function () { editProblem(p, pr, false); }));
          if (c.gaps.length) acts.appendChild(chipBtn("Add gaps to next session", function () { askGapsSession(p, pr); }));
          det.appendChild(acts);
        } }));
    });
    body.appendChild(sec);
  }

  /* ---------- the drawer: fields on the left, the framing diagram on the right ---------- */
  function editProblem(p, pr, isNew) {
    var d = JSON.parse(JSON.stringify(pr));
    var dirtyLocal = false;
    var diagram, gapsBox, stmtBox, stmtDraftPill;
    function touchD() { dirtyLocal = true; paintDiagram(); paintGaps(); paintDirty(); }
    var dirtyNote;
    function paintDirty() { if (dirtyNote) { dirtyNote.textContent = dirtyLocal ? "Unsaved changes" : ""; dirtyNote.hidden = !dirtyLocal; } }
    sideDrawer(isNew ? "New customer problem" : (d.title || "Customer problem"), function (body, close) {
      var split = el("div", "pdsplit");
      var main = el("div", "pdmain"), aside = el("div", "pdside");
      /* head */
      var titleIn = txtIn(d.title, "In their words, the complaint as it first came up", function (v) { d.title = v; touchD(); }); titleIn.id = "pf-title";
      main.appendChild(fld("Broad complaint", titleIn));
      var r0 = el("div", "fld three");
      r0.appendChild(fld("Status", selIn(PB.STATUS, d.status, function (v) { d.status = v; touchD(); })));
      r0.appendChild(fld("Confidence", selIn(PB.CONFIDENCE.map(function (c) { return [c, c || "Not set"]; }), d.confidence, function (v) { d.confidence = v; touchD(); })));
      r0.appendChild(fld("Owner", txtIn(d.owner, "Uzziel", function (v) { d.owner = v; touchD(); })));
      main.appendChild(r0);
      /* framing steps */
      main.appendChild(el("div", "lab", "Framing"));
      PB.FRAME.forEach(function (st) {
        var w = el("div", "pfield"); w.id = "pfw-" + st.key;
        var lab = el("div", "pflab");
        lab.appendChild(el("i", "stepn", String(st.n)));
        lab.appendChild(el("b", null, st.label));
        var help = el("button", "pfhelp", "?"); help.type = "button"; help.title = "Questions to ask"; help.setAttribute("aria-label", "Questions to ask about " + st.label); help.setAttribute("aria-expanded", "false");
        lab.appendChild(help);
        w.appendChild(lab);
        w.appendChild(el("div", "pfprompt", st.prompt));
        var qs = el("ul", "pfq"); qs.hidden = true; st.questions.forEach(function (q) { qs.appendChild(el("li", null, q)); }); w.appendChild(qs);
        help.onclick = function () { qs.hidden = !qs.hidden; help.setAttribute("aria-expanded", String(!qs.hidden)); };
        var ta = areaIn(d.frame[st.key], "", function (v) { d.frame[st.key] = v; touchD(); }, 2); ta.id = "pf-" + st.key; ta.setAttribute("aria-label", st.label);
        w.appendChild(ta);
        var pv = el("div", "pfprov");
        pv.appendChild(el("span", null, "Provenance"));
        pv.appendChild(selIn(PB.PROVENANCE.map(function (x) { return [x, x || "Not set"]; }), d.provenance[st.key], function (v) { d.provenance[st.key] = v; touchD(); }));
        w.appendChild(pv);
        main.appendChild(w);
      });
      /* specific problem */
      var sp = el("div", "pfield"); sp.id = "pfw-statement";
      var slab = el("div", "pflab"); slab.appendChild(el("b", null, "Specific problem"));
      stmtDraftPill = quietPill(d.statementDraft ? "draft synthesis" : "reviewed", d.statementDraft ? "st-feature-flag" : "st-live"); slab.appendChild(stmtDraftPill);
      sp.appendChild(slab);
      sp.appendChild(el("div", "pfprompt", "Two or three sentences made only from the fields above. It is a synthesis, not something the client said; it stays Draft until you review it."));
      stmtBox = areaIn(d.statement, "", function (v) { d.statement = v; touchD(); }, 4); stmtBox.id = "pf-statement"; stmtBox.setAttribute("aria-label", "Specific problem");
      sp.appendChild(stmtBox);
      var srow = el("div", "rowacts");
      srow.appendChild(chipBtn("Generate draft from the fields", function () { var t = PB.synthesize(d); if (!t) { toast("Fill some framing fields first.", true); return; } d.statement = t; d.statementDraft = true; d.statementAt = Date.now(); stmtBox.value = t; stmtDraftPill.textContent = "draft synthesis"; stmtDraftPill.className = "pill quiet st-feature-flag"; touchD(); }));
      var rev = el("label", "chk"); var cb = el("input"); cb.type = "checkbox"; cb.checked = !d.statementDraft; cb.onchange = function () { d.statementDraft = !cb.checked; stmtDraftPill.textContent = d.statementDraft ? "draft synthesis" : "reviewed"; stmtDraftPill.className = "pill quiet " + (d.statementDraft ? "st-feature-flag" : "st-live"); touchD(); }; rev.appendChild(cb); rev.appendChild(document.createTextNode(" I reviewed this statement"));
      srow.appendChild(rev);
      sp.appendChild(srow);
      main.appendChild(sp);
      /* gaps */
      gapsBox = el("div", "pgaps"); main.appendChild(gapsBox);
      /* links */
      var linksFold = foldSection("Links", "pb:links:" + d.id, true);
      linksFold.body.appendChild(fld("Session", selIn([["", "None"]].concat(p.sessions.slice().sort(byDateDesc).map(function (s) { return [s.id, sessionLabel(p, s.id)]; })), d.session, function (v) { d.session = v; touchD(); })));
      linksFold.body.appendChild(multiLink("Evidence", p.evidence.map(function (e) { return [e.id, (e.kind || "") + ": " + e.text.slice(0, 70)]; }), d.evidence, function () { touchD(); }));
      linksFold.body.appendChild(multiLink("Workflow steps", p.steps.map(function (s) { return [s.id, s.title]; }), d.steps, function () { touchD(); }));
      linksFold.body.appendChild(multiLink("Requests (what they explicitly asked for)", p.requests.map(function (r) { return [r.id, r.title]; }), d.requests, function () { touchD(); }));
      linksFold.body.appendChild(multiLink("Artifacts and prototypes", p.artifacts.map(function (a) { return [a.id, a.title]; }), d.artifacts, function () { touchD(); }));
      var frow = el("div", "fld"); frow.appendChild(el("label", null, "Feature"));
      var fb = el("button", "btn ghost small", d.feature && feature(d.feature) ? feature(d.feature).name : "Pick a feature");
      fb.onclick = function () { pickFeature("Link to a feature", []).then(function (f) { if (f) { d.feature = f.id; fb.textContent = f.name; touchD(); } }); };
      frow.appendChild(fb);
      if (d.feature) { var clr = el("button", "chip", "Clear"); clr.onclick = function () { d.feature = ""; fb.textContent = "Pick a feature"; touchD(); }; frow.appendChild(clr); }
      linksFold.body.appendChild(frow);
      linksFold.body.appendChild(fld("Product decision", selIn([["", "None"]].concat(decisions().filter(function (x) { return !x.pilot || x.pilot === p.id; }).map(function (x) { return [x.id, x.title + " · " + x.state]; })), d.decision, function (v) { d.decision = v; touchD(); }), "The cofounder-aligned gate. Linking it here does not decide anything."));
      main.appendChild(linksFold.node);
      /* routing, behind a fold */
      var ro = d.routing;
      var routeFold = foldSection("Solution routing", "pb:route:" + d.id, false, "After the problem is framed. Human-only or no product change is a valid outcome; nothing here is a recommendation.");
      routeFold.body.appendChild(fld("Workflow: work happening today", areaIn(ro.workflow, "", function (v) { ro.workflow = v; touchD(); }, 2)));
      routeFold.body.appendChild(fld("Desired output: what ALIE should return, change, complete or deliver", areaIn(ro.output, "", function (v) { ro.output = v; touchD(); }, 2)));
      routeFold.body.appendChild(fld("Primary ALIE surface", selIn(PB.SURFACES.map(function (x) { return [x, x || "Not set"]; }), ro.surface, function (v) { ro.surface = v; touchD(); })));
      var capw = el("div", "fld"); capw.appendChild(el("label", null, "Required capabilities"));
      var caps = el("div", "capgrid");
      PB.CAPABILITIES.forEach(function (c) { var l = el("label", "chk"); var i = el("input"); i.type = "checkbox"; i.checked = ro.capabilities.indexOf(c) !== -1; i.onchange = function () { if (i.checked) { if (ro.capabilities.indexOf(c) === -1) ro.capabilities.push(c); } else ro.capabilities = ro.capabilities.filter(function (x) { return x !== c; }); touchD(); }; l.appendChild(i); l.appendChild(document.createTextNode(" " + c)); caps.appendChild(l); });
      capw.appendChild(caps); routeFold.body.appendChild(capw);
      routeFold.body.appendChild(fld("Ownership", txtIn(ro.ownership, "Who owns the outcome on our side and on theirs", function (v) { ro.ownership = v; touchD(); })));
      var operFold = foldSection("Operating model", "pb:oper:" + d.id, false);
      PB.OPERATING.forEach(function (o) { operFold.body.appendChild(fld(o[1], txtIn(ro.operating[o[0]], "", function (v) { ro.operating[o[0]] = v; touchD(); }))); });
      routeFold.body.appendChild(operFold.node);
      var valw = el("div", "fld"); valw.appendChild(el("label", null, "Validation path"));
      valw.appendChild(el("div", "vpath", "Prototype → Review → Test with users → Refine → Confirm fit before scaling"));
      routeFold.body.appendChild(valw);
      routeFold.body.appendChild(fld("Stage", selIn(PB.VALIDATION_STAGES.map(function (x) { return [x, x || "Not started"]; }), ro.validation.stage, function (v) { ro.validation.stage = v; touchD(); })));
      routeFold.body.appendChild(fld("Next test", txtIn(ro.validation.next, "What we show or try next, with whom", function (v) { ro.validation.next = v; touchD(); })));
      routeFold.body.appendChild(fld("Evidence needed", txtIn(ro.validation.evidence, "What would confirm or refute it", function (v) { ro.validation.evidence = v; touchD(); })));
      main.appendChild(routeFold.node);
      if (!isNew) main.appendChild(drivePushRow("problem", pr, p, "drive"));
      /* actions */
      dirtyNote = el("span", "note edirty"); dirtyNote.hidden = true;
      var extra = [dirtyNote];
      if (!isNew) { var del = el("button", "btn ghost danger", "Delete"); del.onclick = function () { askConfirm("Delete this customer problem?", "Evidence, requests and decisions stay.", { danger: true, ok: "Delete" }).then(function (y) { if (!y) return; p.problems = problemsOf(p).filter(function (x) { return x.id !== pr.id; }); p.questions.forEach(function (q) { if (q.problem === pr.id) { q.problem = ""; q.frameField = ""; } }); touchPilot(p); close(); render(); save(); }); }; extra.push(del); }
      var acts = drawerActs(function () {
        if (!d.title.trim()) { toast("Give it the broad complaint first.", true); return; }
        d.title = d.title.trim(); d.updated = Date.now();
        if (isNew) problemsOf(p).push(d); else Object.assign(pr, d);
        touchPilot(p); dirtyLocal = false; close(); render(); save();
      }, function () { if (dirtyLocal) askConfirm("Discard unsaved changes?", "", { danger: true, ok: "Discard" }).then(function (y) { if (y) close(); }); else close(); }, extra);
      main.appendChild(acts);
      /* diagram */
      diagram = el("div", "pdiag");
      aside.appendChild(el("div", "lab", "Framing map"));
      aside.appendChild(diagram);
      aside.appendChild(el("p", "note", "Click a step to jump to its field. Filled steps are solid; gaps are hollow."));
      split.appendChild(main); split.appendChild(aside);
      body.appendChild(split);
      paintDiagram(); paintGaps();
    }, { eyebrow: "CUSTOMER PROBLEM", wide: true, cls: "pdrawer" });
    function focusField(key) {
      var w = document.getElementById("pfw-" + key), ta = document.getElementById("pf-" + key);
      if (w) w.scrollIntoView({ behavior: "smooth", block: "center" });
      if (ta) setTimeout(function () { ta.focus(); }, 250);
    }
    function paintDiagram() {
      if (!diagram) return;
      diagram.innerHTML = "";
      var c = PB.completeness(d);
      function node(label, done, key, n, cls) {
        var b = el("button", "pnode" + (done ? " done" : " gap") + (cls ? " " + cls : "")); b.type = "button";
        if (n) b.appendChild(el("i", null, String(n)));
        b.appendChild(el("span", null, label));
        b.title = done ? "Filled" : "Not yet framed";
        b.onclick = function () { focusField(key); };
        diagram.appendChild(b);
      }
      node("Broad complaint", !!d.title.trim(), "title", "", "cap");
      PB.FRAME.forEach(function (st) { diagram.appendChild(el("i", "parrow", "↓")); node(st.label, c.gaps.indexOf(st.key) === -1, st.key, st.n, ""); });
      diagram.appendChild(el("i", "parrow", "↓"));
      node("Specific problem", !!d.statement.trim(), "statement", "", "cap" + (d.statement.trim() && !d.statementDraft ? " reviewed" : ""));
    }
    function paintGaps() {
      if (!gapsBox) return;
      gapsBox.innerHTML = "";
      var gaps = PB.gapQuestions(d);
      if (!gaps.length) { gapsBox.appendChild(el("p", "note", "Every step is framed.")); return; }
      var h = el("div", "lab", "Gaps · " + gaps.length + " to ask"); gapsBox.appendChild(h);
      gaps.forEach(function (g) { var r = el("button", "gaprow"); r.type = "button"; r.appendChild(el("b", null, g.label)); r.appendChild(el("span", null, g.text)); r.onclick = function () { focusField(g.field); }; gapsBox.appendChild(r); });
      if (!isNew) { var b = chipBtn("Add gaps to next session", function () { askGapsSession(p, pr); }); b.classList.add("gapbtn"); gapsBox.appendChild(b); }
      else gapsBox.appendChild(el("p", "note", "Save first to add these gaps to a planned session."));
    }
  }
  function foldSection(title, key, dflt, hint) {
    var node = el("div", "pfold");
    node.dataset.fold = key;
    var head = el("button", "pfoldhead"); head.type = "button";
    head.appendChild(el("span", "fchev", "›")); head.appendChild(el("b", null, title));
    head.setAttribute("aria-expanded", String(foldOpen(key, dflt)));
    node.appendChild(head);
    var body = el("div", "pfoldbody");
    if (hint) body.appendChild(el("p", "note", hint));
    node.appendChild(body);
    if (foldOpen(key, dflt)) node.classList.add("open");
    head.onclick = function () { var o = !node.classList.contains("open"); node.classList.toggle("open", o); foldSet(key, o); head.setAttribute("aria-expanded", String(o)); };
    return { node: node, body: body };
  }
  function multiLink(label, options, arr, onChange) {
    var w = el("div", "fld"); w.appendChild(el("label", null, label));
    var chosen = el("div", "linklist");
    var byId = {}; options.forEach(function (o) { byId[o[0]] = o[1]; });
    function draw() { chosen.innerHTML = ""; arr.forEach(function (id) { if (!byId[id]) return; var c = el("button", "chip", byId[id]); c.type = "button"; c.title = "Remove"; c.onclick = function () { var i = arr.indexOf(id); if (i !== -1) arr.splice(i, 1); draw(); onChange(); }; chosen.appendChild(c); }); }
    draw(); w.appendChild(chosen);
    var sel = selIn([["", options.length ? "Attach…" : "Nothing to attach"]].concat(options.filter(function (o) { return arr.indexOf(o[0]) === -1; })), "", function (v) { if (v && arr.indexOf(v) === -1) { arr.push(v); draw(); onChange(); } sel.value = ""; });
    w.appendChild(sel);
    return w;
  }
  function frameFromEvidence(p, e) {
    var pr = PB.fromEvidence(e, uid, Date.now()); pr.owner = ME;
    editProblem(p, pr, true);
  }
  function frameFromRequest(p, r) {
    var pr = PB.fromRequest(r, uid, Date.now()); pr.owner = ME;
    editProblem(p, pr, true);
  }
  function problemChip(p, id) {
    var pr = problemById(p, id); if (!pr) return null;
    var b = el("button", "chip", "Problem: " + pr.title.slice(0, 50) + " · " + pr.status); b.type = "button";
    b.onclick = function () { editProblem(p, pr, false); };
    return b;
  }
  /* feature page: which pilots care about this feature */
  function pilotsPanel(f) {
    var list = pilotsFor(f);
    var dl = pilotDeliverablesFor(f);
    var rq = requestsFor(f);
    var p = el("div", "panel");
    p.style.marginTop = "18px";
    p.appendChild(el("h3", null, "Pilots"));
    rq.forEach(function (x) {
      var r0 = el("div", "fl");
      var b0 = el("button", null, x.pilot.name + " · from their request “" + x.r.title + "”");
      b0.onclick = function () { ui.view = "pilots"; ui.pilot = x.pilot.id; ui.pilotTab = "requests"; ui.feature = null; render(); };
      r0.appendChild(b0);
      p.appendChild(r0);
    });
    dl.forEach(function (x) {
      var r = el("div", "fl");
      var b = el("button", null, x.pilot.name + " · delivers “" + x.d.title + "”");
      b.onclick = function () { ui.view = "pilots"; ui.pilot = x.pilot.id; ui.pilotTab = "deliverables"; ui.feature = null; render(); };
      r.appendChild(b);
      if (x.d.tag) r.appendChild(pill(x.d.tag, DELIV_TAG_CLASS[x.d.tag]));
      p.appendChild(r);
    });
    if (!list.length && !dl.length && !rq.length) { p.appendChild(el("div", "note", "No pilot has asked for this yet.")); return p; }
    list.forEach(function (pl) {
      var r = el("div", "fl");
      var b = el("button", null, pl.name + ((pl.wants || []).indexOf(f.id) !== -1 ? " · asked for it" : " · we think they need it"));
      b.onclick = function () { ui.view = "pilots"; ui.pilot = pl.id; ui.feature = null; render(); };
      r.appendChild(b);
      r.appendChild(pilotStatusPill(pl));
      p.appendChild(r);
    });
    return p;
  }

  /* --- deliverables: what the pilot needs delivered, which features provide it, and in what order to build --- */
  var DELIV_TAGS = ["", "Quick win", "Big bet", "Later", "Blocked"];
  var DELIV_TAG_CLASS = { "Quick win": "st-live", "Big bet": "st-building", "Later": "st-planned", "Blocked": "st-needs-work" };
  function delivFeats(d) { return (d.features || []).map(feature).filter(Boolean); }
  function delivProgress(d) {
    var fs = delivFeats(d);
    if (!fs.length) return null;
    var live = fs.filter(function (f) { return f.state === "Live" || f.state === "Needs work" || f.state === "Feature flag"; }).length;
    return { live: live, total: fs.length };
  }
  function pilotDeliverablesFor(f) {
    var out = [];
    pilots().forEach(function (p) { (p.deliverables || []).forEach(function (d) { if ((d.features || []).indexOf(f.id) !== -1) out.push({ pilot: p, d: d }); }); });
    return out;
  }
  function touchPilot(p) { p.updated = Date.now(); }

  /* --- requests: what a pilot asked for, in their words, before it is (or is not) a feature --- */
  var REQ_FIT = ["", "Core to ALIE", "Adjacent", "Out of scope"];
  var REQ_DECISION = ["Undecided", "Build", "Integrate or partner", "Later", "Declined"];
  var REQ_DECISION_CLASS = { "Undecided": "", "Build": "st-live", "Integrate or partner": "st-building", "Later": "st-planned", "Declined": "st-needs-work" };
  function allRequests() {
    var out = [];
    pilots().forEach(function (p) { (p.requests || []).forEach(function (r) { out.push({ pilot: p, r: r }); }); });
    return out;
  }
  function requestsFor(f) { return allRequests().filter(function (x) { return x.r.feature === f.id; }); }

  /* --- software and partners: what the pilot uses today and who they work with --- */
  var STACK_KINDS = ["Software", "Partner"];
  var STACK_CATS = ["Case or practice management", "Document management", "Email and calendar", "Accounting and billing", "Dictation and transcription", "Scanning and OCR", "Legal research", "Medical records", "Client portal or e-signature", "Marketing firm", "IT firm", "Accounting firm", "Legal or compliance", "Other"];
  function renderPilotStack(host, p) {
    var pad = el("div", "pad");
    var dir = el("div", "dir");
    var list = p.stack || [];
    var sw = list.filter(function (x) { return x.kind === "Software"; }).length, pt = list.length - sw;
    var intro = el("div", "dsum");
    intro.appendChild(el("b", null, list.length ? sw + (sw === 1 ? " software" : " softwares") + " · " + pt + (pt === 1 ? " partner" : " partners") : "Nothing documented yet"));
    intro.appendChild(el("span", "note", "What they use today and who they work with: case management, email, accounting, dictation, and the marketing, IT or accounting firms around them. How they use each one is the part worth writing."));
    intro.appendChild(foldAllButtons(pad));
    dir.appendChild(intro);

    function section(kind, title, hint) {
      var items = list.filter(function (x) { return x.kind === kind; });
      var sec = el("div", "dirsec");
      var h = el("h2", null, title);
      h.appendChild(el("em", null, String(items.length)));
      sec.appendChild(h);
      sec.appendChild(el("div", "note", hint));
      var grid = el("div", "stackgrid");
      if (!items.length) grid.appendChild(el("div", "note empty2", "None yet."));
      items.forEach(function (x) {
        var card = el("div", "stackcard");
        var head = el("div", "dhead");
        var title = el("input", "dtitle");
        title.value = x.name; title.placeholder = kind === "Software" ? "Product name" : "Firm name";
        title.setAttribute("aria-label", "Name");
        title.onchange = function () { x.name = title.value.trim() || "Untitled"; x.updated = Date.now(); touchPilot(p); save(); };
        head.appendChild(title);
        if (x.category) head.appendChild(el("span", "fsum", x.category));
        var del = el("button", "dmove del", "×"); del.title = "Remove";
        del.onclick = function () {
          askConfirm("Remove “" + x.name + "”?", "", { danger: true, ok: "Remove" }).then(function (yes) {
            if (!yes) return;
            p.stack = list.filter(function (y) { return y.id !== x.id; }); touchPilot(p); render(); save();
          });
        };
        head.appendChild(del);
        card.appendChild(head);
        var meta = el("div", "reqmeta");
        var cat = el("span", "reqfit");
        cat.appendChild(el("label", null, "Category"));
        cat.appendChild(selectOf([["", "Pick one"]].concat(STACK_CATS.map(function (c) { return [c, c]; })), x.category || "", function (v) { x.category = v; x.updated = Date.now(); touchPilot(p); save(); }, "Category"));
        meta.appendChild(cat);
        var lk = el("span", "reqsrc");
        lk.appendChild(el("label", null, kind === "Software" ? "Link" : "Contact"));
        var lin = el("input"); lin.value = x.link || ""; lin.placeholder = kind === "Software" ? "Website or login page" : "Name, email, phone";
        lin.setAttribute("aria-label", kind === "Software" ? "Link" : "Contact");
        lin.onchange = function () { x.link = lin.value.trim(); x.updated = Date.now(); touchPilot(p); save(); render(); };
        lk.appendChild(lin);
        if (/^https?:\/\//.test(x.link || "")) { var go = el("a", "chip", "Open"); go.href = x.link; go.target = "_blank"; go.rel = "noopener"; lk.appendChild(go); }
        meta.appendChild(lk);
        card.appendChild(meta);
        var use = el("div", "reqsec");
        use.appendChild(el("div", "lab", kind === "Software" ? "How they use it" : "What they do for them"));
        use.appendChild(richEditor(x.usage, function (h) { x.usage = h; x.updated = Date.now(); touchPilot(p); save(); }, kind === "Software" ? "Who uses it, for what, how often, what it costs, what they like and hate about it." : "Scope, cadence, cost, who the contact is, how happy they are.", "small dnote"));
        card.appendChild(use);
        foldable(card, "s:" + x.id, true, ".dhead", [x.category, peekText(x.usage, kind === "Software" ? "How they use it is not written yet" : "What they do for them is not written yet")].filter(Boolean).join(" · "));
        grid.appendChild(card);
      });
      sec.appendChild(grid);
      var add = el("button", "btn ghost rowbtn", kind === "Software" ? "+ Add a software" : "+ Add a partner");
      add.style.marginTop = "12px";
      add.onclick = function () {
        askText(kind === "Software" ? "Which software?" : "Which firm?", { placeholder: kind === "Software" ? "For example: Juris Évolution, Outlook, Dragon" : "For example: their marketing agency, IT provider, accountant", ok: "Add" }).then(function (n) {
          if (!n) return;
          p.stack = (p.stack || []).concat([{ id: uid(), name: n, kind: kind, category: "", usage: "", link: "", created: Date.now(), updated: Date.now() }]);
          touchPilot(p); render(); save();
        });
      };
      sec.appendChild(add);
      return sec;
    }
    dir.appendChild(section("Software", "Software they use", "Every tool in their day: case management, email and calendar, accounting, dictation, scanning, research."));
    var ps = section("Partner", "Firms and partners", "Marketing, IT, accounting, legal or anyone else they rely on outside the firm.");
    ps.style.marginTop = "36px";
    dir.appendChild(ps);
    pad.appendChild(dir);
    host.appendChild(pad);
  }

  /* --- directory style: square icon, name, one-line description, like a plugin marketplace --- */
  var SEARCH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
  function dirIcon(f, cls) {
    var d = el("div", "diricon" + (cls ? " " + cls : ""));
    if (f.image) {
      var img = document.createElement("img");
      img.src = f.image; img.alt = ""; img.loading = "lazy";
      img.onerror = function () { img.remove(); d.innerHTML = dirSvg(f); };
      d.appendChild(img);
      return d;
    }
    d.innerHTML = dirSvg(f);
    return d;
  }
  function dirSvg(f) {
    return '<svg viewBox="0 0 160 104" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (THUMB_SVG[thumbKind(f)] || THUMB_SVG.spark) + "</svg>";
  }
  function dirSearch(value, placeholder, onInput) {
    var w = el("div", "dirsearch");
    w.innerHTML = SEARCH_SVG;
    var inp = el("input");
    inp.type = "search";
    inp.placeholder = placeholder;
    inp.value = value || "";
    inp.setAttribute("aria-label", placeholder);
    inp.oninput = function () { onInput(inp.value); };
    w.appendChild(inp);
    return w;
  }
  function refocusDirSearch() {
    var again = document.querySelector(".dirsearch input");
    if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
  }
  /* sub-functionality card, directory style: icon, name, two-line description, state badge at the right */
  var SHIPPED_GLYPH = { "Live": 1, "Needs work": 1, "Feature flag": 1 };
  function subCard(k, o) {
    o = o || {};
    var c = el("div", "subcard " + stateClass(k.state));
    c.id = "card-" + k.id;
    c.setAttribute("role", "button");
    c.tabIndex = 0;
    var ic = dirIcon(k);
    if (k.image && o.lightbox) { ic.classList.add("clickable"); ic.title = "Preview"; ic.onclick = function (e) { e.stopPropagation(); lightbox(k, o.siblings || [k]); }; }
    c.appendChild(ic);
    var t = el("div", "t");
    var b = el("b", null, k.name);
    if (k.owner && k.owner !== "Unassigned") b.appendChild(el("span", "own", k.owner));
    t.appendChild(b);
    t.appendChild(el("span", "d", plain(k.note) || "No description yet."));
    c.appendChild(t);
    var right = el("div", "right");
    var g = el("span", "subst" + (SHIPPED_GLYPH[k.state] ? " done" : ""));
    if (SHIPPED_GLYPH[k.state]) g.textContent = "✓"; else g.appendChild(el("i", "sd " + stateClass(k.state)));
    g.title = k.state;
    right.appendChild(g);
    right.appendChild(el("small", null, k.state));
    c.appendChild(right);
    if (o.trash) { var tr = el("span", "trash"); tr.appendChild(trashBtn(k)); c.appendChild(tr); }
    c.title = k.name + " · " + k.state + (k.period ? " · " + periodShort(k) : "");
    c.onclick = function () { (o.onOpen || open)(k); };
    c.onkeydown = function (e) { if (e.key === "Enter") { (o.onOpen || open)(k); } };
    if (o.drag) { c.draggable = true; c.dataset.id = k.id; wireDrag(c, k, null); }
    return c;
  }
  function subAddCard(parentF, label) {
    var a = el("button", "subcard add");
    a.appendChild(el("span", null, label || "+ Add a sub-functionality"));
    a.onclick = function () { create(parentF.spaces.slice(), { parent: parentF.id, name: "New sub-feature", sections: parentF.sections ? JSON.parse(JSON.stringify(parentF.sections)) : {} }); };
    return a;
  }

  /* one row: icon, name with state dot, description, chevron; sub-features as a "See …" line */
  function dirRow(f, onOpen, showSubs) {
    var r = el("button", "dirrow");
    r.appendChild(dirIcon(f));
    var t = el("div", "t");
    var b = el("b");
    b.appendChild(document.createTextNode(f.name));
    var sd = el("i", "sd " + stateClass(f.state));
    sd.title = f.state;
    b.appendChild(sd);
    t.appendChild(b);
    t.appendChild(el("span", "d", plain(f.note) || "No description yet."));
    if (showSubs) {
      var kids = subsOf(f);
      if (kids.length) {
        var more = el("div", "dirmore");
        var stack = el("div", "stack");
        kids.slice(0, 3).forEach(function (k) { var m = el("div", "diricon mini"); m.innerHTML = dirSvg(k); stack.appendChild(m); });
        more.appendChild(stack);
        var names = kids.slice(0, 3).map(function (k) { return k.name; });
        var rest = kids.length - names.length;
        more.appendChild(el("span", null, "See " + names.join(", ") + (rest > 0 ? " and " + rest + " more" : "")));
        t.appendChild(more);
      }
    }
    r.appendChild(t);
    r.appendChild(el("span", "act", "›"));
    r.title = f.name + " · " + f.state + (f.owner && f.owner !== "Unassigned" ? " · " + f.owner : "");
    r.onclick = function () { onOpen(f); };
    return r;
  }
  function dirSection(title, count, rows) {
    var sec = el("div", "dirsec");
    var h = el("h2", null, title);
    if (count !== undefined) h.appendChild(el("em", null, String(count)));
    sec.appendChild(h);
    var grid = el("div", "dirgrid");
    rows.forEach(function (r) { grid.appendChild(r); });
    sec.appendChild(grid);
    return sec;
  }

  /* space page as a directory: search, then one section per division */
  function renderSpaceDirectory(host, sp) {
    var pad = el("div", "pad");
    var dir = el("div", "dir");
    var q = (ui.subq || "").trim().toLowerCase();
    function hit(f) { return !q || (f.name + " " + plain(f.note)).toLowerCase().indexOf(q) !== -1; }
    dir.appendChild(dirSearch(ui.subq, "Search " + sp + " features", function (v) { ui.subq = v; renderView(); refocusDirSearch(); }));
    var mains = mainsIn(sp).sort(function (a, b) { return a.name.localeCompare(b.name); });
    var shown = mains.filter(function (m) { return hit(m) || subsOf(m).some(hit); });
    var order = sectionsFor(sp).slice();
    var groups = {};
    shown.forEach(function (m) {
      var sec = sectionOf(m, sp);
      if (order.indexOf(sec) === -1) sec = "";
      (groups[sec] = groups[sec] || []).push(m);
    });
    var keys2 = order.filter(function (k) { return groups[k]; });
    if (groups[""]) keys2.push("");
    if (!mains.length) dir.appendChild(el("div", "empty", "Nothing here yet. Create a feature, or drag one onto " + sp + " in the left nav."));
    else if (!shown.length) dir.appendChild(el("div", "empty", "No match in " + sp + "."));
    keys2.forEach(function (sec) {
      var items = groups[sec];
      var n = items.reduce(function (a, m) { return a + 1 + subsOf(m).length; }, 0);
      dir.appendChild(dirSection(sec || "Other", n, items.map(function (m) {
        return dirRow(m, function (f) { ui.spaceSel = f.id; ui.smode = "browse"; ui.subq = ""; renderView(); }, true);
      })));
    });
    pad.appendChild(dir);
    host.appendChild(pad);
  }

  /* features home: search, category tiles, recently updated */
  function renderFeaturesHome(host) {
    var p = project();
    host.appendChild(header("FEATURES", p.name + " features", [newBtn("NEW FEATURE", function () { create(); })]));
    var pad = el("div", "pad");
    var dir = el("div", "dir");
    dir.appendChild(dirSearch("", "Search a feature by name or description…", function (v) {
      ui.query = v; document.getElementById("find").value = v; renderView();
    }));

    var sec = el("div", "dirsec");
    sec.appendChild(el("h2", null, "Browse by space"));
    var tiles = el("div", "cattiles");
    S.spaces.forEach(function (sp) {
      var mains = mainsIn(sp);
      var subs = 0;
      mains.forEach(function (m) { subs += subsOf(m).length; });
      var live = inSpace(sp).filter(function (f) { return f.state === "Live"; }).length;
      var t = el("button", "cattile");
      t.appendChild(avatarEl(spaceIcon(sp), "lg"));
      var tx = el("div", "tx");
      tx.appendChild(el("b", null, sp));
      tx.appendChild(el("span", null, spaceBlurb(sp) || (mains.length + " main features")));
      t.appendChild(tx);
      var n = el("div", "n");
      n.appendChild(el("b", null, String(mains.length)));
      n.appendChild(el("span", null, subs ? subs + " sub · " + live + " live" : live + " live"));
      t.appendChild(n);
      t.onclick = function () { ui.view = "space"; ui.space = sp; ui.spaceSel = null; ui.smode = "dir"; ui.subq = ""; render(); };
      t.addEventListener("dragover", function (e) { e.preventDefault(); t.classList.add("dragover"); });
      t.addEventListener("dragleave", function () { t.classList.remove("dragover"); });
      t.addEventListener("drop", function (e) {
        e.preventDefault(); t.classList.remove("dragover");
        var f = feature(e.dataTransfer.getData("text/plain"));
        if (!f) return;
        f.spaces = f.spaces || [];
        if (f.spaces.indexOf(sp) === -1) f.spaces.push(sp);
        touch(f); render(); save();
      });
      tiles.appendChild(t);
    });
    (function () {
      var up = upcoming();
      var t = el("button", "cattile upcoming");
      t.appendChild(avatarEl("upcoming", "lg"));
      var tx = el("div", "tx");
      tx.appendChild(el("b", null, "Upcoming"));
      tx.appendChild(el("span", null, "Building, planned or researched, across all spaces."));
      t.appendChild(tx);
      var n = el("div", "n");
      n.appendChild(el("b", null, String(up.length)));
      var dated = up.filter(function (f) { return f.period; }).length;
      n.appendChild(el("span", null, dated ? dated + " on the roadmap" : "features"));
      t.appendChild(n);
      t.onclick = function () { ui.fmode = "upcoming"; renderView(); };
      tiles.appendChild(t);
    })();
    sec.appendChild(tiles);
    dir.appendChild(sec);

    var over = overrunList();
    if (over.length) {
      var ochip = el("button", "driftchip", over.length + (over.length === 1 ? " feature running over its estimate" : " features running over their estimates") + " ›");
      ochip.onclick = function () { ui.view = "changes"; render(); };
      dir.appendChild(ochip);
    }
    var drift = driftList();
    if (drift.length) {
      var dchip = el("button", "driftchip", drift.length + (drift.length === 1 ? " feature built without agreement" : " features built without agreement") + " ›");
      dchip.onclick = function () { ui.view = "changes"; render(); };
      dir.appendChild(dchip);
    }
    var recent = feats().slice().sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); }).slice(0, 8);
    if (recent.length) {
      dir.appendChild(dirSection("Recently updated", undefined, recent.map(function (f) {
        return dirRow(f, function (x) { open(x.id); }, false);
      })));
    }
    var building = feats().filter(function (f) { return f.state === "Building"; }).sort(function (a, b) { return a.name.localeCompare(b.name); }).slice(0, 8);
    if (building.length) {
      dir.appendChild(dirSection("Being built now", undefined, building.map(function (f) {
        return dirRow(f, function (x) { open(x.id); }, false);
      })));
    }

    var foot = el("div", "spacefoot");
    var all = el("button", "chip", "Browse all " + feats().length + " features as a list");
    all.onclick = function () { ui.fmode = "all"; renderView(); };
    foot.appendChild(all);
    var addSp = el("button", "chip", "+ New space");
    addSp.onclick = newSpace;
    foot.appendChild(addSp);
    var dr = el("button", "chip", S.driveFolder ? "Product folder in Drive ↗" : "Set the Drive folder");
    dr.onclick = function () {
      if (S.driveFolder) { window.open(S.driveFolder, "_blank", "noopener"); return; }
      askText("Drive folder for product files", { placeholder: "https://drive.google.com/drive/folders/…", ok: "Save" }).then(function (v) { if (v) { S.driveFolder = v; save(); render(); } });
    };
    dr.oncontextmenu = function (e) { e.preventDefault(); askText("Drive folder for product files", { value: S.driveFolder, ok: "Save" }).then(function (v) { if (v !== null) { S.driveFolder = v; save(); render(); } }); };
    foot.appendChild(dr);
    dir.appendChild(foot);
    pad.appendChild(dir);
    host.appendChild(pad);
  }

  /* Upcoming: everything not yet live, grouped by how far along it is. */
  function renderUpcoming(host) {
    var p = project();
    var back = el("button", "btn ghost", "Spaces");
    back.onclick = function () { ui.fmode = "cards"; renderView(); };
    host.appendChild(header("UPCOMING", p.name + " · what is coming", [back, newBtn("NEW FEATURE", function () { create([], { state: "Planned" }); })]));
    var bar = el("div", "bar");
    spaceChips(bar);
    bar.appendChild(ownerSelect(renderView));
    host.appendChild(bar);
    var pad = el("div", "pad");
    var list = upcoming().filter(passes);
    if (!list.length) pad.appendChild(el("div", "empty", "Nothing upcoming. Set a feature to Building, Planned or Research and it shows up here."));
    UPCOMING_STATES.forEach(function (st) {
      var items = list.filter(function (f) { return f.state === st; });
      if (!items.length) return;
      items.sort(function (a, b) {
        if (!!a.period !== !!b.period) return a.period ? -1 : 1;
        if (a.period && b.period && a.period !== b.period) return a.period < b.period ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      var hint = st === "Building" ? "In development now." : st === "Planned" ? "Agreed, not started." : st === "Research" ? "Being explored by the R&D team." : "Not agreed yet. Move it to Planned once it is.";
      var head = sectionTitle(st + " · " + items.length);
      var hs = el("span", "note", hint);
      hs.style.cssText = "text-transform:none;letter-spacing:0;font-size:14px;margin-left:10px;";
      head.appendChild(hs);
      pad.appendChild(head);
      var tiles = el("div", "tiles");
      items.forEach(function (f) { tiles.appendChild(tile(f)); });
      pad.appendChild(tiles);
    });
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

  /* --- space view: divisions like the real app, sub-menu on the left, hero page on the right --- */

  var divToggles = {};
  try { divToggles = JSON.parse(localStorage.getItem("alie.divs") || "{}") || {}; } catch (e) { divToggles = {}; }
  function saveDivToggles() { try { localStorage.setItem("alie.divs", JSON.stringify(divToggles)); } catch (e) {} }
  function sectionsFor(sp) { return (S.sections && S.sections[sp]) || []; }
  function sectionOf(f, sp) {
    var sec = f.sections && f.sections[sp];
    if (!sec && f.parent) { var p = feature(f.parent); sec = p && p.sections && p.sections[sp]; }
    return sec || "";
  }
  function manageSections(sp) {
    return dialog(function (box, close) {
      box.appendChild(el("h2", null, sp + " divisions"));
      box.appendChild(el("p", null, "One per line, in the order they appear in the sub-menu. Match the real app's navigation."));
      var ta = el("textarea");
      ta.style.minHeight = "180px";
      ta.value = sectionsFor(sp).join("\n");
      ta.setAttribute("aria-label", "Divisions");
      box.appendChild(ta);
      var acts = el("div", "acts");
      var cancel = el("button", "btn ghost", "Cancel"); cancel.onclick = function () { close(null); };
      var ok = el("button", "btn", "Save");
      ok.onclick = function () { close(ta.value.split("\n").map(function (x) { return x.trim(); }).filter(Boolean)); };
      acts.appendChild(cancel); acts.appendChild(ok);
      box.appendChild(acts);
    }).then(function (list) {
      if (!list) return;
      S.sections = S.sections || {};
      S.sections[sp] = list;
      render(); save();
    });
  }

  function renderSpace(host, sp) {
    var acts = [newBtn("NEW FEATURE", function () { create([sp]); })];
    acts.push(menu("More", [
      ["Divisions of this space", function () { manageSections(sp); }],
      "-",
      ["Rename space", function () {
        askText("Rename space", { value: sp, ok: "Rename",
          validate: function (v) { return v !== sp && S.spaces.indexOf(v) !== -1 ? "That space already exists." : ""; } })
          .then(function (n) {
            if (!n || n === sp) return;
            S.spaces[S.spaces.indexOf(sp)] = n;
            if (S.sections && S.sections[sp]) { S.sections[n] = S.sections[sp]; delete S.sections[sp]; }
            S.features.forEach(function (f) {
              var i = (f.spaces || []).indexOf(sp);
              if (i !== -1) f.spaces[i] = n;
              if (f.sections && f.sections[sp]) { f.sections[n] = f.sections[sp]; delete f.sections[sp]; }
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

    var modeBar = el("div", "bar modebar");
    var mseg = el("div", "seg");
    [["Directory", "dir"], ["Browse", "browse"], ["Board", "board"]].forEach(function (m) {
      var b = el("button", null, m[0]);
      b.setAttribute("aria-pressed", String(ui.smode === m[1]));
      b.onclick = function () { ui.smode = m[1]; renderView(); };
      mseg.appendChild(b);
    });
    modeBar.appendChild(mseg);
    host.appendChild(modeBar);

    if (ui.smode === "dir") return renderSpaceDirectory(host, sp);
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
    var selMain = sel && sel.parent ? feature(sel.parent) : sel;
    if (!sel || !selMain || mains.indexOf(selMain) === -1) { sel = mains[0]; selMain = sel; }
    ui.spaceSel = sel.id;

    var grid = el("div", "spacegrid");

    /* sub-menu grouped by division, main features in caps, sub-functionalities under the open one */
    var nav = el("nav", "subnav");
    nav.setAttribute("aria-label", sp + " features");
    var q = (ui.subq || "").trim().toLowerCase();
    function hit(f) { return !q || (f.name + " " + plain(f.note)).toLowerCase().indexOf(q) !== -1; }
    var fin = el("input", "subfind");
    fin.type = "search";
    fin.placeholder = "Filter " + sp + "…";
    fin.value = ui.subq || "";
    fin.setAttribute("aria-label", "Filter features");
    fin.oninput = function () { ui.subq = fin.value; renderView(); var again = document.querySelector(".subfind"); if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); } };
    nav.appendChild(fin);

    var shown = mains.filter(function (m) { return hit(m) || subsOf(m).some(hit); });
    var order = sectionsFor(sp).slice();
    var groups = {};
    shown.forEach(function (m) {
      var sec = sectionOf(m, sp);
      if (order.indexOf(sec) === -1) sec = "";
      (groups[sec] = groups[sec] || []).push(m);
    });
    var keys2 = order.filter(function (k) { return groups[k]; });
    if (groups[""]) keys2.push("");

    /* divisions collapse: only the division holding the selected feature is open unless the user toggled it */
    var selSec = sectionOf(selMain, sp);
    if (order.indexOf(selSec) === -1) selSec = "";
    var divKey = function (sec) { return sp + "|" + (sec || "Other"); };
    if (ui.lastSpaceSel !== sel.id) { ui.lastSpaceSel = sel.id; if (divToggles[divKey(selSec)] === false) { delete divToggles[divKey(selSec)]; saveDivToggles(); } }
    function isOpen(sec) {
      if (q) return true;
      var t = divToggles[divKey(sec)];
      return t === undefined ? sec === selSec : !!t;
    }
    var list2 = el("div", "subnav-list");
    if (q && !shown.length) list2.appendChild(el("div", "note", "No match in " + sp + "."));
    keys2.forEach(function (sec) {
      var open = isOpen(sec);
      var lab = el("button", "division" + (open ? " open" : ""));
      lab.type = "button";
      lab.setAttribute("aria-expanded", String(open));
      lab.appendChild(el("span", "chev", "›"));
      lab.appendChild(el("span", "dn", sec || "Other"));
      var n = groups[sec].reduce(function (a, m) { return a + 1 + subsOf(m).length; }, 0);
      lab.appendChild(el("span", "dc", String(n)));
      if (!open && groups[sec].some(function (m) { return m.id === selMain.id; })) lab.classList.add("has-on");
      lab.onclick = function () { divToggles[divKey(sec)] = !open; saveDivToggles(); renderView(); };
      list2.appendChild(lab);
      if (!open) return;
      groups[sec].forEach(function (m) {
        var kids = q ? subsOf(m).filter(function (k) { return hit(k) || hit(m); }) : subsOf(m);
        var item = el("button", "sn top" + (m.id === selMain.id ? " on" : ""));
        item.appendChild(el("i", "sd " + stateClass(m.state)));
        item.appendChild(el("span", "nm", m.name));
        if (subsOf(m).length) item.appendChild(el("span", "ct", String(subsOf(m).length)));
        item.onclick = function () { ui.spaceSel = m.id; renderView(); };
        list2.appendChild(item);
        if ((m.id === selMain.id || q) && kids.length) {
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
    });
    nav.appendChild(list2);

    var dd = el("select", "subnav-select selbox");
    dd.setAttribute("aria-label", "Pick a feature");
    keys2.forEach(function (sec) {
      var og = document.createElement("optgroup"); og.label = sec || "Other";
      groups[sec].forEach(function (m) {
        var o = el("option", null, m.name.toUpperCase()); o.value = m.id; if (m.id === sel.id) o.selected = true; og.appendChild(o);
        subsOf(m).forEach(function (k) { var ok = el("option", null, "    " + k.name); ok.value = k.id; if (k.id === sel.id) ok.selected = true; og.appendChild(ok); });
      });
      dd.appendChild(og);
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

  function trashBtn(f, cls) {
    var b = el("button", "trash" + (cls ? " " + cls : ""));
    b.setAttribute("aria-label", "Delete " + f.name);
    b.title = "Delete";
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
    b.onclick = function (e) {
      e.stopPropagation();
      var kids = childrenOf(f).length;
      askConfirm("Delete " + f.name + "?", kids ? "Its " + kids + " sub-functionalit" + (kids === 1 ? "y" : "ies") + " will stay and become main features. This cannot be undone." : "This cannot be undone.", { danger: true, ok: "Delete" })
        .then(function (yes) {
          if (!yes) return;
          var parentId = f.parent;
          S.features = S.features.filter(function (x) { return x.id !== f.id; });
          S.features.forEach(function (x) { if (x.parent === f.id) { x.parent = null; touch(x); } });
          tombstones[f.id] = true;
          if (ui.feature === f.id) ui.feature = null;
          if (ui.spaceSel === f.id) ui.spaceSel = parentId || null;
          render(); save(); toast(f.name + " deleted.");
        });
    };
    return b;
  }

  /* Full-size preview of one sub-functionality, with previous / next among its siblings. */
  function lightbox(f, siblings) {
    var scrim = el("div", "lbscrim");
    var box = el("div", "lb");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", f.name);
    function close() { scrim.remove(); document.removeEventListener("keydown", onKey); }
    function show(x) { f = x; draw(); }
    function onKey(e) {
      if (e.key === "Escape") { e.stopPropagation(); close(); }
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    }
    function step(d) {
      if (!siblings || siblings.length < 2) return;
      var i = siblings.indexOf(f);
      show(siblings[(i + d + siblings.length) % siblings.length]);
    }
    function draw() {
      box.innerHTML = "";
      var x = el("button", "lbclose", "×");
      x.setAttribute("aria-label", "Close");
      x.onclick = close;
      box.appendChild(x);
      var media = el("div", "lbmedia");
      if (f.image) { var img = document.createElement("img"); img.src = f.image; img.alt = f.name; media.appendChild(img); }
      else media.appendChild(thumbEl(f, "lbfallback"));
      box.appendChild(media);
      var cap = el("div", "lbcap");
      var t = el("div", "lbtitle");
      t.appendChild(el("h3", null, f.name));
      t.appendChild(statePill(f));
      cap.appendChild(t);
      var par = parentOf(f);
      if (par) cap.appendChild(el("div", "note", "Part of " + par.name));
      cap.appendChild(f.note ? richView(f.note) : el("p", null, "No description yet."));
      var acts = el("div", "acts");
      if (siblings && siblings.length > 1) {
        var prev = el("button", "btn ghost", "‹ Previous"); prev.onclick = function () { step(-1); }; acts.appendChild(prev);
        var next = el("button", "btn ghost", "Next ›"); next.onclick = function () { step(1); }; acts.appendChild(next);
        acts.appendChild(el("span", "note", (siblings.indexOf(f) + 1) + " of " + siblings.length));
      }
      var go = el("button", "btn", "Open");
      go.onclick = function () { close(); ui.spaceSel = f.id; renderView(); };
      acts.appendChild(go);
      var pg = el("button", "btn ghost", "Edit page");
      pg.onclick = function () { close(); open(f.id); };
      acts.appendChild(pg);
      cap.appendChild(acts);
      box.appendChild(cap);
    }
    draw();
    scrim.onclick = function (e) { if (e.target === scrim) close(); };
    document.addEventListener("keydown", onKey);
    scrim.appendChild(box);
    document.body.appendChild(scrim);
    box.querySelector(".lbclose").focus();
  }

  /* One feature as a hero page: screenshot, title, description, then a sub-menu and cards of its sub-functionalities. */
  function featureSheet(f, sp) {
    var box = el("div", "sheet");
    var par = parentOf(f);
    var kids = par ? [] : subsOf(f);
    var sec = sectionOf(f, sp);

    var hero = el("div", "hero" + (f.image ? " shot" : ""));
    if (f.image) {
      var img = document.createElement("img");
      img.src = f.image; img.alt = f.name;
      hero.appendChild(img);
      var zoom = el("button", "heroZoom", "View full size");
      zoom.onclick = function () { lightbox(f, par ? subsOf(par) : null); };
      hero.appendChild(zoom);
    } else hero.appendChild(thumbEl(f, "herofallback"));
    box.appendChild(hero);

    var head = el("div", "sheethd");
    var crumbs = el("div", "eyebrow", (sec ? sec.toUpperCase() + " · " : "") + (par ? "SUB-FUNCTIONALITY" : "MAIN FEATURE"));
    head.appendChild(crumbs);
    if (par) {
      var pl = el("button", "parentlink", "← " + par.name);
      pl.onclick = function () { ui.spaceSel = par.id; renderView(); };
      head.appendChild(pl);
    }
    var titleRow = el("div", "titlerow");
    titleRow.appendChild(el("h1", null, f.name));
    titleRow.appendChild(trashBtn(f, "lg"));
    head.appendChild(titleRow);
    var meta = el("div", "pills");
    meta.appendChild(statePill(f));
    if (f.owner && f.owner !== "Unassigned") meta.appendChild(pill(f.owner));
    if (f.period) meta.appendChild(pill(laneLabel(laneOfPeriod(f, keys()))));
    if (f.effort) meta.appendChild(pill("Takes " + effortLabel(f, true)));
    if (expectedEnd(f) && SHIPPED_STATES.indexOf(f.state) === -1) meta.appendChild(pill((overrunDays(f) ? overrunDays(f) + " days over · due " : "Due ") + dueLabel(f), overrunDays(f) ? "st-needs-work" : ""));
    if (f.agreed) meta.appendChild(pill("Agreed", "st-live"));
    else if (BUILT_STATES.indexOf(f.state) !== -1 && driftList().indexOf(f) !== -1) meta.appendChild(pill("Built without agreement", "st-needs-work"));
    if (f.rnd) meta.appendChild(pill("R&D · " + f.rndStage, "rnd"));
    icpsOf(f).forEach(function (i) { meta.appendChild(pill(i.name, "icp")); });
    head.appendChild(meta);
    head.appendChild(domainBadges(f));
    box.appendChild(head);

    box.appendChild(f.note ? richView(f.note, "desc") : el("p", "desc muted", "No description yet. Open the page to write what this is."));

    var acts = el("div", "acts sheetacts");
    var edit = el("button", "btn", "Open page");
    edit.onclick = function () { open(f.id); };
    acts.appendChild(edit);
    var quick = el("button", "btn ghost", "Quick edit");
    quick.onclick = function () { preview(f.id); };
    acts.appendChild(quick);
    if (f.link) { var lk = el("a", "btn ghost", "Drive"); lk.href = f.link; lk.target = "_blank"; lk.rel = "noopener"; acts.appendChild(lk); }
    box.appendChild(acts);

    if (!par) {
      var hd = el("div", "sheethead");
      hd.appendChild(el("h2", null, "Sub-functionalities"));
      hd.appendChild(el("em", null, kids.length ? String(kids.length) : "none yet"));
      box.appendChild(hd);
      if (kids.length) {
        var jump = el("nav", "jump");
        jump.setAttribute("aria-label", "Sub-functionalities of " + f.name);
        kids.forEach(function (k, i) {
          var b = el("button", "jumpb");
          b.appendChild(el("span", "n", String(i + 1)));
          b.appendChild(document.createTextNode(k.name));
          b.onclick = function () {
            var card = document.getElementById("card-" + k.id);
            if (card) { card.scrollIntoView({ behavior: "smooth", block: "center" }); card.classList.add("flash"); setTimeout(function () { card.classList.remove("flash"); }, 1200); }
          };
          jump.appendChild(b);
        });
        box.appendChild(jump);
      }
      var cards = el("div", "subgrid");
      kids.forEach(function (k) {
        cards.appendChild(subCard(k, { lightbox: true, siblings: kids, trash: true, drag: true, onOpen: function (x) { ui.spaceSel = x.id; renderView(); } }));
      });
      cards.appendChild(subAddCard(f));
      box.appendChild(cards);
    } else {
      var sibs = subsOf(par).filter(function (x) { return x.id !== f.id; });
      if (sibs.length) {
        var h2 = el("div", "sheethead");
        h2.appendChild(el("h2", null, "Also under " + par.name));
        h2.appendChild(el("em", null, String(sibs.length)));
        box.appendChild(h2);
        var row = el("nav", "jump");
        sibs.forEach(function (x) {
          var c = el("button", "jumpb", x.name);
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
    if (f.note) t.appendChild(el("p", null, plain(f.note)));
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
    c.appendChild(el("p", null, plain(f.note).slice(0, 92)));

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
        c.appendChild(el("p", null, plain(f.note).slice(0, 88)));
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
    var imp = el("button", "btn ghost", "Import a plan (.md)");
    imp.onclick = function () {
      askMarkdown("New research item from a Markdown plan", { text: "The first # heading becomes the item's name; everything under it becomes the experiment plan.", ok: "Create" }).then(function (md) {
        if (!md) return;
        var sp = splitMdTitle(md);
        var f = create(ui.spaceFilter ? [ui.spaceFilter] : [], { rnd: true, state: "Research", name: sp.title || "New research item", rndPlan: mdToHtml(sp.body || md) }, true);
        save(); open(f.id);
        toast("Research item created from the plan.");
      });
    };
    acts.unshift(imp);
    acts.push(menu("More", [
      ["Manage students", function () { managePeople("students"); }],
      [S.rndFolder ? "Change the R&D folder in Drive" : "Set the R&D folder in Drive", function () {
        askText("R&D folder in Drive", { value: S.rndFolder || "", placeholder: "https://drive.google.com/drive/folders/…", ok: "Save", text: "Every research item is written there as a Google Doc, one per item, updated on every change." }).then(function (v) { if (v !== null) { S.rndFolder = v; save(); render(); } });
      }],
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
    var vg = barGroup("View"); vg.appendChild(seg); bar.appendChild(vg);
    var fg = barGroup("Filter"); bar.appendChild(fg);
    spaceChips(fg);
    var ss = el("select", "selbox");
    ss.setAttribute("aria-label", "Student filter");
    [["", "Any student"], ["__none", "Unassigned"]].concat(S.students.map(function (s) { return [s, s]; })).forEach(function (o) {
      var e = el("option", null, o[1]); e.value = o[0];
      if (o[0] === ui.studentFilter) e.selected = true;
      ss.appendChild(e);
    });
    ss.onchange = function () { ui.studentFilter = ss.value; renderView(); };
    fg.appendChild(ss);
    host.appendChild(bar);

    var pad = el("div", "pad");
    var drow = el("div", "driverow");
    drow.appendChild(driveStatusLine());
    if (S.rndFolder) { var fo = el("a", "chip", "R&D folder in Drive ↗"); fo.href = S.rndFolder; fo.target = "_blank"; fo.rel = "noopener"; drow.appendChild(fo); }
    else { var setF = el("button", "chip", "Set the R&D folder"); setF.onclick = function () { askText("R&D folder in Drive", { placeholder: "https://drive.google.com/drive/folders/…", ok: "Save" }).then(function (v) { if (v) { S.rndFolder = v; save(); render(); } }); }; drow.appendChild(setF); }
    pad.appendChild(drow);

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
    if (f.rndQuestion) c.appendChild(el("p", "q", plain(f.rndQuestion).slice(0, 140)));
    else c.appendChild(el("p", null, (plain(f.note) || "No research question yet.").slice(0, 92)));
    c.appendChild(el("div", "stu", f.student ? "Student: " + f.student : "No student assigned"));

    var tags = el("div", "tags");
    if (ui.rgroup !== "stage") tags.appendChild(pill(f.rndStage, "rnd"));
    tags.appendChild(statePill(f));
    tags.appendChild(pill(f.owner));
    (f.spaces || []).forEach(function (sp) { tags.appendChild(pill(sp)); });
    if (f.rndPlan) tags.appendChild(pill("plan", "gold"));
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

  /* --- rich text: a small editor for notes and descriptions, with safe rendering --- */

  var RICH_TAGS = { P: 1, BR: 1, B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, UL: 1, OL: 1, LI: 1, H2: 1, H3: 1, H4: 1, A: 1, BLOCKQUOTE: 1, CODE: 1, PRE: 1, HR: 1, TABLE: 1, THEAD: 1, TBODY: 1, TR: 1, TH: 1, TD: 1 };
  function isHtml(s) { return /<\/?[a-z][\s\S]*>/i.test(String(s || "")); }
  function escapeHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  /* Plain text with newlines becomes paragraphs; lines starting with "- " or "* " become bullets. */
  function textToHtml(t) {
    var lines = String(t || "").split(/\r?\n/), out = "", inList = false;
    lines.forEach(function (line) {
      var m = /^\s*[-*•]\s+(.*)$/.exec(line);
      if (m) { if (!inList) { out += "<ul>"; inList = true; } out += "<li>" + escapeHtml(m[1]) + "</li>"; return; }
      if (inList) { out += "</ul>"; inList = false; }
      if (line.trim()) out += "<p>" + escapeHtml(line) + "</p>";
    });
    if (inList) out += "</ul>";
    return out;
  }
  function sanitizeHtml(html) {
    var doc = new DOMParser().parseFromString("<div>" + String(html || "") + "</div>", "text/html");
    var root = doc.body.firstChild;
    function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 3) return;
        if (n.nodeType !== 1 || n.tagName === "SCRIPT" || n.tagName === "STYLE") { n.remove(); return; }
        walk(n);
        var tag = n.tagName;
        if (tag === "DIV") { var p = doc.createElement("p"); while (n.firstChild) p.appendChild(n.firstChild); n.replaceWith(p); n = p; tag = "P"; }
        if (tag === "SPAN" || tag === "FONT") { while (n.firstChild) n.parentNode.insertBefore(n.firstChild, n); n.remove(); return; }
        if (!RICH_TAGS[tag]) { while (n.firstChild) n.parentNode.insertBefore(n.firstChild, n); n.remove(); return; }
        Array.prototype.slice.call(n.attributes).forEach(function (a) { n.removeAttribute(a.name); });
        if (tag === "A") {
          var href = (n.getAttribute("data-href") || "");
          n.setAttribute("target", "_blank"); n.setAttribute("rel", "noopener");
        }
      });
    }
    // keep hrefs through the attribute wipe
    Array.prototype.forEach.call(root.querySelectorAll("a[href]"), function (a) {
      var h = a.getAttribute("href") || "";
      if (/^(https?:|mailto:)/i.test(h)) a.setAttribute("data-href", h);
    });
    walk(root);
    Array.prototype.forEach.call(root.querySelectorAll("a"), function (a) {
      var h = a.getAttribute("data-href");
      if (h) { a.setAttribute("href", h); a.removeAttribute("data-href"); } else { while (a.firstChild) a.parentNode.insertBefore(a.firstChild, a); a.remove(); }
    });
    // block elements never sit inside a paragraph
    Array.prototype.slice.call(root.querySelectorAll("p")).forEach(function (pEl) {
      if (pEl.querySelector("ul, ol, h2, h3, h4, blockquote, p, pre, table, hr")) { while (pEl.firstChild) pEl.parentNode.insertBefore(pEl.firstChild, pEl); pEl.remove(); }
    });
    return root.innerHTML.replace(/<p>(\s|&nbsp;|<br>)*<\/p>/g, "").trim();
  }
  function richHtml(s) { return isHtml(s) ? sanitizeHtml(s) : textToHtml(s); }
  /* Plain text for cards, rows, search. */
  function plain(s) {
    if (!isHtml(s)) return String(s || "");
    var doc = new DOMParser().parseFromString("<div>" + s + "</div>", "text/html");
    Array.prototype.forEach.call(doc.querySelectorAll("li"), function (li) { li.insertBefore(doc.createTextNode("• "), li.firstChild); li.appendChild(doc.createTextNode("  ")); });
    Array.prototype.forEach.call(doc.querySelectorAll("p, h3, h4, br, blockquote"), function (b) { b.appendChild(doc.createTextNode(" ")); });
    return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
  }
  /* Markdown to the HTML the rich editor understands. Headings, lists, task lists, tables, fenced code, quotes, rules, links, emphasis. */
  function mdInline(t) {
    var codes = [];
    t = escapeHtml(t).replace(/`([^`]+)`/g, function (_, c) { codes.push(c); return "\u0000" + (codes.length - 1) + "\u0000"; });
    t = t.replace(/\[([^\]]+)\]\((https?:[^\s)]+|mailto:[^\s)]+)\)/g, '<a href="$2">$1</a>');
    t = t.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2">$2</a>');
    t = t.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/__([^_]+)__/g, "<b>$1</b>");
    t = t.replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1<i>$2</i>").replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, "$1<i>$2</i>");
    t = t.replace(/~~([^~]+)~~/g, "<s>$1</s>");
    return t.replace(/\u0000(\d+)\u0000/g, function (_, i) { return "<code>" + codes[Number(i)] + "</code>"; });
  }
  function mdToHtml(md) {
    var lines = String(md || "").replace(/\r\n?/g, "\n").split("\n"), out = [], i = 0, para = [];
    function flushPara() { if (para.length) { out.push("<p>" + para.map(function (l) { return mdInline(l.replace(/\s{2,}$/, "")); }).join("<br>") + "</p>"); para = []; } }
    function listAt(start, indent, ordered) {
      var html = ordered ? "<ol>" : "<ul>", j = start;
      while (j < lines.length) {
        var m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[j]);
        if (!m) { if (lines[j].trim() === "" && j + 1 < lines.length && /^\s+([-*+]|\d+[.)])\s+/.test(lines[j + 1]) && lines[j + 1].match(/^\s*/)[0].length > indent) { j++; continue; } break; }
        var ind = m[1].length;
        if (ind < indent) break;
        if (ind > indent) { var sub = listAt(j, ind, /\d/.test(m[2])); html = html.replace(/<\/li>$/, "") + sub.html + "</li>"; j = sub.next; continue; }
        var txt = m[3].replace(/^\[( |x|X)\]\s+/, function (_, c) { return c === " " ? "☐ " : "☑ "; });
        html += "<li>" + mdInline(txt) + "</li>"; j++;
      }
      return { html: html + (ordered ? "</ol>" : "</ul>"), next: j };
    }
    while (i < lines.length) {
      var line = lines[i];
      var fence = /^\s*```/.exec(line);
      if (fence) { flushPara(); var code = []; i++; while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]); i++; out.push("<pre><code>" + escapeHtml(code.join("\n")) + "</code></pre>"); continue; }
      var h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (h) { flushPara(); var lvl = h[1].length; out.push("<h" + (lvl === 1 ? 2 : lvl === 2 ? 3 : 4) + ">" + mdInline(h[2]) + "</h" + (lvl === 1 ? 2 : lvl === 2 ? 3 : 4) + ">"); i++; continue; }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flushPara(); out.push("<hr>"); i++; continue; }
      if (/^\s*>/.test(line)) { flushPara(); var q = []; while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, "")); out.push("<blockquote>" + mdToHtml(q.join("\n")) + "</blockquote>"); continue; }
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        flushPara();
        var cells = function (l) { return l.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map(function (c) { return mdInline(c.replace(/\\\|/g, "|").trim()); }); };
        var html = "<table><thead><tr>" + cells(line).map(function (c) { return "<th>" + c + "</th>"; }).join("") + "</tr></thead><tbody>";
        i += 2;
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { html += "<tr>" + cells(lines[i]).map(function (c) { return "<td>" + c + "</td>"; }).join("") + "</tr>"; i++; }
        out.push(html + "</tbody></table>"); continue;
      }
      var lm = /^(\s*)([-*+]|\d+[.)])\s+/.exec(line);
      if (lm) { flushPara(); var r = listAt(i, lm[1].length, /\d/.test(lm[2])); out.push(r.html); i = r.next; continue; }
      if (line.trim() === "") { flushPara(); i++; continue; }
      para.push(line); i++;
    }
    flushPara();
    return sanitizeHtml(out.join(""));
  }
  function looksLikeMarkdown(t) { return /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|```|>\s|\|.*\|)/m.test(String(t || "")) || /\*\*[^*]+\*\*|\[[^\]]+\]\(https?:/.test(String(t || "")); }

  /* Paste or upload a Markdown document; resolves with the text, or null. */
  function askMarkdown(title, o) {
    o = o || {};
    return dialog(function (box, close) {
      box.classList.add("wide");
      box.appendChild(el("h2", null, title));
      box.appendChild(el("p", null, o.text || "Paste the Markdown here, or pick a .md file. Headings, lists, tables, code and links come through."));
      var ta = el("textarea", "mdbox");
      ta.placeholder = "# Experiment: …\n\n## Hypothesis\n…\n\n## Method\n1. …";
      ta.setAttribute("aria-label", "Markdown");
      box.appendChild(ta);
      var row = el("div", "acts");
      var file = document.createElement("input"); file.type = "file"; file.accept = ".md,.markdown,.txt,text/markdown,text/plain"; file.style.display = "none";
      file.onchange = function () {
        var fl = file.files && file.files[0]; if (!fl) return;
        var rd = new FileReader();
        rd.onload = function () { ta.value = String(rd.result || ""); ta.focus(); };
        rd.readAsText(fl);
      };
      var up = el("button", "btn ghost", "Upload a .md file"); up.onclick = function () { file.click(); };
      var cancel = el("button", "btn ghost", "Cancel"); cancel.onclick = function () { close(null); };
      var ok = el("button", "btn", o.ok || "Import");
      ok.onclick = function () { var v = ta.value.trim(); if (!v) { ta.focus(); return; } close(v); };
      row.appendChild(up); row.appendChild(file); row.appendChild(cancel); row.appendChild(ok);
      box.appendChild(row);
      setTimeout(function () { ta.focus(); if (o.pick) file.click(); }, 0);
    });
  }
  /* First "# Title" line becomes the name; the rest is the body. */
  function splitMdTitle(md) {
    var m = /^\s*#\s+(.+?)\s*#*\s*\n/.exec(md);
    return m ? { title: m[1].trim(), body: md.slice(m[0].length) } : { title: "", body: md };
  }

  function richView(s, cls) {
    var d = el("div", "rich" + (cls ? " " + cls : ""));
    d.innerHTML = richHtml(s);
    return d;
  }

  /* contenteditable editor with a small toolbar; calls onChange(html) as you type */
  function richEditor(value, onChange, placeholder, cls) {
    var wrap = el("div", "rte" + (cls ? " " + cls : ""));
    var bar = el("div", "rtebar");
    var body = el("div", "rtebody");
    body.contentEditable = "true";
    body.setAttribute("role", "textbox");
    body.setAttribute("aria-multiline", "true");
    body.dataset.placeholder = placeholder || "";
    body.innerHTML = richHtml(value);
    body.addEventListener("paste", function (e) {
      var cd = e.clipboardData; if (!cd) return;
      var html = cd.getData("text/html"), txt = cd.getData("text/plain");
      if (html || !txt || !looksLikeMarkdown(txt)) return;
      e.preventDefault();
      document.execCommand("insertHTML", false, mdToHtml(txt));
      emit();
    });
    function cmd(name, arg) { body.focus(); document.execCommand(name, false, arg || null); emit(); }
    function emit() { onChange(sanitizeHtml(body.innerHTML)); }
    [["B", "bold", "Bold"], ["I", "italic", "Italic"], ["U", "underline", "Underline"],
     ["•", "insertUnorderedList", "Bullet list"], ["1.", "insertOrderedList", "Numbered list"],
     ["H", "formatBlock", "Heading", "H4"], ["¶", "formatBlock", "Paragraph", "P"], ["“", "formatBlock", "Quote", "BLOCKQUOTE"]].forEach(function (t) {
      var b = el("button", "rtb", t[0]);
      b.type = "button";
      b.title = t[2];
      b.setAttribute("aria-label", t[2]);
      b.onmousedown = function (e) { e.preventDefault(); };
      b.onclick = function () { cmd(t[1], t[3]); };
      bar.appendChild(b);
    });
    var link = el("button", "rtb", "Link");
    link.type = "button"; link.title = "Link";
    link.onmousedown = function (e) { e.preventDefault(); };
    link.onclick = function () {
      var sel = window.getSelection();
      var range = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
      askText("Link address", { placeholder: "https://…", ok: "Add link" }).then(function (url) {
        if (!url) return;
        if (!/^(https?:|mailto:)/i.test(url)) url = "https://" + url;
        body.focus();
        if (range) { sel.removeAllRanges(); sel.addRange(range); }
        if (!range || range.collapsed) document.execCommand("insertHTML", false, '<a href="' + escapeHtml(url) + '">' + escapeHtml(url) + "</a>");
        else document.execCommand("createLink", false, url);
        emit();
      });
    };
    bar.appendChild(link);
    var clear = el("button", "rtb", "Tx");
    clear.type = "button"; clear.title = "Clear formatting";
    clear.onmousedown = function (e) { e.preventDefault(); };
    clear.onclick = function () { cmd("removeFormat"); cmd("formatBlock", "P"); };
    bar.appendChild(clear);
    body.addEventListener("input", emit);
    body.addEventListener("paste", function (e) {
      e.preventDefault();
      var t = (e.clipboardData || window.clipboardData).getData("text/plain");
      document.execCommand("insertText", false, t);
    });
    body.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); link.click(); }
    });
    wrap.appendChild(bar);
    wrap.appendChild(body);
    return wrap;
  }

  /* --- market / ICP: ideal client profiles --- */

  var ICP_AVATARS = [["regime", "Regime"], ["institution", "Institution"], ["physician", "Physician"], ["lawyer", "Lawyer"], ["paralegal", "Paralegal"],
                     ["person", "Person"], ["law-firm", "Law firm"], ["clinic", "Clinic"], ["insurer", "Insurer"], ["employer", "Employer"], ["other", "Other"]];
  var AVATAR_SVG = {
    "upcoming": '<path d="M5 19l4-4"/><path d="M9 15c0-5 3-9 9-11-2 6-6 9-11 9"/><path d="M14 6l4 4"/><path d="M7 12H4M12 20v-3"/>',
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

  /* --- hero illustrations per segment type (flat scenes, app palette) --- */
  var HERO_DEFS = '<defs><linearGradient id="hg-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7f5f0"/><stop offset="1" stop-color="#e9e4d8"/></linearGradient><linearGradient id="hg-ink" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#16203a"/><stop offset="1" stop-color="#0f172a"/></linearGradient></defs>';
  var HERO_SVG = {
    "physician":
      '<rect width="420" height="180" fill="url(#hg-sky)"/>' +
      '<rect x="0" y="132" width="420" height="48" fill="#e2ddd2"/>' +
      '<rect x="292" y="30" width="86" height="70" rx="6" fill="#fbfaf7" stroke="#d9d3c6"/><path d="M335 44v42M314 65h42" stroke="#b8963e" stroke-width="7" stroke-linecap="round"/>' +
      '<rect x="40" y="104" width="150" height="10" rx="3" fill="#b8963e"/><rect x="48" y="114" width="8" height="24" fill="#8c6f26"/><rect x="174" y="114" width="8" height="24" fill="#8c6f26"/>' +
      '<rect x="60" y="86" width="52" height="18" rx="3" fill="#fbfaf7" stroke="#d9d3c6"/><path d="M66 92h40M66 98h28" stroke="#9aa3b2" stroke-width="2" stroke-linecap="round"/>' +
      '<circle cx="222" cy="52" r="20" fill="#e8c9a8"/><path d="M204 46c2-16 34-16 36 0-6-4-30-4-36 0z" fill="#3a2a1a"/>' +
      '<path d="M182 132c0-34 18-58 40-58s40 24 40 58z" fill="#fbfaf7" stroke="#d9d3c6"/><path d="M204 76l18 12 18-12" fill="none" stroke="#d9d3c6" stroke-width="2"/>' +
      '<path d="M210 78c-6 20-2 34 6 40M234 78c6 20 2 34-6 40" fill="none" stroke="#0f172a" stroke-width="3.5" stroke-linecap="round"/><circle cx="222" cy="122" r="6" fill="#0f172a"/><circle cx="222" cy="122" r="2.5" fill="#b8963e"/>' +
      '<rect x="20" y="20" width="60" height="42" rx="4" fill="#fbfaf7" stroke="#d9d3c6"/><path d="M28 34h44M28 44h30" stroke="#c9c2b3" stroke-width="3" stroke-linecap="round"/>',
    "lawyer":
      '<rect width="420" height="180" fill="url(#hg-sky)"/>' +
      '<rect x="0" y="126" width="420" height="54" fill="#d8d2c4"/>' +
      '<rect x="230" y="40" width="34" height="86" fill="#8c6f26"/><rect x="270" y="40" width="34" height="86" fill="#0f172a"/><rect x="310" y="40" width="34" height="86" fill="#4b5563"/><rect x="350" y="40" width="34" height="86" fill="#b8963e"/>' +
      '<path d="M236 60h22M276 60h22M316 60h22M356 60h22M236 100h22M316 100h22" stroke="#f7f5f0" stroke-width="2" opacity=".7"/>' +
      '<path d="M120 42v84M84 126h72" stroke="#0f172a" stroke-width="5" stroke-linecap="round"/><path d="M120 50L64 66M120 50l56 16" stroke="#0f172a" stroke-width="4" stroke-linecap="round"/>' +
      '<path d="M44 92a20 20 0 0 0 40 0z" fill="#b8963e"/><path d="M156 92a20 20 0 0 0 40 0z" fill="#b8963e"/><path d="M64 66l-20 26M64 66l20 26M176 66l-20 26M176 66l20 26" stroke="#0f172a" stroke-width="2"/>' +
      '<circle cx="120" cy="40" r="7" fill="#b8963e"/>',
    "law-firm":
      '<rect width="420" height="180" fill="url(#hg-sky)"/>' +
      '<rect x="0" y="140" width="420" height="40" fill="#d8d2c4"/>' +
      '<path d="M60 70L210 22l150 48z" fill="#0f172a"/><rect x="72" y="70" width="276" height="12" fill="#16203a"/>' +
      '<rect x="88" y="82" width="22" height="58" fill="#fbfaf7" stroke="#cfc8b9"/><rect x="140" y="82" width="22" height="58" fill="#fbfaf7" stroke="#cfc8b9"/><rect x="192" y="82" width="22" height="58" fill="#fbfaf7" stroke="#cfc8b9"/><rect x="244" y="82" width="22" height="58" fill="#fbfaf7" stroke="#cfc8b9"/><rect x="296" y="82" width="22" height="58" fill="#fbfaf7" stroke="#cfc8b9"/>' +
      '<rect x="72" y="140" width="276" height="8" fill="#b8963e"/>' +
      '<rect x="196" y="100" width="28" height="40" fill="#0f172a"/><circle cx="210" cy="52" r="10" fill="#b8963e"/>' +
      '<path d="M120 100h44M120 110h44M120 120h30" stroke="#c9c2b3" stroke-width="3" stroke-linecap="round" opacity=".0"/>',
    "clinic":
      '<rect width="420" height="180" fill="url(#hg-sky)"/>' +
      '<rect x="0" y="140" width="420" height="40" fill="#dcd7cb"/>' +
      '<rect x="96" y="54" width="228" height="86" rx="4" fill="#fbfaf7" stroke="#cfc8b9"/><rect x="96" y="44" width="228" height="14" rx="3" fill="#0f172a"/>' +
      '<rect x="112" y="70" width="30" height="24" rx="2" fill="#dfe6ef"/><rect x="156" y="70" width="30" height="24" rx="2" fill="#dfe6ef"/><rect x="234" y="70" width="30" height="24" rx="2" fill="#dfe6ef"/><rect x="278" y="70" width="30" height="24" rx="2" fill="#dfe6ef"/>' +
      '<rect x="194" y="98" width="32" height="42" rx="2" fill="#0f172a"/><rect x="204" y="114" width="4" height="8" fill="#b8963e"/>' +
      '<rect x="196" y="20" width="28" height="28" rx="6" fill="#b8963e"/><path d="M210 27v14M203 34h14" stroke="#0f172a" stroke-width="5" stroke-linecap="round"/>' +
      '<circle cx="48" cy="112" r="20" fill="#7a9a6b"/><rect x="45" y="128" width="6" height="14" fill="#5b4632"/><circle cx="372" cy="108" r="24" fill="#93ab84"/><rect x="369" y="128" width="6" height="14" fill="#5b4632"/>',
    "insurer":
      '<rect width="420" height="180" fill="url(#hg-sky)"/>' +
      '<rect x="0" y="136" width="420" height="44" fill="#dcd7cb"/>' +
      '<path d="M90 96a120 120 0 0 1 240 0z" fill="#b8963e"/><path d="M90 96a120 120 0 0 1 240 0" fill="none" stroke="#8c6f26" stroke-width="3"/><path d="M130 96c8-40 40-60 80-62M210 34c40 2 72 22 80 62" fill="none" stroke="#f7f5f0" stroke-width="2" opacity=".5"/>' +
      '<path d="M210 96v46a10 10 0 0 0 20 0" fill="none" stroke="#0f172a" stroke-width="5" stroke-linecap="round"/>' +
      '<path d="M150 136v-24l30-22 30 22v24z" fill="#fbfaf7" stroke="#cfc8b9"/><rect x="174" y="118" width="12" height="18" fill="#0f172a"/>' +
      '<rect x="236" y="116" width="60" height="20" rx="6" fill="#0f172a"/><circle cx="250" cy="138" r="6" fill="#4b5563"/><circle cx="282" cy="138" r="6" fill="#4b5563"/><path d="M246 116l8-10h24l8 10" fill="#0f172a"/>' +
      '<path d="M40 60l18 6v16c0 12-8 20-18 26-10-6-18-14-18-26V66z" fill="#fbfaf7" stroke="#8c6f26" stroke-width="2"/><path d="M33 82l5 5 10-11" fill="none" stroke="#2f7a4a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
    "employer":
      '<rect width="420" height="180" fill="url(#hg-sky)"/>' +
      '<rect x="0" y="140" width="420" height="40" fill="#d8d2c4"/>' +
      '<path d="M60 140V84l50 26V84l50 26V84l50 26v30z" fill="#4b5563"/><rect x="60" y="130" width="150" height="10" fill="#0f172a"/>' +
      '<rect x="74" y="40" width="14" height="50" fill="#0f172a"/><rect x="100" y="52" width="14" height="38" fill="#0f172a"/>' +
      '<rect x="232" y="60" width="130" height="80" rx="3" fill="#fbfaf7" stroke="#cfc8b9"/>' +
      '<rect x="244" y="72" width="22" height="16" fill="#dfe6ef"/><rect x="276" y="72" width="22" height="16" fill="#dfe6ef"/><rect x="308" y="72" width="22" height="16" fill="#dfe6ef"/><rect x="244" y="98" width="22" height="16" fill="#dfe6ef"/><rect x="276" y="98" width="22" height="16" fill="#dfe6ef"/><rect x="308" y="98" width="22" height="16" fill="#dfe6ef"/>' +
      '<rect x="284" y="118" width="26" height="22" fill="#0f172a"/><rect x="232" y="52" width="130" height="8" fill="#b8963e"/>' +
      '<circle cx="386" cy="118" r="8" fill="#e8c9a8"/><path d="M372 140c0-12 6-18 14-18s14 6 14 18z" fill="#0f172a"/><circle cx="216" cy="122" r="7" fill="#e8c9a8"/><path d="M204 140c0-10 5-15 12-15s12 5 12 15z" fill="#b8963e"/>',
    "regime":
      '<rect width="420" height="180" fill="url(#hg-ink)"/>' +
      '<rect x="0" y="140" width="420" height="40" fill="#0b1224"/>' +
      '<path d="M70 66L210 26l140 40z" fill="#b8963e"/><rect x="86" y="66" width="248" height="10" fill="#8c6f26"/>' +
      '<rect x="100" y="76" width="18" height="58" fill="#f7f5f0"/><rect x="146" y="76" width="18" height="58" fill="#f7f5f0"/><rect x="192" y="76" width="18" height="58" fill="#f7f5f0"/><rect x="238" y="76" width="18" height="58" fill="#f7f5f0"/><rect x="284" y="76" width="18" height="58" fill="#f7f5f0"/>' +
      '<rect x="86" y="134" width="248" height="6" fill="#f7f5f0"/><rect x="78" y="140" width="264" height="6" fill="#c9c2b3"/>' +
      '<circle cx="210" cy="50" r="9" fill="#0f172a"/><path d="M206 50l3 3 6-7" fill="none" stroke="#b8963e" stroke-width="2" stroke-linecap="round"/>' +
      '<rect x="24" y="40" width="30" height="40" rx="2" fill="#f7f5f0" opacity=".9"/><path d="M30 50h18M30 58h18M30 66h12" stroke="#4b5563" stroke-width="2" stroke-linecap="round"/><circle cx="46" cy="72" r="4" fill="#b8963e"/>',
    "institution":
      '<rect width="420" height="180" fill="url(#hg-sky)"/>' +
      '<rect x="0" y="140" width="420" height="40" fill="#d8d2c4"/>' +
      '<rect x="110" y="50" width="200" height="90" fill="#fbfaf7" stroke="#cfc8b9"/><path d="M100 50h220l-10-14H110z" fill="#0f172a"/>' +
      '<rect x="126" y="66" width="24" height="40" fill="#dfe6ef"/><rect x="166" y="66" width="24" height="40" fill="#dfe6ef"/><rect x="230" y="66" width="24" height="40" fill="#dfe6ef"/><rect x="270" y="66" width="24" height="40" fill="#dfe6ef"/>' +
      '<rect x="196" y="100" width="28" height="40" fill="#0f172a"/><rect x="110" y="140" width="200" height="6" fill="#b8963e"/>' +
      '<rect x="206" y="14" width="4" height="26" fill="#4b5563"/><path d="M210 14h26l-6 7 6 7h-26z" fill="#b8963e"/>',
    "paralegal":
      '<rect width="420" height="180" fill="url(#hg-sky)"/>' +
      '<rect x="0" y="136" width="420" height="44" fill="#e2ddd2"/>' +
      '<rect x="60" y="104" width="300" height="10" rx="3" fill="#8c6f26"/><rect x="70" y="114" width="8" height="22" fill="#5b4632"/><rect x="342" y="114" width="8" height="22" fill="#5b4632"/>' +
      '<circle cx="210" cy="56" r="18" fill="#e8c9a8"/><path d="M194 52c4-16 30-16 34 0-6-4-28-4-34 0z" fill="#3a2a1a"/>' +
      '<path d="M170 104c0-24 16-40 40-40s40 16 40 40z" fill="#0f172a"/><path d="M196 70l14 10 14-10" fill="none" stroke="#b8963e" stroke-width="3"/>' +
      '<rect x="252" y="76" width="70" height="28" rx="3" fill="#fbfaf7" stroke="#cfc8b9"/><path d="M260 86h54M260 94h36" stroke="#9aa3b2" stroke-width="2" stroke-linecap="round"/>' +
      '<rect x="96" y="70" width="60" height="34" rx="3" fill="#fbfaf7" stroke="#cfc8b9"/><rect x="104" y="78" width="44" height="18" fill="#dfe6ef"/>' +
      '<rect x="24" y="30" width="34" height="46" rx="2" fill="#fbfaf7" stroke="#cfc8b9"/><path d="M31 42h20M31 50h20M31 58h12" stroke="#c9c2b3" stroke-width="3" stroke-linecap="round"/>' +
      '<rect x="364" y="26" width="34" height="46" rx="2" fill="#fbfaf7" stroke="#cfc8b9"/><path d="M371 38h20M371 46h20M371 54h12" stroke="#c9c2b3" stroke-width="3" stroke-linecap="round"/>',
    "person":
      '<rect width="420" height="180" fill="url(#hg-sky)"/>' +
      '<rect x="0" y="136" width="420" height="44" fill="#e2ddd2"/>' +
      '<circle cx="210" cy="58" r="22" fill="#e8c9a8"/><path d="M190 52c4-18 36-18 40 0-8-4-32-4-40 0z" fill="#3a2a1a"/>' +
      '<path d="M160 136c0-30 22-50 50-50s50 20 50 50z" fill="#0f172a"/><path d="M196 88l14 12 14-12" fill="none" stroke="#b8963e" stroke-width="3"/>' +
      '<circle cx="330" cy="80" r="26" fill="#f2efe9" stroke="#d9d3c6"/><path d="M318 80h24M330 68v24" stroke="#b8963e" stroke-width="4" stroke-linecap="round" opacity=".0"/>' +
      '<circle cx="80" cy="96" r="16" fill="#7a9a6b"/><rect x="77" y="108" width="6" height="28" fill="#5b4632"/>',
    "other":
      '<rect width="420" height="180" fill="url(#hg-sky)"/>' +
      '<circle cx="210" cy="90" r="46" fill="#0f172a"/><circle cx="210" cy="90" r="14" fill="#b8963e"/>' +
      '<circle cx="90" cy="60" r="10" fill="#b8963e"/><circle cx="330" cy="120" r="10" fill="#b8963e"/><path d="M100 64l70 20M320 116l-70-20" stroke="#4b5563" stroke-width="2"/>'
  };
  function heroSvg(key) {
    return '<svg viewBox="0 0 420 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' + HERO_DEFS + (HERO_SVG[key] || HERO_SVG.other) + "</svg>";
  }

  function icpThumbEl(icp, cls) {
    var d = el("div", "icpthumb " + (icp.kind === "Regime" ? "regime" : "buyer") + (cls ? " " + cls : ""));
    if (icp.image) {
      d.classList.add("shot");
      var img = document.createElement("img");
      img.src = icp.image; img.alt = ""; img.loading = "lazy";
      img.onerror = function () { d.classList.remove("shot"); img.remove(); };
      d.appendChild(img);
      return d;
    }
    d.classList.add("scene");
    d.innerHTML = heroSvg(icp.kind === "Regime" && (icp.avatar === "person" || !icp.avatar) ? "regime" : icp.avatar);
    d.appendChild(el("span", "k", icp.kind === "Regime" ? "Regime" : avatarLabel(icp.avatar)));
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
    var c = el("div", "icpcard big");
    c.setAttribute("role", "button");
    c.tabIndex = 0;
    c.appendChild(icpThumbEl(icp));
    var top = el("div", "top");
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
    if (icp.description) c.appendChild(el("p", null, plain(icp.description)));
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
    c.appendChild(foot);
    var fl = featuresFor(icp).sort(function (a, b) { return a.name.localeCompare(b.name); });
    var fb = el("div", "cfeat");
    fb.appendChild(el("div", "lab", fl.length ? "Features they ask for · " + fl.length : "Features they ask for"));
    if (!fl.length) fb.appendChild(el("div", "note", "None tagged yet. Open the profile to tag some."));
    fl.slice(0, 7).forEach(function (f) {
      var r = el("button", "cf");
      r.appendChild(el("i", "sd " + stateClass(f.state)));
      r.appendChild(el("span", "nm", f.name));
      r.title = f.name + " · " + f.state;
      r.onclick = function (e) { e.stopPropagation(); open(f.id); };
      fb.appendChild(r);
    });
    if (fl.length > 7) {
      var moreB = el("button", "cf more", "+ " + (fl.length - 7) + " more");
      moreB.onclick = function (e) { e.stopPropagation(); openIcp(icp.id); };
      fb.appendChild(moreB);
    }
    c.appendChild(fb);
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
        if (f.note) td0.appendChild(el("span", null, plain(f.note)));
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
        c.appendChild(el("p", null, plain(f.note).slice(0, 88)));
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
    left.appendChild(icpThumbEl(icp, "hero"));
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
    left.appendChild(richEditor(icp.description, function (h) { icp.description = h; save(); }, isRegime ? "What this regime is, who it commissions, what it pays for." : "Who they are, what they buy, what matters to them.", "small"));

    left.appendChild(el("div", "sublab", "Notebook"));
    left.appendChild(richEditor(icp.notes, function (h) { icp.notes = h; save(); }, "Anything you learn about this segment: pricing, volumes, pains, quotes, sources. Bullet points, numbered lists, bold, links.", "writer"));
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

    var pimg2 = el("div", "panel");
    pimg2.style.marginTop = "18px";
    pimg2.appendChild(el("h3", null, "Image"));
    pimg2.appendChild(el("div", "note", icp.image ? "Shown on the card and at the top of this page." : "Add a logo, a photo or a chart for this segment. Until then the card shows its icon."));
    var upRow2 = el("div", "acts");
    upRow2.style.marginTop = "10px";
    var fileIn2 = document.createElement("input");
    fileIn2.type = "file"; fileIn2.accept = "image/*"; fileIn2.style.display = "none";
    fileIn2.onchange = function () { if (fileIn2.files && fileIn2.files[0]) uploadShot(icp, fileIn2.files[0]); };
    var up2 = el("button", "btn ghost", icp.image ? "Replace image" : "Add image");
    up2.onclick = function () { fileIn2.click(); };
    upRow2.appendChild(up2); upRow2.appendChild(fileIn2);
    if (icp.image) { var rm2 = el("button", "btn ghost", "Remove"); rm2.onclick = function () { removeShot(icp); }; upRow2.appendChild(rm2); }
    pimg2.appendChild(upRow2);
    right.appendChild(pimg2);

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

    host.appendChild(header((f.spaces || []).join(" · ").toUpperCase() || "FEATURE", f.name, [back, trashBtn(f, "hdr"), more]));

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

    left.appendChild(richEditor(f.note, function (h) { f.note = h; touch(f); save(); }, "What this feature is, where it stands, what has to happen next, and what the team needs to know.", "writer"));

    if (f.rnd) {
      left.appendChild(el("div", "sublab", "Research question"));
      left.appendChild(richEditor(f.rndQuestion, function (h) { f.rndQuestion = h; touch(f); save(); }, "The question the student should answer. What would a good result look like?", "small"));

      var planLab = el("div", "sublab planlab");
      planLab.appendChild(document.createTextNode("Experiment plan"));
      var planActs = el("span", "planacts");
      function importPlan(pick) {
        askMarkdown("Import the experiment plan", { pick: pick, ok: f.rndPlan ? "Replace the plan" : "Import" }).then(function (md) {
          if (!md) return;
          var sp = splitMdTitle(md);
          f.rndPlan = mdToHtml(sp.body || md);
          if (sp.title && (!f.name || /^New research item$|^New feature$|^Untitled$/.test(f.name))) f.name = sp.title;
          touch(f); save(); render();
          toast("Plan imported. It reaches the R&D folder in Drive on the next sync.");
        });
      }
      var pasteB = el("button", "chip", "Paste Markdown"); pasteB.onclick = function () { importPlan(false); };
      var upB = el("button", "chip", "Upload .md"); upB.onclick = function () { importPlan(true); };
      planActs.appendChild(pasteB); planActs.appendChild(upB);
      if (f.driveDoc) { var dd = el("a", "chip", "Open in Drive ↗"); dd.href = "https://docs.google.com/document/d/" + f.driveDoc + "/edit"; dd.target = "_blank"; dd.rel = "noopener"; planActs.appendChild(dd); }
      planLab.appendChild(planActs);
      left.appendChild(planLab);
      left.appendChild(richEditor(f.rndPlan, function (h) { f.rndPlan = h; touch(f); save(); }, "Hypothesis, method, data, success criteria, timeline. Paste Markdown straight in; it is converted.", "writer plan"));

      left.appendChild(el("div", "sublab", "Findings"));
      left.appendChild(richEditor(f.rndFindings, function (h) { f.rndFindings = h; touch(f); save(); }, "What was learned, what was tried, and the recommendation for the product.", "small"));
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
        function (v) { f.period = periodFor(v); touch(f); render(); save(); }, "When")],
     ["Takes", effortControl(f, function () { render(); })]
    ].forEach(function (pair) {
      var row = el("div", "field");
      row.appendChild(el("label", null, pair[0]));
      row.appendChild(pair[1]);
      p1.appendChild(row);
    });
    var flags = el("div", "statusflags");
    if (f.agreed) flags.appendChild(pill("Agreed", "st-live"));
    else if (BUILT_STATES.indexOf(f.state) !== -1 && driftList().indexOf(f) !== -1) flags.appendChild(pill("Built without agreement", "st-needs-work"));
    if (expectedEnd(f) && SHIPPED_STATES.indexOf(f.state) === -1) flags.appendChild(pill((overrunDays(f) ? overrunDays(f) + " days over · due " : "Due ") + dueLabel(f), overrunDays(f) ? "st-needs-work" : ""));
    if (flags.childNodes.length) p1.appendChild(flags);
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

    var pimg = el("div", "panel");
    pimg.style.marginTop = "18px";
    pimg.appendChild(el("h3", null, "Screenshot"));
    if (f.image) {
      var big = thumbEl(f, "page");
      pimg.appendChild(big);
    } else pimg.appendChild(el("div", "note", "No screenshot yet. Add one of the real screen so the card shows what it looks like."));
    var upRow = el("div", "acts");
    upRow.style.marginTop = "10px";
    var fileIn = document.createElement("input");
    fileIn.type = "file"; fileIn.accept = "image/*"; fileIn.style.display = "none";
    fileIn.onchange = function () { if (fileIn.files && fileIn.files[0]) uploadShot(f, fileIn.files[0]); };
    var up = el("button", "btn ghost", f.image ? "Replace" : "Add screenshot");
    up.onclick = function () { fileIn.click(); };
    upRow.appendChild(up); upRow.appendChild(fileIn);
    if (f.image) { var rm = el("button", "btn ghost", "Remove"); rm.onclick = function () { removeShot(f); }; upRow.appendChild(rm); }
    pimg.appendChild(upRow);
    right.appendChild(pimg);

    var pt = el("div", "panel");
    pt.style.marginTop = "18px";
    pt.appendChild(el("h3", null, "Thumbnail" + (f.image ? " (used when there is no screenshot)" : "")));
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
      var kl = el("div", "subgrid one");
      kids.forEach(function (k) { kl.appendChild(subCard(k, { onOpen: function (x) { open(x.id); } })); });
      ps.appendChild(kl);
    }
    if (!f.parent) {
      (f.spaces || []).forEach(function (sp) {
        var list = sectionsFor(sp);
        if (!list.length) return;
        var srow = el("div", "field");
        srow.appendChild(el("label", null, sp + " division"));
        var cur = (f.sections && f.sections[sp]) || "";
        srow.appendChild(selectOf([["", "Other"]].concat(list.map(function (x) { return [x, x]; })), cur, function (v) {
          f.sections = f.sections || {};
          if (v) f.sections[sp] = v; else delete f.sections[sp];
          touch(f); render(); save();
        }, sp + " division"));
        ps.appendChild(srow);
      });
      var addK = el("button", "btn ghost rowbtn", "+ Add a sub-feature");
      addK.onclick = function () { create(f.spaces.slice(), { parent: f.id, name: "New sub-feature", sections: f.sections ? JSON.parse(JSON.stringify(f.sections)) : {} }); };
      ps.appendChild(addK);
    } else {
      ps.appendChild(el("div", "note", "Sub-features sit in their parent's division."));
    }
    right.appendChild(ps);
    right.appendChild(foldable(pilotsPanel(f), "fp:pilots", true, "h3"));
    right.appendChild(foldable(evidencePanel(f), "fp:evidence", false, "h3"));
    right.appendChild(foldable(decisionsPanel(f), "fp:decisions", false, "h3"));
    right.appendChild(foldable(historyPanel(f), "fp:history", false, "h3"));

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
      return (f.name + " " + plain(f.note) + " " + f.owner + " " + f.state + " " + f.student + " " + plain(f.rndQuestion) + " " + (f.spaces || []).join(" ") + " " + icpsOf(f).map(function (i) { return i.name; }).join(" ") + (f.rnd ? " r&d research" : "")).toLowerCase().indexOf(q) !== -1;
    });
    host.appendChild(header("SEARCH", hits.length + (hits.length === 1 ? " result" : " results") + " for “" + ui.query.trim() + "”", []));
    var pad = el("div", "pad");
    if (!hits.length) pad.appendChild(el("div", "empty", "No match."));
    var rows = el("div", "rows");
    hits.forEach(function (f) {
      var r = featureRow(f, null, f.period ? laneOfPeriod(f, keys()) : "none");
      var pr = S.projects.filter(function (p) { return p.id === f.project; })[0];
      var where = (pr && pr.id !== S.current ? "In " + pr.name + " · " : "") + ((f.spaces || []).join(", ") || "no space");
      var pf = parentOf(f);
      if (pf) where += " · part of " + pf.name;
      r.querySelector(".body").appendChild(el("span", "meta", where));
      rows.appendChild(r);
    });
    pad.appendChild(rows);
    host.appendChild(pad);
  }

  /* ---------- actions ---------- */

  function create(spaces, extra, silent) {
    var f = { id: uid(), project: S.current, name: "New feature", state: "Proposed", agreed: false, owner: "Unassigned",
              spaces: spaces || [], period: null, effort: 0, effortUnit: "weeks", note: "", link: "", rnd: false, rndStage: "Backlog",
              student: "", rndQuestion: "", rndPlan: "", rndFindings: "", driveDoc: "", parent: null, thumb: "", image: "", sections: {}, created: Date.now(), updated: Date.now() };
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
  document.getElementById("find").oninput = function (e) { ui.query = e.target.value; renderView(); var fs = document.querySelector(".fsearch input"); if (fs) fs.value = e.target.value; };
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
