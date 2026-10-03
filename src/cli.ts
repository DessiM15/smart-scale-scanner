/**
 * ssa: Smart Scale Accessibility Scanner.
 *
 *   ssa scan <url> [--pages /a,/b] [--max-pages 12] [--out dir] [--label "Name"] [--desktop-only] [--quick]
 *   ssa scan <url> --lead [--out dir] [--label "Name"]
 *   ssa report <scan.json> [--out report.html]
 *   ssa fix <scan.json> [--out ACCESSIBILITY-FIX.md]
 *   ssa compare <before.json> <after.json>
 *
 * `scan` writes scan.json, report.html and ACCESSIBILITY-FIX.md into --out
 * (default .scans/<host>/<date>). With --lead it runs the short public scan
 * and writes scan.json and lead.json instead: the visitor's report, with no
 * fix file. Every other command works from scan.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compare, formatCompare } from "./compare.ts";
import { normalizeBase } from "./crawl.ts";
import { buildLeadReport } from "./lead.ts";
import { buildFixFile } from "./report/fixfile.ts";
import { buildHtmlReport } from "./report/html.ts";
import { runLeadScan, runScan, ScanFailure } from "./scan.ts";
import { TOOL_NAME, TOOL_VERSION, type ScanResult } from "./types.ts";

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

const USAGE = "ssa scan <url> [--pages /a,/b] [--max-pages 12] [--out dir] [--label Name] [--desktop-only] [--quick] [--lead]";

async function scan(args: ReturnType<typeof parseArgs>) {
  const target = args.positional[0];
  if (!target) throw new Error(`Usage: ${USAGE}`);
  const base = normalizeBase(target);
  const host = new URL(base).host;
  const label = typeof args.flags.label === "string" ? args.flags.label : undefined;
  const stamp = new Date().toISOString().slice(0, 10);
  const outDir = String(args.flags.out ?? join(".scans", host, stamp));
  mkdirSync(outDir, { recursive: true });

  log(`${TOOL_NAME} v${TOOL_VERSION}\n${base}`);

  if (args.flags.lead) {
    let result: ScanResult;
    try {
      result = await runLeadScan({ target, label, log });
    } catch (e) {
      if (e instanceof ScanFailure) throw new Error(`could not scan (${e.reason}): ${e.message}`);
      throw e;
    }
    const lead = buildLeadReport(result, `cli-${Date.now()}`);
    writeFileSync(join(outDir, "scan.json"), JSON.stringify(result, null, 2));
    writeFileSync(join(outDir, "lead.json"), JSON.stringify(lead, null, 2));
    log(`\n${lead.totals.problems} problems, ${lead.totals.serious} serious · ${lead.sections.map((s) => `${s.title}: ${s.rating}`).join(" · ")} · ${Math.round(result.durationMs / 1000)}s`);
    log(`→ ${join(outDir, "lead.json")}\n→ ${join(outDir, "scan.json")}`);
    return;
  }

  const result = await runScan({
    target,
    label,
    maxPages: Number(args.flags["max-pages"] ?? 12),
    explicit: typeof args.flags.pages === "string" ? args.flags.pages.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    desktopOnly: Boolean(args.flags["desktop-only"]),
    quick: Boolean(args.flags.quick),
    log,
  });
  writeFileSync(join(outDir, "scan.json"), JSON.stringify(result, null, 2));
  writeFileSync(join(outDir, "report.html"), buildHtmlReport(result));
  writeFileSync(join(outDir, "ACCESSIBILITY-FIX.md"), buildFixFile(result));
  const s = result.summary;
  log(`\n${s.problems} distinct problems · ${s.contrastElements} faint-text elements · ${s.axeViolations} other rule failures · ${s.flags.length} keyboard/structure/motion findings · ${Math.round(result.durationMs / 1000)}s`);
  log(`→ ${join(outDir, "report.html")}\n→ ${join(outDir, "ACCESSIBILITY-FIX.md")}\n→ ${join(outDir, "scan.json")}`);
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
      log(`${TOOL_NAME} v${TOOL_VERSION}\n\n  ${USAGE}\n  ssa report <scan.json> [--out report.html]\n  ssa fix <scan.json> [--out ACCESSIBILITY-FIX.md]\n  ssa compare <before.json> <after.json> [--out compare.json]`);
      process.exitCode = cmd ? 1 : 0;
  }
}

main().catch((e) => {
  log(`error: ${(e as Error).message ?? e}`);
  process.exitCode = 1;
});
