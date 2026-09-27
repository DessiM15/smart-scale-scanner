/**
 * The axe-core pass. axe is the engine the lawsuit-mill scanners run, so a
 * page that is clean here is a page that does not show up on their lists.
 * We add two things on top: contrast failures grouped by the actual color
 * pair (so a designer sees "six tokens", not "fifty elements"), and a plain
 * account of what axe could not decide, since text over images and
 * gradients needs a human eye.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Page } from "../browser.ts";

const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

export interface AxeNode {
  html: string;
  target: string;
  message: string;
}

export interface AxeViolation {
  id: string;
  impact: "critical" | "serious" | "moderate" | "minor" | null;
  help: string;
  helpUrl: string;
  wcag: string[];
  count: number;
  nodes: AxeNode[];
}

export interface ContrastGroup {
  fg: string;
  bg: string;
  fontSize: string;
  ratio: number;
  required: number;
  count: number;
  classes: string;
  sample: string;
}

export interface AxeResult {
  violations: AxeViolation[];
  contrast: ContrastGroup[];
  contrastElements: number;
  /** Elements axe could not decide, by reason (bgImage, bgGradient, pseudoContent ...). */
  undetermined: Record<string, number>;
  incomplete: Record<string, number>;
  passes: number;
}

export async function runAxe(page: Page): Promise<AxeResult> {
  await page.inject(AXE_SOURCE);
  const raw = await page.evaluate<string>(`
    axe.run(document, { runOnly: { type: "tag", values: ${JSON.stringify(AXE_TAGS)} }, resultTypes: ["violations", "incomplete", "passes"] })
      .then((r) => {
        const contrast = {};
        let contrastElements = 0;
        const violations = [];
        for (const v of r.violations) {
          if (v.id === "color-contrast" || v.id === "color-contrast-enhanced") {
            for (const n of v.nodes) {
              const d = (n.any[0] && n.any[0].data) || {};
              contrastElements++;
              const m = n.html.match(/class="([^"]*)"/);
              const classes = (m ? m[1].split(/\\s+/).filter((c) => /text-|color|gray|grey|muted|light|opacity/.test(c)).join(" ") : "").slice(0, 90);
              const sample = n.html.replace(/<[^>]+>/g, "").replace(/\\s+/g, " ").trim().slice(0, 60);
              const key = [d.fgColor, d.bgColor, d.fontSize, d.contrastRatio, classes].join("|");
              if (!contrast[key]) contrast[key] = { fg: d.fgColor, bg: d.bgColor, fontSize: d.fontSize, ratio: Number(d.contrastRatio), required: Number(d.expectedContrastRatio ? String(d.expectedContrastRatio).split(":")[0].replace(/[^0-9.]/g, "") : 4.5) || 4.5, count: 0, classes, sample };
              contrast[key].count++;
            }
            continue;
          }
          violations.push({
            id: v.id,
            impact: v.impact || null,
            help: v.help,
            helpUrl: v.helpUrl,
            wcag: v.tags.filter((t) => /^wcag\\d/.test(t)),
            count: v.nodes.length,
            nodes: v.nodes.slice(0, 6).map((n) => ({
              html: n.html.slice(0, 240),
              target: (n.target || []).join(" "),
              message: ((n.any[0] && n.any[0].message) || n.failureSummary || "").slice(0, 240),
            })),
          });
        }
        const undetermined = {};
        const incomplete = {};
        for (const v of r.incomplete) {
          incomplete[v.id] = v.nodes.length;
          if (v.id === "color-contrast") {
            for (const n of v.nodes) {
              const k = (n.any[0] && n.any[0].data && n.any[0].data.messageKey) || "other";
              undetermined[k] = (undetermined[k] || 0) + 1;
            }
          }
        }
        return JSON.stringify({
          violations,
          contrast: Object.values(contrast).sort((a, b) => b.count - a.count),
          contrastElements,
          undetermined,
          incomplete,
          passes: r.passes.length,
        });
      })
  `);
  return JSON.parse(raw) as AxeResult;
}
