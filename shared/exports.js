/* Plain-text views of the document for Drive: a pilot record (Markdown) and two CSV sheets.
   Pure functions of the state, shared by the scripts and the Worker's Drive sync. */

export function plain(html) {
  return String(html || "").replace(/<li>/g, "• ").replace(/<\/(p|li|h3|h4|blockquote)>/g, " ").replace(/<br\s*\/?>/g, " ")
    .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}
export function markdownText(html) {
  return String(html || "")
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
    md += `### ${i + 1}. ${d.title}${d.tag ? " · " + d.tag : ""}\n\n${fs2.length ? liveN + " of " + fs2.length + " features live" : "no features tagged"}\n\n`;
    if (d.note) md += `${markdownText(d.note)}\n\n`;
    if (fs2.length) md += fs2.map(frow).join("\n") + "\n\n";
  });
  if (!dl.length) md += "- none yet\n\n";
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
