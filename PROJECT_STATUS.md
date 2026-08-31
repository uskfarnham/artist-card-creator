# Project Status — Artist Card Creator
*(renamed from "Business Card Creator")*

_Last updated: 2026-08-31_

---

## Current State

**Migration to a static site is complete, tested, and live on GitHub Pages.**
The app has been fully rewritten from Google Apps Script (`Code.gs` +
`Index.html`, ~1900 lines) to a standalone static site, hosted in its own repo
under the `uskfarnham` account (`uskfarnham.github.io/artist-card-creator/`).
Committed, pushed, and confirmed working in a real deployed environment.

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
script load** (this distinction caused two real bugs during testing — see Key
Learnings).

---

## Resolved by the Migration

- **Static site migration** — complete, tested, live.
- **Iframe-fighting CSS removed** — the `!important`-laden layout reset block
  existed solely to fight the GAS iframe sandbox. Gone; replaced with plain
  flexbox in `css/styles.css`.
- **Chunked-cache silent-failure bug class eliminated by construction** — no
  server round-trip at all anymore, so the class of bug can't recur.
- **Server-side PDF generation replaced** — `print.js` opens the imposed A4
  sheet in a new tab and calls `window.print()`; "Save as PDF" via the
  browser's native print dialog covers file-saving without a client-side PDF
  library dependency.
- **Duplicated `serverSideCompileToPrintSheet` / near-duplicate imposition
  logic** — moot; `Code.gs` no longer exists, only one `compileToPrintSheet`
  now, in `print.js`.
- **Rich-text styling via span-wrapping (fragile at scale)** — replaced
  entirely by **Quill**, storing content as a Delta rather than nested DOM
  spans. Quill lives in the sidebar only (`#quillEditorContainer`); canvas
  text elements are a read-only preview. `js/text-formatting.js`.
- **Font-size slider → dropdown** — standard sizes (8–96px), matched to
  Quill's registered size whitelist.
- **App renamed** to "Artist Card Creator" throughout.
- **Card-size groundwork laid** — `js/card-sizes.js` is the single source of
  truth for card dimensions (currently only `uk-eu` 85×55mm active).
  `print.js`'s imposition grid is calculated from the active size, not
  hardcoded — ready for the card-size-configuration backlog item without
  another print-logic rewrite.

---

## Bugs Found & Fixed During Testing (2026-08-30 – 2026-08-31)

A substantial rewrite surfaced real bugs, as expected. Documenting root
causes here since several point at general patterns worth watching for in
future work on this codebase, not just one-off fixes.

- **Alignment not visible on canvas/print** — Quill's default `align` format
  is class-based (`ql-align-center`), and that class is only styled *inside*
  Quill's own stylesheet, scoped to `.ql-editor`. Copying the HTML out to the
  canvas preview (outside `.ql-editor`) meant the class had no matching CSS
  anywhere. Fixed by swapping to Quill's style-based `align` attributor
  (`attributors/style/align`), baking alignment in as inline `text-align`
  CSS instead — portable wherever the HTML ends up.
- **Font-family dropdown had no effect** — same root cause as alignment:
  Quill's default `font` format is class-based with a tiny built-in whitelist
  (`serif`/`monospace` only), silently rejecting anything else. Fixed with
  the style-based `attributors/style/font` attributor instead.
- **Font-family dropdown showed blank for earlier-applied (non-most-recent)
  fonts** — browsers don't always preserve inline `font-family` strings
  verbatim on read-back (quote handling can differ), so exact string
  comparison against dropdown option values could silently fail to match
  anything. Fixed with normalized (quote/whitespace-insensitive) matching —
  `normalizeFontFamilyValue`/`setFontFamilySelectValue` in
  `text-formatting.js`.
- **Font/size/color/bold/italic/underline/alignment controls didn't reflect
  the actual cursor position** — these were only ever set once, when an
  element was first selected, from its whole-element default style; nothing
  updated them as the cursor moved through differently-formatted text. Fixed
  by syncing all of them live on Quill's `selection-change` event
  (`syncToolbarToSelection`), including toggling `.active` on the
  bold/italic/underline/alignment buttons.
