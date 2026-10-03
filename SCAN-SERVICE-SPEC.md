# Scan service: the scanner's side of the free website check

Status: Dee gave the go-ahead on 2026-10-01. Phase 1 (sections 1 and 2) and Phase 2 (sections 3 to 6) are built and tested as of 2026-10-02. The one thing left in Phase 2 is the deployment itself, which waits on the Fly.io account (section 5).

What changed while building Phase 2, all reflected below:

- A refused address answers `422 { ok: false, error, reason: "unreachable" }` at submit time, so the website can show its "we couldn't reach your site" message without queueing anything.
- The vetted address is pinned in Chrome (`--host-resolver-rules`), so a hostname that changes its answer mid-scan still lands where it was checked.
- The host firewall rule in section 4 is not available on Fly.io machines; the two checks in code are the protection there.
- `GET /scans/{id}` is signed like everything else, over an empty body.

What changed while building Phase 1:

- Each finding carries `problems`, the number of distinct problems it stands for. It is 1 for everything except faint text, which is one per color pair, so the list adds up to the total.
- Lead mode runs two browsers at once (desktop passes in one, phone-width passes and reflow in the other). Measured at 37 to 53 seconds on three real sites.
- The CLI writes `scan.json` next to `lead.json`, for debugging and `compare`.

The full project is specified in the website repo as `WEBSITE-BUSINESS-SPEC.md` (free check page, Website Business portal section, weekly postcards). This file covers only what is built here: a shorter "lead" scan, a new search-basics pass, and an HTTP service the website calls. The contract in section 3 mirrors section 5 of the website spec. If they disagree, the website spec wins.

Everything in `CLAUDE.md` still applies: erasable TypeScript only, no build step, page scripts as strings, one finding is one problem, never claim compliance. The CLI keeps working exactly as it does today.

## 1. Lead mode

`ssa scan <url> --lead` and the service both run this.

- **Pages:** the home page plus up to two more. Prefer pages linked from the main navigation whose path or link text suggests contact, services, menu, about or shop, in that order; otherwise the first two from the usual discovery.
- **Passes:** axe at desktop and phone widths on each page; keyboard walk and structure on desktop; reflow on the home page only; the new search pass (section 2). No reduced-motion recheck.
- **Budget:** 90 seconds is the target. Navigation timeout is 20 seconds per page. A hard stop at 150 seconds returns whatever finished, as long as the home page did.
- **Output:** the lead report JSON (section 3), written as `lead.json` by the CLI. No fix file. The existing `report.html` and `ACCESSIBILITY-FIX.md` are for clients and are not produced in lead mode.

### Ratings

Each section gets one of three ratings, and there is no numeric score:

- `good`: no problems.
- `fair`: problems, none critical or serious.
- `needs-work`: at least one critical or serious problem.

`totals.problems` is the same distinct-problem count as `summary.problems`, plus the search findings. `totals.serious` counts critical and serious together.

## 2. The search pass (`src/checks/seo.ts`)

A basics check for the "Getting found on Google" section. It reports what is plainly missing or broken. It does not measure rankings, Google Business Profile, or backlinks, and the wording of every finding must not promise a ranking.

Each of these is one finding, however many pages show it:

| Id | Finding | Severity |
|---|---|---|
| `seo-noindex` | The home page tells Google not to list it (robots meta tag, or robots.txt blocks everything) | critical |
| `seo-no-https` | The site does not load securely, or the insecure address does not forward to the secure one | serious |
| `seo-title` | Page title missing, or identical on every page checked | serious |
| `seo-no-viewport` | No mobile viewport tag, so the page is not built for phones | serious |
| `seo-slow` | The home page takes more than 4 seconds to load at phone size, or weighs more than 3 MB | moderate |
| `seo-meta-description` | No description for Google to show under the title | moderate |
| `seo-no-local-schema` | No business details in the page's structured data (name, address or area, phone) | moderate |
| `seo-broken-links` | Links in the navigation lead to missing pages (check at most 20) | moderate |
| `seo-no-sitemap` | No sitemap for Google to read | minor |
| `seo-canonical` | The page's canonical address is missing or points to a different site | minor |
| `seo-no-phone-link` | A phone number is shown but cannot be tapped to call | minor |
| `seo-no-social-preview` | No title or image for link previews when the site is shared | minor |

Do not report something twice. Where axe already reports the same thing (`document-title`, `html-has-lang`, `image-alt`, `meta-viewport`), keep the axe finding in the Accessibility section and skip the search one. This is the same rule `summarize()` already applies to the structure flags.

Each finding needs a plain-English line in `rules.ts`, written for a business owner.

## 3. The service (`src/server.ts`)

A small HTTP server on `node:http`. No framework and no new dependencies.

### Endpoints

All requests carry `X-SSA-Timestamp` (unix seconds) and `X-SSA-Signature` (hex HMAC-SHA256 of `timestamp + "." + rawBody` with `SSA_WORKER_SECRET`). Reject a bad signature or a timestamp more than five minutes off with 401.

- `POST /scans` with `{ scanId, url, label?, callbackUrl }`. Returns `202 { scanId, position }`. A repeated `scanId` returns the current state and does not start a second scan. Returns `429` when the queue is full.
- `GET /scans/{scanId}` returns the current state, and the report once complete. States are kept in memory for one hour.
- `GET /health` is unsigned and returns only `{ ok: true }`.

