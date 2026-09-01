/**
 * print.js
 * ---------------------------------------------------------------------------
 * Compiles the current design into an imposed A4 print sheet and opens it
 * in a new tab, triggering the browser's native print dialog.
 *
 * WHAT CHANGED FROM THE APPS SCRIPT VERSION:
 * The old flow uploaded compressed images to CacheService in 50KB chunks
 * (registerPrintCacheSegment), reassembled them server-side
 * (compileImposedPdfFromPayload in Code.gs), and used HtmlService's
 * getAs('application/pdf') to produce a real server-generated PDF saved to
 * Drive. None of that exists on a static site — no server compute, no
 * chunking, no cache, no silent-failure risk on missing chunks (that whole
 * bug class from PROJECT_STATUS.md is gone by construction).
 *
 * Instead: build the imposed HTML client-side (images already live as
 * compressed base64 data URIs in memory — no upload needed), open it in a
 * new tab, and call window.print() once it loads. Every major browser's
 * print dialog offers "Save as PDF" as a destination, so this covers both
 * "print it" and "save it as a PDF file" without adding a client-side PDF
 * library. This is the same approach the app used before the Apps Script
 * migration (the code below is that original vanilla path, restored).
 *
 * CARD SIZE: uses getCurrentCardSize()/getPxToMmFactor() from
 * card-sizes.js instead of a hardcoded 85x55mm/321px baseline, and
 * calculates the imposition grid (cards per row/column) dynamically from
 * the card's real-world mm dimensions rather than a fixed 2x5 grid. For
 * the current UK/EU-only setup this produces the identical 2x5 layout as
 * before; it's forward-looking for when card-sizes.js grows more options.
 * ---------------------------------------------------------------------------
 */

// Margin-squeeze constants for imposed-A4 mode (single-sheet mode bypasses
// this entirely — see below). MIN is a safe floor clear of typical printer
// unprintable-edge limits (~4-5mm); PREFERRED matches the original fixed
// 20mm/11mm layout, kept whenever squeezing wouldn't actually buy anything.
const MIN_MARGIN_MM = 8;
const PREFERRED_MARGIN_LEFT_MM = 20;
const PREFERRED_MARGIN_TOP_MM = 11;
const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;

// Generic over width OR height — pass the matching page/card/preferred-
// margin values. Only shrinks the margin as far as needed to fit one more
// card than the preferred margin would allow; never shrinks it further
// than that, and never below MIN_MARGIN_MM.
function fitAxis(pageMm, cardMm, preferredMarginMm) {
  const countAtPreferred = Math.max(1, Math.floor((pageMm - 2 * preferredMarginMm) / cardMm));
  const countAtMin = Math.max(1, Math.floor((pageMm - 2 * MIN_MARGIN_MM) / cardMm));

  if (countAtMin > countAtPreferred) {
    const neededMargin = (pageMm - countAtMin * cardMm) / 2;
    return { count: countAtMin, marginMm: Math.max(MIN_MARGIN_MM, neededMargin) };
  }
  return { count: countAtPreferred, marginMm: preferredMarginMm };
}

