import type { AxeResult, ContrastGroup } from "./checks/axe.ts";
import type { KeyboardResult } from "./checks/keyboard.ts";
import type { StructureResult } from "./checks/structure.ts";
import type { ReflowResult } from "./checks/reflow.ts";

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
}
