# Loved Beauty · accessibility fix

> **How to use this file.** In Claude Code or Cursor, opened at this project's root, say: "Read ACCESSIBILITY-FIX.md and do everything in it." The findings are from a Smart Scale Accessibility Scanner run on 2026-09-27 (WCAG 2.2 Level AA, 10 pages at desktop and phone widths). "The job" is the work. When it reports done, run the manual checks, then rescan.

Detected: Next.js, hosted on Vercel. Make the changes in the components and shared layout so a fix applies everywhere the component renders.

## Findings

9 distinct problems: 2 rule failures, 4 contrast color pairs, 3 findings from the keyboard, structure, motion and reflow passes.

1. **Hidden controls can be tabbed to** (serious) on /, /shop, /about and 7 more pages. 2 tab stops land on controls inside a hidden region (for example: button "Close bag" inside div.fixed.inset-0 aria-hidden; a "Shop all" inside div.fixed.inset-0 aria-hidden), usually a closed menu, drawer or modal.
2. **Links open new tabs without saying so** (minor) on /, /shop, /about and 7 more pages. 7 links use target="_blank" with no "(opens in new tab)" hint (for example: Loved Beauty on Instagram, Loved Beauty on TikTok, Instagram, TikTok).
3. **Page breaks at 400% zoom** (serious) on /shop. At 320px wide the page scrolls sideways by 6px (li.shrink-0, a.link-underline.text-[0.7rem], li.shrink-0). Low-vision users who zoom cannot read it.
4. **Text contrast** (serious): 112 elements across the scanned pages fail the 4.5:1 minimum, from 4 color pairs:
   - #7c5f4e on #dfcfc1 at 7.9pt (10.56px): 3.83:1 (needs 4.5:1), 60 elements, classes `text-[#7c5f4e]`, e.g. "Shop"
   - #6f585d on #dfcfc1 at 10.5pt (14px): 4.28:1 (needs 4.5:1), 20 elements, classes `text-sm text-plum`, e.g. "10% off your first order. No noise."
   - #6f585d on #dfcfc1 at 8.2pt (10.88px): 4.28:1 (needs 4.5:1), 20 elements, classes `text-[0.68rem] text-plum`, e.g. "By subscribing you agree to receive marketing emails from Lo"
   - #8e6e5c on #f6efe9 at 7.9pt (10.56px): 4.06:1 (needs 4.5:1), 12 elements, e.g. "Our story"
5. **ARIA hidden element must not be focusable or contain focusable elements** (serious, axe rule `aria-hidden-focus`): 30 instances on /, /shop, /about and 7 more pages. Controls that are hidden from screen readers but can still be tabbed to. A keyboard user lands inside something invisible, usually a closed menu or cart drawer.
   - `<div class="fixed inset-0 z-50 overflow-hidden pointer-events-none" aria-hidden="true">`
   - `<div id="mobile-menu" class="fixed inset-0 z-50 flex flex-col bg-cream transition-transform duration-500 ease-[cubic-bezier(0.76,0,0.24,1)] `
6. **Heading levels should only increase by one** (moderate, axe rule `heading-order`): 6 instances on /shop, /collections/bestsellers, /collections/lips. Heading levels that skip (a level 1 straight to a level 3). Screen reader users skim a page by its headings the way sighted people skim by eye; a skipped level breaks the outline.
   - `<h3 class="h-display text-[1.2rem] md:text-[1.5rem]"><a class="text-ink" href="/products/lustre-lip-gloss">Lustre Lip Gloss</a></h3>`

---

## The job

Make this Next.js / React site conform to WCAG 2.2 Level AA without changing the visual design. Fix each numbered item, then do the manual checks, then verify. Do not install an accessibility overlay widget (accessiBe, UserWay, AudioEye or similar); they do not fix the code and sites running them are still sued.

1. Hidden controls can be tabbed to: The listed controls can be tabbed to while hidden (a closed drawer, menu or modal under aria-hidden or display/opacity tricks). Unmount that region when closed, or set the inert attribute on it while closed, and manage focus properly when it opens.
2. Links open new tabs without saying so: Add visually hidden "(opens in new tab)" text inside every link with target="_blank", or drop target="_blank" for links that stay on the site.
3. Page breaks at 400% zoom: At 320px wide the page scrolls sideways. Find the listed elements with fixed widths, min-widths or wide grids and let them wrap or shrink; give images and embeds max-width: 100%.
4. Text contrast: Darken or lighten the text color (or the background) so every text under 24px measures at least 4.5:1 and text 24px and up (or 19px bold) measures at least 3:1. Fix the shared color token, not each element; the groups below tell you which tokens. The failing pairs are listed under Findings with their classes; change each color token once so every use passes. Re-measure after: any pair still under its required ratio is a fail.
5. ARIA hidden element must not be focusable or contain focusable elements (30 instances): When a drawer, menu or modal is closed, either unmount it or set the inert attribute on it. Never leave focusable controls under aria-hidden="true".
6. Heading levels should only increase by one (6 instances): Make heading levels step down one at a time. Where a heading is only there for styling, use a <p> styled to look the same.

Then do these manual checks and fix what you find:

7. Keyboard: press Tab through every page. Focus must always be visible (a 2px+ ring at 3:1 against its surroundings), the order must match the visual order, nothing may trap focus, and every menu, dropdown, slider, dialog and drawer must open with Enter or Space, close with Escape, and return focus to the control that opened it.
8. Hidden regions: a closed menu, cart drawer or modal must not contain tabbable controls. Unmount it or set the inert attribute on it while closed. While open, a dialog needs role="dialog", aria-modal="true", a label, focus moved inside, and a focus trap.
9. Forms: every field has a visible label tied with for/id, required fields are marked in text (not color alone), autocomplete attributes are set on name, email, phone and address fields, and errors are text tied to the field with aria-describedby, announced, with focus moved to the first error on a failed submit.
10. Images: every meaningful image has alt text describing what a sighted person gets from it; decorative images have alt="". Text inside images is repeated as real text.
11. Motion: everything that moves for more than five seconds (video, carousel, marquee, ticker) has a visible pause control, stops under prefers-reduced-motion, and never autoplays sound.
12. Links: every link that opens a new tab includes visually hidden "(opens in new tab)" text. Replace "click here" and "learn more" link text with text that says where the link goes.
13. Headings and landmarks: exactly one h1 per page, no skipped levels, and header, nav, main and footer landmarks with every visible thing inside one of them. Two navs get distinct aria-labels.
14. Zoom: at 400% browser zoom (or a 320px-wide window) nothing is cut off and the page does not scroll sideways.
15. Touch: every tap target is at least 24 by 24 CSS pixels or has 24 pixels of space around it. Pinch-to-zoom is not blocked.
16. Language: the html element has the right lang, and any block in another language has its own lang attribute.

Add an accessibility statement page (at /accessibility, linked from the footer). It states that the site targets WCAG 2.2 Level AA, lists what has been done, names any known limitations honestly (third-party embeds, for example), gives an email and phone for reporting problems, and commits to a response time. Date it.

## Verify when done

Run `ssa scan <url>` (Smart Scale Accessibility Scanner) or an axe-core run with the tags wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa against every page at 1366px and 390px and make it report zero violations and zero contrast failures. Then do a full keyboard-only walkthrough of the home page and the page that makes money (the form, the menu, the product and cart). Report what you changed, file by file, and anything you could not fix and why.

---
Generated by Smart Scale Accessibility Scanner v0.1.0 · https://loved-beauty.vercel.app · 2026-09-27
