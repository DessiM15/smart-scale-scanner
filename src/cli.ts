/**
 * ssa: Smart Scale Accessibility Scanner.
 *
 *   ssa scan <url> [--pages /a,/b] [--max-pages 12] [--out dir] [--label "Name"] [--desktop-only] [--quick]
 *   ssa report <scan.json> [--out report.html]
 *   ssa fix <scan.json> [--out ACCESSIBILITY-FIX.md]
 *   ssa compare <before.json> <after.json>
 *
 * `scan` writes scan.json, report.html and ACCESSIBILITY-FIX.md into --out
 * (default .scans/<host>/<date>). Every other command works from scan.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Chrome, DESKTOP, MOBILE, REFLOW, type Page } from "./browser.ts";
import { runAxe } from "./checks/axe.ts";
import { keyboardWalk } from "./checks/keyboard.ts";
import { reflowCheck } from "./checks/reflow.ts";
import { reducedMotionCheck, structureCheck } from "./checks/structure.ts";
import { compare, formatCompare } from "./compare.ts";
import { detectStack, discoverPages, normalizeBase } from "./crawl.ts";
import { buildFixFile } from "./report/fixfile.ts";
import { buildHtmlReport } from "./report/html.ts";
import { STANDARD, TOOL_NAME, TOOL_VERSION, type Flag, type PageScan, type RuleSummary, type ScanResult, type Summary } from "./types.ts";

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else flags[key] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

const log = (m: string) => process.stderr.write(m + "\n");

async function scanPage(page: Page, url: string, path: string, viewport: "desktop" | "mobile", full: boolean): Promise<PageScan> {
  const rec: PageScan = { path, url, viewport, status: null, title: "" };
  try {
    const { status } = await page.goto(url);
    rec.status = status;
    rec.title = await page.evaluate<string>("document.title");
    rec.axe = await runAxe(page);
    if (full) {
      rec.structure = await structureCheck(page);
      rec.keyboard = await keyboardWalk(page);
    }
  } catch (e) {
    rec.error = String((e as Error).message ?? e).slice(0, 200);
  }
  return rec;
}

function summarize(pages: PageScan[]): Summary {
  const byRule = new Map<string, RuleSummary>();
  const contrast = new Map<string, Summary["contrastGroups"][number]>();
  let contrastElements = 0;
  let axeViolations = 0;
  for (const p of pages) {
    if (!p.axe) continue;
    contrastElements += p.axe.contrastElements;
    for (const g of p.axe.contrast) {
      const key = `${g.fg}|${g.bg}|${g.fontSize}|${g.classes}`;
      const cur = contrast.get(key);
      if (cur) cur.count += g.count;
      else contrast.set(key, { ...g });
    }
    for (const v of p.axe.violations) {
      axeViolations += v.count;
      const cur = byRule.get(v.id);
      if (cur) {
        cur.count += v.count;
        if (!cur.pages.includes(p.path)) cur.pages.push(p.path);
        for (const n of v.nodes) if (cur.samples.length < 6 && !cur.samples.some((s) => s.html === n.html)) cur.samples.push({ html: n.html, message: n.message });
      } else {
        byRule.set(v.id, { id: v.id, help: v.help, helpUrl: v.helpUrl, impact: v.impact ?? "moderate", count: v.count, pages: [p.path], samples: v.nodes.map((n) => ({ html: n.html, message: n.message })) });
      }
    }
  }
  // Site-level flags from the non-axe passes. Each is one problem however many pages show it.
  const flagMap = new Map<string, Flag>();
  const flag = (id: string, severity: Flag["severity"], title: string, detail: string, path: string) => {
    const cur = flagMap.get(id);
    if (cur) {
      if (!cur.pages.includes(path)) cur.pages.push(path);
    } else flagMap.set(id, { id, severity, title, detail, pages: [path] });
  };
  for (const p of pages) {
    const st = p.structure;
    const kb = p.keyboard;
    if (kb) {
      if (!kb.skipLink.present && kb.stops > 8) flag("no-skip-link", "moderate", "No skip link", "The first Tab press should offer a link past the navigation to the main content. A keyboard user must otherwise tab through every menu item on every page.", p.path);
      if (kb.skipLink.present && kb.skipLink.targetExists === false) flag("skip-link-broken", "moderate", "Skip link goes nowhere", `The skip link "${kb.skipLink.text}" points at an element that does not exist on the page.`, p.path);
      if (kb.invisibleFocus.length) flag("invisible-focus", "serious", "Keyboard focus is invisible", `${kb.invisibleFocus.length} of the first ${kb.stops} tab stops show no focus indicator (for example: ${kb.invisibleFocus.slice(0, 4).map((s) => `${s.tag.toLowerCase()} "${s.name || "unnamed"}"`).join(", ")}). A keyboard user cannot see where they are.`, p.path);
      if (kb.hiddenFocus.length) flag("hidden-focus", "serious", "Hidden controls can be tabbed to", `${kb.hiddenFocus.length} tab stops land on controls inside a hidden region (for example: ${kb.hiddenFocus.slice(0, 4).map((s) => `${s.tag.toLowerCase()} "${s.name || "unnamed"}"${s.hiddenBy ? ` inside ${s.hiddenBy}` : ""}`).join("; ")}), usually a closed menu, drawer or modal.`, p.path);
      if (kb.trap) flag("focus-trap", "critical", "Keyboard focus gets trapped", `Tab keeps landing on ${kb.trap.tag.toLowerCase()} "${kb.trap.name || "unnamed"}" and cannot move past it.`, p.path);
    }
    if (st) {
      // axe already reports these three; do not list the same problem twice.
      const axeHas = (id: string) => byRule.has(id);
      if (!st.landmarks.main && !axeHas("landmark-one-main")) flag("no-main-landmark", "moderate", "No main landmark", "The page has no <main> element, so screen reader users cannot jump to the content.", p.path);
      if (!st.lang) flag("missing-lang", "serious", "Page language not declared", "The <html> element has no lang attribute.", p.path);
      if (st.h1Count > 1) flag("multiple-h1", "moderate", "More than one main heading", `${st.h1Count} h1 elements on the page; a screen reader user cannot tell which is the title.`, p.path);
      if (st.h1Count === 0 && !axeHas("page-has-heading-one")) flag("no-h1", "moderate", "No main heading", "The page has no h1.", p.path);
      if (st.headingSkips.length && !axeHas("heading-order")) flag("heading-skips", "moderate", "Heading levels skip", `Levels jump (${st.headingSkips.slice(0, 3).map((h) => `h${h.from} to h${h.to} at "${h.text}"`).join("; ")}), which breaks the page outline screen readers navigate by.`, p.path);
      if (st.iframesWithoutTitle.length) flag("iframe-title", "serious", "Embedded frame without a title", `${st.iframesWithoutTitle.length} iframe(s) have no title (${st.iframesWithoutTitle.slice(0, 2).join(", ") || "inline"}). Screen readers announce only "frame".`, p.path);
      if (st.newTabLinksWithoutHint >= 3) flag("new-tab-hint", "minor", "Links open new tabs without saying so", `${st.newTabLinksWithoutHint} links use target="_blank" with no "(opens in new tab)" hint (for example: ${st.newTabSamples.join(", ")}).`, p.path);
      if (st.media.autoplayWithoutControls) flag("autoplay", "serious", "Media plays automatically with no controls", `${st.media.autoplayWithoutControls} autoplaying video or audio element(s) have no controls, so the visitor cannot pause them.`, p.path);
      if (st.media.longAnimations && st.media.pauseControls === 0) flag("long-animation", "moderate", "Content moves for more than five seconds with no pause control", `${st.media.longAnimations} animation(s) run longer than five seconds (a ticker, marquee or carousel) and the page has no visible pause, stop or play control. Pausing on hover or focus helps but is not a control a visitor can find; WCAG 2.2.2 asks for one.`, p.path);
      if (st.overlay) flag("overlay", "serious", "Accessibility overlay widget installed", `An overlay widget (${st.overlay}) is loaded. Overlays do not fix the underlying code, interfere with real screen readers, and are named in lawsuits.`, p.path);
      if (st.images.filenameAlt.length) flag("filename-alt", "moderate", "Image descriptions are file names", `Alt text such as "${st.images.filenameAlt.slice(0, 2).join('", "')}" describes nothing.`, p.path);
      if (st.landmarks.navsWithoutName) flag("unnamed-navs", "minor", "Navigation areas without names", `${st.landmarks.navsWithoutName} of the page's navigation regions have no aria-label, so a screen reader cannot tell them apart.`, p.path);
    }
    if (p.reducedMotion && (p.reducedMotion.longAnimationsWithReduce > 0 || p.reducedMotion.autoplayWithReduce > 0)) {
      flag("ignores-reduced-motion", "moderate", "Motion ignores the visitor's reduce-motion setting", `With prefers-reduced-motion on, ${p.reducedMotion.longAnimationsWithReduce} long animation(s) and ${p.reducedMotion.autoplayWithReduce} autoplaying media element(s) keep running.`, p.path);
    }
    if (p.reflow?.horizontalScroll) flag("reflow", "serious", "Page breaks at 400% zoom", `At 320px wide the page scrolls sideways by ${p.reflow.overflowPx}px${p.reflow.offenders.length ? ` (${p.reflow.offenders.slice(0, 3).join(", ")})` : ""}. Low-vision users who zoom cannot read it.`, p.path);
  }
  const rules = [...byRule.values()].sort((a, b) => b.count - a.count);
  const groups = [...contrast.values()].sort((a, b) => b.count - a.count);
  const flags = [...flagMap.values()];
  return {
    pages: new Set(pages.map((p) => p.path)).size,
    pagesWithErrors: pages.filter((p) => p.error).length,
    axeViolations,
    contrastElements,
    contrastGroups: groups,
    byRule: rules,
    flags,
    problems: rules.length + groups.length + flags.length,
  };
}

async function scan(args: ReturnType<typeof parseArgs>) {
  const target = args.positional[0];
  if (!target) throw new Error("Usage: ssa scan <url> [--pages /a,/b] [--max-pages 12] [--out dir] [--label Name] [--desktop-only] [--quick]");
  const base = normalizeBase(target);
  const host = new URL(base).host;
  const label = String(args.flags.label ?? host);
  const maxPages = Number(args.flags["max-pages"] ?? 12);
  const explicit = typeof args.flags.pages === "string" ? args.flags.pages.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  const desktopOnly = Boolean(args.flags["desktop-only"]);
  const quick = Boolean(args.flags.quick);
  const started = Date.now();
  const stamp = new Date().toISOString().slice(0, 10);
  const outDir = String(args.flags.out ?? join(".scans", host, stamp));
  mkdirSync(outDir, { recursive: true });

  log(`${TOOL_NAME} v${TOOL_VERSION}\n${base}`);
  const chrome = await Chrome.launch();
  const pages: PageScan[] = [];
  try {
    const home = await chrome.newPage(DESKTOP);
    await home.goto(base + "/");
    const { paths, source } = await discoverPages(base, home, maxPages, explicit);
    const stack = await detectStack(base, home);
    await home.close();
    log(`${paths.length} pages from ${source} · ${stack}`);

    const desktop = await chrome.newPage(DESKTOP);
    for (const path of paths) {
      log(`  desktop ${path}`);
      const rec = await scanPage(desktop, base + path, path, "desktop", true);
      pages.push(rec);
    }
    if (!quick) {
      const reflowPage = await chrome.newPage(REFLOW);
      for (const rec of pages.slice(0, 3)) {
        if (rec.error) continue;
        try {
          await reflowPage.goto(rec.url, 2500);
          rec.reflow = await reflowCheck(reflowPage);
        } catch {}
      }
      await reflowPage.close();
      const first = pages.find((p) => !p.error);
      if (first) {
        log(`  reduced motion ${first.path}`);
        try {
          first.reducedMotion = await reducedMotionCheck(desktop, first.url);
        } catch {}
      }
    }
    await desktop.close();
    if (!desktopOnly) {
      const mobile = await chrome.newPage(MOBILE);
      for (const path of paths) {
        log(`  mobile  ${path}`);
        pages.push(await scanPage(mobile, base + path, path, "mobile", false));
      }
      await mobile.close();
    }
    const result: ScanResult = {
      tool: TOOL_NAME,
      version: TOOL_VERSION,
      standard: STANDARD,
      scannedAt: new Date().toISOString(),
      base,
      label,
      stack,
      pageSource: source,
      durationMs: Date.now() - started,
      pages,
      summary: summarize(pages),
    };
    writeFileSync(join(outDir, "scan.json"), JSON.stringify(result, null, 2));
    writeFileSync(join(outDir, "report.html"), buildHtmlReport(result));
    writeFileSync(join(outDir, "ACCESSIBILITY-FIX.md"), buildFixFile(result));
    const s = result.summary;
    log(`\n${s.problems} distinct problems · ${s.contrastElements} faint-text elements · ${s.axeViolations} other rule failures · ${s.flags.length} keyboard/structure/motion findings · ${Math.round(result.durationMs / 1000)}s`);
    log(`→ ${join(outDir, "report.html")}\n→ ${join(outDir, "ACCESSIBILITY-FIX.md")}\n→ ${join(outDir, "scan.json")}`);
  } finally {
    await chrome.close();
  }
}

function readScan(file: string): ScanResult {
  return JSON.parse(readFileSync(file, "utf8")) as ScanResult;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  switch (cmd) {
    case "scan":
      await scan(args);
      break;
    case "report": {
      const r = readScan(args.positional[0]);
      const out = String(args.flags.out ?? "report.html");
      writeFileSync(out, buildHtmlReport(r));
      log(`→ ${out}`);
      break;
    }
    case "fix": {
      const r = readScan(args.positional[0]);
      const out = String(args.flags.out ?? "ACCESSIBILITY-FIX.md");
      writeFileSync(out, buildFixFile(r));
      log(`→ ${out}`);
      break;
    }
    case "compare": {
      const c = compare(readScan(args.positional[0]), readScan(args.positional[1]));
      process.stdout.write(formatCompare(c) + "\n");
      if (typeof args.flags.out === "string") writeFileSync(args.flags.out, JSON.stringify(c, null, 2));
      break;
    }
    default:
      log(`${TOOL_NAME} v${TOOL_VERSION}\n\n  ssa scan <url> [--pages /a,/b] [--max-pages 12] [--out dir] [--label Name] [--desktop-only] [--quick]\n  ssa report <scan.json> [--out report.html]\n  ssa fix <scan.json> [--out ACCESSIBILITY-FIX.md]\n  ssa compare <before.json> <after.json> [--out compare.json]`);
      process.exitCode = cmd ? 1 : 0;
  }
}

main().catch((e) => {
  log(`error: ${(e as Error).message ?? e}`);
  process.exitCode = 1;
});
