/**
 * Things a screen-reader user meets before any pixel: the page's outline,
 * its landmarks, its language, what its links promise, and whether an
 * overlay widget is pretending to do this job. All read in one pass.
 */
import type { Page } from "../browser.ts";

export interface StructureResult {
  title: string;
  lang: string;
  h1Count: number;
  headings: { level: number; text: string }[];
  headingSkips: { from: number; to: number; text: string }[];
  landmarks: { main: boolean; nav: boolean; header: boolean; footer: boolean; navsWithoutName: number };
  images: { total: number; missingAlt: number; filenameAlt: string[] };
  iframesWithoutTitle: string[];
  newTabLinksWithoutHint: number;
  newTabSamples: string[];
  genericLinkText: number;
  media: { autoplayWithoutControls: number; longAnimations: number; pauseControls: number };
  overlay: string | null;
  formsWithoutSubmitText: number;
}

export const STRUCTURE_SCRIPT = `
  (() => {
    const text = (el) => (el.getAttribute("aria-label") || el.textContent || "").replace(/\\s+/g, " ").trim();
    const hs = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter((h) => h.offsetParent !== null || getComputedStyle(h).position === "fixed");
    const headings = hs.map((h) => ({ level: Number(h.tagName[1]), text: text(h).slice(0, 70) }));
    const headingSkips = [];
    let prev = 0;
    for (const h of headings) { if (prev && h.level > prev + 1) headingSkips.push({ from: prev, to: h.level, text: h.text }); prev = h.level; }
    const navs = [...document.querySelectorAll("nav,[role=navigation]")];
    const navNames = navs.map((n) => n.getAttribute("aria-label") || n.getAttribute("aria-labelledby") || "");
    const navsWithoutName = navs.length > 1 ? navNames.filter((n) => !n).length : 0;
    const imgs = [...document.querySelectorAll("img")];
    const filenameAlt = imgs.map((i) => i.getAttribute("alt") || "").filter((a) => /\\.(jpe?g|png|webp|gif|svg)$/i.test(a) || /^(img|image|dsc|photo)[-_ ]?\\d+/i.test(a)).slice(0, 5);
    const iframesWithoutTitle = [...document.querySelectorAll("iframe")].filter((f) => !f.getAttribute("title")).map((f) => (f.getAttribute("src") || "").slice(0, 80));
    const newTab = [...document.querySelectorAll('a[target="_blank"]')];
    const hinted = (a) => /new (tab|window)|opens in/i.test(text(a) + " " + (a.getAttribute("title") || ""));
    const newTabNoHint = newTab.filter((a) => !hinted(a));
    const generic = [...document.querySelectorAll("a[href]")].filter((a) => /^(click here|read more|learn more|more|here|link)$/i.test(text(a))).length;
    const autoplay = [...document.querySelectorAll("video[autoplay],audio[autoplay]")].filter((v) => !v.hasAttribute("controls")).length;
    let longAnimations = 0;
    try {
      for (const a of document.getAnimations()) {
        const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : {};
        const total = t.iterations === Infinity ? Infinity : (Number(t.duration) || 0) * (Number(t.iterations) || 1);
        if (total > 5000) longAnimations++;
      }
    } catch {}
    const pauseControls = [...document.querySelectorAll("button,a,[role=button]")].filter((b) => /\\b(pause|stop|play)\\b/i.test(text(b) + " " + (b.getAttribute("title") || ""))).length;
    const overlaySel = ['[class*="acsb"]', "#userwayAccessibilityIcon", "[data-acsb]", 'script[src*="accessibe"]', 'script[src*="userway"]', 'script[src*="audioeye"]', 'script[src*="equalweb"]', 'script[src*="allyable"]', 'script[src*="accessiway"]', 'script[src*="adally"]', 'script[src*="accessibility-widget"]'];
    let overlay = null;
    for (const s of overlaySel) { if (document.querySelector(s)) { overlay = s.replace(/[\\[\\]'"*=script src]/g, "").replace("class", "").replace("data-", "") || s; break; } }
    const forms = [...document.querySelectorAll("form")];
    const formsWithoutSubmitText = forms.filter((f) => { const b = f.querySelector('button,[type=submit]'); return b && !text(b) && !b.getAttribute("value"); }).length;
    return {
      title: document.title,
      lang: document.documentElement.lang || "",
      h1Count: document.querySelectorAll("h1").length,
      headings: headings.slice(0, 60),
      headingSkips,
      landmarks: { main: !!document.querySelector("main,[role=main]"), nav: navs.length > 0, header: !!document.querySelector("header,[role=banner]"), footer: !!document.querySelector("footer,[role=contentinfo]"), navsWithoutName },
      images: { total: imgs.length, missingAlt: imgs.filter((i) => !i.hasAttribute("alt")).length, filenameAlt },
      iframesWithoutTitle,
      newTabLinksWithoutHint: newTabNoHint.length,
      newTabSamples: newTabNoHint.slice(0, 4).map((a) => text(a).slice(0, 40) || a.getAttribute("href") || ""),
      genericLinkText: generic,
      media: { autoplayWithoutControls: autoplay, longAnimations, pauseControls },
      overlay,
      formsWithoutSubmitText,
    };
  })()
`;

export async function structureCheck(page: Page): Promise<StructureResult> {
  return page.evaluate<StructureResult>(STRUCTURE_SCRIPT);
}

/** Re-count the long-running animations with reduced motion emulated; anything left ignores the user's setting. */
export async function reducedMotionCheck(page: Page, url: string): Promise<{ longAnimationsWithReduce: number; autoplayWithReduce: number }> {
  await page.setReducedMotion(true);
  await page.goto(url, 3000);
  const r = await page.evaluate<{ a: number; v: number }>(`
    (() => {
      let a = 0;
      try { for (const x of document.getAnimations()) { const t = x.effect && x.effect.getTiming ? x.effect.getTiming() : {}; const total = t.iterations === Infinity ? Infinity : (Number(t.duration) || 0) * (Number(t.iterations) || 1); if (total > 5000 && x.playState === "running") a++; } } catch {}
      const v = [...document.querySelectorAll("video,audio")].filter((m) => !m.paused && !m.hasAttribute("controls")).length;
      return { a, v };
    })()
  `);
  await page.setReducedMotion(false);
  return { longAnimationsWithReduce: r.a, autoplayWithReduce: r.v };
}
