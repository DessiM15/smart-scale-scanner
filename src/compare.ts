/**
 * Before and after. Two scan results in, one honest diff out: which
 * problems went away, which stayed, and what is new. This is the record
 * a client keeps, and the thing the fix loop checks itself against.
 */
import type { ScanResult } from "./types.ts";

export interface CompareRow {
  key: string;
  title: string;
  before: number;
  after: number;
}

export interface CompareResult {
  base: string;
  before: string;
  after: string;
  problemsBefore: number;
  problemsAfter: number;
  fixed: CompareRow[];
  remaining: CompareRow[];
  introduced: CompareRow[];
}

function rows(r: ScanResult): Map<string, CompareRow> {
  const m = new Map<string, CompareRow>();
  if (r.summary.contrastElements) m.set("contrast", { key: "contrast", title: "Text contrast (elements)", before: 0, after: 0 });
  for (const rule of r.summary.byRule) m.set(`rule:${rule.id}`, { key: `rule:${rule.id}`, title: rule.help, before: 0, after: 0 });
  for (const f of r.summary.flags) m.set(`flag:${f.id}`, { key: `flag:${f.id}`, title: f.title, before: 0, after: 0 });
  return m;
}

function countOf(r: ScanResult, key: string): number {
  if (key === "contrast") return r.summary.contrastElements;
  if (key.startsWith("rule:")) return r.summary.byRule.find((x) => x.id === key.slice(5))?.count ?? 0;
  if (key.startsWith("flag:")) return r.summary.flags.find((x) => x.id === key.slice(5))?.pages.length ?? 0;
  return 0;
}

export function compare(before: ScanResult, after: ScanResult): CompareResult {
  const keys = new Map<string, CompareRow>([...rows(before), ...rows(after)]);
  const fixed: CompareRow[] = [];
  const remaining: CompareRow[] = [];
  const introduced: CompareRow[] = [];
  for (const [key, row] of keys) {
    const b = countOf(before, key);
    const a = countOf(after, key);
    const out = { ...row, before: b, after: a };
    if (b > 0 && a === 0) fixed.push(out);
    else if (b > 0 && a > 0) remaining.push(out);
    else if (b === 0 && a > 0) introduced.push(out);
  }
  return {
    base: after.base,
    before: before.scannedAt,
    after: after.scannedAt,
    problemsBefore: before.summary.problems,
    problemsAfter: after.summary.problems,
    fixed,
    remaining,
    introduced,
  };
}

export function formatCompare(c: CompareResult): string {
  const line = (r: CompareRow) => `  ${r.title.padEnd(58).slice(0, 58)} ${String(r.before).padStart(5)} → ${String(r.after).padStart(5)}`;
  const out: string[] = [];
  out.push(`${c.base}`);
  out.push(`before ${c.before.slice(0, 10)}: ${c.problemsBefore} distinct problems · after ${c.after.slice(0, 10)}: ${c.problemsAfter}`);
  out.push("");
  out.push(`Fixed (${c.fixed.length})`);
  c.fixed.forEach((r) => out.push(line(r)));
  out.push(`Remaining (${c.remaining.length})`);
  c.remaining.forEach((r) => out.push(line(r)));
  out.push(`Introduced (${c.introduced.length})`);
  c.introduced.forEach((r) => out.push(line(r)));
  return out.join("\n");
}
