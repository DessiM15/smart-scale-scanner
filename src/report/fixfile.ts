/**
 * ACCESSIBILITY-FIX.md: the file that goes into the client's repo and
 * that an AI coding assistant (or a developer) works from. The findings
 * come from the scan; the instructions come from the rule dictionary;
 * the manual checks and the statement page are the same for everyone.
 *
 * The scan is the evidence, this file is the work order. Together they
 * are what a "fix" means in this product: not a badge, a change to the code.
 */
import { ruleText } from "../rules.ts";
import type { ScanResult } from "../types.ts";

const fmtDate = (iso: string) => iso.slice(0, 10);

function stackVoice(stack: string): { name: string; note: string } {
  const s = stack.toLowerCase();
  if (s.includes("shopify")) return { name: "Shopify theme", note: "Make the changes in the theme code (sections, snippets, theme.liquid and the theme CSS). Do not install an accessibility app or overlay." };
  if (s.includes("wordpress")) return { name: "WordPress site", note: "Make the changes in the child theme's templates and stylesheet, and in the block or page builder settings where the markup comes from there. Do not install an accessibility overlay plugin." };
  if (s.includes("next.js") || s.includes("react")) return { name: "Next.js / React site", note: "Make the changes in the components and shared layout so a fix applies everywhere the component renders." };
  if (s.includes("squarespace") || s.includes("wix") || s.includes("webflow") || s.includes("framer")) return { name: `${stack.split(",")[0]} site`, note: "Most fixes are in the editor's element settings (alt text, link labels, heading levels) and the site's custom CSS. Where the platform cannot express a fix, note it as a known limitation on the accessibility statement." };
  return { name: "static HTML site", note: "Every page is its own file, so apply each fix to every page that contains the shared header, footer, and blocks, including any separate mobile pages." };
}

export function buildFixFile(r: ScanResult): string {
  const s = r.summary;
  const voice = stackVoice(r.stack);
  const lines: string[] = [];
  const push = (t = "") => lines.push(t);

  push(`# ${r.label} · accessibility fix`);
  push();
  push(`> **How to use this file.** In Claude Code or Cursor, opened at this project's root, say: "Read ACCESSIBILITY-FIX.md and do everything in it." The findings are from a ${r.tool} run on ${fmtDate(r.scannedAt)} (${r.standard}, ${s.pages} pages at desktop and phone widths). "The job" is the work. When it reports done, run the manual checks, then rescan.`);
  push();
  push(`Detected: ${r.stack}. ${voice.note}`);
  push();

  push(`## Findings`);
  push();
  if (s.problems === 0) {
    push(`No failures from the automated pass. Do the manual checks below anyway; scanners see about a third of real problems.`);
  } else {
    push(`${s.problems} distinct problems: ${s.byRule.length} rule failures, ${s.contrastGroups.length} contrast color pairs, ${s.flags.length} findings from the keyboard, structure, motion and reflow passes.`);
  }
  push();
  let n = 0;
  for (const f of s.flags) {
    n++;
    push(`${n}. **${f.title}** (${f.severity}) on ${pagesText(f.pages)}. ${f.detail}`);
  }
  if (s.contrastGroups.length) {
    n++;
    push(`${n}. **Text contrast** (serious): ${s.contrastElements} elements across the scanned pages fail the 4.5:1 minimum, from ${s.contrastGroups.length} color pairs:`);
    for (const g of s.contrastGroups.slice(0, 20)) {
      push(`   - ${g.fg} on ${g.bg} at ${g.fontSize}: ${g.ratio.toFixed(2)}:1 (needs ${g.required}:1), ${g.count} element${g.count === 1 ? "" : "s"}${g.classes ? `, classes \`${g.classes}\`` : ""}${g.sample ? `, e.g. "${g.sample}"` : ""}`);
    }
    if (s.contrastGroups.length > 20) push(`   - and ${s.contrastGroups.length - 20} more pairs in the JSON result`);
  }
  for (const rule of s.byRule) {
    n++;
    const t = ruleText(rule.id, rule.help);
    push(`${n}. **${rule.help}** (${rule.impact}, axe rule \`${rule.id}\`): ${rule.count} instance${rule.count === 1 ? "" : "s"} on ${pagesText(rule.pages)}. ${t.plain}`);
    for (const smp of rule.samples.slice(0, 3)) push(`   - \`${smp.html.replace(/`/g, "'").slice(0, 140)}\``);
  }
  push();
  push(`---`);
  push();
  push(`## The job`);
  push();
  push(`Make this ${voice.name} conform to ${r.standard} without changing the visual design. Fix each numbered item, then do the manual checks, then verify. Do not install an accessibility overlay widget (accessiBe, UserWay, AudioEye or similar); they do not fix the code and sites running them are still sued.`);
  push();
  let k = 0;
  for (const f of s.flags) {
    k++;
    push(`${k}. ${f.title}: ${fixForFlag(f.id, f.detail)}`);
  }
  if (s.contrastGroups.length) {
    k++;
    push(`${k}. Text contrast: ${ruleText("color-contrast", "").fix} The failing pairs are listed under Findings with their classes; change each color token once so every use passes. Re-measure after: any pair still under its required ratio is a fail.`);
  }
  for (const rule of s.byRule) {
    k++;
    push(`${k}. ${rule.help} (${rule.count} instance${rule.count === 1 ? "" : "s"}): ${ruleText(rule.id, rule.help).fix}`);
  }
  push();
  push(`Then do these manual checks and fix what you find:`);
  push();
  const manual = [
    "Keyboard: press Tab through every page. Focus must always be visible (a 2px+ ring at 3:1 against its surroundings), the order must match the visual order, nothing may trap focus, and every menu, dropdown, slider, dialog and drawer must open with Enter or Space, close with Escape, and return focus to the control that opened it.",
    "Hidden regions: a closed menu, cart drawer or modal must not contain tabbable controls. Unmount it or set the inert attribute on it while closed. While open, a dialog needs role=\"dialog\", aria-modal=\"true\", a label, focus moved inside, and a focus trap.",
    "Forms: every field has a visible label tied with for/id, required fields are marked in text (not color alone), autocomplete attributes are set on name, email, phone and address fields, and errors are text tied to the field with aria-describedby, announced, with focus moved to the first error on a failed submit.",
    "Images: every meaningful image has alt text describing what a sighted person gets from it; decorative images have alt=\"\". Text inside images is repeated as real text.",
    "Motion: everything that moves for more than five seconds (video, carousel, marquee, ticker) has a visible pause control, stops under prefers-reduced-motion, and never autoplays sound.",
    "Links: every link that opens a new tab includes visually hidden \"(opens in new tab)\" text. Replace \"click here\" and \"learn more\" link text with text that says where the link goes.",
    "Headings and landmarks: exactly one h1 per page, no skipped levels, and header, nav, main and footer landmarks with every visible thing inside one of them. Two navs get distinct aria-labels.",
    "Zoom: at 400% browser zoom (or a 320px-wide window) nothing is cut off and the page does not scroll sideways.",
    "Touch: every tap target is at least 24 by 24 CSS pixels or has 24 pixels of space around it. Pinch-to-zoom is not blocked.",
    "Language: the html element has the right lang, and any block in another language has its own lang attribute.",
  ];
  manual.forEach((m, i) => push(`${k + i + 1}. ${m}`));
  push();
  push(`Add an accessibility statement page (at /accessibility, linked from the footer). It states that the site targets ${r.standard}, lists what has been done, names any known limitations honestly (third-party embeds, for example), gives an email and phone for reporting problems, and commits to a response time. Date it.`);
  push();
  push(`## Verify when done`);
  push();
  push(`Run \`ssa scan <url>\` (${r.tool}) or an axe-core run with the tags wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa against every page at 1366px and 390px and make it report zero violations and zero contrast failures. Then do a full keyboard-only walkthrough of the home page and the page that makes money (the form, the menu, the product and cart). Report what you changed, file by file, and anything you could not fix and why.`);
  push();
  push(`---`);
  push(`Generated by ${r.tool} v${r.version} · ${r.base} · ${fmtDate(r.scannedAt)}`);
  return lines.join("\n") + "\n";
}

