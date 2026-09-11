(function () {
  "use strict";

  var STATES = ["Proposed", "Research", "Planned", "Building", "Live", "Needs work", "Feature flag"];
  var BUILT_STATES = ["Building", "Live", "Needs work", "Feature flag"];
  var RND_STAGES = ["Backlog", "Assigned", "In progress", "Findings", "Concluded"];
  /* Nav items switched off for now. Remove a key here to bring the item back. */
  var HIDDEN_NAV = { parallel: true, timeline: true, changes: true };
  var ICONS = { roadmap: "▤", features: "◫", parallel: "⋔", timeline: "▦", rnd: "⚗", icp: "◎", space: "◆", changes: "◷", pilots: "◔" };

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
  var ui = { view: "roadmap", space: null, feature: null, grain: "month", group: "state", rmode: "quarters", preview: null,
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
  function flush() {
    if (!dirty || saving) return Promise.resolve();
    saving = true; dirty = false;
    setSaveState("Saving…");
    return fetch("/api/state", {
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
    if (["roadmap", "features", "parallel", "timeline", "rnd", "icp", "changes", "pilots"].indexOf(m[0]) !== -1) ui.view = m[0];
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
     ["icp", "Market / ICP", ICONS.icp, S.icps.length],
     ["pilots", "Pilots", ICONS.pilots, (S.pilots || []).length || null],
     ["changes", "What changed", ICONS.changes, (S.log || []).filter(function (e) { return e.t > Date.now() - 7 * 86400000; }).length || null]].filter(function (it) { return !HIDDEN_NAV[it[0]]; }).forEach(function (it) {
      var b = el("button", "navitem" + (it[0] === "rnd" ? " rnd" : ""));
      b.setAttribute("aria-current", String(ui.view === it[0] && !ui.feature));
      b.dataset.view = it[0];
      b.appendChild(el("span", "ic", it[2]));
      b.appendChild(el("span", "nm", it[1]));
      if (it[3] !== null) b.appendChild(el("span", "ct", String(it[3])));
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
    renderRoadmap(host);
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

    host.appendChild(header("PRODUCT ROADMAP", ui.rmode === "quarters" ? p.name + " by quarter" : ui.rmode === "months" ? p.name + " by month" : p.name + " deployment order", acts));

    var bar = el("div", "bar");
    var seg = el("div", "seg");
    [["Quarters", "quarters"], ["Months", "months"], ["List", "order"], ["Gantt", "gantt"]].forEach(function (m) {
      var b = el("button", null, m[0]);
      b.setAttribute("aria-pressed", String(ui.rmode === m[1]));
      b.onclick = function () { ui.rmode = m[1]; renderView(); };
      seg.appendChild(b);
    });
    bar.appendChild(seg);

    if (ui.rmode !== "quarters" && ui.rmode !== "months") {
      var g = el("div", "seg");
      [["Weekly", "week"], ["Monthly", "month"], ["Quarterly", "quarter"]].forEach(function (m) {
        var b = el("button", null, m[0]);
        b.setAttribute("aria-pressed", String(ui.grain === m[1]));
        b.onclick = function () { ui.grain = m[1]; renderView(); };
        g.appendChild(b);
      });
      bar.appendChild(g);
    }
    spaceChips(bar);
    bar.appendChild(ownerSelect(renderView));
    if (S.icps.length) bar.appendChild(icpSelect(renderView));
    host.appendChild(bar);

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
    var cols = "repeat(" + total + ", minmax(" + (mode === "months" ? 42 : 56) + "px, 1fr))" + (hasLater ? " minmax(120px, .8fr)" : "");
    var rowsSp = ui.spaceFilter ? [ui.spaceFilter] : S.spaces.slice();

    var pad = el("div", "pad");
    var frame = el("div", "qframe");
    var head = el("div", "qrow qhead");
    head.appendChild(el("div", "qteam", "Teams"));
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
      items.sort(function (a, b) { return a.period < b.period ? -1 : a.period > b.period ? 1 : 0; });
      var row = el("div", "qrow tone-" + (S.spaces.indexOf(sp) % 4));
      var name = el("div", "qteam");
      name.appendChild(el("b", null, sp));
      name.appendChild(el("span", "qn", items.length ? items.length + (items.length === 1 ? " feature" : " features") : "Nothing scheduled"));
      row.appendChild(name);
      var lanes = el("div", "qlanes");
      var n = Math.max(items.length, 1);
      lanes.style.gridTemplateColumns = cols;
      lanes.style.gridTemplateRows = "repeat(" + n + ", 46px)";
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
      items.forEach(function (f, idx) {
        var pos = M.posOf(f), span = M.span;
        var days = effortDays(f);
        var slotDays = mode === "months" ? 7 : 30;
        var est = days > 0;
        span = est ? Math.max(1, Math.round(days / slotDays)) : 2;
        if (pos === -1) { pos = total; span = 1; }
        if (pos + span > total && pos < total) span = total - pos;
        var shortPill = span <= 2;
        var pill = el("button", "qpill " + stateClass(f.state) + (est ? "" : " noest") + (shortPill ? " short" : ""));
        pill.style.gridColumn = (pos + 1) + " / span " + span;
        pill.style.gridRow = String(idx + 1);
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
        if (tag && shortPill) nmEl.appendChild(el("span", "mo2" + (over ? " overtag" : ""), " · " + tag));
        else if (tag) pill.appendChild(el("span", "mo" + (over ? " overtag" : ""), tag));
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
    foot.appendChild(el("span", "note", (mode === "months" ? "Each month is split into weeks. " : "") + "Pill length is the estimate; dashed pills have none yet. Drag to move, × to take off the roadmap, click for details." + (shipped ? " " + shipped + " live features without a date are not shown." : "")));
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
  var LOG_FIELDS = { created: "Created", deleted: "Deleted", name: "Name", state: "State", owner: "Owner", period: "Date", effort: "Estimate", agreed: "Agreed",
    spaces: "Spaces", parent: "Parent", rnd: "R&D", rndStage: "R&D stage", student: "Student", link: "Drive link", note: "Description", image: "Screenshot" };
  /* Drift: exists in the product (Building or beyond) without ever having been Planned, and not marked agreed.
     Features with no history at all were inventoried from the live apps and are left alone. */
  function driftList() {
    var byF = {};
    (S.log || []).forEach(function (e) { (byF[e.fid] = byF[e.fid] || []).push(e); });
    return feats().filter(function (f) {
      if (f.agreed || BUILT_STATES.indexOf(f.state) === -1) return false;
      var es = byF[f.id];
      if (!es || !es.length) return false;
      if (es.some(function (e) { return e.field === "state" && e.to === "Planned"; })) return false;
      var born = es.filter(function (e) { return e.field === "created"; })[0];
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
  var PILOT_STATUS = ["Prospect", "Piloting", "Live client", "Paused"];
  var PILOT_STATUS_CLASS = { "Prospect": "st-planned", "Piloting": "st-building", "Live client": "st-live", "Paused": "st-feature-flag" };
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

  function renderPilots(host) {
    if (ui.pilot) { var cur = pilotById(ui.pilot); if (cur) return renderPilotPage(host, cur); ui.pilot = null; }
    host.appendChild(header("PILOTS", project().name + " · who we are piloting with", [newBtn("NEW PILOT", newPilot)]));
    var pad = el("div", "pad");
    var dir = el("div", "dir");
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
      var w = pilotFeats(p, "wants").length, l = pilotLive(p).length, n = pilotFeats(p, "needs").length;
      var dn = (p.deliverables || []).length;
      var rq = (p.requests || []).length, rqU = (p.requests || []).filter(function (r) { return r.decision === "Undecided"; }).length;
      tx.appendChild(el("span", null, (w ? w + " asked for · " + l + " of those live" : "Nothing asked for yet") + (n ? " · " + n + " we think they need" : "") + (dn ? " · " + dn + (dn === 1 ? " deliverable" : " deliverables") : "") + (rq ? " · " + rq + (rq === 1 ? " request" : " requests") + (rqU ? " (" + rqU + " to decide)" : "") : "") + (p.contact ? " · " + p.contact : "")));
      t.appendChild(tx);
      var nn = el("div", "n");
      nn.appendChild(el("b", null, w ? Math.round(100 * l / w) + "%" : "—"));
      nn.appendChild(el("span", null, "of asks live"));
      t.appendChild(nn);
      t.onclick = function () { ui.pilot = p.id; ui.pilotTab = "overview"; renderView(); };
      tiles.appendChild(t);
    });
    dir.appendChild(tiles);
    var across = requestsAcrossPilots();
    if (across) dir.appendChild(across);
    pad.appendChild(dir);
    host.appendChild(pad);
  }

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

  function renderPilotPage(host, p) {
    var back = el("button", "btn ghost", "Pilots");
    back.onclick = function () { ui.pilot = null; renderView(); };
    var more = menu("More", [
      ["Rename", function () { askText("Rename pilot", { value: p.name, ok: "Rename" }).then(function (n) { if (n) { p.name = n; p.updated = Date.now(); render(); save(); } }); }],
      "-",
      ["Delete", function () { deletePilot(p); }, true]
    ]);
    host.appendChild(header("PILOT", p.name, [back, more]));
    host.appendChild(pilotTabs(p));
    if (ui.pilotTab === "deliverables") return renderPilotDeliverables(host, p);
    if (ui.pilotTab === "requests") return renderPilotRequests(host, p);
    if (ui.pilotTab === "stack") return renderPilotStack(host, p);
    var pad = el("div", "pad");
    var grid = el("div", "grid2 pilotgrid");
    var left = el("div"), right = el("div");

    /* left: facts and notebook */
    var pf = el("div", "panel");
    pf.appendChild(el("h3", null, "About"));
    [["Status", selectOf(PILOT_STATUS, p.status, function (v) { p.status = v; p.updated = Date.now(); render(); save(); }, "Status")],
     ["Profile", selectOf([["", "No profile"]].concat(S.icps.filter(function (x) { return x.kind === "Buyer"; }).map(function (x) { return [x.id, x.name]; })), p.icp || "", function (v) { p.icp = v; p.updated = Date.now(); render(); save(); }, "Buyer profile")],
     ["Since", selectOf((function () { var ks = [], m = mAdd(mKey(new Date()), -12); for (var i = 0; i < 24; i++) ks.push([mAdd(m, i), mLong(mAdd(m, i))]); return ks; })(), p.since || mKey(new Date()), function (v) { p.since = v; p.updated = Date.now(); save(); }, "Since")]
    ].forEach(function (pair) {
      var row = el("div", "field");
      row.appendChild(el("label", null, pair[0]));
      row.appendChild(pair[1]);
      pf.appendChild(row);
    });
    var crow = el("div", "field");
    crow.appendChild(el("label", null, "Contact"));
    var cin = el("input"); cin.value = p.contact || ""; cin.placeholder = "Name, role, email";
    cin.setAttribute("aria-label", "Contact");
    cin.onchange = function () { p.contact = cin.value.trim(); p.updated = Date.now(); save(); };
    crow.appendChild(cin); pf.appendChild(crow);
    var lrow = el("div", "field");
    lrow.appendChild(el("label", null, "Drive"));
    var lin = el("input"); lin.value = p.link || ""; lin.placeholder = "https://drive.google.com/…";
    lin.setAttribute("aria-label", "Drive link");
    lin.onchange = function () { p.link = lin.value.trim(); p.updated = Date.now(); save(); render(); };
    lrow.appendChild(lin);
    if (p.link) { var go = el("a", "btn ghost", "Open"); go.href = p.link; go.target = "_blank"; go.rel = "noopener"; lrow.appendChild(go); }
    pf.appendChild(lrow);
    left.appendChild(pf);

    var pn = el("div", "panel");
    pn.style.marginTop = "18px";
    pn.appendChild(el("h3", null, "Notebook"));
    pn.appendChild(richEditor(p.notes, function (h) { p.notes = h; p.updated = Date.now(); save(); }, "What they do, what hurts, what they said, next steps, dates.", "writer"));
    left.appendChild(pn);

    /* right: the three lists */
    var listMode = pilotListMode();
    var modeRow = el("div", "listmode");
    var mseg = el("div", "seg small");
    [["List", "list"], ["Grid", "grid"]].forEach(function (m) {
      var b = el("button", null, m[0]);
      b.setAttribute("aria-pressed", String(listMode === m[1]));
      b.onclick = function () { setPilotListMode(m[1]); renderView(); };
      mseg.appendChild(b);
    });
    modeRow.appendChild(mseg);
    right.appendChild(modeRow);
    function listPanel(title, hint, key, derived) {
      var pnl = el("div", "panel plist");
      var h = el("h3", null, title);
      pnl.appendChild(h);
      pnl.appendChild(el("div", "note", hint));
      var rows = el("div", "pilotrows" + (listMode === "grid" ? " grid" : ""));
      var items = derived ? pilotLive(p) : pilotFeats(p, key);
      if (!items.length) rows.appendChild(el("div", "note empty2", derived ? "Nothing they asked for is live yet." : "Nothing here yet."));
      items.forEach(function (f) {
        rows.appendChild(pilotFeatureRow(f, derived ? null : function (x) { p[key] = (p[key] || []).filter(function (id) { return id !== x.id; }); p.updated = Date.now(); render(); save(); }));
      });
      pnl.appendChild(rows);
      if (!derived) {
        var add = el("button", "btn ghost rowbtn", "+ Add a feature");
        add.onclick = function () {
          pickFeature(title, p[key] || []).then(function (f) {
            if (!f) return;
            p[key] = (p[key] || []).concat([f.id]); p.updated = Date.now(); render(); save();
          });
        };
        pnl.appendChild(add);
      }
      return pnl;
    }
    right.appendChild(listPanel("They asked for", "Features this client requested. Their state shows how far along each one is.", "wants", false));
    var lv = listPanel("Live for them", "Derived: what they asked for that is already shipped.", "wants", true);
    lv.style.marginTop = "18px"; right.appendChild(lv);
    var nd = listPanel("We think they will need", "Our own view of what will matter to them, before they ask.", "needs", false);
    nd.style.marginTop = "18px"; right.appendChild(nd);

    grid.appendChild(left); grid.appendChild(right);
    pad.appendChild(grid);
    host.appendChild(pad);
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

  function pilotTabs(p) {
    var bar = el("div", "bar modebar");
    var seg = el("div", "seg");
    [["Overview", "overview"], ["Requests" + ((p.requests || []).length ? " · " + p.requests.length : ""), "requests"], ["Deliverables" + ((p.deliverables || []).length ? " · " + p.deliverables.length : ""), "deliverables"], ["Software & partners" + ((p.stack || []).length ? " · " + p.stack.length : ""), "stack"]].forEach(function (m) {
      var b = el("button", null, m[0]);
      b.setAttribute("aria-pressed", String((ui.pilotTab || "overview") === m[1]));
      b.onclick = function () { ui.pilotTab = m[1]; renderView(); };
      seg.appendChild(b);
    });
    bar.appendChild(seg);
    return bar;
  }

  function renderPilotDeliverables(host, p) {
    var pad = el("div", "pad");
    var dir = el("div", "dir");
    var list = p.deliverables || [];
    var allF = [];
    list.forEach(function (d) { delivFeats(d).forEach(function (f) { if (allF.indexOf(f) === -1) allF.push(f); }); });
    var liveN = allF.filter(function (f) { return f.state === "Live" || f.state === "Needs work" || f.state === "Feature flag"; }).length;

    var intro = el("div", "dsum");
    intro.appendChild(el("b", null, list.length ? list.length + (list.length === 1 ? " deliverable" : " deliverables") + " · " + allF.length + " features involved · " + liveN + " live" : "No deliverables yet"));
    intro.appendChild(el("span", "note", "Each deliverable is something the client gets. Tag the features that provide it, label quick wins, and drag the order to say what we build first."));
    dir.appendChild(intro);

    var wrap = el("div", "delivs");
    if (!list.length) wrap.appendChild(el("div", "empty", "Add the first deliverable: the outcome the client is waiting for, in their words."));
    list.forEach(function (d, i) {
      var card = el("div", "deliv");
      card.draggable = true;
      card.addEventListener("dragstart", function (e) { e.dataTransfer.setData("text/plain", "deliv:" + d.id); card.classList.add("dragging"); });
      card.addEventListener("dragend", function () { card.classList.remove("dragging"); });
      card.addEventListener("dragover", function (e) { e.preventDefault(); card.classList.add("dragover"); });
      card.addEventListener("dragleave", function () { card.classList.remove("dragover"); });
      card.addEventListener("drop", function (e) {
        e.preventDefault(); card.classList.remove("dragover");
        var id = (e.dataTransfer.getData("text/plain") || "").replace(/^deliv:/, "");
        var from = list.findIndex(function (x) { return x.id === id; });
        if (from === -1 || from === i) return;
        var moved = list.splice(from, 1)[0];
        list.splice(i, 0, moved);
        touchPilot(p); render(); save();
      });

      var head = el("div", "dhead");
      var num = el("span", "dnum", String(i + 1));
      head.appendChild(num);
      var title = el("input", "dtitle");
      title.value = d.title; title.placeholder = "What the client gets, in their words";
      title.setAttribute("aria-label", "Deliverable title");
      title.onchange = function () { d.title = title.value.trim() || "Untitled deliverable"; touchPilot(p); save(); };
      head.appendChild(title);
      var tagSel = selectOf(DELIV_TAGS.map(function (t) { return [t, t || "No label"]; }), d.tag || "", function (v) { d.tag = v; touchPilot(p); render(); save(); }, "Label");
      tagSel.classList.add("dtag");
      if (d.tag && DELIV_TAG_CLASS[d.tag]) tagSel.classList.add(DELIV_TAG_CLASS[d.tag]);
      head.appendChild(tagSel);
      var prog = delivProgress(d);
      head.appendChild(el("span", "dprog" + (prog && prog.live === prog.total ? " done" : ""), prog ? prog.live + " of " + prog.total + " live" : "no features yet"));
      var up = el("button", "dmove", "↑"); up.title = "Move up"; up.disabled = i === 0;
      up.onclick = function () { list.splice(i - 1, 0, list.splice(i, 1)[0]); touchPilot(p); render(); save(); };
      var down = el("button", "dmove", "↓"); down.title = "Move down"; down.disabled = i === list.length - 1;
      down.onclick = function () { list.splice(i + 1, 0, list.splice(i, 1)[0]); touchPilot(p); render(); save(); };
      head.appendChild(up); head.appendChild(down);
      var del = el("button", "dmove del", "×"); del.title = "Delete deliverable";
      del.onclick = function () {
        askConfirm("Delete “" + d.title + "”?", "Features stay untouched.", { danger: true, ok: "Delete" }).then(function (yes) {
          if (!yes) return;
          p.deliverables = list.filter(function (x) { return x.id !== d.id; }); touchPilot(p); render(); save();
        });
      };
      head.appendChild(del);
      card.appendChild(head);

      card.appendChild(richEditor(d.note, function (h) { d.note = h; touchPilot(p); save(); }, "Why it matters to them, what done looks like, open questions from the team.", "small dnote"));

      var fl = el("div", "dfeats");
      delivFeats(d).forEach(function (f) {
        var chip = el("span", "dchip " + stateClass(f.state));
        var b = el("button", null, f.name);
        b.title = f.state + (f.effort ? " · takes " + effortLabel(f, true) : "") + (f.owner && f.owner !== "Unassigned" ? " · " + f.owner : "");
        b.onclick = function () { open(f.id); };
        chip.appendChild(el("i", "sd " + stateClass(f.state)));
        chip.appendChild(b);
        if (f.effort) chip.appendChild(el("em", null, effortLabel(f)));
        var x = el("button", "x", "×"); x.setAttribute("aria-label", "Untag " + f.name);
        x.onclick = function () { d.features = (d.features || []).filter(function (id) { return id !== f.id; }); touchPilot(p); render(); save(); };
        chip.appendChild(x);
        fl.appendChild(chip);
      });
      var addF = el("button", "chip", "+ Tag a feature");
      addF.onclick = function () {
        pickFeature("Which feature provides “" + d.title + "”?", d.features || []).then(function (f) {
          if (!f) return;
          d.features = (d.features || []).concat([f.id]); touchPilot(p); render(); save();
        });
      };
      fl.appendChild(addF);
      card.appendChild(fl);
      wrap.appendChild(card);
    });
    dir.appendChild(wrap);

    var addD = el("button", "btn ghost rowbtn", "+ Add a deliverable");
    addD.style.marginTop = "14px";
    addD.onclick = function () {
      askText("New deliverable", { placeholder: "For example: a medical chronology within 24 hours of upload", ok: "Add" }).then(function (t) {
        if (!t) return;
        p.deliverables = (p.deliverables || []).concat([{ id: uid(), title: t, note: "", tag: "", features: [] }]);
        touchPilot(p); render(); save();
      });
    };
    dir.appendChild(addD);

    /* derived build order: features in the order their deliverables sit, not yet live first */
    if (allF.length) {
      var order = el("div", "dirsec");
      order.style.marginTop = "36px";
      var h = el("h2", null, "Build order for this pilot");
      h.appendChild(el("em", null, allF.length + " features"));
      order.appendChild(h);
      order.appendChild(el("div", "note", "Features in the order their deliverables are ranked. Live ones are shown last so the queue is what is left to do."));
      var todo = allF.filter(function (f) { return ["Live", "Needs work", "Feature flag"].indexOf(f.state) === -1; });
      var done = allF.filter(function (f) { return todo.indexOf(f) === -1; });
      var rows = el("div", "pilotrows buildorder");
      todo.concat(done).forEach(function (f, idx) {
        var r = pilotFeatureRow(f, null);
        var n = el("span", "dnum small", String(idx + 1));
        r.insertBefore(n, r.firstChild);
        var which = list.filter(function (d) { return (d.features || []).indexOf(f.id) !== -1; }).map(function (d) { return d.title; });
        var extra = el("span", "d");
        extra.appendChild(el("span", "note", "for " + which.join(", ") + (f.effort ? " · takes " + effortLabel(f, true) : " · no estimate")));
        r.querySelector(".t").appendChild(extra);
        if (todo.indexOf(f) === -1) r.classList.add("isdone");
        rows.appendChild(r);
      });
      order.appendChild(rows);
      dir.appendChild(order);
    }
    pad.appendChild(dir);
    host.appendChild(pad);
  }

  /* --- requests: what a pilot asked for, in their words, before it is (or is not) a feature --- */
  var REQ_FIT = ["", "Core to ALIE", "Adjacent", "Out of scope"];
  var REQ_DECISION = ["Undecided", "Build", "Integrate or partner", "Later", "Declined"];
  var REQ_DECISION_CLASS = { "Undecided": "", "Build": "st-live", "Integrate or partner": "st-building", "Later": "st-planned", "Declined": "st-needs-work" };
  function reqKey(t) { return String(t || "").toLowerCase().replace(/[^a-z0-9àâçéèêëîïôûùüÿœ ]+/g, " ").replace(/\s+/g, " ").trim(); }
  function allRequests() {
    var out = [];
    pilots().forEach(function (p) { (p.requests || []).forEach(function (r) { out.push({ pilot: p, r: r }); }); });
    return out;
  }
  function requestsFor(f) { return allRequests().filter(function (x) { return x.r.feature === f.id; }); }

  function renderPilotRequests(host, p) {
    var pad = el("div", "pad");
    var dir = el("div", "dir");
    var list = p.requests || [];
    var undecided = list.filter(function (r) { return r.decision === "Undecided"; }).length;
    var intro = el("div", "dsum");
    intro.appendChild(el("b", null, list.length ? list.length + (list.length === 1 ? " request" : " requests") + (undecided ? " · " + undecided + " to decide" : " · all decided") : "No requests yet"));
    intro.appendChild(el("span", "note", "Anything they raised, whether or not it fits ALIE. Write the bottleneck, the business need and a possible solution; decide with the team; promote to a feature only what we build."));
    dir.appendChild(intro);

    var wrap = el("div", "delivs");
    if (!list.length) wrap.appendChild(el("div", "empty", "Add the first request: the title in their words, then what slows them down today, why it matters to the business, and what could solve it."));
    list.forEach(function (r, i) {
      var card = el("div", "deliv req");
      var head = el("div", "dhead");
      head.appendChild(el("span", "dnum", String(i + 1)));
      var title = el("input", "dtitle");
      title.value = r.title; title.placeholder = "What they asked for, in their words";
      title.setAttribute("aria-label", "Request title");
      title.onchange = function () { r.title = title.value.trim() || "Untitled request"; r.updated = Date.now(); touchPilot(p); save(); };
      head.appendChild(title);
      var decSel = selectOf(REQ_DECISION.map(function (d) { return [d, d]; }), r.decision || "Undecided", function (v) {
        r.decision = v; r.updated = Date.now(); touchPilot(p);
        if (v === "Undecided") { render(); save(); return; }
        askText("Why " + v.toLowerCase() + "?", { value: r.reason || "", placeholder: "One line the team will understand in six months.", ok: "Save" }).then(function (t) { if (t !== null) r.reason = t; render(); save(); });
      }, "Decision");
      decSel.classList.add("dtag"); if (REQ_DECISION_CLASS[r.decision]) decSel.classList.add(REQ_DECISION_CLASS[r.decision]);
      head.appendChild(decSel);
      var del = el("button", "dmove del", "×"); del.title = "Delete request";
      del.onclick = function () {
        askConfirm("Delete “" + r.title + "”?", "The record of this request goes away.", { danger: true, ok: "Delete" }).then(function (yes) {
          if (!yes) return;
          p.requests = list.filter(function (x) { return x.id !== r.id; }); touchPilot(p); render(); save();
        });
      };
      head.appendChild(del);
      card.appendChild(head);

      var meta = el("div", "reqmeta");
      var fitRow = el("span", "reqfit");
      fitRow.appendChild(el("label", null, "Fit"));
      fitRow.appendChild(selectOf(REQ_FIT.map(function (x) { return [x, x || "Not assessed"]; }), r.fit || "", function (v) { r.fit = v; r.updated = Date.now(); touchPilot(p); save(); }, "Fit"));
      meta.appendChild(fitRow);
      var src = el("span", "reqsrc");
      src.appendChild(el("label", null, "Source"));
      var sin = el("input"); sin.value = r.source || ""; sin.placeholder = "Who said it, when · Drive link";
      sin.setAttribute("aria-label", "Source");
      sin.onchange = function () { r.source = sin.value.trim(); r.updated = Date.now(); touchPilot(p); save(); };
      src.appendChild(sin);
      if (/^https?:\/\//.test(r.source || "")) { var go = el("a", "chip", "Open"); go.href = r.source; go.target = "_blank"; go.rel = "noopener"; src.appendChild(go); }
      meta.appendChild(src);
      if (r.decision !== "Undecided" && r.reason) meta.appendChild(el("span", "reqwhy", "Why: " + r.reason));
      card.appendChild(meta);

      var secs = el("div", "reqsecs");
      [["bottleneck", "Current bottleneck", "What happens today, who does it, how often, how long it takes."],
       ["need", "Business need", "Why it matters to them: what it costs, what it blocks, what changes if it is solved."],
       ["solution", "Possible solution", "Build, integrate with what they use, partner, or nothing. First take, not a commitment."]].forEach(function (s) {
        var sec = el("div", "reqsec");
        sec.appendChild(el("div", "lab", s[1]));
        sec.appendChild(richEditor(r[s[0]], function (h) { r[s[0]] = h; r.updated = Date.now(); touchPilot(p); save(); }, s[2], "small dnote"));
        secs.appendChild(sec);
      });
      card.appendChild(secs);

      var foot = el("div", "dfeats");
      var lf = r.feature ? feature(r.feature) : null;
      if (lf) {
        var chip = el("span", "dchip " + stateClass(lf.state));
        var b = el("button", null, "Feature: " + lf.name); b.onclick = function () { open(lf.id); };
        chip.appendChild(el("i", "sd " + stateClass(lf.state))); chip.appendChild(b);
        chip.appendChild(pill(lf.state, "st " + stateClass(lf.state)));
        foot.appendChild(chip);
      } else {
        var promote = el("button", "chip", "↑ Promote to a Proposed feature");
        promote.onclick = function () {
          askConfirm("Promote “" + r.title + "” to a feature?", "It starts as Proposed, carries the bottleneck, need and solution as its description, and joins this pilot's asks. Nothing is agreed until you move it to Planned.", { ok: "Promote" }).then(function (yes) {
            if (!yes) return;
            var note = "<p><b>From " + escapeHtml(p.name) + "'s request.</b></p>" +
              (r.bottleneck ? "<h4>Current bottleneck</h4>" + richHtml(r.bottleneck) : "") +
              (r.need ? "<h4>Business need</h4>" + richHtml(r.need) : "") +
              (r.solution ? "<h4>Possible solution</h4>" + richHtml(r.solution) : "");
            var f = create([], { name: r.title, state: "Proposed", note: note }, true);
            r.feature = f.id; if (r.decision === "Undecided") r.decision = "Build";
            if ((p.wants || []).indexOf(f.id) === -1) p.wants = (p.wants || []).concat([f.id]);
            r.updated = Date.now(); touchPilot(p); save();
            toast(r.title + " is now a Proposed feature. Give it a space and a division.");
            open(f.id);
          });
        };
        foot.appendChild(promote);
      }
      card.appendChild(foot);
      wrap.appendChild(card);
    });
    dir.appendChild(wrap);

    var addR = el("button", "btn ghost rowbtn", "+ Add a request");
    addR.style.marginTop = "14px";
    addR.onclick = function () {
      askText("New request", { placeholder: "For example: automated retainer and power of attorney prepopulation", ok: "Add" }).then(function (t) {
        if (!t) return;
        p.requests = (p.requests || []).concat([{ id: uid(), title: t, bottleneck: "", need: "", solution: "", fit: "", decision: "Undecided", reason: "", source: "", feature: "", created: Date.now(), updated: Date.now() }]);
        touchPilot(p); render(); save();
      });
    };
    dir.appendChild(addR);
    pad.appendChild(dir);
    host.appendChild(pad);
  }

  /* pilots list: the same ask coming from several pilots is the signal */
  function requestsAcrossPilots() {
    var all = allRequests();
    if (!all.length) return null;
    var groups = {}, order = [];
    all.forEach(function (x) { var k = reqKey(x.r.title); if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(x); });
    order.sort(function (a, b) { return groups[b].length - groups[a].length; });
    var sec = el("div", "dirsec");
    sec.style.marginTop = "36px";
    var h = el("h2", null, "Requests across pilots");
    h.appendChild(el("em", null, all.length + (all.length === 1 ? " request" : " requests")));
    sec.appendChild(h);
    sec.appendChild(el("div", "note", "Everything pilots raised, most-shared first. The same ask from several pilots is the product-market-fit signal."));
    var rows = el("div", "pilotrows");
    order.forEach(function (k) {
      var xs = groups[k];
      var r = el("div", "dirrow prow reqrow");
      var n = el("span", "dnum small" + (xs.length > 1 ? " hot" : ""), String(xs.length));
      r.appendChild(n);
      var t = el("div", "t");
      t.appendChild(el("b", null, xs[0].r.title));
      var d = el("span", "d");
      xs.forEach(function (x) {
        var b = el("button", "chip", x.pilot.name + (x.r.decision !== "Undecided" ? " · " + x.r.decision : ""));
        b.onclick = function () { ui.pilot = x.pilot.id; ui.pilotTab = "requests"; renderView(); };
        d.appendChild(b);
      });
      var fits = xs.map(function (x) { return x.r.fit; }).filter(Boolean).filter(function (v, i, a) { return a.indexOf(v) === i; });
      fits.forEach(function (fv) { d.appendChild(pill(fv, fv === "Core to ALIE" ? "st-live" : fv === "Adjacent" ? "st-planned" : "st-needs-work")); });
      t.appendChild(d);
      r.appendChild(t);
      rows.appendChild(r);
    });
    sec.appendChild(rows);
    return sec;
  }

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
      var cards = el("div", "bigcards");
      kids.forEach(function (k, i) {
        var c = el("div", "bigcard " + stateClass(k.state));
        c.id = "card-" + k.id;
        c.setAttribute("role", "group");
        c.draggable = true;
        c.dataset.id = k.id;
        var th = thumbEl(k);
        th.classList.add("clickable");
        th.setAttribute("role", "button");
        th.tabIndex = 0;
        th.setAttribute("aria-label", "Preview " + k.name);
        th.appendChild(el("span", "zoomhint", "Preview"));
        th.onclick = function (e) { e.stopPropagation(); lightbox(k, kids); };
        th.onkeydown = function (e) { if (e.key === "Enter") lightbox(k, kids); };
        c.appendChild(th);
        var ch = el("div", "bch");
        var tt = el("button", "cardtitle");
        tt.appendChild(el("span", "num", String(i + 1)));
        tt.appendChild(el("h3", null, k.name));
        tt.onclick = function () { ui.spaceSel = k.id; renderView(); };
        ch.appendChild(tt);
        ch.appendChild(statePill(k));
        ch.appendChild(trashBtn(k));
        c.appendChild(ch);
        c.appendChild(el("p", null, plain(k.note) || "No description yet."));
        var extra = el("div", "bcf");
        if (k.spaces.some(function (s) { return s !== sp; })) extra.appendChild(domainBadges(k));
        if (k.owner && k.owner !== "Unassigned") extra.appendChild(pill(k.owner));
        if (k.period) extra.appendChild(pill(periodShort(k)));
        c.appendChild(extra);
        wireDrag(c, k, null);
        cards.appendChild(c);
      });
      var add = el("button", "bigcard add");
      add.appendChild(el("h3", null, "+ Add a sub-functionality"));
      add.appendChild(el("p", null, "It shows up here and in the sub-menu."));
      add.onclick = function () { create(f.spaces.slice(), { parent: f.id, name: "New sub-feature", sections: f.sections ? JSON.parse(JSON.stringify(f.sections)) : {} }); };
      cards.appendChild(add);
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
    if (f.rndQuestion) c.appendChild(el("p", "q", plain(f.rndQuestion).slice(0, 140)));
    else c.appendChild(el("p", null, (plain(f.note) || "No research question yet.").slice(0, 92)));
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

  /* --- rich text: a small editor for notes and descriptions, with safe rendering --- */

  var RICH_TAGS = { P: 1, BR: 1, B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, UL: 1, OL: 1, LI: 1, H3: 1, H4: 1, A: 1, BLOCKQUOTE: 1, CODE: 1 };
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
      if (pEl.querySelector("ul, ol, h3, h4, blockquote, p")) { while (pEl.firstChild) pEl.parentNode.insertBefore(pEl.firstChild, pEl); pEl.remove(); }
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
    right.appendChild(pilotsPanel(f));
    right.appendChild(historyPanel(f));

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
              student: "", rndQuestion: "", rndFindings: "", parent: null, thumb: "", image: "", sections: {}, created: Date.now(), updated: Date.now() };
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