- **Arrow-key nudge silently did nothing after editing text** — clicking a
  canvas element to reposition it calls `preventDefault()` on the mousedown
  (needed to suppress default text-selection during drag), which *also*
  blocks the browser's default behavior of blurring whatever was previously
  focused. If Quill (or any sidebar control — same bug, not Quill-specific)
  still held focus from an earlier interaction, arrow keys kept going there
  instead of nudging the element. Fixed with an explicit
  `releaseFocusForCanvasInteraction()` blur, called at the start of every
  drag/resize/deselect interaction (`main.js`). A visible highlight
  (`.quill-editing-active` class + border/shadow) and a persistent hint line
  were also added under the Quill box so the "which mode am I in" state is
  visible, not just fixed.
- **Double-clicking a text element didn't visibly focus Quill** — calling
  `quill.focus()` immediately after switching the sidebar panel from
  `display:none` to `display:block` in the same synchronous script run can
  silently fail in some browsers; the layout change needs a moment to take
  effect first. Fixed by deferring the focus call one frame via
  `requestAnimationFrame`.
- **Undo/redo never touched the background** — `pushHistory`/`loadHistory`
  only ever snapshotted `state.elements`; `state.background` (color,
  gradient, image, fade) wasn't part of the history model at all. This also
  meant the background-fade overlay `<div>` was silently deleted on every
  undo (the cleanup loop removes any canvas child that isn't the safe-zone/
  guides layer, which unintentionally included it) and never recreated until
  the next background edit. Fixed by including `state.background` in every
  history snapshot, and refactoring background application into two
  reusable pieces: `applyBackgroundToDOM()` (DOM only, no history push) and
  `syncBackgroundControlsToState()` (sidebar controls + DOM, including the
  gradient-string reverse-engineering regex) — both now shared correctly by
  `loadHistory`, `loadStateFromDisk`, and normal user-driven background
  edits, rather than three separate copies of similar logic.
- **Background fade lost specifically on save/reload** (a variant of the bug
  above) — `loadStateFromDisk` was calling the background-restoring sync
  *before* its own canvas-children cleanup loop, which then deleted the
  fade-overlay div the sync had just created. Fixed by reordering: cleanup →
  render elements → restore background, not the other way round.
- **"Invalid CSS colour" console error after undo, following gradient
  eyedropper use** — turned out to be the same background-history gap above;
  resolved as part of that fix. Confirmed non-reproducing after.
- **Save As showed a second, different save dialog, and cancelling it could
  leave the file empty/corrupted** — `createWritable()` (File System Access
  API) truncates the target file immediately, *before* any actual write
  happens. The original save logic fell back to a completely different save
  mechanism (plain blob download) on any non-`AbortError` failure — but if
  that failure happened *after* `createWritable()` had already truncated the
  file, and the user then cancelled the fallback's dialog, the file was left
  permanently empty. Root cause of the failure itself, when actually hit
  during testing, was a `NotAllowedError` — specific to running in VS Code's
  built-in dev browser, which doesn't support the File System Access API's
  write-permission model even though its picker dialog appears to work; not
  expected to affect real users in a normal browser tab. Fixed regardless of
  environment: the save logic now distinguishes failures *before* the
  writable stream opens (nothing touched yet, safe to fall back to a plain
  download quietly) from failures *after* it opens (file already truncated —
  surfaces a clear warning instead of silently chaining into a second,
  differently-behaved save flow).
- **Touch/tablet input didn't work at all (tested on iPad)** — drag/resize
  logic was built entirely on mouse events (`mousedown`/`mousemove`/
  `mouseup`), which don't fire reliably for touch-driven interactions in
  Safari/iOS. Converted every drag/resize/deselect listener to **Pointer
  Events** (`pointerdown`/`pointermove`/`pointerup`), which unify mouse,
  touch, and pen input, plus added `touch-action: none` CSS on
  `.design-element`/`.resize-handle` specifically (not the wider workspace,
  which still allows normal touch-scroll/pinch-zoom when not interacting
  with an element) so the browser doesn't intercept a touch-drag as a page
  gesture instead of passing it to the app.

---

## Backlog

