/**
 * The scans themselves, separate from the command line so the scan service
 * can run them too.
 *
 *   runScan      the full client scan: every discovered page, all passes
 *   runLeadScan  the short public scan: three pages, plus the search pass
 *
 * Both return a ScanResult. The summary builder (and with it the site-level
 * flags) lives here.
 */
import { Chrome, DESKTOP, MOBILE, REFLOW, RefusedResponse, type LaunchOptions, type NavResult, type Page } from "./browser.ts";
import { runAxe } from "./checks/axe.ts";
import { keyboardWalk } from "./checks/keyboard.ts";
import { reflowCheck, type ReflowResult } from "./checks/reflow.ts";
import { findBrokenLinks, searchFlags, seoPageCheck, seoSiteBasics } from "./checks/seo.ts";
import { reducedMotionCheck, structureCheck } from "./checks/structure.ts";
import { detectStack, discoverPages, normalizeBase, pickLeadPages } from "./crawl.ts";
import { STANDARD, TOOL_NAME, TOOL_VERSION, type Flag, type PageScan, type RuleSummary, type ScanResult, type Summary } from "./types.ts";

type Log = (message: string) => void;

interface PageOptions {
  /** Also run the search pass on this page. */
  seo?: boolean;
  /** Keep the load time and page weight. */
  recordLoad?: boolean;
  timeoutMs?: number;
  /** Pause video and audio once the page has loaded, so they do not eat the processor during the checks. */
  quietMedia?: boolean;
  /** The longest the keyboard walk may take. */
  keyboardBudgetMs?: number;
}

const QUIET_MEDIA = `(() => { document.querySelectorAll("video,audio").forEach((m) => { try { m.pause(); } catch {} }); return true; })()`;

async function scanPage(page: Page, url: string, path: string, viewport: "desktop" | "mobile", full: boolean, options: PageOptions = {}): Promise<PageScan> {
  const rec: PageScan = { path, url, viewport, status: null, title: "" };
  try {
    const nav = await page.goto(url, 4000, options.timeoutMs ?? 30000);
    rec.status = nav.status;
    if (options.recordLoad) rec.load = { loadMs: nav.loadMs, bytes: nav.bytes };
    rec.title = await page.evaluate<string>("document.title");
    if (options.quietMedia) await page.evaluate(QUIET_MEDIA);
    rec.axe = await runAxe(page);
    if (options.seo) rec.seo = await seoPageCheck(page);
    if (full) {
      rec.structure = await structureCheck(page);
      rec.keyboard = await keyboardWalk(page, 80, options.keyboardBudgetMs);
    }
  } catch (e) {
    rec.error = String((e as Error).message ?? e).slice(0, 200);
  }
  return rec;
}

