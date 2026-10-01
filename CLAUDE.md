# Smart Scale Accessibility Scanner · working notes

Read this first when picking the project back up. The README describes what the tool is; this file says where the work stands and what is next.

## Where we are (2026-09-27)

- **v0.1 is on main and works end to end.** `node src/cli.ts scan <url>` produces `report.html`, `ACCESSIBILITY-FIX.md` and `scan.json`; `compare` diffs two scans. Tested on smartscaleagent.com (near clean), mextacohouse.com (34 problems, the rich example) and loved-beauty.vercel.app.
- **It has already found one bug axe and a manual pass both missed:** smartscaleagent.com's navbar keeps two desktop layouts in the page and fades one out; the hidden one still had eight tabbable links. Fixed with `inert` in smart-scale-website-official PR #63. That is the keyboard walk earning its keep, and the story to tell when selling this.
- **Baseline scans are committed under `scans/`** for andrethomaslaw.com and loved-beauty.vercel.app (2026-09-27-before). After each site's fixes land, run the scan again into a `-after` folder and `compare` the two. Mex Taco House gets its baseline the day it is fixed (they are open on the 27th; fix on a closed day).
- **andrethomaslaw.com is done: 9 → 0 (2026-09-28-after, `compare.json` alongside).** The rescan exposed four scanner blind spots, all fixed the same day: English-only wording checks for skip links, new-tab hints and pause buttons (the Spanish pages were clean but flagged), and Chrome's native date input, whose month/day/year sub-fields read as a focus trap with no visible focus. The baseline's "focus trap" was that date input, never a real trap; say so if the before/after is ever shown to the client.
- **ascension-group-landing-page.vercel.app scanned 2026-09-28 (13 problems, `scans/.../2026-09-28-before`).** Repo is `~/Desktop/Ascension Athlete Group`; a hand-annotated `ACCESSIBILITY-FIX.md` with file:line references is in it, not yet committed there. Rescan into a `-after` folder once the fixes land.
- **Fix files are already in each client repo** as `ACCESSIBILITY-FIX.md` (written by hand on 2026-09-25, before the generator existed). The generator's output is close to them but not identical; when regenerating, keep the hand-written manual-check items if they are more specific.

## How the code is organized

```
src/cli.ts              commands and the summary builder (site-level flags live here)
src/browser.ts          Chrome over CDP, Node's built-in WebSocket; no Puppeteer
src/crawl.ts            sitemap-then-links page discovery, stack detection
src/checks/axe.ts       axe-core run, contrast grouped by color pair
src/checks/keyboard.ts  real Tab-key walk
src/checks/structure.ts outline, landmarks, media, overlays, reduced-motion recheck
src/checks/reflow.ts    320px reflow (400% zoom)
src/rules.ts            plain-English meaning + fix per axe rule id
src/report/html.ts      client report
src/report/fixfile.ts   ACCESSIBILITY-FIX.md generator
src/compare.ts          before/after
```

Conventions that matter:

- **TypeScript with erasable syntax only.** Node 22 runs the `.ts` files directly (type stripping). That means: no `enum`, no parameter properties in constructors, `import type` for types, and `.ts` in import specifiers. There is no build step and we want to keep it that way.
- **Page scripts are strings** passed to `page.evaluate`. Inside a template literal, regex escapes need doubling (`/\\s+/`). This has bitten once already.
- **One finding = one problem.** `summary.problems` counts distinct rules + distinct contrast color pairs + distinct site-level flags, not elements. Clients get a number they can act on. Do not add checks that inflate it with duplicates; the structure flags are deduped against axe rules in `summarize()`.
- **Never claim compliance.** Report, fix file and license all say a scan is not a legal certification. Keep it that way in any new output.
- **Chrome path:** looked up in `browser.ts`; `SSA_CHROME` overrides.

## Known rough edges

- Focus that enters a cross-origin iframe (booking calendars, maps) is noted in `keyboard.embeddedFrames` and not judged. Right call, but the report does not show that list yet.
- "Long animation with no pause control" fires on ticker/marquee patterns that pause on hover and focus. It is a legitimate 2.2.2 finding at moderate severity; the wording explains why.
- Hidden-focus now waits up to 1.5s for a fade-in before judging. Sections that take longer than that to appear after focus lands are still flagged, and rightly so.
- The reflow `offenders` list is DOM-order and includes children of `overflow:hidden` parents (marquee tracks), so the first entries can be a false lead. On Ascension the real 38px cause was `.btn` with `whitespace-nowrap`. Worth skipping descendants of clipped ancestors and sorting by right edge.
- Reflow runs on the first three pages only, reduced-motion on the home page only, to keep a scan under two minutes.
- No login, no cart state, no dialog probing yet.
- The `hiddenBy` field on a hidden focus stop names the ancestor and how it hides (`opacity:0`, `aria-hidden`, ...). Useful; not yet in the HTML report.

## Next (in order)

1. **Dialog and drawer probe.** Find the first element with `role=dialog` or the first button whose name suggests a menu/cart/search, activate it with the keyboard, then check: focus moved inside, Tab stays inside, Escape closes, focus returns. This catches the Loved Beauty cart bug as a positive test, not just via aria-hidden.
2. **Empty-form probe.** Find the main form, press Enter in it empty, and check that error text appeared, is associated (`aria-describedby`) and that focus moved to the first invalid field.
3. **`ssa fix --apply`.** The product's center: hand the fix file to an AI coding agent in the site's repo (Claude Code non-interactive, or the Agent SDK), let it open a PR, wait for the Vercel preview, rescan the preview URL, attach `compare` output to the PR. Start with a repo we own (loved-beauty), gate it behind a flag, never merge automatically.
4. **Report polish:** show `embeddedFrames` and `hiddenBy`, add a "since last scan" line when a previous scan exists in the same folder tree.
5. **Monitoring:** a `watch` command or a GitHub Action that rescans weekly and opens an issue on regression.
6. **Web front end:** a form on smartscaleagent.com that queues a scan and emails the report. Lead magnet for the compliance article.

## Business notes

- Not patenting: prior art everywhere, expensive, easy to design around. The asset is the fix-as-PR loop, report quality, the before/after record, and reputation.
- Licensing to other agencies (white label) is real but comes after the loop works on our own clients for a few months.
- Sell fewer problems and proof, never immunity.
