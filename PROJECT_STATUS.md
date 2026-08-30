# Project Status — Artist Card Creator
*(renamed from "Business Card Creator")*

_Last updated: 2026-08-30_

---

## Current State

**Migration to a static site is code-complete but UNTESTED.** The app has been
rewritten from Google Apps Script (`Code.gs` + `Index.html`, ~1900 lines) to a
standalone static site intended for GitHub Pages, hosted in its own repo under the
`uskfarnham` account (e.g. `uskfarnham.github.io/artist-card-creator/`).

### File structure (new)
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
machinery, as long as those references are only *resolved* at runtime (inside a
function body), not at file-load time.

### ⚠️ Needs real browser testing before trusting it
This was a substantial rewrite (contentEditable → Quill, server-side PDF →
client-side print, GAS → static). Suggested test order: create/drag/resize
elements → text formatting via Quill → background controls → save/load JSON →
print/PDF flow. **Re-update this file after testing** — some of the "Resolved"
items below are resolved *in design*, not yet confirmed working.

---

## Resolved by the Migration

- **Static site migration** — complete (pending testing). No more Apps Script,
  no `HtmlService`, no iframe. `index.html` + `css/styles.css` + `js/*.js`, plain
  files, git-based deploy to GitHub Pages.
- **Iframe-fighting CSS removed** — the `!important`-laden layout reset block
  (`.app-container`, `.main-body` locked to 100vw/100vh) existed solely to fight
  the GAS iframe sandbox. Gone; replaced with plain flexbox in `css/styles.css`.
- **Chunked-cache silent-failure bug class eliminated by construction** — not
  patched, structurally impossible now. The old flow uploaded compressed images
  to `CacheService` in 50KB chunks (`registerPrintCacheSegment`) and reassembled
  them server-side, silently skipping any missing chunk. The new `print.js`
  builds the imposed HTML entirely client-side (images already live as
  compressed base64 in memory) — no upload, no chunking, no cache, no server
  round-trip at all.
- **Server-side PDF generation replaced** — `compileImposedPdfFromPayload`
  (`HtmlService.getAs('application/pdf')` + Drive upload) is gone. `print.js`
  now opens the imposed A4 sheet in a new tab and calls `window.print()`
  (the original pre-GAS approach, restored). Every major browser's print
  dialog offers "Save as PDF" as a destination, so file-saving still works
  without a client-side PDF library dependency.
- **Duplicated `serverSideCompileToPrintSheet` in `Code.gs`** — moot; `Code.gs`
  no longer exists.
- **Near-duplicate imposition logic (server vs. client)** — moot for the same
  reason; only one `compileToPrintSheet` now, in `print.js`.
- **Dead/commented-out code cleanup** — done as part of the rewrite; nothing
  carried over verbatim, each file was reconstructed clean.
- **Rich-text styling via span-wrapping (fragile at scale)** — replaced
  entirely. The old `extractContents()`/`insertNode()` DOM-span approach is
  gone; **Quill** now handles all rich text editing, storing content as a
  Delta (data model) rather than nested DOM spans, so overlapping styles
  (bold one word, italic another, differing colors, etc.) no longer produce
  span soup. Quill lives in the sidebar only (`#quillEditorContainer`); canvas
  text elements are a read-only preview. See `js/text-formatting.js`.
- **Font-size slider → dropdown** — the numeric slider was fiddly for precise
  selection; replaced with a `<select>` of standard sizes (8–96px), matched
  exactly to Quill's registered size whitelist.
- **App renamed** to "Artist Card Creator" throughout (title, brand text, saved
  file name `artist_card_design.json`, code comments).
- **Card-size groundwork laid** — new `js/card-sizes.js` is the single source of
  truth for card dimensions (currently only `uk-eu` 85×55mm is active).
  `print.js`'s imposition grid (cards per row/column, crop marks) is now
  *calculated* from the active card size rather than hardcoded to 2×5 — produces
  an identical layout today, but the medium-priority "card size configuration"
  backlog item below only needs a size-selector UI and canvas-dimension wiring
  now, not a print-logic rewrite too.

---

## Backlog

