# Ascension Group · accessibility fix

> **How to use this file.** In Claude Code or Cursor, opened at this project's root, say: "Read ACCESSIBILITY-FIX.md and do everything in it." The findings are from a Smart Scale Accessibility Scanner run on 2026-09-28 (WCAG 2.2 Level AA, 2 pages at desktop and phone widths). "The job" is the work. When it reports done, run the manual checks, then rescan.

Detected: Next.js, hosted on Vercel. Make the changes in the components and shared layout so a fix applies everywhere the component renders.

## Findings

13 distinct problems: 5 rule failures, 0 contrast color pairs, 8 findings from the keyboard, structure, motion and reflow passes.

1. **No skip link** (moderate) on /, /founders. The first Tab press should offer a link past the navigation to the main content. A keyboard user must otherwise tab through every menu item on every page.
2. **Keyboard focus is invisible** (serious) on /. 7 of the first 43 tab stops show no focus indicator (for example: input "Full name", input "Email", input "Phone", input "Sport and position"). A keyboard user cannot see where they are.
3. **Hidden controls can be tabbed to** (serious) on /. 7 tab stops land on controls inside a hidden region (for example: a "Ascension Athlete Group home" inside header.sticky.top-0 aria-hidden; a "Divisions" inside header.sticky.top-0 aria-hidden; a "Partnerships" inside header.sticky.top-0 aria-hidden; a "Events" inside header.sticky.top-0 aria-hidden), usually a closed menu, drawer or modal.
4. **Links open new tabs without saying so** (minor) on /. 3 links use target="_blank" with no "(opens in new tab)" hint (for example: @ascensionathletegroup, Instagram @ascensionathletegroup, Smart Scale, LLC).
5. **Media plays automatically with no controls** (serious) on /. 4 autoplaying video or audio element(s) have no controls, so the visitor cannot pause them.
6. **Content moves for more than five seconds with no pause control** (moderate) on /. 2 animation(s) run longer than five seconds (a ticker, marquee or carousel) and the page has no visible pause, stop or play control. Pausing on hover or focus helps but is not a control a visitor can find; WCAG 2.2.2 asks for one.
7. **Motion ignores the visitor's reduce-motion setting** (moderate) on /. With prefers-reduced-motion on, 0 long animation(s) and 4 autoplaying media element(s) keep running.
8. **Page breaks at 400% zoom** (serious) on /, /founders. At 320px wide the page scrolls sideways by 38px (span.eyebrow.text-silver-2, div.marquee-track.slow, span.flex.items-center). Low-vision users who zoom cannot read it.
9. **<dt> and <dd> elements must be contained by a <dl>** (serious, axe rule `dlitem`): 32 instances on /founders. <dt> and <dd> elements must be contained by a <dl>
   - `<dt class="inline font-semibold uppercase tracking-[0.08em] text-bone">College<!-- -->: </dt>`
   - `<dd class="inline text-silver">Army West Point</dd>`
   - `<dt class="inline font-semibold uppercase tracking-[0.08em] text-bone">Pro experience<!-- -->: </dt>`
10. **Links must be distinguishable without relying on color** (serious, axe rule `link-in-text-block`): 4 instances on /, /founders. Links inside paragraphs that look like the surrounding text, so color-blind readers cannot find them.
   - `<a href="https://smartscaleagent.com/" target="_blank" rel="noopener noreferrer" class="text-silver transition-colors hover:text-gold">Smart`
11. **<dl> elements must only directly contain properly-ordered <dt> and <dd> groups, <script>, <template> or <div> elements** (serious, axe rule `definition-list`): 4 instances on /founders. <dl> elements must only directly contain properly-ordered <dt> and <dd> groups, <script>, <template> or <div> elements
   - `<dl class="mt-7 max-w-2xl space-y-3">`
   - `<dl class="mt-7 max-w-2xl space-y-3">`
12. **Certain ARIA roles must contain particular children** (critical, axe rule `aria-required-children`): 2 instances on /. Certain ARIA roles must contain particular children
   - `<div class="marquee mt-12 overflow-hidden border-y border-white/10 py-10" role="list" aria-label="Teams our athletes have signed with">`
13. **All page content should be contained by landmarks** (moderate, axe rule `region`): 2 instances on /, /founders. Content sitting outside any landmark (header, nav, main, footer). Screen reader users jump between landmarks; content outside them is hard to reach.
   - `<div class="flex flex-col gap-6"><a class="btn btn-gold w-full" href="/#contact">Book a Consultation</a><p class="eyebrow text-silver-2">Hou`

---

## The job

Make this Next.js / React site conform to WCAG 2.2 Level AA without changing the visual design. Fix each numbered item, then do the manual checks, then verify. Do not install an accessibility overlay widget (accessiBe, UserWay, AudioEye or similar); they do not fix the code and sites running them are still sued.

