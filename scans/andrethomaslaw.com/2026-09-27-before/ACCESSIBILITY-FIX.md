# Andre Thomas Law · accessibility fix

> **How to use this file.** In Claude Code or Cursor, opened at this project's root, say: "Read ACCESSIBILITY-FIX.md and do everything in it." The findings are from a Smart Scale Accessibility Scanner run on 2026-09-27 (WCAG 2.2 Level AA, 10 pages at desktop and phone widths). "The job" is the work. When it reports done, run the manual checks, then rescan.

Detected: Next.js, hosted on Vercel. Make the changes in the components and shared layout so a fix applies everywhere the component renders.

## Findings

9 distinct problems: 1 rule failures, 2 contrast color pairs, 6 findings from the keyboard, structure, motion and reflow passes.

1. **Keyboard focus is invisible** (serious) on /, /practice-areas, /about and 7 more pages. 12 of the first 80 tab stops show no focus indicator (for example: input "unnamed", input "unnamed", input "unnamed", select "Select a practice area (optional)Personal InjuryCar Accident"). A keyboard user cannot see where they are.
2. **Hidden controls can be tabbed to** (serious) on /, /practice-areas, /reviews and 1 more page. 2 tab stops land on controls inside a hidden region (for example: a "Explore practice areas→" inside div opacity:0; a "Read them all on Google" inside div opacity:0), usually a closed menu, drawer or modal.
3. **Keyboard focus gets trapped** (critical) on /, /practice-areas, /about and 7 more pages. Tab keeps landing on input "unnamed" and cannot move past it.
4. **Links open new tabs without saying so** (minor) on /, /practice-areas, /about and 7 more pages. 5 links use target="_blank" with no "(opens in new tab)" hint (for example: Read them all on Google, 13201 Northwest Freeway, Suite 485, Hous, Instagram ↗, 13201 Northwest FreewaySuite 485Houston,).
5. **Content moves for more than five seconds with no pause control** (moderate) on /, /about, /team and 4 more pages. 2 animation(s) run longer than five seconds (a ticker, marquee or carousel) and the page has no visible pause, stop or play control. Pausing on hover or focus helps but is not a control a visitor can find; WCAG 2.2.2 asks for one.
6. **No skip link** (moderate) on /es. The first Tab press should offer a link past the navigation to the main content. A keyboard user must otherwise tab through every menu item on every page.
7. **Text contrast** (serious): 3 elements across the scanned pages fail the 4.5:1 minimum, from 2 color pairs:
   - #a4823a on #fbf9f5 at 8.3pt (11px): 3.42:1 (needs 4.5:1), 2 elements, classes `text-gold-600`, e.g. "02"
   - #a4823a on #f4efe5 at 8.3pt (11px): 3.14:1 (needs 4.5:1), 1 element, classes `text-gold-600`, e.g. "02"
8. **Heading levels should only increase by one** (moderate, axe rule `heading-order`): 4 instances on /, /es. Heading levels that skip (a level 1 straight to a level 3). Screen reader users skim a page by its headings the way sighted people skim by eye; a skipped level breaks the outline.
   - `<h3 class="mt-4 font-display text-[1.75rem] leading-tight text-paper md:text-[2.1rem]">Core Values and Approach</h3>`
   - `<h3 class="mt-4 font-display text-[1.75rem] leading-tight text-paper md:text-[2.1rem]">Valores y forma de trabajar</h3>`

---

## The job

Make this Next.js / React site conform to WCAG 2.2 Level AA without changing the visual design. Fix each numbered item, then do the manual checks, then verify. Do not install an accessibility overlay widget (accessiBe, UserWay, AudioEye or similar); they do not fix the code and sites running them are still sued.

