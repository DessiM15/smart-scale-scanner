# Smart Scale Accessibility Scanner · working notes

Read this first when picking the project back up. The README describes what the tool is; this file says where the work stands and what is next.

## Where we are (2026-10-03)

- **v0.1 is on main and works end to end.** `node src/cli.ts scan <url>` produces `report.html`, `ACCESSIBILITY-FIX.md` and `scan.json`; `compare` diffs two scans. Tested on smartscaleagent.com (near clean), mextacohouse.com (34 problems, the rich example) and loved-beauty.vercel.app.
- **It has already found one bug axe and a manual pass both missed:** smartscaleagent.com's navbar keeps two desktop layouts in the page and fades one out; the hidden one still had eight tabbable links. Fixed with `inert` in smart-scale-website-official PR #63. That is the keyboard walk earning its keep, and the story to tell when selling this.
- **Baseline scans are committed under `scans/`** for andrethomaslaw.com and loved-beauty.vercel.app (2026-09-27-before). After each site's fixes land, run the scan again into a `-after` folder and `compare` the two. Mex Taco House gets its baseline the day it is fixed (they are open on the 27th; fix on a closed day).
- **andrethomaslaw.com is done: 9 → 0 (2026-09-28-after, `compare.json` alongside).** The rescan exposed four scanner blind spots, all fixed the same day: English-only wording checks for skip links, new-tab hints and pause buttons (the Spanish pages were clean but flagged), and Chrome's native date input, whose month/day/year sub-fields read as a focus trap with no visible focus. The baseline's "focus trap" was that date input, never a real trap; say so if the before/after is ever shown to the client.
- **ascension-group-landing-page.vercel.app scanned 2026-09-28 (13 problems, `scans/.../2026-09-28-before`).** Repo is `~/Desktop/Ascension Athlete Group`; a hand-annotated `ACCESSIBILITY-FIX.md` with file:line references is in it, not yet committed there. Rescan into a `-after` folder once the fixes land.
- **Fix files are already in each client repo** as `ACCESSIBILITY-FIX.md` (written by hand on 2026-09-25, before the generator existed). The generator's output is close to them but not identical; when regenerating, keep the hand-written manual-check items if they are more specific.
- **The free website check is being built (started 2026-10-01).** The whole project (public check page, "Website Business" portal section, weekly postcards to new Texas businesses) is specified in the website repo as `WEBSITE-BUSINESS-SPEC.md`; this repo's share is `SCAN-SERVICE-SPEC.md`. **Phase 1 is done:** `ssa scan <url> --lead` runs the three-page public scan with the new search pass and writes `lead.json`, the visitor's report (37 to 53 seconds on smartscaleagent.com, mextacohouse.com and wordpress.org). **Phase 2 is built (2026-10-02):** the HTTP scan service (`src/server.ts`, `src/service/`), with request signing, the private-address guard (DNS check, pinned address, every response's address checked), a one-at-a-time queue with signed callbacks, `Dockerfile` and `fly.toml`. Run it locally with `SSA_WORKER_SECRET=x SSA_CALLBACK_HOST=smartscaleagent.com npm run serve`. **Deployed 2026-10-03** to Fly.io as `smart-scale-scan` (https://smart-scale-scan.fly.dev, Dallas, one machine that stops when idle; since 2026-10-05 a performance-2x with 4 GB, because the shared size was throttled after a short burst and a few scans in a row then ran three times slower and hit the time limit). A signed scan of smartscaleagent.com completes through it in about 57 seconds warm and about 74 seconds from a stopped machine; unsigned requests get a 401. The shared secret is in `~/.ssa-worker-secret` on the Mac (not in the repo) and set on Fly as `SSA_WORKER_SECRET`; the website needs the same value. Fly's own auto-stop is **off** on purpose (2026-10-05): the proxy only sees open requests, so it stopped the machine in the middle of scans nobody was watching. The service exits by itself after `SSA_IDLE_EXIT_SECONDS` (300) with nothing running or waiting, which stops the machine; the next request starts it. Keep it at **one machine** (`fly scale count 1`): the queue and job state live in memory, and Fly creates two by default on a first deploy. `fly launch` also adds a `.github` auto-deploy workflow and a `FLY_API_TOKEN` repo secret; the workflow was deleted on purpose, deploys are `fly deploy` by hand. Callbacks answer 404 until the website has the endpoint. A payment method was added to the Fly account the same day. **Phase 3 is built (2026-10-03)** in the website repo as pull request #64 (branch `website-check-phase-3`), merged and live the same day: `/check` and its pages, the lead store, the Website Business section of the portal, the emails, `/privacy`. A real scan runs through its Vercel preview and this service. The Turnstile keys are set in Vercel (Production only) and the DMARC record now reports to info@smartscaleagent.com (2026-10-04). Still open before it goes public: a postal address saved in the portal's Website Business Settings (emails to site owners are held until then; there is no address yet), and one real check from a phone to confirm Turnstile passes a real visitor. `SSA_WORKER_URL` and `SSA_WORKER_SECRET` are already set in Vercel.
- **`npm test` scans a fixture site with a real Chrome** (about two and a half minutes for both test files). It pins the lead report's contents, checks that the full scan's summary still equals `test/expected-full-summary.json`, and exercises the service: signing, the address guard, the queue limit, callbacks, and one real scan through HTTP. If a full-scan check changes on purpose, regenerate that file and say why in the commit.

## How the code is organized

```
src/cli.ts              commands: argument parsing and writing files
src/server.ts           the scan service: HTTP endpoints, settings from the environment
src/service/jobs.ts     the queue (one scan at a time), job state, signed callbacks with retries
src/service/guard.ts    public-address checks: hostname rules, DNS lookup, private ranges for v4 and v6
src/service/signing.ts  HMAC request signing shared with the website
src/scan.ts             runScan (full) and runLeadScan (public); the summary builder (site-level flags live here)
src/lead.ts             the visitor's report: two sections, ratings, top three; no fix text
src/browser.ts          Chrome over CDP, Node's built-in WebSocket; no Puppeteer. Launch options: sandbox, pinned host, user agent, address guard
src/crawl.ts            sitemap-then-links page discovery, lead page picking, stack detection
src/checks/axe.ts       axe-core run, contrast grouped by color pair
src/checks/keyboard.ts  real Tab-key walk
src/checks/structure.ts outline, landmarks, media, overlays, reduced-motion recheck
src/checks/reflow.ts    320px reflow (400% zoom)
src/checks/seo.ts       search basics, lead mode only: titles, https, robots, sitemap, schema, speed
src/rules.ts            plain-English meaning + fix per axe rule id; owner-facing titles and flag wording for the lead report
src/report/html.ts      client report
src/report/fixfile.ts   ACCESSIBILITY-FIX.md generator
src/compare.ts          before/after
test/                   fixture site, its server, and the scan tests
```

Conventions that matter:

- **TypeScript with erasable syntax only.** Node 22 runs the `.ts` files directly (type stripping). That means: no `enum`, no parameter properties in constructors, `import type` for types, and `.ts` in import specifiers. There is no build step and we want to keep it that way.
- **Page scripts are strings** passed to `page.evaluate`. Inside a template literal, regex escapes need doubling (`/\\s+/`). This has bitten once already.
- **One finding = one problem.** `summary.problems` counts distinct rules + distinct contrast color pairs + distinct site-level flags, not elements. Clients get a number they can act on. Do not add checks that inflate it with duplicates; the structure flags are deduped against axe rules in `summarize()`.
- **Never claim compliance.** Report, fix file and license all say a scan is not a legal certification. Keep it that way in any new output.
- **Chrome path:** looked up in `browser.ts`; `SSA_CHROME` overrides.
- **Chrome's sandbox is on by default** since 2026-10-02 (it used to pass `--no-sandbox` always). `SSA_NO_SANDBOX=1` turns it off where it cannot run. The CLI on a Mac needs nothing.
- **The lead report gives nothing away.** `lead.json` says what is wrong in plain words: no fix instructions, no HTML samples, no selectors, no score, and never the word compliant. The test enforces it. Search findings must not promise a ranking.
- **The full scan must not change by accident.** The search pass and the lead report run in lead mode only; `runScan` output is pinned by the test.

## Known rough edges

- Focus that enters a cross-origin iframe (booking calendars, maps) is noted in `keyboard.embeddedFrames` and not judged. Right call, but the report does not show that list yet.
- "Long animation with no pause control" fires on ticker/marquee patterns that pause on hover and focus. It is a legitimate 2.2.2 finding at moderate severity; the wording explains why.
- Hidden-focus now waits up to 1.5s for a fade-in before judging. Sections that take longer than that to appear after focus lands are still flagged, and rightly so.
- The reflow `offenders` list is DOM-order and includes children of `overflow:hidden` parents (marquee tracks), so the first entries can be a false lead. On Ascension the real 38px cause was `.btn` with `whitespace-nowrap`. Worth skipping descendants of clipped ancestors and sorting by right edge.
- Reflow runs on the first three pages only, reduced-motion on the home page only, to keep a scan under two minutes.
- No login, no cart state, no dialog probing yet.
- The `hiddenBy` field on a hidden focus stop names the ancestor and how it hides (`opacity:0`, `aria-hidden`, ...). Useful; not yet in the HTML report.
- Instance counts in the full report add the desktop and phone passes together, so one unnamed button reads as "2 instances". The lead report counts it once (`instances()` in `lead.ts`); the full report and fix file still double it.
- Lead mode runs two Chrome processes at once (desktop passes in one, phone-width passes and reflow in the other). That is what keeps it under a minute, and it is why the scan service wants 2 GB of memory.
- On a Fly machine that has just woken from a stop, the first Chrome start takes about 12 seconds (cold disk); warm it is under one. `Chrome.launch` waits up to 30 seconds for that reason. The first scan after a quiet spell is about 15 seconds slower.
- The public scan pauses video and audio after each page loads and caps the keyboard walk at 30 seconds. Without that, a home page with two autoplaying videos (taylormadeesthetics.net) took over 150 seconds on the Fly machine and failed as a timeout, while the same scan took 32 seconds on the Mac. Autoplay is still reported, because that check reads the markup. The full scan does neither.
- The lead scan's speed finding is measured on a fast connection with no throttling, so it only catches pages that are slow or heavy outright (over 4 seconds or 3 MB).

## Next (in order)

First, the free website check: Phase 3 is merged (website PR #64); close its open items above. Merged 2026-10-05: #65, the waiting screen with a step list and rotating facts, and #66, Phase 4 (five services, the new Local SEO page, the check in the header, homepage, footer and ADA post). Also merged that day: #67, an email to the team for every finished check, and #68, Phase 5 (day 3 and day 10 follow-up emails from a second daily job, `/api/wb/cron`; a calendar booking cannot be seen, so marking the lead Contacted is what stops them). Still open before owners get any email: the postal address in the portal's Website Business Settings. #69 swapped the homepage advertising photo for the full dining room shot (the `/advertise` page still has the old one). **Where we stopped (2026-10-05):** everything through Phase 5 is live and nothing is open or unmerged. Waiting on Dee: the postal address. Next is Phase 6 (the postcard pipeline in dry run) in the website repo.

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
