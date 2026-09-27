/**
 * The client-facing report. One self-contained HTML file: what was
 * scanned, what failed, what each failure means in plain words, and what
 * happens next. Written for a business owner first and a developer second.
 */
import { ruleText } from "../rules.ts";
import type { ScanResult } from "../types.ts";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const SEVERITY_ORDER: Record<string, number> = { critical: 0, serious: 1, moderate: 2, minor: 3 };

export function buildHtmlReport(r: ScanResult): string {
  const s = r.summary;
  const date = new Date(r.scannedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const clean = s.problems === 0;
  const items: { severity: string; title: string; plain: string; count: string; pages: string[]; samples: string[] }[] = [];
  for (const f of s.flags) items.push({ severity: f.severity, title: f.title, plain: f.detail, count: "", pages: f.pages, samples: [] });
  if (s.contrastGroups.length) {
    items.push({
      severity: "serious",
      title: "Text too faint to read",
      plain: ruleText("color-contrast", "").plain,
      count: `${s.contrastElements} elements, ${s.contrastGroups.length} color pairs`,
      pages: [...new Set(r.pages.filter((p) => p.axe && p.axe.contrastElements > 0).map((p) => p.path))],
      samples: s.contrastGroups.slice(0, 8).map((g) => `${g.fg} on ${g.bg} at ${g.fontSize}: ${g.ratio.toFixed(2)}:1, needs ${g.required}:1 (${g.count})${g.sample ? ` · "${g.sample}"` : ""}`),
    });
  }
  for (const rule of s.byRule) {
    items.push({ severity: rule.impact, title: rule.help, plain: ruleText(rule.id, rule.help).plain, count: `${rule.count} instance${rule.count === 1 ? "" : "s"}`, pages: rule.pages, samples: rule.samples.slice(0, 3).map((x) => x.html) });
  }
  items.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
  const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 } as Record<string, number>;
  for (const it of items) counts[it.severity] = (counts[it.severity] ?? 0) + 1;

  const pageRows = r.pages
    .map((p) => {
      const c = p.axe?.contrastElements ?? 0;
      const v = p.axe?.violations.reduce((a, x) => a + x.count, 0) ?? 0;
      const kb = p.keyboard ? p.keyboard.invisibleFocus.length + p.keyboard.hiddenFocus.length + (p.keyboard.trap ? 1 : 0) : 0;
      return `<tr><td><code>${esc(p.path)}</code></td><td>${p.viewport}</td><td>${p.error ? `<span class="err">${esc(p.error)}</span>` : p.status ?? ""}</td><td class="num">${c}</td><td class="num">${v}</td><td class="num">${p.keyboard ? kb : "·"}</td><td>${p.reflow ? (p.reflow.horizontalScroll ? `<span class="bad">sideways scroll</span>` : "ok") : "·"}</td></tr>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(r.label)} · Accessibility Report</title>
<style>
  :root { --bg:#0C0B0A; --panel:#131211; --panel2:#1A1816; --line:rgba(255,255,255,.10); --text:#F5F2EE; --muted:rgba(255,255,255,.66); --red:#EF4444; --gold:#D9B26A; --ok:#5FBF85; --warn:#E0A83A; }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--text); font:16px/1.55 Inter, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; }
  .wrap { max-width:1040px; margin:0 auto; padding:48px 20px 80px }
  .eyebrow { font:11px/1 ui-monospace, Menlo, monospace; letter-spacing:.18em; text-transform:uppercase; color:var(--red) }
  h1 { font-size:clamp(34px,5vw,56px); line-height:1.05; margin:12px 0 8px; letter-spacing:-.01em }
  .lede { color:var(--muted); max-width:66ch; margin:0 }
  .tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin:32px 0 }
  .tile { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:16px 18px }
  .tile b { display:block; font-size:34px; line-height:1; letter-spacing:-.02em; font-variant-numeric:tabular-nums }
  .tile span { display:block; margin-top:8px; font:11px/1.3 ui-monospace, Menlo, monospace; letter-spacing:.14em; text-transform:uppercase; color:var(--muted) }
  .tile.bad b { color:var(--red) } .tile.ok b { color:var(--ok) }
  .verdict { border-left:3px solid ${clean ? "var(--ok)" : "var(--red)"}; background:var(--panel2); padding:14px 18px; border-radius:0 10px 10px 0; max-width:70ch }
  h2 { font-size:22px; margin:44px 0 12px }
  .item { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:18px 20px; margin-bottom:12px }
  .item header { display:flex; flex-wrap:wrap; gap:8px 14px; align-items:baseline }
  .item h3 { margin:0; font-size:17px }
  .sev { font:10px/1 ui-monospace, Menlo, monospace; letter-spacing:.14em; text-transform:uppercase; padding:5px 8px; border-radius:999px; border:1px solid var(--line) }
  .sev.critical, .sev.serious { color:var(--red); border-color:rgba(239,68,68,.4) } .sev.moderate { color:var(--warn); border-color:rgba(224,168,58,.4) } .sev.minor { color:var(--muted) }
  .count { color:var(--muted); font-size:13px }
  .item p { color:var(--muted); margin:10px 0 0; max-width:72ch }
  .item ul { margin:10px 0 0; padding-left:18px; color:var(--muted); font-size:13.5px }
  .item code, td code, .samples li { font:12.5px/1.5 ui-monospace, Menlo, monospace }
  .pages { margin-top:10px; font-size:12.5px; color:var(--muted) }
  table { width:100%; border-collapse:collapse; font-size:14px; margin-top:8px }
  th, td { text-align:left; padding:9px 10px; border-bottom:1px solid var(--line); vertical-align:top }
  th { font:11px/1 ui-monospace, Menlo, monospace; letter-spacing:.12em; text-transform:uppercase; color:var(--muted) }
  td.num { font-variant-numeric:tabular-nums; text-align:right } th:nth-child(n+4) { text-align:right }
  .bad { color:var(--red) } .err { color:var(--warn) }
  .tablewrap { overflow-x:auto }
  .next { background:var(--panel); border:1px solid var(--line); border-top:3px solid var(--red); border-radius:10px; padding:22px 24px; max-width:76ch }
  .next p { margin:0 0 10px; color:var(--muted) } .next p:last-child { margin:0 }
  footer { margin-top:48px; padding-top:18px; border-top:1px solid var(--line); font:11px/1.6 ui-monospace, Menlo, monospace; letter-spacing:.1em; text-transform:uppercase; color:var(--muted) }
  @media (max-width:640px) { .wrap { padding:32px 16px 64px } }
</style>
</head>
<body>
<div class="wrap">
  <p class="eyebrow">${esc(r.tool)} · ${esc(r.standard)}</p>
  <h1>${esc(r.label)}</h1>
  <p class="lede">${esc(r.base)} · scanned ${esc(date)} · ${s.pages} page${s.pages === 1 ? "" : "s"} at desktop and phone widths · ${esc(r.stack)}</p>

  <div class="tiles">
    <div class="tile ${clean ? "ok" : "bad"}"><b>${s.problems}</b><span>distinct problems</span></div>
    <div class="tile"><b>${counts.critical + counts.serious}</b><span>critical or serious</span></div>
    <div class="tile"><b>${s.contrastElements}</b><span>faint-text elements</span></div>
    <div class="tile"><b>${s.pages}</b><span>pages checked</span></div>
  </div>

  <div class="verdict">${clean
    ? `<b>No failures from the automated pass.</b> That puts this site past the scanners the lawsuit firms use. The manual checks (keyboard, screen reader, zoom, motion) still need a person; the list is in the fix file.`
    : `<b>${s.problems} distinct problems to fix.</b> Every one of them is a specific change in the site's code, listed below in plain words and in the accompanying fix file with exact instructions. Nothing here needs a rebuild.`}</div>

  <h2>What fails, and what it means</h2>
  ${items.length ? items.map((it) => `
  <div class="item">
    <header><span class="sev ${esc(it.severity)}">${esc(it.severity)}</span><h3>${esc(it.title)}</h3>${it.count ? `<span class="count">${esc(it.count)}</span>` : ""}</header>
    <p>${esc(it.plain)}</p>
    ${it.samples.length ? `<ul class="samples">${it.samples.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    <div class="pages">On: ${it.pages.map((p) => `<code>${esc(p)}</code>`).join(" ")}</div>
  </div>`).join("") : `<p class="lede">Nothing to list.</p>`}

  <h2>Page by page</h2>
  <div class="tablewrap"><table>
    <thead><tr><th>Page</th><th>View</th><th>Status</th><th>Faint text</th><th>Other failures</th><th>Keyboard</th><th>400% zoom</th></tr></thead>
    <tbody>${pageRows}</tbody>
  </table></div>

  <h2>What happens next</h2>
  <div class="next">
    <p><b>The fix.</b> Alongside this report is a file called ACCESSIBILITY-FIX.md. It contains every finding above with exact instructions a developer, or an AI coding assistant working in the site's own code, follows to fix them. On a well-built site that is a day or two of work; on an older template site it can be more, but the file says exactly what to change.</p>
    <p><b>The proof.</b> After the fixes, the same scan runs again and produces a before-and-after record. Keep it with the business's files.</p>
    <p><b>What this is not.</b> A scan is not a legal certification, and no tool can promise a business will never receive a demand letter. What it does is remove the failures the automated scanners find, which is how businesses end up on those lists in the first place. This report is not legal advice.</p>
  </div>

  <footer>${esc(r.tool)} v${esc(r.version)} · Smart Scale, Katy, Texas · smartscaleagent.com</footer>
</div>
</body>
</html>
`;
}