### Callbacks

`POST callbackUrl`, signed the same way:

```json
{ "scanId": "s_...", "event": "started | progress | completed | failed", "step": "mobile", "stepIndex": 2, "stepCount": 5, "report": { }, "failure": { "reason": "unreachable | blocked | timeout | not_html", "detail": "..." }, "at": "2026-10-01T15:00:00Z" }
```

Steps, in order: `load`, `mobile`, `keyboard`, `search`, `report`. Retry a failed callback three times with a growing delay. `callbackUrl` must be on the host named in `SSA_CALLBACK_HOST`; anything else is refused.

### The report

```json
{
  "version": 1, "scanId": "s_...", "base": "https://example.com", "label": "Example Cafe",
  "scannedAt": "...", "durationMs": 71000, "stack": "WordPress",
  "pagesChecked": [{ "path": "/", "title": "..." }],
  "totals": { "problems": 7, "serious": 3 },
  "sections": [
    { "id": "accessibility", "title": "Accessibility", "rating": "needs-work", "problems": 5, "serious": 3,
      "findings": [{ "id": "color-contrast", "severity": "serious", "title": "Text too faint to read", "plain": "...", "pages": ["/"], "count": "24 elements, 6 color pairs", "problems": 6 }] },
    { "id": "search", "title": "Getting found on Google", "rating": "fair", "problems": 2, "serious": 0, "findings": [] }
  ],
  "top": ["color-contrast", "hidden-focus", "seo-meta-description"]
}
```

No fix instructions, no HTML samples, no selectors: the fix work is what we sell. `top` is the three findings to lead with, by severity and then by how easily an owner will understand them.

### Queue

One scan at a time, because Chrome is the memory cost. Queue length is capped (default 10). Each scan launches and closes its own Chrome with a fresh profile, as the CLI does now.

### Failures

| Reason | When |
|---|---|
| `unreachable` | DNS or connection failure on the home page |
| `blocked` | 401, 403 or 429 on the home page, or a bot-challenge page |
| `timeout` | The home page did not finish inside the budget |
| `not_html` | The address is not a web page |

A failure on a second or third page is not a scan failure; the report covers the pages that worked.

## 4. Security

The service takes addresses from strangers and opens them in a browser, so:

- **Public addresses only.** Accept `http` and `https` on the default ports, by hostname only. Resolve the hostname before scanning and refuse loopback, private, link-local, carrier-grade NAT and cloud metadata ranges, for IPv4 and IPv6.
- **Check again during the scan.** Watch the remote address of every response, including redirects and embedded frames, and abort if one lands in a refused range. Where the host offers an outbound firewall, add a rule for the same ranges, so the protection does not rest on one check (Fly.io does not; see the status note above).
- **Chrome sandboxed.** The container runs Chrome as a non-root user with its sandbox on. `--no-sandbox` stays available for local use through `SSA_NO_SANDBOX=1` and is off on the server.
- **Nothing persists.** Fresh profile per scan, downloads blocked, permission prompts denied.
- **Honest identity.** Append `SmartScaleScanner/<version> (+https://smartscaleagent.com/check)` to the user agent so a site owner can see who visited.
- **No secrets in logs.** Log the scan id, host, duration and outcome. Never log email addresses; the service never receives them.

## 5. Hosting

A container with Node 22 and Chromium, on a small always-available machine that can sleep when idle. Fly.io is the recommendation: one machine with 2 GB of memory, stopped when idle and started on request. Expected cost is inside the $10 to $30 a month already agreed; confirm at deploy. Railway or Render are equivalent alternatives.

Not Vercel: a scan is a real browser held open for a minute or more over a debugging connection, which is the wrong shape for a serverless function.

Configuration: `SSA_WORKER_SECRET`, `SSA_CALLBACK_HOST`, `SSA_CHROME`, `PORT`, `SSA_QUEUE_MAX`, `SSA_NO_SANDBOX`.

The files: `Dockerfile` (Node 22 and Debian's Chromium, running as an unprivileged user), `.dockerignore`, and `fly.toml` (Dallas region, 2 GB, stops when idle, health check on `/health`). The first-deploy commands are at the top of `fly.toml`. Neither Docker nor the Fly tools are installed on the development Mac, so the container has not been built here; the service itself was run locally against real sites.

## 6. Tests

`node --test`, no new dependencies, against a local fixture server:

- Signature accepted, rejected, and expired.
- A repeated `scanId` does not start a second scan.
- Each refused address range, and a redirect into one.
- A full queue returns 429.
- A fixture site with known problems produces the expected findings and ratings, and each one appears once.
- A full (non-lead) scan of the fixture gives the same result before and after this work.

## 7. Build order

**Phase 1. Lead mode and the search pass.** Done when `ssa scan <url> --lead` writes `lead.json` for smartscaleagent.com, mextacohouse.com and one WordPress site in under 90 seconds each, and a full scan is unchanged.

**Phase 2. The service.** Server, queue, signing, address protection, container, deployment. Done when a signed request to the deployed worker returns a report by callback, and private addresses, unsigned requests and a full queue are each refused.

After that the work moves to the website repo.
