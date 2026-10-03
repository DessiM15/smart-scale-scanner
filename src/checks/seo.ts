/**
 * The search pass: the basics a site needs before Google can list it and a
 * customer can find it. It reports what is plainly missing or broken. It
 * does not measure rankings, a Google Business Profile, or backlinks, and
 * no finding here promises a position on Google.
 *
 * Runs in lead mode only. Each finding is one problem however many pages
 * show it, and anything axe already reports is left to axe.
 */
import type { Page } from "../browser.ts";
import type { Flag, PageScan } from "../types.ts";

export interface SeoPageResult {
  title: string;
  metaDescription: string;
  viewport: string;
  robotsMeta: string;
  canonical: string;
  schemaTypes: string[];
  /** Structured data that names a business with a phone, an address or a service area. */
  hasBusinessSchema: boolean;
  phonesShown: number;
  telLinks: number;
  og: { title: boolean; image: boolean };
  /** Same-site links in the header and navigation, for the broken-link check. */
  navLinks: string[];
}

export interface SeoSiteResult {
  /** `httpRedirects` is null when nothing answers on the insecure address at all. */
  https: { secure: boolean; httpRedirects: boolean | null };
  robots: { exists: boolean; blocksAll: boolean; noindexHeader: boolean };
  sitemap: boolean;
  brokenLinks: { url: string; status: number }[];
}

const SEO_SCRIPT = `
  (() => {
    const meta = (sel) => { const el = document.querySelector(sel); return ((el && el.getAttribute("content")) || "").trim(); };
    const types = [];
    let business = false;
    const generic = /^(WebSite|WebPage|BreadcrumbList|Person|Article|BlogPosting|ImageObject|SearchAction|ItemList|FAQPage)$/;
    const visit = (node) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (node["@graph"]) visit(node["@graph"]);
      const t = [].concat(node["@type"] || []).map(String);
      for (const x of t) if (!types.includes(x)) types.push(x);
      if (t.length && !t.every((x) => generic.test(x)) && node.name && (node.telephone || node.address || node.areaServed)) business = true;
    };
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) { try { visit(JSON.parse(s.textContent || "")); } catch {} }
    const text = document.body ? document.body.innerText : "";
    const phones = (text.match(/\\(?\\b\\d{3}\\)?[\\s.-]\\d{3}[\\s.-]\\d{4}\\b/g) || []).length;
    const nav = [];
    for (const a of document.querySelectorAll("header a[href], nav a[href], [role=navigation] a[href]")) {
      try {
        const u = new URL(a.href);
        if (u.origin !== location.origin) continue;
        u.hash = "";
        if (!nav.includes(u.href)) nav.push(u.href);
      } catch {}
      if (nav.length >= 20) break;
    }
    const canonical = document.querySelector('link[rel="canonical" i]');
    return {
      title: document.title.trim(),
      metaDescription: meta('meta[name="description" i]'),
      viewport: meta('meta[name="viewport" i]'),
      robotsMeta: (meta('meta[name="robots" i]') + " " + meta('meta[name="googlebot" i]')).trim().toLowerCase(),
      canonical: ((canonical && canonical.getAttribute("href")) || "").trim(),
      schemaTypes: types.slice(0, 12),
      hasBusinessSchema: business,
      phonesShown: phones,
      telLinks: document.querySelectorAll('a[href^="tel:" i]').length,
      og: { title: !!meta('meta[property="og:title" i]'), image: !!meta('meta[property="og:image" i]') },
      navLinks: nav,
    };
  })()
`;

export async function seoPageCheck(page: Page): Promise<SeoPageResult> {
  return page.evaluate<SeoPageResult>(SEO_SCRIPT);
}

const FETCH_TIMEOUT_MS = 8000;

