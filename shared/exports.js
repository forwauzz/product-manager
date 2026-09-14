/* Plain-text views of the document for Drive: a pilot record (Markdown) and two CSV sheets.
   Pure functions of the state, shared by the scripts and the Worker's Drive sync. */

export function plain(html) {
  return String(html || "").replace(/<li>/g, "• ").replace(/<\/(p|li|h3|h4|blockquote)>/g, " ").replace(/<br\s*\/?>/g, " ")
    .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}
function tablesToMd(html) {
  return String(html || "").replace(/<table[^>]*>([\s\S]*?)<\/table>/g, (_, body) => {
    const rows = [];
    body.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/g, (__, tr) => {
      const cells = [];
      tr.replace(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g, (___, c) => { cells.push(c.replace(/<[^>]+>/g, "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim()); });
      rows.push(cells);
    });
    if (!rows.length) return "";
    const w = Math.max(...rows.map(r => r.length));
    const line = r => "| " + Array.from({ length: w }, (_, i) => r[i] || "").join(" | ") + " |";
    return "\n\n" + line(rows[0]) + "\n" + "| " + Array.from({ length: w }, () => "---").join(" | ") + " |\n" + rows.slice(1).map(line).join("\n") + "\n\n";
  });
}
export function markdownText(html) {
  return tablesToMd(html)
    .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/g, (_, c) => "\n\n```\n" + c.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">") + "\n```\n\n")
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/g, (_, c) => "\n\n```\n" + c.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">") + "\n```\n\n")
    .replace(/<code>(.*?)<\/code>/g, "`$1`")
    .replace(/<hr\s*\/?>/g, "\n\n---\n\n")
    .replace(/<h2[^>]*>/g, "\n## ").replace(/<\/h2>/g, "\n")
    .replace(/<h[34][^>]*>/g, "\n### ").replace(/<\/h[34]>/g, "\n")
    .replace(/<li>/g, "- ").replace(/<\/li>/g, "\n").replace(/<\/(p|blockquote)>/g, "\n\n").replace(/<br\s*\/?>/g, "\n")
    .replace(/<b>|<strong>/g, "**").replace(/<\/b>|<\/strong>/g, "**").replace(/<i>|<em>/g, "_").replace(/<\/i>|<\/em>/g, "_")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g, "$2 ($1)")
    .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n").trim();
}
export function effortText(f) {
  return f && f.effort ? f.effort + " " + (f.effort === 1 ? String(f.effortUnit || "weeks").slice(0, -1) : (f.effortUnit || "weeks")) : "";
}
function monthLabel(p) {
  if (!p) return "";
  const [y, m, d] = String(p).split("-").map(Number);
  const dt = new Date(y, m - 1, d || 1);
  return d ? dt.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" }) : dt.toLocaleDateString("en-CA", { year: "numeric", month: "long" });
}
/* Drive folder id from a folder link, or "" */
export function driveFolderId(link) {
  const m = /drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]+)/.exec(String(link || ""));
  return m ? m[1] : "";
}