### High Priority
- [ ] **Test the migration thoroughly** (see test order above) before relying
      on this as the working version. Confirm: element drag/resize/snap, Quill
      formatting (including overlapping styles — the original motivating bug),
      background controls, save/load round-trip, print/PDF output on at least
      one real printer or print-to-PDF check against actual mm measurements.
- [ ] **New feature: drag-and-drop shapes.** Add shape elements (line, rectangle,
      ellipse, triangle now; polygon and star planned later) that can be placed
      on the card alongside text and image elements, with move/resize
      interactions consistent with the app's existing conventions.

      **Design decisions made (2026-08-30 sketch session):**
      - **Per-shape-kind geometry, not one shared bounding box.** Each
        `shapeKind` stores its own natural geometry field set rather than
        forcing every shape through `x, y, width, height` — avoids shoehorning
        shapes whose natural representation doesn't fit a box (a line is two
        points, not a box with a diagonal drawn in it):
        - `line`: `x1, y1, x2, y2` — explicit endpoints, no bounding box stored.
        - `rectangle` / `ellipse` / `triangle`: `x, y, width, height` — this
          genuinely is their natural geometry, so a bounding box is the right
          fit here, not a compromise.
        - Future `star` / `polygon`: box-based like ellipse — `x, y, width,
          height`, with vertices derived from independent `rx`/`ry` rather
          than a single radius (see the resize-behavior correction below for
          why). Not designed in full detail yet (vertex count, inner-radius
          ratio for the star specifically), but the geometry family is settled.
      - **The `.design-element` wrapper div's bounding box is derived, not
        authoritative**, for any shape whose real geometry isn't box-shaped
        (i.e. lines now, center+radius shapes later). E.g. a line's wrapper
        box is computed as the min/max of its two endpoints. This keeps the
        existing layering/click-handling/selection-styling machinery working
        unchanged for every shape kind, while the source of truth for "what
        does this shape actually look like" stays in the shape-specific fields.
      - **Resize interaction varies by geometry kind, not by individual shape**
        — `drag-resize.js` needs a small dispatch by geometry kind rather than
        one universal resize path:
        - **Line** (2 endpoints): exactly two handles, one per endpoint;
          dragging either one moves that point directly. This is a new
          resize mode alongside the existing 4-corner-handle one.
        - **Box shapes** (rectangle, ellipse, triangle): reuse the existing
          4-corner-handle resize as-is, free (non-aspect-locked) by default.
          **Holding Shift constrains width=height** (square for rectangle,
          circle for ellipse) — one shared constraint helper for both, rather
          than duplicated logic. Triangle: free resize only for now; an
          equilateral-triangle Shift-constraint is a possible future nicety,
          not decided.
        - **Design correction (same session):** originally sketched
        polygon/star as `cx, cy, radius` with a single radius-drag handle —
        but a single scalar radius can only scale uniformly, so it can't
        express "wider than tall" at all. Corrected to: polygon/star should
        be **box-based** like ellipse, parameterized as `x, y, width, height`
        with vertices computed from independent `rx = width/2, ry = height/2`
        (i.e. `(cx + rx·cos θ, cy + ry·sin θ)` per vertex) rather than one
        shared radius. This means polygon/star reuse the *same* 4-corner-handle
        resize as rectangle/ellipse — dragging a corner stretches `rx`/`ry`
        independently for intentional distortion (a tall narrow star, a
        squashed pentagon), and **Shift constrains `rx = ry`** for a "regular"
        symmetric shape, exactly like the square/circle constraint above.
      - **Net result: geometry only splits into two kinds, not three** —
        **box-based** (rectangle, ellipse, triangle, and future polygon/star,
        all sharing one 4-corner resize + optional Shift-constrain
        implementation) and **endpoint-based** (line, with its own 2-handle
        resize). The earlier "center+radius, single handle" category turned
        out to be unnecessary once the distortion requirement was considered
        — simpler than originally sketched, not more complex.
      - Rotation (e.g. spinning a star to a different point angle) is a
        separate future concern from resize — would be an optional additional
        handle layered on top of whichever resize model applies, not a change
        to the model itself. Not designed, not currently planned.
      - **Circle vs. ellipse**: one shape type (`ellipse`), not two — free
        resize by default, Shift constrains to a true circle. Avoids a
        separate `circle` type with its own permanently-locked aspect ratio
        to maintain alongside `ellipse`.

      **Still to design:**
      - Rendering as SVG (one `<svg>` per shape element, inside the existing
        `.design-element` wrapper) — chosen over CSS-shape hacks for crisp
        resizing, real stroke control, and because triangles are trivial as
        an SVG `<polygon>` but awkward in pure CSS.
      - Style fields: `fill`, `fillEnabled` (lines have none; closed shapes may
        want a "no fill" outline-only option), `stroke`, `strokeWidth`,
        `strokeEnabled`. Sidebar needs a new `shapePropertiesGroup` — fill
        swatch picker (hidden for lines), stroke swatch picker, stroke width
        as a small dropdown (not a slider — same reasoning as the font-size
        control), reusing the existing palette-swatch UI pattern throughout.
      - Toolbar UI: a row of shape-icon buttons in the "Add Elements"
        accordion (one per shape kind) rather than a single "Add Shape" button.
      - `print.js` needs a shape-rendering branch emitting the same SVG
        markup, scaled via the existing px-to-mm factor — should be simpler
        than the image path since SVG has no resolution/compression concerns.
      - Smart-guides/snapping: box-shaped shapes should fall out for free
        (same `x/y/width/height` the snap engine already expects); line
        endpoint snapping will need explicit thought since there's no
        width/height to snap against.
