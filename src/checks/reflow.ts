/**
 * WCAG 1.4.10 Reflow: at 320 CSS pixels wide (a 1280px screen zoomed to
 * 400%) the page must not scroll sideways, and text must not be clipped.
 * Low-vision users live at this zoom level; a page that fails here is a
 * page they cannot read.
 */
import type { Page } from "../browser.ts";

export interface ReflowResult {
  horizontalScroll: boolean;
  overflowPx: number;
  offenders: string[];
}

export async function reflowCheck(page: Page): Promise<ReflowResult> {
  return page.evaluate<ReflowResult>(`
    (() => {
      const w = document.documentElement.clientWidth;
      const sw = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0);
      const overflowPx = Math.max(0, sw - w);
      const offenders = [];
      if (overflowPx > 2) {
        for (const el of document.querySelectorAll("body *")) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.right > w + 2 && r.width < 4000) {
            const cs = getComputedStyle(el);
            if (cs.position === "fixed" || cs.overflowX === "hidden") continue;
            const desc = el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\\s+/).slice(0, 2).join(".") : "");
            offenders.push(desc.slice(0, 80));
            if (offenders.length >= 6) break;
          }
        }
      }
      return { horizontalScroll: overflowPx > 2, overflowPx, offenders };
    })()
  `);
}