async function get(url: string, redirect: "follow" | "manual" = "follow"): Promise<Response | null> {
  try {
    return await fetch(url, { redirect, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch {
    return null;
  }
}

/** True when robots.txt tells every crawler to stay out of the whole site. */
export function robotsBlocksAll(robotsTxt: string): boolean {
  let applies = false;
  let lastWasAgent = false;
  let disallowAll = false;
  let allowsSomething = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      // Consecutive User-agent lines share one group.
      if (!lastWasAgent) applies = false;
      if (value === "*") applies = true;
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!applies) continue;
    if (key === "disallow" && value === "/") disallowAll = true;
    if (key === "allow" && value) allowsSomething = true;
  }
  return disallowAll && !allowsSomething;
}

/** Checks that need the site but not the browser: secure loading, robots.txt, the sitemap. */
export async function seoSiteBasics(base: string): Promise<Omit<SeoSiteResult, "brokenLinks">> {
  const host = new URL(base).host;
  const [secureRes, insecureRes, robotsRes] = await Promise.all([get(`https://${host}/`), get(`http://${host}/`), get(`${base}/robots.txt`)]);

  let robotsTxt = "";
  if (robotsRes?.ok) {
    const body = await robotsRes.text().catch(() => "");
    // Sites that answer every address with a page return HTML here.
    if (!body.trimStart().startsWith("<")) robotsTxt = body;
  }
  const home = base.startsWith("https://") ? secureRes : insecureRes;
  const noindexHeader = /noindex/i.test(home?.headers.get("x-robots-tag") ?? "");

  let sitemap = /^sitemap\s*:/im.test(robotsTxt);
  for (const path of ["/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml"]) {
    if (sitemap) break;
    const r = await get(base + path);
    if (r?.ok) sitemap = /<(urlset|sitemapindex)/i.test((await r.text().catch(() => "")).slice(0, 2000));
  }

  return {
    https: { secure: secureRes !== null, httpRedirects: insecureRes === null ? null : insecureRes.url.startsWith("https://") },
    robots: { exists: robotsTxt !== "", blocksAll: robotsBlocksAll(robotsTxt), noindexHeader },
    sitemap,
  };
}

/** Which of these same-site links lead to a missing page. Errors and blocks are not counted; only a plain "not found". */
export async function findBrokenLinks(urls: string[]): Promise<SeoSiteResult["brokenLinks"]> {
  const results = await Promise.all(
    urls.slice(0, 20).map(async (url) => {
      const r = await get(url);
      return r && (r.status === 404 || r.status === 410) ? { url, status: r.status } : null;
    }),
  );
  return results.filter((r): r is { url: string; status: number } => r !== null);
}

const SLOW_LOAD_MS = 4000;
const HEAVY_BYTES = 3_000_000;

/**
 * The search findings for the site. `axeRuleIds` are the rules axe already
 * reported, so the same problem is not listed in both sections.
 */
export function searchFlags(pages: PageScan[], site: SeoSiteResult, base: string, axeRuleIds: Set<string>): Flag[] {
  const flags: Flag[] = [];
  const desktop = pages.filter((p) => p.viewport === "desktop" && p.seo);
  const home = desktop[0];
  if (!home?.seo) return flags;
  const add = (id: string, severity: Flag["severity"], title: string, detail: string, paths: string[] = [home.path]) => flags.push({ id, severity, title, detail, pages: paths });
  const pathsWhere = (test: (p: PageScan) => boolean) => desktop.filter(test).map((p) => p.path);

  if (/noindex/.test(home.seo.robotsMeta) || site.robots.blocksAll || site.robots.noindexHeader) {
    add("seo-noindex", "critical", "The site tells Google not to list it", "A setting on the site asks search engines to leave it out of their results. While it is there, the site cannot appear on Google at all. It is often left over from when the site was being built.");
  }

  if (!site.https.secure || site.https.httpRedirects === false) {
    add("seo-no-https", "serious", "The site does not load securely", site.https.secure ? "The insecure version of the address (http) still works and does not forward to the secure one (https). Visitors who land on it see a \"Not secure\" warning, and Google treats the two as separate sites." : "The site does not work on a secure address (https). Browsers show visitors a \"Not secure\" warning, and Google prefers secure pages.");
  }

  const titles = desktop.map((p) => p.seo!.title);
  if (desktop.length > 1 && titles[0] && titles.every((t) => t === titles[0])) {
    add("seo-title", "serious", "Every page has the same title", `The title is the headline Google shows for each page. All ${desktop.length} pages checked are titled "${titles[0].slice(0, 70)}", so Google cannot tell them apart or show the right one for a search.`, desktop.map((p) => p.path));
  } else if (!axeRuleIds.has("document-title")) {
    const untitled = pathsWhere((p) => !p.seo!.title);
    if (untitled.length) add("seo-title", "serious", "Pages have no title", "The title is the headline Google shows for each page. These pages have none, so Google has to make one up.", untitled);
  }

  if (!home.seo.viewport) {
    add("seo-no-viewport", "serious", "The page is not set up for phones", "The page is missing the setting that tells a phone to fit the page to its screen, so it appears as a shrunken desktop page. Most local searches happen on phones, and Google judges the phone version of a site.", pathsWhere((p) => !p.seo!.viewport));
  }

  const mobileHome = pages.find((p) => p.viewport === "mobile" && p.path === home.path && p.load);
  if (mobileHome?.load) {
    const { loadMs, bytes } = mobileHome.load;
    const slow = loadMs === null || loadMs > SLOW_LOAD_MS;
    const heavy = bytes > HEAVY_BYTES;
    if (slow || heavy) {
      const facts = [slow ? (loadMs === null ? "did not finish loading in 20 seconds" : `took ${(loadMs / 1000).toFixed(1)} seconds to load`) : "", heavy ? `weighs ${(bytes / 1_000_000).toFixed(1)} MB` : ""].filter(Boolean).join(" and ");
      add("seo-slow", "moderate", "The home page is slow on a phone", `At phone size, on a fast connection, the home page ${facts}. Visitors on a phone signal wait longer and leave, and page speed is one of the things Google measures.`);
    }
  }

  const noDescription = pathsWhere((p) => !p.seo!.metaDescription);
  if (noDescription.length) {
    add("seo-meta-description", "moderate", "No description for Google to show", "These pages have no description, so Google picks whatever text it finds to show under the title. A written description is the place to say what the business does and where.", noDescription);
  }

  if (!desktop.some((p) => p.seo!.hasBusinessSchema)) {
    add("seo-no-local-schema", "moderate", "No business details for Google to read", "The pages carry no structured business details (name, phone, address or service area). This is one of the ways Google connects a website to its Business Profile and map listing.", desktop.map((p) => p.path));
  }

  if (site.brokenLinks.length) {
    const examples = site.brokenLinks.slice(0, 3).map((l) => new URL(l.url).pathname).join(", ");
    add("seo-broken-links", "moderate", "Menu links lead to missing pages", `${site.brokenLinks.length} link${site.brokenLinks.length === 1 ? "" : "s"} in the site's navigation lead${site.brokenLinks.length === 1 ? "s" : ""} to a "page not found" error (${examples}). Visitors hit a dead end, and Google counts it against the site's upkeep.`);
  }

  if (!site.sitemap) {
    add("seo-no-sitemap", "minor", "No sitemap", "A sitemap is the list of pages a site hands to Google. Without one, Google has to find pages by following links and can miss some.");
  }

  const baseHost = new URL(base).host.replace(/^www\./, "");
  let canonicalElsewhere = false;
  try {
    canonicalElsewhere = Boolean(home.seo.canonical) && new URL(home.seo.canonical, base).host.replace(/^www\./, "") !== baseHost;
  } catch {}
  if (!home.seo.canonical || canonicalElsewhere) {
    add("seo-canonical", "minor", canonicalElsewhere ? "The home page points Google at a different site" : "The home page does not name its official address", canonicalElsewhere ? "The home page names a different website as its official address, so Google may credit that site instead of this one." : "The same page can be reached at several addresses (with and without www, with tracking codes). The page does not say which one is official, so Google has to guess.");
  }

  if (desktop.some((p) => p.seo!.phonesShown > 0) && !desktop.some((p) => p.seo!.telLinks > 0)) {
    add("seo-no-phone-link", "minor", "The phone number cannot be tapped to call", "A phone number is shown as plain text. On a phone, a visitor should be able to tap it to call.", pathsWhere((p) => p.seo!.phonesShown > 0));
  }

  if (!home.seo.og.title || !home.seo.og.image) {
    add("seo-no-social-preview", "minor", "No preview when the site is shared", "When someone shares the site in a text message or on social media, there is no title or picture set for the preview, so it shows as a bare link.");
  }

  return flags;
}