- [ ] **Self-host fonts** — `fonts/` directory exists but is empty. Pick a font
      set (candidates: reuse the current dropdown list, or expand it now that
      Google Fonts are usable), download `.woff2` files, add `@font-face` rules
      to `css/styles.css`, and update the `#propFontFamily` dropdown options
      + Quill's `font` format whitelist to match.

### Medium Priority
- [ ] **Card size configuration.** `card-sizes.js` has the data model; needs a
      size-selector UI (Canvas Settings accordion is the natural home) that
      calls `setCurrentCardSize()`, plus wiring that selector to actually
      resize `.canvas-container` and trigger a re-layout — `setCurrentCardSize`
      currently only stores the selection, per its own code comment.
- [ ] Placeholder for any styling/UX polish once real testing surfaces issues
      (e.g. Quill's default snow-theme visual details vs. the app's existing
      design language).

---

## Key Learnings & Principles

- `document.execCommand` is unreliable for partial text selection formatting in
  current browsers, and even a hand-rolled Range-based
  `extractContents()`/`insertNode()` approach doesn't scale cleanly to many
  overlapping styles. A proper data-model-based rich text editor (Quill) avoids
  the problem at the root rather than patching around it.
- Image compression must happen at upload time, not just display/render time —
  constraining display dimensions alone doesn't reduce the actual data payload.
- Silent failure modes in server-side processing (e.g. missing cache entries)
  are worth surfacing proactively — or better, eliminated by removing the
  server round-trip that created the failure mode in the first place.
- Much of the old CSS/architecture complexity stemmed from fighting the GAS
  iframe sandbox rather than the app's actual requirements — confirmed once
  removed: the layout code is now substantially simpler with no behavior loss.
- Plain `<script>` tags across files sharing a global lexical scope is a
  legitimate lightweight alternative to ES modules for a project this size —
  avoids build-step/bundler complexity while still allowing a clean file split.
- Sliders are a poor fit for controls needing precise, specific values (font
  size); a dropdown of sensible presets is easier to use accurately.

## Tools & Resources
- **Quill** (rich text editor, sidebar-only, headless toolbar wired to existing
  UI buttons) — `js/text-formatting.js`
- Canvas API (image resampling/compression) — `js/elements.js`
- GitHub Pages (static hosting target, own repo under `uskfarnham`)
- jsdom (previously used for simulating/isolating client-side bugs pre-migration)

## Parked Ideas (not on the backlog, noted for later)
- Client-side PDF library (jsPDF/html2pdf.js) for a true one-click PDF download
  without the browser print dialog, if the print-dialog UX ever feels clunky in
  practice. Current approach (open tab + `window.print()`, "Save as PDF" via the
  browser's native dialog) was chosen as the lower-risk path for now.
