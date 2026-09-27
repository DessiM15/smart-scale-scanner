/**
 * Plain-English meaning and the fix for the axe rules a small-business
 * site actually trips. `plain` is what a business owner reads in the
 * report; `fix` is what the developer (or the AI in the repo) is told to
 * do. Anything not listed falls back to axe's own help text.
 */
export interface RuleText {
  plain: string;
  fix: string;
}

export const RULES: Record<string, RuleText> = {
  "color-contrast": {
    plain: "Text that is too faint against its background for people with low vision to read. This is the single most common failure on small-business sites and the first thing a demand letter lists.",
    fix: "Darken or lighten the text color (or the background) so every text under 24px measures at least 4.5:1 and text 24px and up (or 19px bold) measures at least 3:1. Fix the shared color token, not each element; the groups below tell you which tokens.",
  },
  "button-name": {
    plain: "A button with no readable name. A screen reader says only \"button\", so the visitor cannot tell what it does. Usually an icon-only button: search, close, a slider arrow.",
    fix: "Give every icon-only button an aria-label that says what it does (\"Open search\", \"Next slide\", \"Close menu\") and mark the icon inside it aria-hidden=\"true\".",
  },
  "link-name": {
    plain: "A link with no readable text. Usually a social media icon or a logo link. Screen readers announce \"link\" and nothing else.",
    fix: "Give every icon-only link an aria-label naming the destination (\"Mex Taco House on Instagram (opens in new tab)\") and mark the icon aria-hidden=\"true\". For logo links, alt text on the image is enough.",
  },
  "image-alt": {
    plain: "Pictures with no written description. A blind visitor gets nothing, and Google gets nothing either.",
    fix: "Add alt text that describes what is in the photo for anyone who cannot see it (\"Street tacos on a wooden board\"). Purely decorative images get alt=\"\" so screen readers skip them. Never use the file name.",
  },
  label: {
    plain: "A form field with no label attached. The visitor does not know what to type in it.",
    fix: "Add a visible <label> for every field and tie it with for/id. If the design cannot show a label, use aria-label. Placeholder text is not a label.",
  },
  "select-name": {
    plain: "A dropdown with no label attached.",
    fix: "Add a <label for> pointing at the select, or an aria-label.",
  },
  "heading-order": {
    plain: "Heading levels that skip (a level 1 straight to a level 3). Screen reader users skim a page by its headings the way sighted people skim by eye; a skipped level breaks the outline.",
    fix: "Make heading levels step down one at a time. Where a heading is only there for styling, use a <p> styled to look the same.",
  },
  "page-has-heading-one": {
    plain: "The page has no main heading (h1), so there is no title to orient by.",
    fix: "Give every page exactly one h1 that says what the page is.",
  },
  "empty-heading": {
    plain: "A heading with no text in it.",
    fix: "Remove the empty heading or put its text in.",
  },
  region: {
    plain: "Content sitting outside any landmark (header, nav, main, footer). Screen reader users jump between landmarks; content outside them is hard to reach.",
    fix: "Wrap the page: <header>, <nav>, <main> (once), <footer>. Everything visible should live inside one of them.",
  },
  "landmark-one-main": {
    plain: "The page has no main landmark, or more than one.",
    fix: "Wrap the page's primary content in a single <main> element.",
  },
  "landmark-unique": {
    plain: "Two navigation areas that a screen reader cannot tell apart.",
    fix: "Give each <nav> an aria-label (\"Primary\", \"Footer\").",
  },
  "landmark-complementary-is-top-level": {
    plain: "A sidebar (aside) nested inside another landmark.",
    fix: "Move the <aside> out of <main>, or make it a <div>.",
  },
  "skip-link": {
    plain: "A \"skip to content\" link that points at nothing, so it does not work.",
    fix: "Make the link's target exist: <main id=\"main-content\" tabindex=\"-1\">.",
  },
  bypass: {
    plain: "No way to skip past the navigation to the content. A keyboard user must tab through every menu item on every page.",
    fix: "Add a skip link as the first focusable element, visually hidden until focused, pointing at the main landmark.",
  },
  "frame-title": {
    plain: "An embedded frame (a map, a booking calendar, a video) with no title. Screen readers announce \"frame\" and nothing else.",
    fix: "Add a title attribute to every iframe saying what it shows (\"Map showing the restaurant location\").",
  },
  "target-size": {
    plain: "Buttons or links too small to tap reliably on a phone. Slider dots and icon buttons are the usual ones.",
    fix: "Make every tap target at least 24 by 24 CSS pixels, or give it at least 24 pixels of space from its neighbors. A padded hit area is fine; the visible dot can stay small.",
  },
  "aria-hidden-focus": {
    plain: "Controls that are hidden from screen readers but can still be tabbed to. A keyboard user lands inside something invisible, usually a closed menu or cart drawer.",
    fix: "When a drawer, menu or modal is closed, either unmount it or set the inert attribute on it. Never leave focusable controls under aria-hidden=\"true\".",
  },
  "scrollable-region-focusable": {
    plain: "A scrolling area (a reviews strip, a table) that keyboard users cannot reach.",
    fix: "Give the scrolling container tabindex=\"0\" and an aria-label, or restructure it so it does not need to scroll.",
  },
  "html-has-lang": {
    plain: "The page does not say what language it is in, so screen readers may read it with the wrong voice.",
    fix: "Add lang=\"en\" (or the right language) to the <html> element.",
  },
  "document-title": {
    plain: "The page has no title.",
    fix: "Give every page a <title> that says what the page is and which site it belongs to.",
  },
  "aria-prohibited-attr": {
    plain: "An accessibility label placed on an element that cannot carry one, so it is ignored.",
    fix: "Move the aria-label to the interactive element inside, give the element a role, or remove it.",
  },
  "aria-allowed-role": {
    plain: "An element given a role it is not allowed to have.",
    fix: "Use the native element for the job (a <button> for a button) or a role that fits.",
  },
  "nested-interactive": {
    plain: "A control inside another control (a button inside a link), which confuses screen readers and keyboards.",
    fix: "Un-nest them: one interactive element per control.",
  },
  "link-in-text-block": {
    plain: "Links inside paragraphs that look like the surrounding text, so color-blind readers cannot find them.",
    fix: "Underline links in body text, or make them 3:1 different from the text and add an underline on hover and focus.",
  },
  "meta-viewport": {
    plain: "The page blocks pinch-to-zoom on phones.",
    fix: "Remove user-scalable=no and maximum-scale from the viewport meta tag.",
  },
  "video-caption": {
    plain: "A video with no captions.",
    fix: "Add a captions track, or if the video is decorative with no speech, mark it as such and provide a pause control.",
  },
  tabindex: {
    plain: "Elements forced to the front of the tab order with a positive tabindex, which scrambles the keyboard order.",
    fix: "Remove positive tabindex values; use tabindex=\"0\" or the natural DOM order.",
  },
  list: {
    plain: "A list that contains things that are not list items, which breaks how screen readers count and announce it.",
    fix: "Keep only <li> elements directly inside <ul> and <ol>.",
  },
  listitem: {
    plain: "List items that are not inside a list.",
    fix: "Wrap the <li> elements in a <ul> or <ol>.",
  },
  "duplicate-id-aria": {
    plain: "Two elements share the same id, so a label or description points at the wrong one.",
    fix: "Make every id on the page unique.",
  },
  "input-button-name": {
    plain: "A submit button with no text.",
    fix: "Give the button a value or text (\"Send message\").",
  },
};

export function ruleText(id: string, fallbackHelp: string): RuleText {
  return RULES[id] ?? { plain: fallbackHelp, fix: `Resolve every instance of "${fallbackHelp}" (axe rule ${id}); see the rule's help page for the exact requirement.` };
}
