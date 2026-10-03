/**
 * The lead report: what the free website check shows a visitor. Two
 * sections (accessibility, getting found on Google), a three-level rating
 * for each, and every problem in plain words. No score, no claim of
 * compliance, and nothing about how to fix anything.
 */
import { flagPlain, ruleText, ruleTitle } from "./rules.ts";
import type { LeadFinding, LeadReport, LeadSection, ScanResult } from "./types.ts";

const SEVERITY_ORDER: Record<string, number> = { critical: 0, serious: 1, moderate: 2, minor: 3 };

/**
 * Among findings of equal severity, the ones an owner grasps at once come
 * first: "Google is told not to list you" needs no explanation, "labels
 * placed where they are ignored" does.
 */
const LEAD_WITH = [
  "seo-noindex",
  "seo-no-https",
  "color-contrast",
  "image-alt",
  "focus-trap",
  "invisible-focus",
  "hidden-focus",
  "seo-no-viewport",
  "seo-title",
  "button-name",
  "link-name",
  "label",
  "reflow",
  "seo-slow",
  "seo-broken-links",
  "seo-meta-description",
  "seo-no-local-schema",
];

function asSeverity(impact: string): LeadFinding["severity"] {
  return impact === "critical" || impact === "serious" || impact === "minor" ? impact : "moderate";
}

function rate(findings: LeadFinding[]): LeadSection["rating"] {
  if (findings.length === 0) return "good";
  return findings.some((f) => f.severity === "critical" || f.severity === "serious") ? "needs-work" : "fair";
}

function rank(f: LeadFinding): number {
  const i = LEAD_WITH.indexOf(f.id);
  return i === -1 ? LEAD_WITH.length : i;
}

const byImportance = (a: LeadFinding, b: LeadFinding) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || rank(a) - rank(b);

function section(id: LeadSection["id"], title: string, findings: LeadFinding[]): LeadSection {
  findings.sort(byImportance);
  const count = (list: LeadFinding[]) => list.reduce((n, f) => n + f.problems, 0);
  return { id, title, rating: rate(findings), problems: count(findings), serious: count(findings.filter((f) => SEVERITY_ORDER[f.severity] <= 1)), findings };
}

/**
 * How many instances a visitor would count. A page is scanned at two widths,
 * and the same button missing its name at both is one button, so take the
 * larger of the two per page and add the pages up.
 */
function instances(r: ScanResult, countOn: (p: ScanResult["pages"][number]) => number): number {
  const perPath = new Map<string, number>();
  for (const p of r.pages) perPath.set(p.path, Math.max(perPath.get(p.path) ?? 0, countOn(p)));
  return [...perPath.values()].reduce((a, b) => a + b, 0);
}

export function buildLeadReport(r: ScanResult, scanId: string): LeadReport {
  const s = r.summary;
  const accessibility: LeadFinding[] = [];
  for (const f of s.flags) {
    accessibility.push({ id: f.id, severity: f.severity, title: f.title, plain: flagPlain(f.id, f.detail), pages: f.pages, problems: 1 });
  }
  if (s.contrastGroups.length) {
    const pairs = s.contrastGroups.length;
    const elements = instances(r, (p) => p.axe?.contrastElements ?? 0);
    accessibility.push({
      id: "color-contrast",
      severity: "serious",
      title: "Text too faint to read",
      plain: ruleText("color-contrast", "").plain,
      pages: [...new Set(r.pages.filter((p) => p.axe && p.axe.contrastElements > 0).map((p) => p.path))],
      count: `${elements} element${elements === 1 ? "" : "s"}, ${pairs} color pair${pairs === 1 ? "" : "s"}`,
      problems: pairs,
    });
  }
  for (const rule of s.byRule) {
    const n = instances(r, (p) => p.axe?.violations.find((v) => v.id === rule.id)?.count ?? 0);
    accessibility.push({
      id: rule.id,
      severity: asSeverity(rule.impact),
      title: ruleTitle(rule.id, rule.help),
      plain: ruleText(rule.id, rule.help).plain,
      pages: rule.pages,
      count: `${n} instance${n === 1 ? "" : "s"}`,
      problems: 1,
    });
  }
  const search: LeadFinding[] = (r.searchFlags ?? []).map((f) => ({ id: f.id, severity: f.severity, title: f.title, plain: f.detail, pages: f.pages, problems: 1 }));

  const sections = [section("accessibility", "Accessibility", accessibility), section("search", "Getting found on Google", search)];

  // The three to lead with: the most severe overall, with the search section
  // represented whenever it has anything to say.
  const all = sections.flatMap((sec) => sec.findings.map((f) => ({ f, sec: sec.id })));
  all.sort((a, b) => byImportance(a.f, b.f));
  const top = all.slice(0, 3);
  const firstSearch = all.find((x) => x.sec === "search");
  if (firstSearch && top.length === 3 && !top.some((x) => x.sec === "search")) top[2] = firstSearch;

  const seen = new Set<string>();
  const pagesChecked: LeadReport["pagesChecked"] = [];
  for (const p of r.pages) {
    if (p.error || seen.has(p.path)) continue;
    seen.add(p.path);
    pagesChecked.push({ path: p.path, title: p.title });
  }

  return {
    version: 1,
    scanId,
    base: r.base,
    label: r.label,
    scannedAt: r.scannedAt,
    durationMs: r.durationMs,
    stack: r.stack,
    pagesChecked,
    totals: { problems: sections[0].problems + sections[1].problems, serious: sections[0].serious + sections[1].serious },
    sections,
    top: top.map((x) => x.f.id),
  };
}