function pagesText(pages: string[]): string {
  if (pages.length <= 3) return pages.join(", ");
  return `${pages.slice(0, 3).join(", ")} and ${pages.length - 3} more page${pages.length - 3 === 1 ? "" : "s"}`;
}

function fixForFlag(id: string, detail: string): string {
  switch (id) {
    case "no-skip-link":
      return "Add a \"Skip to main content\" link as the first focusable element on every page, visually hidden until focused, pointing at the main landmark, and make that landmark focusable (tabindex=\"-1\").";
    case "skip-link-broken":
      return "Make the skip link's target exist and be focusable: <main id=\"main-content\" tabindex=\"-1\">.";
    case "invisible-focus":
      return "Find every CSS rule that sets outline: none or outline: 0 and replace it with a :focus-visible style: a solid 2px+ outline in a color that measures at least 3:1 against the background, with 2px offset. Confirm the listed elements show it.";
    case "hidden-focus":
      return "The listed controls can be tabbed to while hidden (a closed drawer, menu or modal under aria-hidden or display/opacity tricks). Unmount that region when closed, or set the inert attribute on it while closed, and manage focus properly when it opens.";
    case "focus-trap":
      return "Focus gets stuck on the listed element. Remove the script or tabindex logic that keeps pulling focus back, and make Escape or Tab leave it.";
    case "no-main-landmark":
      return "Wrap the primary page content in a single <main> element on every page.";
    case "missing-lang":
      return "Add lang=\"en\" (or the page's language) to the <html> element.";
    case "multiple-h1":
      return "Keep one h1 per page and demote the others.";
    case "no-h1":
      return "Add one h1 per page that says what the page is.";
    case "heading-skips":
      return "Rework heading levels so they step down one at a time; style-only headings become <p> or <div>.";
    case "iframe-title":
      return "Add a title attribute to each listed iframe describing what it shows.";
    case "new-tab-hint":
      return "Add visually hidden \"(opens in new tab)\" text inside every link with target=\"_blank\", or drop target=\"_blank\" for links that stay on the site.";
    case "autoplay":
      return "Add a visible pause control to every autoplaying video or audio, keep it muted, and stop it under prefers-reduced-motion.";
    case "long-animation":
      return "Give every animation, carousel, ticker or marquee that runs longer than five seconds a visible pause control, and disable it under prefers-reduced-motion.";
    case "ignores-reduced-motion":
      return "Wrap the animation, autoplay and smooth-scroll setup in a check for prefers-reduced-motion: reduce (CSS @media, or window.matchMedia in script) so it does not run for visitors who asked for less motion.";
    case "reflow":
      return "At 320px wide the page scrolls sideways. Find the listed elements with fixed widths, min-widths or wide grids and let them wrap or shrink; give images and embeds max-width: 100%.";
    case "overlay":
      return "Remove the accessibility overlay widget. It does not fix the code, interferes with real screen readers, and appears by name in lawsuits.";
    case "filename-alt":
      return "Replace the listed alt texts (file names) with descriptions of the images.";
    case "unnamed-navs":
      return "Give each <nav> its own aria-label so screen readers can tell them apart.";
    default:
      return detail;
  }
}
