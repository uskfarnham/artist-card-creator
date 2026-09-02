# Project Status — Artist Card Creator
*(renamed from "Business Card Creator")*

_Last updated: 2026-09-01_

---

## Current State

**Migration to a static site is complete, tested, and live on GitHub Pages.**
The app has been fully rewritten from Google Apps Script (`Code.gs` +
`Index.html`, ~1900 lines) to a standalone static site, hosted in its own repo
under the `uskfarnham` account (`uskfarnham.github.io/artist-card-creator/`).

**Shapes feature is now complete and tested end-to-end**, covering
rectangle, ellipse, triangle, and line — creation, drag, resize (including
Shift/lock-proportions constrain), styling (fill/stroke/width), layering,
alignment, grouping, arrow-key nudge, undo/redo, save/load, and print/PDF
output. Polygon and star remain deferred (see Backlog).

### File structure
```
artist-card-creator/
├── index.html
├── css/
│   └── styles.css
├── js/
│   ├── state.js
│   ├── card-sizes.js
│   ├── elements.js
│   ├── drag-resize.js
│   ├── text-formatting.js
│   ├── background.js
│   ├── save-load.js
│   ├── print.js
│   └── main.js
├── fonts/          ← not yet populated
└── PROJECT_STATUS.md
```
Plain `<script>` tags (not ES modules) — top-level `const`/`let` share one global
lexical scope across all classic scripts on the page, so modules can reference
functions/variables defined in files loaded later without any import/export
machinery, **as long as those references are only resolved inside a function
body invoked later, not in a top-level statement that runs immediately at
script load** (see Key Learnings).

---

## Resolved by the Migration

- **Static site migration** — complete, tested, live.
- **Iframe-fighting CSS removed** — replaced with plain flexbox in `css/styles.css`.
- **Chunked-cache silent-failure bug class eliminated by construction**.
- **Server-side PDF generation replaced** — `print.js` opens the imposed A4
  sheet in a new tab and calls `window.print()`.
- **Rich-text styling via span-wrapping** — replaced entirely by **Quill**,
  sidebar-only (`#quillEditorContainer`); canvas text is a read-only preview.
- **Font-size slider → dropdown** — standard sizes (8–96px).
- **App renamed** to "Artist Card Creator" throughout.
- **Card-size groundwork laid** — `js/card-sizes.js` is the single source of
  truth for card dimensions (currently only `uk-eu` 85×55mm active).

---

## Resolved: Shapes Feature (2026-08-31 – 2026-09-01)

Implemented in dependency order across several sessions, per the design
decisions sketched on 2026-08-30 (see git history / earlier status versions
for the original design rationale — summarized under Key Learnings below).

- **Data model** — `type: 'shape'` with a `shapeKind` field. Box-based kinds
  (`rectangle`, `ellipse`, `triangle` — `BOX_SHAPE_KINDS` in `elements.js`)
  reuse the standard `x, y, width, height` model and the existing 4-corner
  resize handles unchanged. `line` is endpoint-based (`x1, y1, x2, y2`), with
  its own 2-handle drag (`initLineEndpointDrag`, `drag-resize.js`) and a
  **derived, not authoritative**, wrapper bounding box
  (`getLineBoundingBox`/`getElementBoundingBox`, `elements.js`).
- **Rendering** — one `<svg>` per shape element inside the existing
  `.design-element` wrapper (`buildShapeMarkup`/`buildLineMarkup`,
  `elements.js`), chosen over CSS-shape hacks for crisp resizing, real
  stroke control, and trivial triangle/line geometry.
- **Toolbar** — shape-icon button row in the "Add Elements" accordion
  (rectangle/ellipse/triangle/line), `createShapeElement(kind)` /
  `createLineElement()`.
- **Shift-constrain / Lock Proportions** — Shift-drag temporarily constrains
  box-shape resize; a persistent **Lock Proportions checkbox** in
  `shapePropertiesGroup` is the touch-accessible equivalent, since Shift
  requires a physical keyboard unavailable on iPad/touch-only devices.
  Target ratio is shape-aware (`getShapeLockRatio`, `elements.js`):
  rectangle/ellipse lock to 1:1 (square/circle), triangle locks to
  `2/√3` (equilateral, not isosceles — a 1:1 box does NOT produce an
  equilateral triangle given the apex-top/base-bottom vertex layout).
