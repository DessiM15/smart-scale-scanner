/**
 * Scans the fixture site, whose problems are known, with a real Chrome.
 *
 *   npm test
 *
 * Two promises are checked here: the lead report says what it should and
 * nothing it should not, and the full client scan still finds exactly what
 * it found before lead mode existed (test/expected-full-summary.json).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { robotsBlocksAll } from "../src/checks/seo.ts";
import { buildLeadReport } from "../src/lead.ts";
import { runLeadScan, runScan } from "../src/scan.ts";
import { startFixture } from "./fixture-server.ts";

let server: Server;
let base = "";

before(async () => {
  ({ server, base } = await startFixture());
});
after(() => server.close());

test("robots.txt: only a blanket Disallow for every crawler counts as blocking the site", () => {
  assert.equal(robotsBlocksAll("User-agent: *\nDisallow: /"), true);
  assert.equal(robotsBlocksAll("User-agent: *\nDisallow:"), false);
  assert.equal(robotsBlocksAll("User-agent: *\nDisallow: /admin"), false);
  assert.equal(robotsBlocksAll("User-agent: BadBot\nDisallow: /"), false);
  assert.equal(robotsBlocksAll("User-agent: BadBot\nUser-agent: *\nDisallow: /"), true);
  assert.equal(robotsBlocksAll("User-agent: *\nDisallow: /\nAllow: /public"), false);
  assert.equal(robotsBlocksAll("# User-agent: *\n# Disallow: /"), false);
});

test("lead scan: the fixture's known problems, each once, and nothing about fixes", async () => {
  const result = await runLeadScan({ target: base });
  const lead = buildLeadReport(result, "s_test");

  assert.deepEqual(lead.pagesChecked.map((p) => p.path), ["/", "/contact.html", "/menu.html"]);

  const [accessibility, search] = lead.sections;
  const ids = (list: typeof accessibility.findings) => list.map((f) => f.id).sort();
  assert.deepEqual(ids(accessibility.findings), ["button-name", "color-contrast", "heading-order", "image-alt", "label", "no-skip-link"]);
  assert.deepEqual(ids(search.findings), [
    "seo-broken-links",
    "seo-canonical",
    "seo-meta-description",
    "seo-no-https",
    "seo-no-local-schema",
    "seo-no-phone-link",
    "seo-no-sitemap",
    "seo-no-social-preview",
    "seo-no-viewport",
    "seo-title",
  ]);

  // One element seen at two widths is one instance.
  const byId = Object.fromEntries(accessibility.findings.map((f) => [f.id, f]));
  assert.equal(byId["image-alt"].count, "1 instance");
  assert.equal(byId["color-contrast"].count, "1 element, 1 color pair");

  assert.equal(accessibility.rating, "needs-work");
  assert.equal(search.rating, "needs-work");
  assert.equal(lead.totals.problems, accessibility.problems + search.problems);
  assert.equal(accessibility.problems, result.summary.problems);
  assert.equal(search.problems, search.findings.length);

  assert.equal(lead.top.length, 3);
  const all = [...accessibility.findings, ...search.findings];
  assert.ok(lead.top.every((id) => all.some((f) => f.id === id)));
  assert.ok(lead.top.some((id) => id.startsWith("seo-")), "the search section is represented in the top three");

  // The visitor's report carries no fix instructions, markup or selectors.
  const allowed = ["count", "id", "pages", "plain", "problems", "severity", "title"];
  for (const f of all) assert.deepEqual(Object.keys(f).filter((k) => !allowed.includes(k)), []);
  const text = JSON.stringify(lead);
  assert.ok(!/<[a-z]+[\s>]/i.test(text), "no HTML in the lead report");
  assert.ok(!/aria-|tabindex|\balt=|<label/i.test(text), "no fix vocabulary in the lead report");
  assert.ok(!/compliant|certif/i.test(text), "no compliance claim in the lead report");
});

test("full scan: same findings as before lead mode existed", async () => {
  const result = await runScan({ target: base });
  const expected = JSON.parse(readFileSync(new URL("./expected-full-summary.json", import.meta.url), "utf8"));
  assert.deepEqual(JSON.parse(JSON.stringify(result.summary)), expected);
  assert.equal(result.mode, undefined);
  assert.ok(result.pages.every((p) => p.seo === undefined && p.load === undefined));
});
