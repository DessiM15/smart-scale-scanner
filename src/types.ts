import type { AxeResult, ContrastGroup } from "./checks/axe.ts";
import type { KeyboardResult } from "./checks/keyboard.ts";
import type { StructureResult } from "./checks/structure.ts";
import type { ReflowResult } from "./checks/reflow.ts";
import type { SeoPageResult, SeoSiteResult } from "./checks/seo.ts";

export const TOOL_NAME = "Smart Scale Accessibility Scanner";
export const TOOL_VERSION = "0.1.0";
export const STANDARD = "WCAG 2.2 Level AA";

export interface PageScan {
  path: string;
  url: string;
  viewport: "desktop" | "mobile";
  status: number | null;
  title: string;
  axe?: AxeResult;
  keyboard?: KeyboardResult;
  structure?: StructureResult;
  reflow?: ReflowResult;
  reducedMotion?: { longAnimationsWithReduce: number; autoplayWithReduce: number };
  /** Lead mode only: what the search pass read from the page. */
  seo?: SeoPageResult;
  /** Lead mode only: how long the page took to load and how much it weighed. */
  load?: { loadMs: number | null; bytes: number };
  error?: string;
}

export interface RuleSummary {
  id: string;
  help: string;
  helpUrl: string;
  impact: string;
  count: number;
  pages: string[];
  samples: { html: string; message: string }[];
}

/** A site-level finding that is not an axe rule: comes from the keyboard walk, structure pass, reflow or motion checks. */
export interface Flag {
  id: string;
  severity: "critical" | "serious" | "moderate" | "minor";
  title: string;
  detail: string;
  pages: string[];
}

export interface Summary {
  pages: number;
  pagesWithErrors: number;
  axeViolations: number;
  contrastElements: number;
  contrastGroups: ContrastGroup[];
  byRule: RuleSummary[];
  flags: Flag[];
  /** The one number a client asks for. Total distinct problems to fix: rules + contrast groups + flags. */
  problems: number;
}

export interface ScanResult {
  tool: typeof TOOL_NAME;
  version: string;
  standard: string;
  scannedAt: string;
  base: string;
  label: string;
  stack: string;
  pageSource: string;
  durationMs: number;
  pages: PageScan[];
  summary: Summary;
  /** "lead" for the short public scan; absent on a full scan. */
  mode?: "lead";
  /** Lead mode only: site-wide search checks, and the findings built from them. */
  seoSite?: SeoSiteResult;
  searchFlags?: Flag[];
}

/**
 * The report the website shows a visitor after the free check. It says what
 * is wrong in plain words and nothing about how to fix it: no instructions,
 * no HTML samples, no selectors. The fix is the work we sell.
 */
export interface LeadFinding {
  id: string;
  severity: Flag["severity"];
  title: string;
  plain: string;
  pages: string[];
  count?: string;
  /** How many distinct problems this entry stands for. One, except faint text, which is one per color pair. */
  problems: number;
}

export interface LeadSection {
  id: "accessibility" | "search";
  title: string;
  rating: "good" | "fair" | "needs-work";
  problems: number;
  serious: number;
  findings: LeadFinding[];
}

export interface LeadReport {
  version: 1;
  scanId: string;
  base: string;
  label: string;
  scannedAt: string;
  durationMs: number;
  stack: string;
  pagesChecked: { path: string; title: string }[];
  totals: { problems: number; serious: number };
  sections: LeadSection[];
  /** Ids of the three findings to lead with. */
  top: string[];
}