- **`shapePropertiesGroup` sidebar panel** — fill/stroke color pickers
  (each with its own saved-palette swatch row and Save button, sharing the
  same underlying `state.palette` as text — see `renderAllPalettes`,
  `addColorToPalette` in `main.js`), fill/stroke enabled toggles, stroke
  width dropdown, Lock Proportions toggle with a tap/click-friendly hint
  tooltip. Fill and Lock Proportions rows hide entirely for lines (no fill
  concept; see `syncShapePanelToElement`).
- **Print/export** — `compileToPrintSheet` (`print.js`) emits inline SVG per
  shape/line element, scaled via the existing `pxToMmFactor`. Gradient card
  backgrounds are also now rendered as a per-card inline SVG
  `<linearGradient>` with a unique id per card (`parseLinearGradient`,
  `gradientAngleToLine`), rather than a shared CSS `background-image`
  string, to address cross-card rendering inconsistency (see Known Issues).
- **Generic-code fixes exposed by lines** — `alignElements` and
  `getSnapTargets` (previously assumed every element has `x`/`width`
  directly) now go through `getElementBoundingBox`, which returns the
  derived box for lines and the authoritative one for everything else.
  Arrow-key nudge (`main.js` `keydown` handler) similarly needed a
  line-aware branch (translate both endpoints by the same delta) — was
  silently a no-op for lines beforehand since it wrote directly to
  non-existent `el.x`/`el.y`.
- **Drag/resize stability rewrite** — see Key Learnings; `initDrag` and
  `initResize` now use `setPointerCapture` + `pointercancel` handling
  instead of `window`-level listeners cleaned up only on `pointerup`.

---

## Resolved: Text preview missing block-level styling (2026-09-02)

`applyStylesToDOM`'s text branch in `js/elements.js` had been left as a
`// ...unchanged...` placeholder since the initial refactor — a pasting
gap where a real diff summary was never filled back in with actual code.
Practical effect: the on-screen canvas preview (`.element-content`) never
had `fontFamily`/`fontSize`/`fontWeight`/`fontStyle`/`color`/`textAlign`/
`lineHeight` applied to it at all, so it silently fell back to the
browser's default font-size (~16px) instead of the intended 14px default.
`print.js` was unaffected — it reads `elData.style` correctly — so the
canvas preview ran measurably wider per character than print, enough to
shift word-wrap points between the two. This is what surfaced as "line
alignment doesn't match between canvas and print": the line's position
was always correct (pure coordinate math, no font dependency); it was the
text reflowing differently around it. Root-caused by comparing exact
letter-by-letter horizontal alignment between an on-screen screenshot and
the raw print SVG/HTML output for the same saved design — the line's
mm-converted coordinates matched exactly, isolating the discrepancy to
text rendering specifically. Fixed by actually applying `elData.style` to
the preview's content node, matching what `print.js` already did.

---

## Known Issues (Low Priority)

- [ ] **Minor: faint gradient banding across tiled print cards.** Cards away
      from the top-left of the printed/PDF sheet could show very slightly
      different gradient rendering than the first card, most visible with
      dark gradient presets (e.g. Midnight Slate). Largely fixed
      (2026-09-01) by giving each card its own independently-keyed inline
      SVG `<linearGradient>` rather than a shared CSS background-image
      string — original effect was strong, now marginal but not fully
      eliminated. Suspected residual cause: Chromium's print/PDF
      color-economy handling, outside app code. Not investigated further;
      revisit only if it becomes more noticeable in practice.
