# Project Status — Artist Card Creator
*(renamed from "Business Card Creator")*

_Last updated: 2026-08-29_

---

## Current State

The app is a browser-based card design tool, currently deployed as a Google Apps Script
(`Code.gs` + `Index.html`, ~1900 lines). It was originally migrated from a single-page
app architecture, and is now being considered for migration back.

### Recently Fixed
- **Text formatting bug** — commented-out font-family listener + deprecated
  `document.execCommand` usage. Replaced with a unified Range-based
  `extractContents()`/`insertNode()` approach for bold/italic/underline, consistent
  with how font size/color already worked.
- **PDF generation failing on large images** — imposition layout was embedding
  full uncompressed base64 image data 10x across the A4 sheet, exceeding HTML-to-PDF
  size limits. Fixed with `compressImageForCard()`: canvas-based resampling at upload
  time, longest edge capped at 1000px, 85% JPEG quality.

---

## Decision Point: Static Site Migration

**Proposal:** move from Google Apps Script (iframe-hosted) to a static site on GitHub
Pages, following the pattern used for the Exhibition Portal project. Return to a
vanilla JS SPA served directly, rather than through `HtmlService`.

### Pros
- **No more iframe/CORS fighting.** Removes the need for the `!important`-laden CSS
  reset block (`.app-container`, `.main-body` locked to 100vw/100vh) that exists
  solely to fight the GAS iframe sandbox.
- **Google Fonts (or any web fonts) work normally.** No CORS/sandbox restriction —
  can use a standard `<link>` tag, or self-host `.woff2` files in the repo. Self-hosting
  is actually the more robust option, since it also guarantees the fonts render
  correctly in the printed PDF (cross-origin fonts can be unreliable there).
- **Eliminates the chunked-cache bug class entirely.** The 50KB chunking dance
  (`registerPrintCacheSegment` + chunk reassembly) exists only to work around
  `CacheService`'s per-key size limits. Client-side, compressed images can just
  stay in memory — no chunking, no TTL, no silent-failure risk on missing segments.
- **Simpler URL, simpler deploy** (git push vs. clasp/Apps Script editor).

### Cons / What Needs Replacing
- **Server-side PDF generation is lost.** `compileImposedPdfFromPayload()` currently
  uses `HtmlService.getAs('application/pdf')` — real server compute, which static
  hosting can't do. Two options:
  1. **Revert to open-in-new-tab + `window.print()`.** Code already exists for this
     (`compileToPrintSheet()` and the commented-out vanilla path) — this used to work
     fine before the GAS migration. Zero new dependencies.
  2. **Client-side PDF library** (jsPDF / html2pdf.js) for a real downloadable file
     without the print dialog. More polished, but adds a dependency and rasterization
     can be finicky against the precise mm-based imposition layout.
  - **Leaning toward option 1** as the lower-risk path — reverting to code that's
    already written and previously worked, revisit jsPDF later if UX feels clunky.
- **Drive auto-storage/sharing link goes away.** Low impact — save/load already uses
  local file download (`showSaveFilePicker`/blob), so PDF export would just follow
  the same pattern.

### Status: **Under consideration** — not yet started. Decide before starting the
HtmlService include-based file split (see below), since the migration would replace
that approach entirely (real separate .css/.js/.html files instead of Apps Script
includes).

---

## Backlog

### High Priority
- [ ] **Static site migration** (see above) — architectural decision needed before
      other refactoring work proceeds, since it changes the target structure.
- [ ] **Silent failure in chunk reassembly** — `compileImposedPdfFromPayload()`
      silently skips missing cache chunks rather than surfacing an error. Only
      relevant if staying on Apps Script; moot if migrating to static/client-side
      image handling.
- [ ] **Rich-text styling via span-wrapping is fragile at scale.** The current
      `extractContents()`/`insertNode()` approach works well for simple cases (single
      style applied to one selection) but produces messy, deeply nested/overlapping
      spans when multiple styles are applied to different overlapping word
      combinations within the same text box. This is a realistic use case — artists
      experimenting with mixed emphasis (e.g. bold one word, italic another,
      underline a third, differing colors) will hit this often. Needs a more robust
      model — likely tracking styled ranges as data (not nested DOM spans) and
      re-rendering from that model, similar to how rich text editors (e.g.
      ProseMirror/Slate-style range models) avoid span soup. Needs design work before
      implementation.
- [ ] **Rename app** from "Business Card Creator" to "Artist Card Creator" —
      title tag, `.brand-title`, PDF filename references, any other UI copy.

### Medium Priority
- [ ] **Card size configuration.** Currently hardcoded to UK/EU standard 85x55mm
      (baked into `--card-width`/`--card-height` CSS vars, the `321px`/`208px` canvas
      pixel baseline, and the A4 imposition grid math in `compileToPrintSheet`).
      Placeholder to add a card-size selector (e.g. US 89x51mm, square, EU, custom)
      that drives the canvas dimensions, px-to-mm conversion factor, and imposition
      layout grid together. Needs a single source of truth for size rather than
      values scattered across CSS and JS.
- [ ] Codebase restructuring: separate CSS/JS/HTML (approach depends on migration
      decision above — `HtmlService` includes if staying on GAS, real files if going
      static).
- [ ] Duplicated `serverSideCompileToPrintSheet` function in `Code.gs` (only
      relevant if staying on Apps Script).
- [ ] Near-duplicate imposition logic split between server (`Code.gs`) and client
      (`compileToPrintSheet` in `Index.html`).
- [ ] Dead/commented-out code cleanup in `Index.html`.

---

## Key Learnings & Principles

- `document.execCommand` is unreliable for partial text selection formatting in
  current browsers; a Range-based `extractContents()`/`insertNode()` approach is more
  robust — but doesn't scale cleanly to many overlapping styles (see backlog above).
- Image compression must happen at upload time, not just display/render time —
  constraining display dimensions alone doesn't reduce the actual data payload.
- Silent failure modes in server-side processing (e.g. missing cache entries) are
  worth surfacing proactively — they're difficult to debug after the fact.
- Much of the current CSS/architecture complexity stems from fighting the GAS iframe
  sandbox rather than the app's actual requirements — worth questioning whether that
  constraint is still needed each time it comes up.

## Tools & Resources
- Google Apps Script (`HtmlService`, server-side caching) — under review
- Canvas API (image resampling/compression)
- jsdom (simulating/isolating client-side bugs)
- GitHub Pages (candidate target for static hosting, per Exhibition Portal precedent)
