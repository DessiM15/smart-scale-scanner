/**
 * The keyboard walk. This presses the real Tab key, the way a person who
 * cannot use a mouse does, and records where focus lands each time. axe
 * cannot do this: it reads the DOM at rest. Three of the most common real
 * failures only show up here: focus that is invisible, focus that lands on
 * controls inside a hidden drawer, and a skip link that goes nowhere.
 */
import type { Page } from "../browser.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface FocusStop {
  index: number;
  tag: string;
  name: string;
  visibleFocus: boolean;
  /** Inside an aria-hidden ancestor or a display:none/visibility:hidden/opacity:0 region. */
  hidden: boolean;
  /** Which ancestor hides it and how, e.g. `div.footer-grid opacity:0`. */
  hiddenBy?: string;
  offscreen: boolean;
  href?: string;
  /** Per-page identity of the focused node, so two unlabeled inputs in a row are not mistaken for one. */
  elId?: number;
  /** A native date/time input whose internal fields take several Tab presses. */
  composite?: boolean;
}

export interface KeyboardResult {
  stops: number;
  /** Third-party embeds focus entered; focus inside them cannot be judged from outside. */
  embeddedFrames: string[];
  /** First tab stop is a skip link. */
  skipLink: { present: boolean; text?: string; targetExists?: boolean; targetFocusable?: boolean };
  invisibleFocus: FocusStop[];
  hiddenFocus: FocusStop[];
  trap: FocusStop | null;
  /** True if the walk reached the end of the page (focus returned to the document). */
  reachedEnd: boolean;
}

const STOP_SNAPSHOT = `
  (() => {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) return { tag: "BODY", name: "", visibleFocus: true, hidden: false, offscreen: false };
    const cs = getComputedStyle(el);
    const hasOutline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
    const hasShadow = cs.boxShadow && cs.boxShadow !== "none";
    // A border-color change alone is what many templates rely on; treat it
    // as visible only when the border is at least 2px, since a 1px tint
    // does not meet the 2.4.11 area rule in practice.
    let borderChange = false;
    try {
      const w = parseFloat(cs.borderTopWidth);
      borderChange = w >= 2 && el.matches(":focus-visible") && /focus/.test(el.className);
    } catch {}
    let hidden = false;
    let hiddenBy = undefined;
    let n = el;
    const desc = (x) => x.tagName.toLowerCase() + (x.id ? "#" + x.id : "") + (typeof x.className === "string" && x.className.trim() ? "." + x.className.trim().split(/\\s+/).slice(0, 2).join(".") : "");
    while (n && n !== document.body) {
      const s = getComputedStyle(n);
      if (n.getAttribute && n.getAttribute("aria-hidden") === "true") { hidden = true; hiddenBy = desc(n) + " aria-hidden"; break; }
      if (s.visibility === "hidden" || s.display === "none" || s.opacity === "0") { hidden = true; hiddenBy = desc(n) + " " + (s.display === "none" ? "display:none" : s.visibility === "hidden" ? "visibility:hidden" : "opacity:0"); break; }
      n = n.parentElement;
    }
    // Chrome moves through the month/day/year fields and the picker button
    // of a native date or time input on successive Tab presses while
    // activeElement stays the same node. Those internal stops draw their
    // own focus ring in the shadow DOM, which computed style cannot see.
    const composite = el.tagName === "INPUT" && /^(date|time|datetime-local|month|week)$/.test(el.type || "");
    if (!el.__ssaId) el.__ssaId = (window.__ssaSeq = (window.__ssaSeq || 0) + 1);
    const r = el.getBoundingClientRect();
    const offscreen = r.width === 0 || r.height === 0 || r.bottom < 0 || r.right < 0 || r.left > innerWidth || r.top > innerHeight + 2000;
    const labelText = el.labels && el.labels[0] ? el.labels[0].textContent : "";
    const name = (el.getAttribute("aria-label") || el.textContent || labelText || el.getAttribute("title") || el.getAttribute("placeholder") || "").replace(/\\s+/g, " ").trim().slice(0, 60);
    return { tag: el.tagName, name, visibleFocus: hasOutline || Boolean(hasShadow) || borderChange, hidden, hiddenBy, offscreen, href: el.getAttribute("href") || undefined, elId: el.__ssaId, composite };
  })()
`;