### High Priority — next up: shapes
- [ ] **New feature: drag-and-drop shapes.** Add shape elements (line,
      rectangle, ellipse, triangle now; polygon and star planned later) that
      can be placed on the card alongside text and image elements, with
      move/resize interactions consistent with the app's existing
      conventions. **Design work is largely done (see below) — next session
      starts implementation, in dependency order similar to the migration
      itself.**

      **Design decisions made (2026-08-30 sketch session):**
      - **Per-shape-kind geometry, not one shared bounding box.** Each
        `shapeKind` stores its own natural geometry field set rather than
        forcing every shape through `x, y, width, height`:
        - `line`: `x1, y1, x2, y2` — explicit endpoints, no bounding box.
        - `rectangle` / `ellipse` / `triangle`: `x, y, width, height` — this
          genuinely is their natural geometry.
        - Future `star` / `polygon`: also box-based (`x, y, width, height`),
          with vertices derived from independent `rx = width/2, ry = height/2`
          — **not** a single shared radius. A single-radius model was the
          original sketch but was corrected once considered properly: it can
          only scale uniformly and can't express "wider than tall" at all.
          `rx`/`ry` lets polygon/star reuse the exact same 4-corner-handle
          resize as rectangle/ellipse, with **Shift constraining `rx = ry`**
          for a "regular" symmetric shape — same pattern as square/circle.
      - **Net result: geometry only splits into two kinds** — **box-based**
        (rectangle, ellipse, triangle, future polygon/star — one shared
        4-corner resize + optional Shift-constrain) and **endpoint-based**
        (line — its own 2-handle resize). A third "center+radius, single
        handle" category was sketched initially and found unnecessary.
      - **The `.design-element` wrapper div's bounding box is derived, not
        authoritative**, for any non-box shape (lines, and eventually
        polygon/star's individually-dragged vertex mode below) — e.g. a
        line's wrapper box is the min/max of its two endpoints. Keeps the
        existing layering/click-handling/selection machinery unchanged for
        every shape kind.
      - **Independently draggable vertices (polygon/star):** rather than only
        symmetric box-corner resize, individual vertices should be directly
        draggable for custom/irregular shapes — reuses the same "drag this
        one point" mechanism the line needs for its endpoints, generalized
        from 2 points to N. Concretely:
        - Polygon/star store an explicit `points: [{x,y}, ...]` array once
          any vertex has been custom-dragged (like the line's endpoints,
          generalized), rather than being purely formula-derived at render
          time.
        - One handle per vertex, looped rather than a fixed set of 4.
        - Dragging a **corner** (bounding-box resize) regenerates *all*
          points fresh from the `rx/ry` formula — discards custom vertex
          tweaks, "resets to regular."
        - Dragging an **individual vertex handle** mutates just that one
          point.
        - No separate "regular vs. custom" mode flag needed — one data
          structure, two edit gestures on it.
      - **Configurable vertex/side count:** a "Sides" dropdown in
        `shapePropertiesGroup` when a polygon/star is selected, sensible
        presets (3, 4, 5, 6, 7, 8, 10, 12). Changing it is a third trigger
        for the same "regenerate all points from formula" path used by
        corner-resize. For star specifically, likely also want an
        inner-radius-ratio control (how deep the notches cut) as a second
        dropdown with presets (e.g. 30/40/50/60%) rather than a slider.
      - **Circle vs. ellipse:** one shape type (`ellipse`), not two — free
        resize by default, Shift constrains to a true circle.
      - Rotation is a separate future concern from resize, not designed, not
        currently planned.

      **Still to design:**
      - Rendering as SVG (one `<svg>` per shape element, inside the existing
        `.design-element` wrapper) — chosen over CSS-shape hacks for crisp
        resizing, real stroke control, and because triangles are trivial as
        an SVG `<polygon>` but awkward in pure CSS.
      - Style fields: `fill`, `fillEnabled` (lines have none), `stroke`,
        `strokeWidth`, `strokeEnabled`. New `shapePropertiesGroup` sidebar
        panel — fill swatch picker (hidden for lines), stroke swatch picker,
        stroke width as a small dropdown (not a slider), reusing the
        existing palette-swatch UI pattern.
      - Toolbar UI: a row of shape-icon buttons in the "Add Elements"
        accordion rather than a single "Add Shape" button.
      - `print.js` needs a shape-rendering branch emitting the same SVG
        markup, scaled via the existing px-to-mm factor.
      - Smart-guides/snapping: box-shaped shapes should fall out for free;
        line endpoint snapping needs explicit thought since there's no
        width/height to snap against.
- [ ] **Self-host fonts** — `fonts/` directory exists but is empty. Pick a
      font set, download `.woff2` files, add `@font-face` rules to
      `css/styles.css`, update the `#propFontFamily` dropdown + Quill's
      `font` format whitelist to match.

### Medium Priority
- [ ] **Card size configuration.** `card-sizes.js` has the data model; needs
      a size-selector UI (Canvas Settings accordion) calling
      `setCurrentCardSize()`, plus wiring it to actually resize
      `.canvas-container` and trigger a re-layout — currently only stores
      the selection.
- [ ] General styling/UX polish pass (e.g. Quill's default snow-theme visual
      details vs. the app's existing design language) — nothing specific
      flagged, just worth a look once shapes land.

---

## Key Learnings & Principles

- `document.execCommand` is unreliable for partial text selection formatting;
  even a hand-rolled Range-based approach doesn't scale to many overlapping
  styles. A proper data-model rich text editor (Quill) avoids the problem at
  the root.
- Image compression must happen at upload time, not just display/render time.
- Silent failure modes in server-side processing are worth surfacing
  proactively — or better, eliminated by removing the server round-trip that
  created the failure mode in the first place.
- Much of the old CSS/architecture complexity stemmed from fighting the GAS
  iframe sandbox rather than the app's actual requirements.
- Plain `<script>` tags sharing a global lexical scope is a legitimate
  lightweight alternative to ES modules for a project this size.
- Sliders are a poor fit for controls needing precise, specific values
  (font size, stroke width, vertex count) — a dropdown of sensible presets
  is easier to use accurately. Applied consistently across the app.
- **Classic-script forward references are only safe inside function bodies
  invoked later — never in a top-level statement that runs immediately at
  script load.** Caused two real bugs (`propInputs` in `text-formatting.js`,
  `printBtn` in `print.js`, both referencing a `main.js` declaration that
  hadn't run yet). Rule: any bare `document.getElementById(...)
  .addEventListener(...)` at a file's top level needs its element declared
  earlier *in that same file*.
- Quill's default formats (`font`, `align`) are often class-based with tiny
  built-in whitelists, scoped to `.ql-editor` in Quill's own CSS — they can
  silently no-op (wrong value) or have no visible effect outside Quill's own
  container (right value, no matching CSS elsewhere) with no error either
  way. The style-based attributor variants (`attributors/style/*`) avoid
  both problems by applying inline CSS directly, portable anywhere the HTML
  ends up. Used for `size`, `font`, and `align`; worth defaulting to for any
  future Quill format too.
- Calling `.focus()` immediately after changing an ancestor from
  `display:none` to `display:block` in the same synchronous script run can
  silently fail in some browsers — defer by one frame
  (`requestAnimationFrame`) when focusing something whose container was just
  revealed.
- A control retaining browser focus after interaction (Quill, but just as
  much any `<input>`/`<select>`) can silently break *other* keyboard
  behavior elsewhere in the app (arrow-key nudge) with no visible error —
  worth an explicit, general "release focus" step at the start of any
  unrelated interaction, not a fix scoped to whichever control was noticed
  first.
- File System Access API's `createWritable()` truncates the target file
  immediately, before any write occurs — a failure after that point can't be
  silently retried via a different save mechanism without real data-loss
  risk if the retry isn't completed. Distinguish "failed before touching the
  file" (safe to quietly fall back) from "failed after truncation started"
  (must warn explicitly) rather than treating all failures the same way.
- Restricted/embedded browser contexts (e.g. VS Code's built-in dev browser)
  can fail File System Access API permission checks (`NotAllowedError`) even
  though the picker dialog itself appears to work — not a bug in the app,
  worth testing save/load in a real standalone browser tab, not just an
  embedded dev preview.
- Drag/resize built on mouse events alone won't work on touch devices;
  Pointer Events are the standard unification (mouse/touch/pen), but mixing
  mouse and pointer listeners on the same interaction risks double-firing,
  since pointer-event-supporting browsers also synthesize the legacy mouse
  events afterward for compatibility — convert fully, not partially.

## Tools & Resources
- **Quill** (rich text editor, sidebar-only, headless toolbar wired to
  existing UI buttons) — `js/text-formatting.js`
- Canvas API (image resampling/compression) — `js/elements.js`
- GitHub Pages (live: `uskfarnham.github.io/artist-card-creator/`)
- Pointer Events (drag/resize/touch support) — `js/drag-resize.js`

## Parked Ideas (not on the backlog, noted for later)
- Client-side PDF library (jsPDF/html2pdf.js) for a true one-click PDF
  download without the browser print dialog, if the print-dialog UX ever
  feels clunky in practice. Current approach (open tab + `window.print()`,
  "Save as PDF" via the browser's native dialog) was chosen as the
  lower-risk path for now.