- [ ] **Font-size can drift out of sync with its text box after a card-size
      switch.** Root cause: `rescaleElementsToNewCanvas` scales box
      geometry but not font-size (see Backlog — "Per-run font-size rescale
      on card size switch"). Symptom: text overflows/looks oversized
      relative to its box, most visible in print output where the
      overflow gets clipped at the card edge rather than the text box
      edge. Mitigated (not fixed) by a warning in the card-size confirm
      dialog telling the user to recheck manually.

---

## Backlog

### High Priority
- [ ] **Rotation support** for all element kinds (image, text, shape).
      Deferred because it touches drag-resize coordinate math across every
      kind — box-based shapes' 4-corner handles, lines' 2-endpoint drag, and
      eventual polygon/star vertex dragging would all need rotation-aware
      math. Needs its own design pass covering: rotation handle UX, how
      rotation interacts with snapping/smart-guides, and whether rotated
      bounding boxes affect the alignment/grouping logic in `elements.js`
      (which currently assumes axis-aligned boxes throughout).
- [ ] **Polygon and star shapes.** Design already largely settled (see git
      history for the 2026-08-30 design session notes) — box-based geometry
      using independent `rx = width/2, ry = height/2` (not a single shared
      radius, which can't express "wider than tall"), explicit `points`
      array for independently-draggable vertices once any vertex is
      custom-dragged, one handle per vertex (generalizing the line's
      2-endpoint drag to N points), corner-resize or "Sides" dropdown change
      regenerates all points fresh from the formula (discarding custom
      tweaks), Shift/Lock-Proportions constrains `rx = ry`. Star needs a
      second "inner radius ratio" dropdown (notch depth presets, e.g.
      30/40/50/60%) rather than a slider.
- [ ] **Duplicate element function** (any type: text, image, shape). Needs a
      design pass before implementation:
      - **Trigger(s):** Ctrl/Cmd+D (desktop convention) likely needs to
        coexist with a toolbar/sidebar "Duplicate" button (touch-accessible
        equivalent — no keyboard shortcut reachable on iPad without an
        external keyboard). Right-click/long-press context menu is a third
        option worth weighing against a persistent button.
      - **Placement of the copy:** reuse the existing `spawnOffset` cascade
        pattern (`elements.js`) so duplicates don't land exactly on top of
        the original.
      - **What gets copied:** straightforward for style/geometry/content;
        needs a decision for `groupId` (joins same group / new group of one
        / ungrouped?) and `zIndex` (front, or just above original?).
      - **Multi-select:** batch-duplicate all selected (preserving relative
        offsets/grouping), or single-element only initially? Single-element
        first, expand later, is probably the lower-risk path (similar to how
        shapes themselves were sequenced).
      - One `pushHistory()` per duplicate action (or per batch), not per
        element, to keep undo/redo granularity sane.

### Medium Priority
- [ ] **Self-host fonts** — `fonts/` directory exists but is empty.
- [ ] **Card size configuration** — `card-sizes.js` has the data model;
      needs a size-selector UI (Canvas Settings accordion) calling
      `setCurrentCardSize()`, plus wiring it to actually resize
      `.canvas-container` and trigger a re-layout.
- [ ] General styling/UX polish pass (Quill's snow-theme visual details vs.
      the app's existing design language).
- [ ] **Per-run font-size rescale on card size switch.** `rescaleElementsToNewCanvas`
      (`card-sizes.js`) currently rescales element geometry and shape
      `strokeWidth` automatically, but deliberately leaves text font-size
      untouched — a text element's block-level default
      (`el.style.fontSize`) could be scaled trivially, but any
      per-character size override (selecting a word/phrase and picking a
      different size than the rest) is baked directly into `el.content` as
      inline Quill HTML, not exposed as a discrete field. Auto-scaling only
      the block default would silently leave those overrides wrong — worse
      than not touching it, since the mismatch wouldn't surface until
      print. Needs a dedicated pass: parse `el.content`'s Quill-generated
      HTML (or better, get the underlying Delta from Quill if kept
      accessible), rescale every inline `font-size` run proportionally,
      re-serialize. Until this exists, `setCurrentCardSize`'s confirm
      dialog warns the user to manually recheck font sizes after switching.

---

## Key Learnings & Principles

- `document.execCommand` is unreliable for partial text selection formatting;
  a proper data-model rich text editor (Quill) avoids the problem at the root.
- Image compression must happen at upload time, not just display/render time.
- Silent failure modes in server-side processing are worth eliminating by
  removing the server round-trip that created the failure mode.
- Plain `<script>` tags sharing a global lexical scope is a legitimate
  lightweight alternative to ES modules for a project this size — but
  **classic-script forward references are only safe inside function bodies
  invoked later, never in a top-level statement that runs immediately at
  script load.**
- Sliders are a poor fit for controls needing precise, specific values
  (font size, stroke width) — a dropdown of sensible presets is easier to
  use accurately. Applied consistently across the app.
- Quill's default formats (`font`, `align`) are often class-based with tiny
  built-in whitelists scoped to `.ql-editor` — the style-based attributor
  variants (`attributors/style/*`) avoid this by applying inline CSS
  directly, portable anywhere the HTML ends up.
- A control retaining browser focus after interaction can silently break
  *other* keyboard behavior elsewhere in the app (arrow-key nudge) with no
  visible error — worth an explicit, general "release focus" step
  (`releaseFocusForCanvasInteraction`) at the start of any canvas
  interaction, not scoped to whichever control was noticed first.
- File System Access API's `createWritable()` truncates the target file
  immediately, before any write occurs — distinguish "failed before
  touching the file" (safe to fall back quietly) from "failed after
  truncation started" (must warn explicitly).
- Drag/resize needs **Pointer Events**, not mouse events, for touch support
  — but pointer listeners attached to `window` and cleaned up only on
  `pointerup` are not sufficient by themselves: fast/edge-of-canvas
  movement (common on trackpads) can trigger `pointercancel` instead of
  `pointerup`, silently leaking the listeners forever and letting a new
  drag/resize session start on top of a stale one still writing to state —
  symptoms were jumpy movement and selection "falling away" onto a
  different element. Fixed with `setPointerCapture` (routes events to the
  interaction regardless of what's under the cursor) plus explicit
  `pointercancel` handling identical to `pointerup`, plus a module-level
  `activeInteraction` guard as a backstop against overlapping sessions.
- **Aspect-ratio-locked resize must derive the "other" axis from the
  dominant axis's proposed SIZE, not its raw mouse delta** — deriving from
  delta flips sign whenever dx/dy have opposite signs (e.g. dragging
  up-and-right on an `se` handle), causing visible jitter as the two deltas
  see-saw. Similarly, **dominant-axis selection must use raw mouse delta
  (`|dx|` vs `|dy|`), not relative size-change** — relative change is
  biased for non-square elements (a wide rectangle sees a bigger % height
  change than width change for the same pixel movement), which felt sticky
  since the shape's growth direction didn't match actual hand movement.
- **Snap-while-ratio-locked needs a single lock decision made once**, not
  two independently-reasoned ones — an early version let `drag-resize.js`'s
  general resize logic pick a dominant axis while `snapResize` separately
  re-decided priority based on which corner crossed a guide threshold that
  frame; near a guide, sub-pixel hover flicker caused the two to disagree
  frame-to-frame, jittering the shape. Fixed by computing the dominant axis
  once (in `initResize`) and passing it down so `snapResize` only ever
  single-axis-tests that one, always deriving the other via ratio.
- **Not every element has `x`/`y`/`width`/`height`** — introducing line's
  endpoint-based geometry exposed several places that assumed every element
  did (`getSnapTargets`, `alignElements`, arrow-key nudge). Generalized via
  `getElementBoundingBox()`, which returns the derived box for
  endpoint-based geometry and the authoritative one otherwise — any future
  non-box element (e.g. custom-vertex polygon/star) should route through
  this rather than reintroducing the same class of bug.
- CSS `text-transform: uppercase` on an ancestor (`.form-group label`)
  silently applies to *nested* content too, including tooltip text that
  should stay mixed-case — worth checking nesting, not just the intended
  target element, when a global style rule produces an unexpected effect
  elsewhere.
- Hover-only tooltips (`:hover` in CSS) have no touch equivalent — added a
  generic tap-to-toggle enhancement (`main.js`) that applies to every
  `.tooltip-container` in the app, plus explicit close-on-outside-click and
  close-on-mouse-leave handling (a tooltip opened via click needs its own
  dismissal path, since it doesn't reliably close on hover-end alone).
- Repeating an *identical* CSS `background` value (e.g. a gradient string)
  across many tiled/repeated elements on one rendered page can produce
  subtle per-element rendering inconsistencies in some browsers, most
  visible with dark colors. Rendering each instance as its own independently
  keyed resource (e.g. a uniquely-`id`'d SVG `<linearGradient>` per card,
  rather than a shared CSS string) is the general fix pattern.
  - A `// ...unchanged...` placeholder left in committed code during a past
  refactor is indistinguishable from a real no-op at a glance — it reads
  as intentional shorthand, not a gap. Worth treating any such comment
  encountered in the live codebase as a prompt to go verify what's
  actually there, especially in a function whose *other* branches (line,
  shape) are fully implemented right alongside it. When on-screen and
  print output disagree, checking whether the *positioning* math
  (coordinates, independent of font/content) matches exactly is a fast way
  to isolate whether the discrepancy is geometric or content/rendering —
  here, the line's coordinates matched perfectly, which pointed straight
  at text rendering rather than any print-specific scaling bug.

## Tools & Resources
- **Quill** (rich text editor, sidebar-only) — `js/text-formatting.js`
- Canvas API (image resampling/compression) — `js/elements.js`
- SVG (shape/line rendering, on-screen and print) — `js/elements.js`, `js/print.js`
- GitHub Pages (live: `uskfarnham.github.io/artist-card-creator/`)
- Pointer Events (drag/resize/touch support, with capture + cancel handling)
  — `js/drag-resize.js`

## Parked Ideas (not on the backlog, noted for later)
- Client-side PDF library (jsPDF/html2pdf.js) for a true one-click PDF
  download without the browser print dialog, if the print-dialog UX ever
  feels clunky in practice. Current approach (open tab + `window.print()`)
  was chosen as the lower-risk path for now.