/**
 * `budgetMs` ends the walk early on a page where every key press is slow (a
 * heavy page on a small machine). What was seen up to then is still judged.
 */
export async function keyboardWalk(page: Page, maxStops = 80, budgetMs = Infinity): Promise<KeyboardResult> {
  const started = Date.now();
  await page.evaluate(`(() => { window.scrollTo(0, 0); document.activeElement && document.activeElement.blur && document.activeElement.blur(); return true; })()`);
  const stops: FocusStop[] = [];
  const embeddedFrames: string[] = [];
  let reachedEnd = false;
  let trap: FocusStop | null = null;
  let repeat = 0;
  let inFrame = 0;
  for (let i = 0; i < maxStops; i++) {
    if (Date.now() - started > budgetMs) break;
    await page.pressKey("Tab");
    await sleep(120);
    let s = await page.evaluate<Omit<FocusStop, "index">>(STOP_SNAPSHOT);
    if (s.tag === "BODY" && i > 0) {
      reachedEnd = true;
      break;
    }
    // Focus inside a cross-origin iframe (a booking calendar, a map) reports
    // the iframe itself on every press. Note it once and move on; what
    // happens inside is the embed's responsibility and the statement page's
    // "known limitations".
    if (s.tag === "IFRAME") {
      inFrame++;
      if (inFrame === 1) embeddedFrames.push(s.name || s.href || "untitled iframe");
      if (inFrame > 40) break;
      continue;
    }
    inFrame = 0;
    // A section that is fading in on scroll reads as opacity 0 for a moment,
    // and fades of up to a second are common. Poll rather than judge the first frame.
    for (let waited = 0; s.hidden && waited < 1500; waited += 300) {
      await sleep(300);
      s = await page.evaluate<Omit<FocusStop, "index">>(STOP_SNAPSHOT);
    }
    const stop: FocusStop = { index: i + 1, ...s };
    const prev = stops[stops.length - 1];
    if (prev && prev.elId === stop.elId) {
      repeat++;
      if (repeat >= (stop.composite ? 6 : 3) && !trap) trap = stop;
      // An internal field of a native date input: Chrome draws that ring itself.
      if (stop.composite) stop.visibleFocus = true;
    } else {
      repeat = 0;
    }
    stops.push(stop);
  }

  const first = stops[0];
  let skipLink: KeyboardResult["skipLink"] = { present: false };
  // Any in-page anchor as the very first stop is a skip link, whatever its
  // wording ("Skip to main content", "Saltar al contenido principal", ...).
  if (first && first.tag === "A" && first.href && first.href.length > 1 && first.href.startsWith("#")) {
    const id = first.href.slice(1);
    const target = await page.evaluate<{ exists: boolean; focusable: boolean }>(`
      (() => {
        const t = document.getElementById(${JSON.stringify(id)}) || document.querySelector('[name=${JSON.stringify(id)}]');
        if (!t) return { exists: false, focusable: false };
        const focusable = t.tabIndex >= -1 && (t.hasAttribute("tabindex") || /^(A|BUTTON|INPUT|SELECT|TEXTAREA|MAIN)$/.test(t.tagName));
        return { exists: true, focusable };
      })()
    `);
    skipLink = { present: true, text: first.name, targetExists: target.exists, targetFocusable: target.focusable };
  }

  return {
    stops: stops.length,
    embeddedFrames,
    skipLink,
    invisibleFocus: stops.filter((s) => !s.visibleFocus && !s.hidden).slice(0, 12),
    hiddenFocus: stops.filter((s) => s.hidden).slice(0, 12),
    trap,
    reachedEnd,
  };
}