export function summarize(pages: PageScan[]): Summary {
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

export interface ScanOptions {
  target: string;
  label?: string;
  maxPages?: number;
  /** Scan exactly these paths (home is always included). */
  explicit?: string[];
  desktopOnly?: boolean;
  /** Skip the reflow and reduced-motion passes. */
  quick?: boolean;
  log?: Log;
}

/** The full client scan. */
export async function runScan(options: ScanOptions): Promise<ScanResult> {
  const log = options.log ?? (() => {});
  const base = normalizeBase(options.target);
  const label = options.label ?? new URL(base).host;
  const started = Date.now();

  const chrome = await Chrome.launch();
  const pages: PageScan[] = [];
  try {
    const home = await chrome.newPage(DESKTOP);
    await home.goto(base + "/");
    const { paths, source } = await discoverPages(base, home, options.maxPages ?? 12, options.explicit);
    const stack = await detectStack(base, home);
    await home.close();
    log(`${paths.length} pages from ${source} · ${stack}`);

    const desktop = await chrome.newPage(DESKTOP);
    for (const path of paths) {
      log(`  desktop ${path}`);
      const rec = await scanPage(desktop, base + path, path, "desktop", true);
      pages.push(rec);
    }
    if (!options.quick) {
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
    if (!options.desktopOnly) {
      const mobile = await chrome.newPage(MOBILE);
      for (const path of paths) {
        log(`  mobile  ${path}`);
        pages.push(await scanPage(mobile, base + path, path, "mobile", false));
      }
      await mobile.close();
    }
    return {
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
  } finally {
    await chrome.close();
  }
}

export type FailureReason = "unreachable" | "blocked" | "timeout" | "not_html";

/** A lead scan that could not produce a report, with the reason the visitor's page needs. */
export class ScanFailure extends Error {
  reason: FailureReason;

  constructor(reason: FailureReason, detail: string) {
    super(detail);
    this.reason = reason;
  }
}

export type LeadStep = "load" | "mobile" | "keyboard" | "search" | "report";

export interface LeadScanOptions {
  target: string;
  label?: string;
  log?: Log;
  /** Called as the scan moves on, for the visitor's progress screen. */
  onStep?: (step: LeadStep) => void;
  /** Browser options: the address guard, the user agent, a pinned hostname. */
  launch?: LaunchOptions;
}

/** Per-page navigation limit in lead mode. */
const LEAD_NAV_TIMEOUT_MS = 20_000;
/** No new page is started after this point. */
const LEAD_SOFT_LIMIT_MS = 110_000;
/** Whatever has finished by now is the report. */
const LEAD_HARD_LIMIT_MS = 150_000;
/**
 * Autoplaying video decoded without a graphics card, in two browsers at
 * once, can slow every step on the service's small machine until the scan
 * runs out of time (taylormadeesthetics.net, 2026-10-05). The public scan
 * pauses media after load and caps the keyboard walk. Autoplay is still
 * reported: that check reads the page's markup, not whether it is playing.
 */
const LEAD_KEYBOARD_BUDGET_MS = 30_000;

const CHALLENGE_TITLE = /just a moment|attention required|access denied|are you a robot|verify you are human|captcha/i;

/**
 * The short public scan: the home page and up to two more, both widths,
 * the keyboard walk, reflow on the home page, and the search pass. Two
 * browsers run side by side (desktop passes in one, phone-width passes in
 * the other) to stay inside the time a visitor will wait.
 */
export async function runLeadScan(options: LeadScanOptions): Promise<ScanResult> {
  const log = options.log ?? (() => {});
  const step = options.onStep ?? (() => {});
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  let base = normalizeBase(options.target);

  const browsers: Chrome[] = [];
  let hardTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    step("load");
    const desktopChrome = await Chrome.launch(options.launch);
    browsers.push(desktopChrome);
    const desktop = await desktopChrome.newPage(DESKTOP);

    let nav: NavResult;
    try {
      nav = await desktop.goto(base + "/", 1500, LEAD_NAV_TIMEOUT_MS);
    } catch (e) {
      if (e instanceof RefusedResponse) throw new ScanFailure("blocked", "The address points somewhere this scanner does not go.");
      throw new ScanFailure("unreachable", String((e as Error).message ?? e).slice(0, 200));
    }
    if (nav.status === null && nav.loadMs === null) throw new ScanFailure("timeout", "The home page did not load in time.");
    if (nav.status !== null && [401, 403, 429].includes(nav.status)) throw new ScanFailure("blocked", `The site answered ${nav.status}.`);
    if (nav.mimeType && !/html/i.test(nav.mimeType)) throw new ScanFailure("not_html", `The address is ${nav.mimeType}, not a web page.`);
    if (CHALLENGE_TITLE.test(await desktop.evaluate<string>("document.title"))) throw new ScanFailure("blocked", "The site showed a bot check instead of its home page.");

    // A bare domain often forwards to www or to https. Scan where it landed.
    const landed = await desktop.evaluate<string>("location.origin");
    if (/^https?:\/\//.test(landed)) base = landed;
    const label = options.label ?? new URL(base).host;

    let paths = await pickLeadPages(desktop);
    if (paths.length < 3) {
      // Some sites build their navigation with script after the page loads.
      await new Promise((r) => setTimeout(r, 2500));
      paths = await pickLeadPages(desktop);
    }
    const stack = await detectStack(base, desktop);
    log(`${paths.length} pages from the navigation · ${stack}`);
    const basics = seoSiteBasics(base);

    const desktopPages: PageScan[] = [];
    const mobilePages: PageScan[] = [];
    let reflow: ReflowResult | undefined;
    let brokenLinks: ReturnType<typeof findBrokenLinks> | undefined;

    const desktopPass = async () => {
      for (const path of paths) {
        if (desktopPages.length && elapsed() > LEAD_SOFT_LIMIT_MS) break;
        log(`  desktop ${path}`);
        const rec = await scanPage(desktop, base + path, path, "desktop", true, { seo: true, timeoutMs: LEAD_NAV_TIMEOUT_MS, quietMedia: true, keyboardBudgetMs: LEAD_KEYBOARD_BUDGET_MS });
        desktopPages.push(rec);
        if (desktopPages.length === 1) {
          step("keyboard");
          brokenLinks = findBrokenLinks(rec.seo?.navLinks ?? []);
        }
      }
    };
    const mobilePass = async () => {
      const mobileChrome = await Chrome.launch(options.launch);
      browsers.push(mobileChrome);
      const mobile = await mobileChrome.newPage(MOBILE);
      for (const path of paths) {
        if (mobilePages.length && elapsed() > LEAD_SOFT_LIMIT_MS) break;
        log(`  mobile  ${path}`);
        mobilePages.push(await scanPage(mobile, base + path, path, "mobile", false, { recordLoad: true, timeoutMs: LEAD_NAV_TIMEOUT_MS, quietMedia: true }));
      }
      await mobile.close();
      if (elapsed() < LEAD_SOFT_LIMIT_MS) {
        const reflowPage = await mobileChrome.newPage(REFLOW);
        try {
          await reflowPage.goto(base + "/", 2500, LEAD_NAV_TIMEOUT_MS);
          reflow = await reflowCheck(reflowPage);
        } catch {}
      }
    };

    step("mobile");
    const hardStop = new Promise<void>((resolve) => {
      hardTimer = setTimeout(resolve, Math.max(0, LEAD_HARD_LIMIT_MS - elapsed()));
    });
    await Promise.race([Promise.all([desktopPass(), mobilePass().catch(() => {})]), hardStop]);

    const home = desktopPages[0];
    if (!home || home.error || !home.axe) throw new ScanFailure("timeout", home?.error ?? "The home page could not be checked in time.");
    if (reflow) home.reflow = reflow;

    step("search");
    const site = { ...(await basics), brokenLinks: brokenLinks ? await brokenLinks : [] };

    step("report");
    const pages = [...desktopPages, ...mobilePages];
    const summary = summarize(pages);
    return {
      tool: TOOL_NAME,
      version: TOOL_VERSION,
      standard: STANDARD,
      scannedAt: new Date().toISOString(),
      base,
      label,
      stack,
      pageSource: "navigation",
      durationMs: elapsed(),
      pages,
      summary,
      mode: "lead",
      seoSite: site,
      searchFlags: searchFlags(pages, site, base, new Set(summary.byRule.map((r) => r.id))),
    };
  } finally {
    clearTimeout(hardTimer);
    await Promise.all(browsers.map((b) => b.close()));
  }
}