export function pilotMarkdown(S, p, when) {
  const byId = Object.fromEntries(S.features.map(f => [f.id, f]));
  const feat = id => byId[id];
  const fname = f => (f.parent && byId[f.parent] ? byId[f.parent].name + " › " : "") + f.name;
  const frow = f => `- ${fname(f)} — ${f.state}${f.owner && f.owner !== "Unassigned" ? " · " + f.owner : ""}${f.period ? " · " + f.period : ""}${effortText(f) ? " · takes " + effortText(f) : ""}`;
  const stamp = (when || new Date()).toISOString().slice(0, 16).replace("T", " ");
  const icp = p.icp ? ((S.icps || []).find(x => x.id === p.icp) || {}).name : "";
  let md = `# ALIE pilot record — ${p.name}\n\nUpdated ${stamp} UTC from the ALIE Product Manager. The app is the source of truth for this record; this copy is kept in the firm's Drive folder for the team.\n\n`;
  md += `## Overview\n\n- Status: ${p.status}\n- Since: ${p.since || "—"}\n- Contact: ${p.contact || "—"}\n- Buyer profile: ${icp || "—"}\n- Drive folder: ${p.link || "—"}\n\n`;
  if (p.notes) md += `### Notebook\n\n${markdownText(p.notes)}\n\n`;
  const wants = (p.wants || []).map(feat).filter(Boolean), needs = (p.needs || []).map(feat).filter(Boolean);
  const live = wants.filter(f => f.state === "Live" || f.state === "Needs work");
  md += `## They asked for (${wants.length})\n\n${wants.map(frow).join("\n") || "- nothing yet"}\n\n`;
  md += `## Requested features shipped (${live.length})\n\n${live.map(frow).join("\n") || "- none yet"}\n\n`;
  md += `## We think they will need (${needs.length})\n\n${needs.map(frow).join("\n") || "- nothing yet"}\n\n`;
  const rq = p.requests || [];
  md += `## Requests (${rq.length})\n\n`;
  rq.forEach((r, i) => {
    md += `### ${i + 1}. ${r.title}\n\n- Decision: ${r.decision}${r.reason ? " — " + r.reason : ""}\n- Fit: ${r.fit || "not assessed"}\n${r.source ? "- Source: " + r.source + "\n" : ""}${r.feature && byId[r.feature] ? "- Promoted to feature: " + byId[r.feature].name + " (" + byId[r.feature].state + ")\n" : ""}\n`;
    if (r.bottleneck) md += `**Current bottleneck**\n\n${markdownText(r.bottleneck)}\n\n`;
    if (r.need) md += `**Business need**\n\n${markdownText(r.need)}\n\n`;
    if (r.solution) md += `**Possible solution**\n\n${markdownText(r.solution)}\n\n`;
  });
  if (!rq.length) md += "- none yet\n\n";
  const dl = p.deliverables || [];
  md += `## Deliverables (${dl.length})\n\n`;
  dl.forEach((d, i) => {
    const fs2 = (d.features || []).map(feat).filter(Boolean);
    const liveN = fs2.filter(f => ["Live", "Needs work", "Feature flag"].indexOf(f.state) !== -1).length;
    md += `### ${i + 1}. ${d.title}${d.tag ? " · " + d.tag : ""}\n\n- Status: ${d.status || "Proposed"} · Client validation: ${(d.validation && d.validation.status) || "Not validated"}\n- ${fs2.length ? liveN + " of " + fs2.length + " features live" : "no features tagged"}\n\n`;
    if (d.note) md += `${markdownText(d.note)}\n\n`;
    if (fs2.length) md += fs2.map(frow).join("\n") + "\n\n";
  });
  if (!dl.length) md += "- none yet\n\n";
  /* discovery */
  const plainText = t => String(t || "").trim();
  const sessions = (p.sessions || []).slice().sort((a, b) => (b.date || "") < (a.date || "") ? -1 : 1);
  const sessName = id => { const s2 = sessions.find(x => x.id === id); return s2 ? (s2.date ? s2.date + " " : "") + (s2.title || s2.purpose || "session") : ""; };
  if (p.objective || (p.people || []).length || (p.nextTouch && (p.nextTouch.date || p.nextTouch.note))) {
    md += `## Discovery\n\n`;
    if (p.objective) md += `**Objective.** ${plainText(p.objective)}\n\n`;
    if (p.nextTouch && (p.nextTouch.date || p.nextTouch.note)) md += `**Next touch.** ${[p.nextTouch.date, p.nextTouch.note].filter(Boolean).join(" · ")}\n\n`;
    if ((p.people || []).length) md += `**People.**\n\n${p.people.map(x => `- ${x.name}${x.role ? " · " + x.role : ""} · ${x.side}${x.note ? " · " + x.note : ""}`).join("\n")}\n\n`;
  }
  if (sessions.length) {
    md += `## Sessions (${sessions.length})\n\n`;
    sessions.forEach(s2 => {
      md += `### ${s2.date || "undated"} · ${s2.title || s2.purpose || "Session"}${s2.draft ? " · DRAFT, to confirm" : ""}\n\n`;
      md += `- Stage: ${s2.stage || "Recorded"}\n`;
      if (s2.participants) md += `- Participants: ${s2.participants}\n`;
      if (s2.purpose) md += `- Purpose: ${plainText(s2.purpose)}\n`;
      if (s2.agenda) md += `- Agenda: ${plainText(s2.agenda).replace(/\n+/g, " · ")}\n`;
      const dl2 = s2.drive || {};
      [["Recording", dl2.recording], ["Transcript", dl2.transcript], ["Raw notes", dl2.rawNotes], ["Summary", dl2.summary], ["Received files", dl2.receivedFiles], ["Session folder", dl2.folder]].forEach(([k, v]) => { if (v) md += `- ${k}: ${v}\n`; });
      if (s2.links) md += `- Notes and artifacts: ${s2.links.split(/\n+/).filter(Boolean).join(" · ")}\n`;
      (s2.files || []).forEach(f2 => { md += `- File: ${f2.name} (${f2.kind}, ${f2.from === "Client" ? "received from the firm" : "ours"}) · ${f2.loop}${f2.owner ? " · " + f2.owner : ""}${f2.due ? " · due " + f2.due : ""}${f2.link ? " · " + f2.link : ""}\n`; });
      const sq = (p.questions || []).filter(q => q.session === s2.id);
      if (sq.length) md += `- Questions: ${sq.map(q => `${q.text} [${q.state || (q.status === "Answered" ? "Confirmed by client" : "Unanswered")}]`).join(" · ")}\n`;
      md += "\n";
      if (s2.summary) md += `**Summary**\n\n${markdownText(s2.summary)}\n\n`;
      if (s2.findings) md += `**Findings**\n\n${markdownText(s2.findings)}\n\n`;
    });
  }
  const oq = (p.questions || []).filter(q => q.status !== "Answered"), aq = (p.questions || []).filter(q => q.status === "Answered");
  if ((p.questions || []).length) {
    md += `## Open questions (${oq.length})\n\n${oq.map(q => `- ${q.text} [${q.state || "Unanswered"}]${q.candidate && q.candidate.text ? " · candidate: " + q.candidate.text : ""}${q.session ? " · " + sessName(q.session) : ""}`).join("\n") || "- none"}\n\n`;
    if (aq.length) md += `### Answered\n\n${aq.map(q => `- ${q.text} → ${q.answer || "answered"}`).join("\n")}\n\n`;
  }
  const acts = (p.actions || []);
  if (acts.length) md += `## Next actions (${acts.filter(a => a.status !== "Done").length} open)\n\n${acts.map(a => `- [${a.status === "Done" ? "x" : " "}] ${a.title}${a.owner ? " · " + a.owner : ""} · ${a.side}${a.due ? " · due " + a.due : ""}${a.status === "Blocked" ? " · BLOCKED" : ""}`).join("\n")}\n\n`;
  const steps = (p.steps || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  if (steps.length) {
    md += `## Workflow map (v${p.workflowVersion || 1})\n\n`;
    ["current", "proposed"].forEach(v => {
      const list = steps.filter(x => (x.version || "current") === v);
      if (!list.length) return;
      md += `### ${v === "current" ? "Current: how they work today" : "Proposed: how it could work with ALIE"}\n\n`;
      list.forEach((x, i) => {
        md += `**${i + 1}. ${x.title}**${x.draft ? " · DRAFT" : ""}\n\n`;
        [["Actor", x.actor], ["Trigger or input", x.trigger], ["Action", x.action], ["Reasoning and decisions", x.reasoning], ["Output", x.output], ["Next recipient", x.next], ["Systems", x.systems]].forEach(([k, val]) => { if (val) md += `- ${k}: ${plainText(val)}\n`; });
        const qs = (p.questions || []).filter(q => q.step === x.id && q.status !== "Answered");
        if (qs.length) md += `- Open questions: ${qs.map(q => q.text).join(" · ")}\n`;
        md += "\n";
      });
    });
  }
  const ev = (p.evidence || []);
  if (ev.length) {
    md += `## Evidence (${ev.length})\n\n`;
    ["Direct quote", "Client paraphrase", "Observed", "Explicit request", "Product inference", "Unsorted"].forEach(k => {
      const list = ev.filter(e => e.kind === k);
      if (!list.length) return;
      md += `### ${k} (${list.length})\n\n${list.map(e => `- ${k === "Direct quote" ? "« " + e.text + " »" : e.text}${e.speaker ? " · " + e.speaker : ""}${e.source ? " · " + e.source : ""}${e.session ? " · " + sessName(e.session) : ""}${e.note ? " · note: " + e.note : ""}`).join("\n")}\n\n`;
    });
  }
  const fitKeys = Object.keys(p.fit || {}).filter(k => byId[k]);
  if (fitKeys.length) md += `## Feature fit (${fitKeys.length})\n\n${fitKeys.map(k => { const v = p.fit[k], f = byId[k]; return `- ${fname(f)} — engineering: ${f.state} · pilot fit: ${v.fit}${v.supports ? " · supports: " + plainText(v.supports) : ""}${v.unknown ? " · unknown: " + plainText(v.unknown) : ""}${v.next ? " · next: " + plainText(v.next) : ""}`; }).join("\n")}\n\n`;
  if ((p.decisions || []).length) md += `## Product decisions (${p.decisions.length})\n\n${p.decisions.map(d => `- ${d.date ? d.date + " · " : ""}**${d.title}** — ${plainText(d.decision)}${d.reason ? " · why: " + plainText(d.reason) : ""}`).join("\n")}\n\n`;
  if ((p.artifacts || []).length) md += `## Prototypes and artifacts (${p.artifacts.length})\n\n${p.artifacts.map(a => `- ${a.origin === "Received" ? "Received from the firm" : "Ours"} · ${a.kind}: ${a.title}${a.version ? " v" + a.version : ""} · ${a.status || "Draft"} · ${a.audience || "Internal"} · loop: ${a.loop || "Received"}${a.owner ? " · " + a.owner : ""}${a.link ? " · " + a.link : ""}${a.note ? " · " + plainText(a.note) : ""}`).join("\n")}\n\n`;
  const pdec = (S.decisions || []).filter(d => d.pilot === p.id);
  if (pdec.length) md += `## Product decisions (${pdec.length})\n\n${pdec.map(d => `- ${d.date ? d.date + " · " : ""}**${d.title}** — ${d.state} · owner ${d.owner || "Uzziel"} · cofounder alignment: ${d.alignment}${d.state === "Decided" && ["Agreed", "Not required"].indexOf(d.alignment) === -1 ? " · BUILD BLOCKED UNTIL ALIGNED" : ""}${d.rationale ? " · why: " + plainText(d.rationale) : ""}`).join("\n")}\n\n`;
  const val = [].concat(dl.map(d => ({ t: d.title, k: "deliverable", v: d.validation })), rq.map(r => ({ t: r.title, k: "request", v: r.validation }))).filter(x => x.v && x.v.status && x.v.status !== "Not validated");
  if (val.length) md += `## Client validation\n\n${val.map(x => `- ${x.t} (${x.k}): ${x.v.status}${x.v.date ? " · " + x.v.date : ""}${x.v.note ? " · " + plainText(x.v.note) : ""}`).join("\n")}\n\n`;
  const recaps = (p.recaps || []).slice().sort((a, b) => b.week < a.week ? -1 : 1);
  if (recaps.length) {
    md += `## Weekly recaps (${recaps.length})\n\n`;
    recaps.forEach(r => {
      md += `### Week of ${r.week}${r.clientReviewed ? " · reviewed by the client" : " · not yet reviewed by the client"}\n\n`;
      if (r.client) md += `**Shared with the client**\n\n${markdownText(r.client)}\n\n`;
      if (r.internal) md += `**Internal notes**\n\n${markdownText(r.internal)}\n\n`;
    });
  }
  const st = p.stack || [];
  md += `## Software and partners (${st.length})\n\n`;
  ["Software", "Partner"].forEach(kind => {
    const items = st.filter(x => x.kind === kind);
    if (!items.length) return;
    md += `### ${kind === "Software" ? "Software they use" : "Firms and partners"}\n\n`;
    items.forEach(x => { md += `- **${x.name}**${x.category ? " · " + x.category : ""}${x.link ? " · " + x.link : ""}\n${x.usage ? "  " + markdownText(x.usage).replace(/\n+/g, " ") + "\n" : ""}`; });
    md += "\n";
  });
  if (!st.length) md += "- none yet\n\n";
  return md;
}

/* One Google Doc per research item, kept in the R&D folder. */
export function rndMarkdown(S, f, when) {
  const byId = Object.fromEntries(S.features.map(x => [x.id, x]));
  const stamp = (when || new Date()).toISOString().slice(0, 16).replace("T", " ");
  const kids = S.features.filter(x => x.parent === f.id);
  let md = `# ALIE R&D — ${f.name}\n\nUpdated ${stamp} UTC from the ALIE Product Manager. The app is the source of truth for this record; this copy is kept in the R&D folder for the team.\n\n`;
  md += `## Overview\n\n- Stage: ${f.rndStage}\n- Student: ${f.student || "nobody yet"}\n- Product state: ${f.state}\n- Owner: ${f.owner || "Unassigned"}\n- Spaces: ${(f.spaces || []).join(", ") || "—"}\n`;
  if (f.parent && byId[f.parent]) md += `- Part of: ${byId[f.parent].name}\n`;
  if (f.link) md += `- Link: ${f.link}\n`;
  if (effortText(f)) md += `- Estimate: ${effortText(f)}\n`;
  md += "\n";
  md += `## Research question\n\n${f.rndQuestion ? markdownText(f.rndQuestion) : "_Not written yet._"}\n\n`;
  md += `## Experiment plan\n\n${f.rndPlan ? markdownText(f.rndPlan) : "_No plan yet._"}\n\n`;
  md += `## Findings\n\n${f.rndFindings ? markdownText(f.rndFindings) : "_Nothing recorded yet._"}\n\n`;
  if (f.note) md += `## Description\n\n${markdownText(f.note)}\n\n`;
  if (kids.length) md += `## Sub-features (${kids.length})\n\n${kids.map(k => `- ${k.name} — ${k.state}`).join("\n")}\n\n`;
  return md;
}

/* One Google Doc for one record: a session, an artifact, or a product decision. */
export function recordMarkdown(S, kind, rec, p, when) {
  const stamp = (when || new Date()).toISOString().slice(0, 16).replace("T", " ");
  const byId = Object.fromEntries(S.features.map(f => [f.id, f]));
  const head = t => `# ${t}\n\nUpdated ${stamp} UTC from the ALIE Product Manager. The app is the source of truth; this copy lives in Drive for the team.\n\n`;
  if (kind === "session") {
    let md = head(`Session — ${rec.title || rec.purpose || "Session"}${p ? " · " + p.name : ""}`);
    md += `- Date: ${rec.date || "undated"}${rec.time ? " " + rec.time : ""}\n- Stage: ${rec.stage || "Recorded"}\n- Participants: ${rec.participants || "—"}\n`;
    if (rec.purpose) md += `- Purpose: ${rec.purpose}\n`;
    const dl2 = rec.drive || {};
    [["Recording", dl2.recording], ["Transcript", dl2.transcript], ["Raw notes", dl2.rawNotes], ["Summary", dl2.summary], ["Received files", dl2.receivedFiles], ["Session folder", dl2.folder]].forEach(([k, v]) => { if (v) md += `- ${k}: ${v}\n`; });
    md += "\n";
    if (rec.agenda) md += `## Agenda\n\n${rec.agenda}\n\n`;
    const qs = p ? (p.questions || []).filter(q => q.session === rec.id) : [];
    if (qs.length) md += `## Questions\n\n${qs.map(q => `- ${q.text} — ${q.state || "Unanswered"}${q.answer ? ": " + q.answer : q.candidate && q.candidate.text ? " (candidate: " + q.candidate.text + ")" : ""}`).join("\n")}\n\n`;
    if (rec.summary) md += `## Summary\n\n${markdownText(rec.summary)}\n\n`;
    if (rec.findings) md += `## Findings\n\n${markdownText(rec.findings)}\n\n`;
    const ev = p ? (p.evidence || []).filter(e => e.session === rec.id) : [];
    if (ev.length) md += `## Evidence (${ev.length})\n\n${ev.map(e => `- [${e.kind}]${e.draft ? " (draft)" : ""} ${e.kind === "Direct quote" ? "« " + e.text + " »" : e.text}${e.speaker ? " · " + e.speaker : ""}${e.timestamp ? " · " + e.timestamp : ""}${e.source ? " · " + e.source : ""}`).join("\n")}\n\n`;
    const acts = p ? (p.actions || []).filter(a => a.links && a.links.session === rec.id) : [];
    if (acts.length) md += `## Actions\n\n${acts.map(a => `- [${a.status === "Done" ? "x" : " "}] ${a.title}${a.owner ? " · " + a.owner : ""} · ${a.side}${a.due ? " · due " + a.due : ""}`).join("\n")}\n\n`;
    if ((rec.files || []).length) md += `## Files\n\n${rec.files.map(f => `- ${f.name} · ${f.kind} · ${f.from === "Client" ? "received from the firm" : "ours"} · ${f.loop}${f.owner ? " · " + f.owner : ""}${f.due ? " · due " + f.due : ""}${f.link ? " · " + f.link : ""}`).join("\n")}\n\n`;
    return md;
  }
  if (kind === "artifact") {
    let md = head(`${rec.kind} — ${rec.title}${rec.version ? " v" + rec.version : ""}${p ? " · " + p.name : ""}`);
    md += `- Origin: ${rec.origin === "Received" ? "received from the firm" : "created by us"}\n- Status: ${rec.status || "Draft"}\n- Audience: ${rec.audience || "Internal"}\n- Owner: ${rec.owner || "—"}\n- Loop: ${rec.loop || "Received"}${rec.loopOwner ? " · " + rec.loopOwner : ""}${rec.loopDue ? " · due " + rec.loopDue : ""}\n`;
    if (rec.link) md += `- Link: ${rec.link}\n`;
    if (rec.feature && byId[rec.feature]) md += `- Feature: ${byId[rec.feature].name} (${byId[rec.feature].state})\n`;
    if (p && rec.request) { const r = (p.requests || []).find(x => x.id === rec.request); if (r) md += `- Request: ${r.title}\n`; }
    if (p && rec.step) { const st = (p.steps || []).find(x => x.id === rec.step); if (st) md += `- Workflow bottleneck: ${st.title}\n`; }
    if (p && rec.session) { const s2 = (p.sessions || []).find(x => x.id === rec.session); if (s2) md += `- Session: ${s2.date || "undated"} · ${s2.title || s2.purpose}\n`; }
    md += "\n";
    if (rec.note) md += `## Note\n\n${markdownText(rec.note)}\n\n`;
    const ev = p ? (rec.evidence || []).map(id => (p.evidence || []).find(e => e.id === id)).filter(Boolean) : [];
    if (ev.length) md += `## Evidence\n\n${ev.map(e => `- [${e.kind}] ${e.text}${e.speaker ? " · " + e.speaker : ""}`).join("\n")}\n\n`;
    return md;
  }
  if (kind === "decision") {
    let md = head(`Product decision — ${rec.title}`);
    md += `- State: ${rec.state}\n- Owner: ${rec.owner || "Uzziel"} (CPO)\n- Date: ${rec.date || "—"}\n- Cofounder alignment: ${rec.alignment}\n`;
    if (rec.state === "Decided" && ["Agreed", "Not required"].indexOf(rec.alignment) === -1) md += `- **Build blocked until aligned**\n`;
    if (p) md += `- Pilot: ${p.name}\n`;
    const L = rec.links || {};
    if (L.feature && byId[L.feature]) md += `- Feature: ${byId[L.feature].name} (${byId[L.feature].state})\n`;
    if (p && L.request) { const r = (p.requests || []).find(x => x.id === L.request); if (r) md += `- Request: ${r.title}\n`; }
    if (p && L.step) { const st = (p.steps || []).find(x => x.id === L.step); if (st) md += `- Workflow step: ${st.title}\n`; }
    if (p && L.artifact) { const a = (p.artifacts || []).find(x => x.id === L.artifact); if (a) md += `- Artifact: ${a.title}\n`; }
    if (p && L.deliverable) { const d = (p.deliverables || []).find(x => x.id === L.deliverable); if (d) md += `- Deliverable: ${d.title}\n`; }
    if (rec.pending) md += `- Gated transition: ${rec.pending.kind} → ${rec.pending.to}${rec.applied ? " (applied)" : " (waiting)"}\n`;
    md += "\n";
    if (rec.rationale) md += `## Rationale\n\n${rec.rationale}\n\n`;
    const ev = p ? (rec.evidence || []).map(id => (p.evidence || []).find(e => e.id === id)).filter(Boolean) : [];
    if (ev.length) md += `## Evidence\n\n${ev.map(e => `- [${e.kind}] ${e.text}${e.speaker ? " · " + e.speaker : ""}`).join("\n")}\n\n`;
    return md;
  }
  return head("Record");
}

function csv(rows) {
  return rows.map(r => r.map(v => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(",")).join("\n") + "\n";
}
export function featuresCsv(S) {
  const byId = Object.fromEntries(S.features.map(f => [f.id, f]));
  const division = (f, sp) => { const top = f.parent && byId[f.parent] ? byId[f.parent] : f; return (top.sections && top.sections[sp]) || ""; };
  const divisions = m => (m.spaces || []).map(sp => division(m, sp)).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join("; ");
  const icpNames = f => (f.icps || []).map(id => ((S.icps || []).find(x => x.id === id) || {}).name).filter(Boolean).join("; ");
  const features = S.features.filter(f => f.project === S.current);
  const mains = features.filter(f => !f.parent).sort((a, b) => a.name.localeCompare(b.name));
  const rows = [["Spaces", "Division", "Feature", "Sub-feature", "State", "Owner", "Date", "Estimate", "R&D", "Profiles", "Description", "Drive link", "Last updated", "Id"]];
  for (const m of mains) {
    const sp = (m.spaces || []).join("; ");
    rows.push([sp, divisions(m), m.name, "", m.state, m.owner, monthLabel(m.period), effortText(m), m.rnd ? "yes" : "", icpNames(m), plain(m.note), m.link || "", new Date(m.updated || 0).toISOString().slice(0, 10), m.id]);
    for (const k of features.filter(f => f.parent === m.id).sort((a, b) => a.name.localeCompare(b.name))) {
      rows.push([sp, divisions(m), m.name, k.name, k.state, k.owner, monthLabel(k.period), effortText(k), k.rnd ? "yes" : "", icpNames(k), plain(k.note), k.link || "", new Date(k.updated || 0).toISOString().slice(0, 10), k.id]);
    }
  }
  return csv(rows);
}
const LOG_FIELDS = { created: "Created", deleted: "Deleted", name: "Name", state: "State", owner: "Owner", period: "Date", effort: "Estimate", agreed: "Agreed", spaces: "Spaces", parent: "Parent", rnd: "R&D", rndStage: "R&D stage", student: "Student", link: "Drive link", note: "Description", image: "Screenshot" };
export function logCsv(S) {
  const rows = [["When", "Who", "Feature", "Change", "From", "To", "Why"]];
  for (const e of (S.log || []).slice().sort((a, b) => b.t - a.t)) {
    rows.push([new Date(e.t).toISOString().replace("T", " ").slice(0, 16), e.who, e.fname, LOG_FIELDS[e.field] || e.field, e.field === "period" ? monthLabel(e.from) : e.from, e.field === "period" ? monthLabel(e.to) : e.to, e.why || ""]);
  }
  return csv(rows);
}