// Parses a CSS linear-gradient(...) string (as stored in state.background.value)
// into its angle and an ordered list of {color, offset%} stops. Generic over
// stop count so it works for both the 2-stop custom gradient builder and the
// 3-stop preset ("Soft Blush").
function parseLinearGradient(valueStr) {
  const angleMatch = valueStr.match(/linear-gradient\(\s*(\d+(?:\.\d+)?)deg\s*,\s*(.+)\)\s*$/i);
  if (!angleMatch) return null;

  const angleDeg = parseFloat(angleMatch[1]);
  const stopParts = angleMatch[2].split(',').map(s => s.trim());

  const stops = stopParts.map((part, i) => {
    const m = part.match(/^(#[0-9a-fA-F]{3,8})\s*(\d+(?:\.\d+)?)%?$/);
    if (m) return { color: m[1], offset: parseFloat(m[2]) };
    return { color: part, offset: (i / Math.max(1, stopParts.length - 1)) * 100 };
  });

  return { angleDeg, stops };
}

// Replicates the CSS linear-gradient angle-to-line algorithm for a specific
// box size (per the CSS Images spec) — needed because our cards are NOT
// square (85x55mm), and a plain SVG rotation assumes a square 0-1 bounding
// box, which does not match CSS's actual angle behavior on a rectangle.
function gradientAngleToLine(angleDeg, w, h) {
  const rad = (angleDeg * Math.PI) / 180;
  const length = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
  const cx = w / 2, cy = h / 2;
  const dx = Math.sin(rad) * (length / 2);
  const dy = -Math.cos(rad) * (length / 2);
  return { x1: cx - dx, y1: cy - dy, x2: cx + dx, y2: cy + dy };
}

function compileToPrintSheet(jsonLayoutState) {
  const cardSize = getCurrentCardSize();
  const pxToMmFactor = getPxToMmFactor();
  const isSingleSheet = cardSize.printMode === 'single-sheet';

  let cols, rows, marginLeftMm, marginTopMm, GRID_WIDTH_MM, GRID_HEIGHT_MM;

  if (isSingleSheet) {
    cols = 1; rows = 1;
    marginLeftMm = 0; marginTopMm = 0;
    GRID_WIDTH_MM = cardSize.widthMm;
    GRID_HEIGHT_MM = cardSize.heightMm;
  } else {
    const fitW = fitAxis(PAGE_WIDTH_MM, cardSize.widthMm, PREFERRED_MARGIN_LEFT_MM);
    const fitH = fitAxis(PAGE_HEIGHT_MM, cardSize.heightMm, PREFERRED_MARGIN_TOP_MM);
    cols = fitW.count; marginLeftMm = fitW.marginMm;
    rows = fitH.count; marginTopMm = fitH.marginMm;
    // Grid box now tightly wraps the actual cards (cols x rows), rather
    // than a fixed 170x275mm container with leftover unused space inside it.
    GRID_WIDTH_MM = cols * cardSize.widthMm;
    GRID_HEIGHT_MM = rows * cardSize.heightMm;
  }

  let cardInnerHtml = '';

  const sortedElements = [...jsonLayoutState.elements].sort((a, b) => a.zIndex - b.zIndex);

  sortedElements.forEach(el => {
    const leftMm = (el.x * pxToMmFactor).toFixed(4);
    const topMm = (el.y * pxToMmFactor).toFixed(4);
    const widthMm = (el.width * pxToMmFactor).toFixed(4);
    const heightMm = (el.height * pxToMmFactor).toFixed(4);

    if (el.type === 'text') {
      const s = el.style || {};
      const fontDecor = s.textDecoration || 'none';

      // Block-level style comes from el.style (set via the sidebar
      // font-family/color/align controls); any per-character overrides
      // (bold/italic/underline/size/color from Quill) are already baked
      // into el.content as inline <span>/<strong>/<em> markup, and take
      // precedence naturally via normal CSS cascade.
      cardInnerHtml += `
        <div style="
          position: absolute;
          left: ${leftMm}mm;
          top: ${topMm}mm;
          width: ${widthMm}mm;
          height: ${heightMm}mm;
          font-family: ${s.fontFamily || 'Arial, sans-serif'};
          font-size: ${s.fontSize || '14px'};
          font-weight: ${s.fontWeight || 'normal'};
          font-style: ${s.fontStyle || 'normal'};
          text-decoration: ${fontDecor};
          color: ${s.color || '#333333'};
          text-align: ${s.textAlign || 'left'};
          line-height: ${s.lineHeight || '1.2'};
          white-space: pre-wrap;
          word-wrap: break-word;
          overflow: hidden;
        ">${el.content}</div>`;

    } else if (el.type === 'image') {
      const src = el.src && el.src.trim() !== '' ? el.src : 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
      cardInnerHtml += `
        <img src="${src}" style="
          position: absolute;
          left: ${leftMm}mm;
          top: ${topMm}mm;
          width: ${widthMm}mm;
          height: ${heightMm}mm;
          object-fit: fill;
        " />`;
    }  else if (el.type === 'shape' && el.shapeKind === 'line') {
      // Lines have no width/height box — endpoints scale directly to mm,
      // and the whole element is positioned at 0,0 with the line drawn in
      // absolute sheet coordinates (simpler than replicating the padded
      // bounding-box math from getLineBoundingBox, which exists only to
      // give the ON-SCREEN wrapper div something to size itself to).
      const s = el.style || {};
      const sw = s.strokeEnabled ? (s.strokeWidth * pxToMmFactor) : 0;
      const strokeAttr = s.strokeEnabled ? s.stroke : 'none';
      const x1 = (el.x1 * pxToMmFactor).toFixed(4);
      const y1 = (el.y1 * pxToMmFactor).toFixed(4);
      const x2 = (el.x2 * pxToMmFactor).toFixed(4);
      const y2 = (el.y2 * pxToMmFactor).toFixed(4);

      cardInnerHtml += `
        <svg style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible;">
          <line x1="${x1}mm" y1="${y1}mm" x2="${x2}mm" y2="${y2}mm" stroke="${strokeAttr}" stroke-width="${sw}mm" stroke-linecap="round" />
        </svg>`;

    } else if (el.type === 'shape') {
      // Rectangle/ellipse/triangle — box-based, so this reuses the same
      // left/top/width/height mm values already computed above for
      // text/image. viewBox stays in the element's own px space (matches
      // buildShapeMarkup's coordinate system) and scales to the mm box via
      // width/height="100%", but stroke-width has to be pre-converted to mm
      // since SVG's own scaling doesn't know the target is millimeters.
      const s = el.style || {};
      const swPx = s.strokeEnabled ? s.strokeWidth : 0;
      const swMm = (swPx * pxToMmFactor).toFixed(4);
      const fillAttr = s.fillEnabled ? s.fill : 'none';
      const strokeAttr = s.strokeEnabled ? s.stroke : 'none';
      const insetPx = swPx / 2;
      const w = el.width, h = el.height;

      let shapeMarkup = '';
      if (el.shapeKind === 'rectangle') {
        shapeMarkup = `<rect x="${insetPx}" y="${insetPx}" width="${Math.max(0, w - swPx)}" height="${Math.max(0, h - swPx)}" fill="${fillAttr}" stroke="${strokeAttr}" vector-effect="non-scaling-stroke" />`;
      } else if (el.shapeKind === 'ellipse') {
        shapeMarkup = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${Math.max(0, w / 2 - insetPx)}" ry="${Math.max(0, h / 2 - insetPx)}" fill="${fillAttr}" stroke="${strokeAttr}" vector-effect="non-scaling-stroke" />`;
      } else if (el.shapeKind === 'triangle') {
        const points = `${w / 2},${insetPx} ${w - insetPx},${h - insetPx} ${insetPx},${h - insetPx}`;
        shapeMarkup = `<polygon points="${points}" fill="${fillAttr}" stroke="${strokeAttr}" stroke-linejoin="round" vector-effect="non-scaling-stroke" />`;
      }

      cardInnerHtml += `
        <svg style="position: absolute; left: ${leftMm}mm; top: ${topMm}mm; width: ${widthMm}mm; height: ${heightMm}mm;" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
          <style>* { stroke-width: ${swMm}mm; }</style>
          ${shapeMarkup}
        </svg>`;
    }
  });

  let cardBackgroundCss = 'background: #ffffff;';
  let overlayHtml = '';
  let gradientDef = null; // parsed once; a unique id is assigned per card below

  if (jsonLayoutState.background) {
    const bg = jsonLayoutState.background;
    const fadeOpacity = (bg.fade || 0) / 100;

    overlayHtml = `<div style="position: absolute; top:0; left:0; width:100%; height:100%; background:#ffffff; opacity:${fadeOpacity}; z-index:0; pointer-events:none;"></div>`;

    if (bg.type === 'image') {
      cardBackgroundCss = `background: ${bg.value}; background-size: cover; background-position: center;`;
    } else if (bg.type === 'gradient' || bg.type === 'custom-gradient') {
      // Rendered as a per-card inline SVG below instead of a shared CSS
      // background-image — see the loop below for why.
      gradientDef = parseLinearGradient(bg.value);
      cardBackgroundCss = 'background: #ffffff;'; // fallback if parsing ever fails
    } else {
      cardBackgroundCss = `background: ${bg.value};`;
    }
  }

  let cardsHtml = '';
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let backgroundLayer = '';

      if (gradientDef) {
        // Each card gets its OWN <linearGradient> id (cardGrad_R_C), even
        // though all instances are visually identical. Repeating the exact
        // same CSS gradient string across many tiled elements on one
        // printed page is the likely trigger for the faint per-card
        // banding reported (worse away from the first card, worse on dark
        // colors) — browsers can apply dithering that isn't fully
        // independent per element when the identical value repeats many
        // times on one render surface. A unique id forces an independent
        // paint per card, matching how shapes/lines (already per-card
        // inline SVG) don't show this issue.
        const gradId = `cardGrad_${row}_${col}`;
        const line = gradientAngleToLine(gradientDef.angleDeg, cardSize.widthMm, cardSize.heightMm);
        const stopsMarkup = gradientDef.stops
          .map(s => `<stop offset="${s.offset}%" stop-color="${s.color}" />`)
          .join('');

        backgroundLayer = `
          <svg style="position: absolute; top:0; left:0; width:100%; height:100%;" preserveAspectRatio="none">
            <defs>
              <linearGradient id="${gradId}" gradientUnits="userSpaceOnUse" x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}">
                ${stopsMarkup}
              </linearGradient>
            </defs>
            <rect x="0" y="0" width="${cardSize.widthMm}mm" height="${cardSize.heightMm}mm" fill="url(#${gradId})" />
          </svg>`;
      }

      cardsHtml += `
        <div style="position: absolute; left: ${col * cardSize.widthMm}mm; top: ${row * cardSize.heightMm}mm; width: ${cardSize.widthMm}mm; height: ${cardSize.heightMm}mm; overflow: hidden; ${cardBackgroundCss}">
          ${backgroundLayer}
          ${overlayHtml}
          ${cardInnerHtml}
        </div>`;
    }
  }

// Crop marks only mean something when multiple cards share one sheet —
  // in single-sheet mode the card's own edge already is the cut line, so
  // marks would just be redundant lines sitting on the page border.
  let cropMarksHtml = '';
  if (!isSingleSheet) {
    for (let c = 0; c <= cols; c++) {
      cropMarksHtml += `<div class="crop-mark-v" style="left: ${c * cardSize.widthMm}mm;"></div>`;
    }
    for (let r = 0; r <= rows; r++) {
      cropMarksHtml += `<div class="crop-mark-h" style="top: ${r * cardSize.heightMm}mm;"></div>`;
    }
  }

  const pageSizeCss = isSingleSheet ? `${cardSize.widthMm}mm ${cardSize.heightMm}mm` : 'A4';
  const sheetWidthMm = isSingleSheet ? cardSize.widthMm : PAGE_WIDTH_MM;
  const sheetHeightMm = isSingleSheet ? cardSize.heightMm : PAGE_HEIGHT_MM;
  const sheetPadTop = isSingleSheet ? 0 : marginTopMm;
  const sheetPadLeft = isSingleSheet ? 0 : marginLeftMm;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Print Sheet</title>
  <style>
    @page { size: ${pageSizeCss}; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #ffffff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .sheet {
      width: ${sheetWidthMm}mm;
      height: ${sheetHeightMm}mm;
      position: relative;
      page-break-inside: avoid;
      padding-top: ${sheetPadTop}mm;
      padding-left: ${sheetPadLeft}mm;
    }
    .grid { width: ${GRID_WIDTH_MM}mm; height: ${GRID_HEIGHT_MM}mm; position: relative; }
    .crop-mark-v { position: absolute; width: 0; border-left: 0.5pt dashed #999999; top: -5mm; bottom: -5mm; z-index: 9999; }
    .crop-mark-h { position: absolute; height: 0; border-top: 0.5pt dashed #999999; left: -5mm; right: -5mm; z-index: 9999; }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="grid">
      ${cropMarksHtml}
      ${cardsHtml}
    </div>
  </div>
  <script>
    if (document.readyState === 'complete') { window.print(); }
    else { window.addEventListener('DOMContentLoaded', () => window.print()); }
  <\/script>
</body>
</html>`;
}


const printBtn = document.getElementById('printBtn');

printBtn.addEventListener('click', () => {
  const html = compileToPrintSheet(state);

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Please allow pop-ups for this site to generate your print sheet.');
    return;
  }

  // Using a Blob URL rather than document.write() — cleaner for larger
  // HTML payloads (embedded base64 images) and avoids document.write()'s
  // deprecation warnings in modern browsers.
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  printWindow.location.href = url;

  // Revoke once the new tab has had time to load the blob. A fixed delay
  // is a little crude but reliable here — the tab only ever needs the URL
  // once, at initial load.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});