1. No skip link: Add a "Skip to main content" link as the first focusable element on every page, visually hidden until focused, pointing at the main landmark, and make that landmark focusable (tabindex="-1").
2. Keyboard focus is invisible: Find every CSS rule that sets outline: none or outline: 0 and replace it with a :focus-visible style: a solid 2px+ outline in a color that measures at least 3:1 against the background, with 2px offset. Confirm the listed elements show it.
3. Hidden controls can be tabbed to: The listed controls can be tabbed to while hidden (a closed drawer, menu or modal under aria-hidden or display/opacity tricks). Unmount that region when closed, or set the inert attribute on it while closed, and manage focus properly when it opens.
4. Links open new tabs without saying so: Add visually hidden "(opens in new tab)" text inside every link with target="_blank", or drop target="_blank" for links that stay on the site.
5. Media plays automatically with no controls: Add a visible pause control to every autoplaying video or audio, keep it muted, and stop it under prefers-reduced-motion.
6. Content moves for more than five seconds with no pause control: Give every animation, carousel, ticker or marquee that runs longer than five seconds a visible pause control, and disable it under prefers-reduced-motion.
7. Motion ignores the visitor's reduce-motion setting: Wrap the animation, autoplay and smooth-scroll setup in a check for prefers-reduced-motion: reduce (CSS @media, or window.matchMedia in script) so it does not run for visitors who asked for less motion.
8. Page breaks at 400% zoom: At 320px wide the page scrolls sideways. Find the listed elements with fixed widths, min-widths or wide grids and let them wrap or shrink; give images and embeds max-width: 100%.
9. <dt> and <dd> elements must be contained by a <dl> (32 instances): Resolve every instance of "<dt> and <dd> elements must be contained by a <dl>" (axe rule dlitem); see the rule's help page for the exact requirement.
10. Links must be distinguishable without relying on color (4 instances): Underline links in body text, or make them 3:1 different from the text and add an underline on hover and focus.
11. <dl> elements must only directly contain properly-ordered <dt> and <dd> groups, <script>, <template> or <div> elements (4 instances): Resolve every instance of "<dl> elements must only directly contain properly-ordered <dt> and <dd> groups, <script>, <template> or <div> elements" (axe rule definition-list); see the rule's help page for the exact requirement.
12. Certain ARIA roles must contain particular children (2 instances): Resolve every instance of "Certain ARIA roles must contain particular children" (axe rule aria-required-children); see the rule's help page for the exact requirement.
13. All page content should be contained by landmarks (2 instances): Wrap the page: <header>, <nav>, <main> (once), <footer>. Everything visible should live inside one of them.

Then do these manual checks and fix what you find:

14. Keyboard: press Tab through every page. Focus must always be visible (a 2px+ ring at 3:1 against its surroundings), the order must match the visual order, nothing may trap focus, and every menu, dropdown, slider, dialog and drawer must open with Enter or Space, close with Escape, and return focus to the control that opened it.
15. Hidden regions: a closed menu, cart drawer or modal must not contain tabbable controls. Unmount it or set the inert attribute on it while closed. While open, a dialog needs role="dialog", aria-modal="true", a label, focus moved inside, and a focus trap.
16. Forms: every field has a visible label tied with for/id, required fields are marked in text (not color alone), autocomplete attributes are set on name, email, phone and address fields, and errors are text tied to the field with aria-describedby, announced, with focus moved to the first error on a failed submit.
17. Images: every meaningful image has alt text describing what a sighted person gets from it; decorative images have alt="". Text inside images is repeated as real text.
18. Motion: everything that moves for more than five seconds (video, carousel, marquee, ticker) has a visible pause control, stops under prefers-reduced-motion, and never autoplays sound.
19. Links: every link that opens a new tab includes visually hidden "(opens in new tab)" text. Replace "click here" and "learn more" link text with text that says where the link goes.
20. Headings and landmarks: exactly one h1 per page, no skipped levels, and header, nav, main and footer landmarks with every visible thing inside one of them. Two navs get distinct aria-labels.
21. Zoom: at 400% browser zoom (or a 320px-wide window) nothing is cut off and the page does not scroll sideways.
22. Touch: every tap target is at least 24 by 24 CSS pixels or has 24 pixels of space around it. Pinch-to-zoom is not blocked.
23. Language: the html element has the right lang, and any block in another language has its own lang attribute.

Add an accessibility statement page (at /accessibility, linked from the footer). It states that the site targets WCAG 2.2 Level AA, lists what has been done, names any known limitations honestly (third-party embeds, for example), gives an email and phone for reporting problems, and commits to a response time. Date it.

## Verify when done

Run `ssa scan <url>` (Smart Scale Accessibility Scanner) or an axe-core run with the tags wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa against every page at 1366px and 390px and make it report zero violations and zero contrast failures. Then do a full keyboard-only walkthrough of the home page and the page that makes money (the form, the menu, the product and cart). Report what you changed, file by file, and anything you could not fix and why.

---
Generated by Smart Scale Accessibility Scanner v0.1.0 · https://ascension-group-landing-page.vercel.app · 2026-09-28
