# Smart Scale Accessibility Scanner

WCAG 2.2 AA scans that end in a fix file, not a badge.

Point it at a website. It scans the site's pages at desktop and phone widths, runs the same engine the lawsuit-mill scanners use (axe-core) plus the checks they skip (a real keyboard walk, hidden-region focus, reduced-motion behavior, 400% zoom reflow, overlay detection), and writes three things:

- `report.html`: a client-facing report in plain words, with what each failure means and what happens next.
- `ACCESSIBILITY-FIX.md`: a work order that goes into the site's own repo. A developer, or an AI coding assistant opened at the project root, works from it: "Read ACCESSIBILITY-FIX.md and do everything in it."
- `scan.json`: the full result, for `compare` and for anything built on top.

Then `ssa compare before.json after.json` produces the before-and-after record.

## Run it

Requires Node 22.18 or newer and Google Chrome (or Chromium, or Edge) installed. Nothing else to install beyond `npm install`.

```
npm install
node src/cli.ts scan https://example.com
node src/cli.ts scan https://example.com --pages /,/menu,/contact --label "Example Cafe"
node src/cli.ts compare .scans/example.com/2026-09-01/scan.json .scans/example.com/2026-09-27/scan.json
```

Or link the `ssa` command: `npm link`, then `ssa scan https://example.com`.

Options for `scan`:

| Flag | Meaning |
|---|---|
| `--pages /a,/b` | Scan exactly these paths (home is always included). Otherwise the sitemap, or the home page's links. |
| `--max-pages 12` | Cap when discovering pages. |
| `--out dir` | Where to write. Default `.scans/<host>/<date>`. |
| `--label "Name"` | The business name on the report. |
| `--desktop-only` | Skip the phone-width pass. |
| `--quick` | Skip reflow and reduced-motion passes. |
| `--lead` | The short public scan (below). Writes `lead.json` and `scan.json`, no report or fix file. |

Set `SSA_CHROME` to a browser executable if the usual locations don't have one.

### The lead scan

`ssa scan https://example.com --lead` is the scan behind the free website check on smartscaleagent.com. It checks the home page and up to two more pages picked from the site's navigation, at both widths, in under a minute, and adds a search pass. The result, `lead.json`, is what a visitor is shown: two sections (Accessibility, Getting found on Google), a rating for each (good, fair, needs work), every problem in plain words, and the three to lead with. It contains no fix instructions and no score.

`npm test` runs both kinds of scan against a small fixture site with a real Chrome.

### The scan service

`npm run serve` starts the HTTP service the website calls (`src/server.ts`): `POST /scans` queues a lead scan, the result goes back to the website as a signed callback, and `GET /scans/{id}` returns the state. It needs `SSA_WORKER_SECRET` and `SSA_CALLBACK_HOST`. It only scans public websites: hostnames are resolved and checked against private ranges before a scan, pinned for the scan, and every response's address is checked during it. `Dockerfile` and `fly.toml` deploy it.

## What it checks

**axe-core, WCAG 2.2 AA plus best practice**, on every page at 1366px and 390px. Contrast failures are grouped by color pair so a designer sees "six tokens to change", not "fifty elements".

**Keyboard walk** (desktop, every page): presses the real Tab key up to 80 times and records where focus lands. Flags invisible focus, focus landing inside hidden regions (closed drawers and menus, the most common real bug on stores), focus traps, a missing skip link, and a skip link whose target does not exist. Focus that enters a third-party embed is noted, not judged.

**Structure** (desktop, every page): language, one h1, heading skips, landmarks, unnamed navs, untitled iframes, alt text that is a file name, links that open new tabs without saying so, autoplaying media without controls, animations running longer than five seconds with no pause control, and accessibility overlay widgets.

**Reduced motion** (home page): reloads with `prefers-reduced-motion: reduce` emulated and counts what keeps moving.

**Reflow** (first three pages): renders at 320px wide, the equivalent of 400% zoom, and flags sideways scrolling with the elements that cause it.

**Search basics** (lead scan only): whether the site asks Google not to list it, loads securely, has distinct page titles, descriptions, a phone layout, business details in structured data, a sitemap, working navigation links, a tappable phone number and a share preview, and whether the home page is slow or heavy on a phone. It reports what is missing or broken. It does not measure rankings.

## What it does not do

It does not certify compliance, and nothing can promise a business will never receive a demand letter. Automated checks find roughly a third of real accessibility problems; the fix file ends with the manual checks a person still has to run (screen reader, forms, dialogs, zoom). It does not scan behind logins or through a checkout with items in the cart yet.

## Layout

```
src/cli.ts              commands: scan, report, fix, compare
src/server.ts           the scan service (HTTP)
src/service/            queue and callbacks, public-address guard, request signing
src/scan.ts             the full scan and the lead scan; the summary builder
src/lead.ts             the visitor's report from a lead scan
src/browser.ts          Chrome over the DevTools Protocol (no Puppeteer, no Playwright)
src/crawl.ts            page discovery (sitemap, then links) and stack detection
src/checks/axe.ts       axe-core run and contrast grouping
src/checks/keyboard.ts  the Tab walk
src/checks/structure.ts outline, landmarks, media, overlays; reduced-motion recheck
src/checks/reflow.ts    320px reflow
src/checks/seo.ts       search basics (lead scan only)
src/rules.ts            plain-English meaning and fix per axe rule
src/report/html.ts      the client report
src/report/fixfile.ts   ACCESSIBILITY-FIX.md
src/compare.ts          before/after
```

TypeScript with erasable syntax only, run directly by Node's type stripping. No build step.

## Roadmap

1. `ssa fix --apply`: open a pull request against the site's repo with the fixes made, using an AI coding agent driven by the fix file, then rescan the preview deployment and attach the compare to the PR.
2. Dialog and drawer probe: open the first dialog it finds and test focus trap, Escape, and focus return.
3. Form probe: submit the main form empty and check that errors are text, tied to fields, and announced.
4. Authenticated and cart-state scans.
5. Scheduled rescans with a diff alert (monitoring).
6. A web front end: paste a URL, get the report by email.

Proprietary. See LICENSE.
