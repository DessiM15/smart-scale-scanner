/**
 * Which pages to scan. The sitemap is the site's own list of what matters,
 * so it comes first; the home page's links are the fallback for sites
 * without one. Either way the home page is always scanned first.
 */
import type { Page } from "./browser.ts";

const SKIP_EXT = /\.(pdf|jpe?g|png|webp|gif|svg|mp4|xml|zip|json|css|js)$/i;

export function normalizeBase(input: string): string {
  const u = new URL(input.includes("://") ? input : `https://${input}`);
  return `${u.protocol}//${u.host}`;
}

async function fromSitemap(base: string): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  const read = async (url: string, depth: number) => {
    if (depth > 2) return;
    let xml = "";
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return;
      xml = await r.text();
    } catch {
      return;
    }
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
    const isIndex = /<sitemapindex/i.test(xml);
    for (const loc of locs) {
      if (isIndex) {
        await read(loc, depth + 1);
        continue;
      }
      try {
        const u = new URL(loc);
        if (`${u.protocol}//${u.host}` !== base) continue;
        const path = u.pathname.replace(/\/$/, "") || "/";
        if (SKIP_EXT.test(path) || seen.has(path)) continue;
        seen.add(path);
        out.push(path);
      } catch {}
    }
  };
  await read(`${base}/sitemap.xml`, 0);
  return out;
}

async function fromLinks(page: Page): Promise<string[]> {
  return page.evaluate<string[]>(`
    (() => {
      const seen = new Set();
      for (const a of document.querySelectorAll("a[href]")) {
        try {
          const u = new URL(a.href);
          if (u.origin !== location.origin || u.hash) continue;
          const p = u.pathname.replace(/\\/$/, "") || "/";
          seen.add(p);
        } catch {}
      }
      return [...seen];
    })()
  `);
}

export async function discoverPages(
  base: string,
  homePage: Page,
  maxPages: number,
  explicit?: string[],
): Promise<{ paths: string[]; source: "explicit" | "sitemap" | "links" }> {
  if (explicit && explicit.length) {
    const paths = ["/", ...explicit.map((p) => (p.startsWith("/") ? p : `/${p}`)).filter((p) => p !== "/")];
    return { paths: [...new Set(paths)].slice(0, maxPages), source: "explicit" };
  }
  const sm = await fromSitemap(base);
  if (sm.length) {
    const paths = ["/", ...sm.filter((p) => p !== "/")];
    return { paths: paths.slice(0, maxPages), source: "sitemap" };
  }
  const links = await fromLinks(homePage);
  const paths = ["/", ...links.filter((p) => p !== "/" && !SKIP_EXT.test(p))];
  return { paths: paths.slice(0, maxPages), source: "links" };
}

/** Stack detection from response headers and markup. Drives the wording of the fix file. */
export async function detectStack(base: string, homePage: Page): Promise<string> {
  const hints: string[] = [];
  try {
    const r = await fetch(base + "/", { signal: AbortSignal.timeout(15000), redirect: "follow" });
    const h = (n: string) => (r.headers.get(n) || "").toLowerCase();
    if (h("x-powered-by").includes("next") || h("x-nextjs-prerender")) hints.push("Next.js");
    if (h("x-shopify-stage") || h("x-shopid")) hints.push("Shopify");
    if (h("x-wix-request-id")) hints.push("Wix");
    if (h("link").includes("wp-json")) hints.push("WordPress");
    if (h("server").includes("vercel") || h("x-vercel-id")) hints.push("hosted on Vercel");
    if (h("server").includes("netlify")) hints.push("hosted on Netlify");
  } catch {}
  const markup = await homePage.evaluate<string[]>(`
    (() => {
      const html = document.documentElement.outerHTML;
      const gen = (document.querySelector('meta[name="generator"]')?.getAttribute("content") || "");
      const out = [];
      if (gen) out.push("generator:" + gen);
      if (html.includes("/_next/")) out.push("Next.js");
      if (html.includes("wp-content")) out.push("WordPress");
      if (html.includes("cdn.shopify.com")) out.push("Shopify");
      if (html.includes("squarespace")) out.push("Squarespace");
      if (html.includes("wixstatic")) out.push("Wix");
      if (html.includes("webflow")) out.push("Webflow");
      if (html.includes("framerusercontent")) out.push("Framer");
      if (html.includes("data-reactroot") || html.includes("__NEXT_DATA__")) out.push("React");
      if (html.includes("swiper")) out.push("Swiper slider");
      if (html.includes("bootstrap")) out.push("Bootstrap");
      if (html.includes("font-awesome") || html.includes("fontawesome") || html.includes('class="fa')) out.push("Font Awesome icons");
      return out;
    })()
  `);
  const all = [...new Set([...hints, ...markup])];
  if (!all.some((s) => /Next|WordPress|Shopify|Squarespace|Wix|Webflow|Framer|React|generator/.test(s))) {
    all.unshift("static HTML");
  }
  return all.join(", ");
}