1. Keyboard focus is invisible: Find every CSS rule that sets outline: none or outline: 0 and replace it with a :focus-visible style: a solid 2px+ outline in a color that measures at least 3:1 against the background, with 2px offset. Confirm the listed elements show it.
2. Hidden controls can be tabbed to: The listed controls can be tabbed to while hidden (a closed drawer, menu or modal under aria-hidden or display/opacity tricks). Unmount that region when closed, or set the inert attribute on it while closed, and manage focus properly when it opens.
3. Keyboard focus gets trapped: Focus gets stuck on the listed element. Remove the script or tabindex logic that keeps pulling focus back, and make Escape or Tab leave it.
4. Links open new tabs without saying so: Add visually hidden "(opens in new tab)" text inside every link with target="_blank", or drop target="_blank" for links that stay on the site.
5. Content moves for more than five seconds with no pause control: Give every animation, carousel, ticker or marquee that runs longer than five seconds a visible pause control, and disable it under prefers-reduced-motion.
6. No skip link: Add a "Skip to main content" link as the first focusable element on every page, visually hidden until focused, pointing at the main landmark, and make that landmark focusable (tabindex="-1").
7. Text contrast: Darken or lighten the text color (or the background) so every text under 24px measures at least 4.5:1 and text 24px and up (or 19px bold) measures at least 3:1. Fix the shared color token, not each element; the groups below tell you which tokens. The failing pairs are listed under Findings with their classes; change each color token once so every use passes. Re-measure after: any pair still under its required ratio is a fail.
8. Heading levels should only increase by one (4 instances): Make heading levels step down one at a time. Where a heading is only there for styling, use a <p> styled to look the same.

Then do these manual checks and fix what you find:

9. Keyboard: press Tab through every page. Focus must always be visible (a 2px+ ring at 3:1 against its surroundings), the order must match the visual order, nothing may trap focus, and every menu, dropdown, slider, dialog and drawer must open with Enter or Space, close with Escape, and return focus to the control that opened it.
10. Hidden regions: a closed menu, cart drawer or modal must not contain tabbable controls. Unmount it or set the inert attribute on it while closed. While open, a dialog needs role="dialog", aria-modal="true", a label, focus moved inside, and a focus trap.
11. Forms: every field has a visible label tied with for/id, required fields are marked in text (not color alone), autocomplete attributes are set on name, email, phone and address fields, and errors are text tied to the field with aria-describedby, announced, with focus moved to the first error on a failed submit.
12. Images: every meaningful image has alt text describing what a sighted person gets from it; decorative images have alt="". Text inside images is repeated as real text.
13. Motion: everything that moves for more than five seconds (video, carousel, marquee, ticker) has a visible pause control, stops under prefers-reduced-motion, and never autoplays sound.
14. Links: every link that opens a new tab includes visually hidden "(opens in new tab)" text. Replace "click here" and "learn more" link text with text that says where the link goes.
15. Headings and landmarks: exactly one h1 per page, no skipped levels, and header, nav, main and footer landmarks with every visible thing inside one of them. Two navs get distinct aria-labels.
16. Zoom: at 400% browser zoom (or a 320px-wide window) nothing is cut off and the page does not scroll sideways.
17. Touch: every tap target is at least 24 by 24 CSS pixels or has 24 pixels of space around it. Pinch-to-zoom is not blocked.
18. Language: the html element has the right lang, and any block in another language has its own lang attribute.

Add an accessibility statement page (at /accessibility, linked from the footer). It states that the site targets WCAG 2.2 Level AA, lists what has been done, names any known limitations honestly (third-party embeds, for example), gives an email and phone for reporting problems, and commits to a response time. Date it.

## Verify when done

Run `ssa scan <url>` (Smart Scale Accessibility Scanner) or an axe-core run with the tags wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa against every page at 1366px and 390px and make it report zero violations and zero contrast failures. Then do a full keyboard-only walkthrough of the home page and the page that makes money (the form, the menu, the product and cart). Report what you changed, file by file, and anything you could not fix and why.

---
Generated by Smart Scale Accessibility Scanner v0.1.0 · https://andrethomaslaw.com · 2026-09-27
