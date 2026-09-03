/**
 * print.js
 * ---------------------------------------------------------------------------
 * Compiles a card side's design into an imposed A4 print sheet and opens it
 * in a new tab, triggering the browser's native print dialog.
 *
 * STEP 5 of the front/back feature: two separate print actions now exist —
 * "Print Front" and "Print Back" — rather than one. Each opens its own tab,
 * matching a manual print-flip-reinsert-print workflow (or a duplex
 * printer's own manual-duplex driver mode), one physical pass at a time.
 *
 * DUPLEX ALIGNMENT: since every card ON a sheet is an identical repeated
 * copy of ONE design, reordering which grid cell holds which card has no
 * visual effect — there's no per-card "matching" to do. What DOES need to
 * align, for accurate cutting, is the grid's PHYSICAL POSITION on the page.
 * Flipping a sheet over its LONG edge (the standard duplex convention)
 * physically swaps left and right as the printer's second pass sees it — so
 * the back sheet's grid margin is measured from the opposite side of the
 * page (mirrorHorizontal), landing the grid in the same physical spot on
 * both sides once printed. Only meaningful in imposed-a4 mode; single-sheet
 * mode (e.g. 6x4) has no margin to mirror since the card fills the page.
 * ---------------------------------------------------------------------------
 */

const MIN_MARGIN_MM = 8;
const PREFERRED_MARGIN_LEFT_MM = 20;
const PREFERRED_MARGIN_TOP_MM = 11;
const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;

function fitAxis(pageMm, cardMm, preferredMarginMm) {
  const countAtPreferred = Math.max(1, Math.floor((pageMm - 2 * preferredMarginMm) / cardMm));
  const countAtMin = Math.max(1, Math.floor((pageMm - 2 * MIN_MARGIN_MM) / cardMm));

  if (countAtMin > countAtPreferred) {
    const neededMargin = (pageMm - countAtMin * cardMm) / 2;
    return { count: countAtMin, marginMm: Math.max(MIN_MARGIN_MM, neededMargin) };
  }
  return { count: countAtPreferred, marginMm: preferredMarginMm };
}

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

function gradientAngleToLine(angleDeg, w, h) {
  const rad = (angleDeg * Math.PI) / 180;
  const length = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
  const cx = w / 2, cy = h / 2;
  const dx = Math.sin(rad) * (length / 2);
  const dy = -Math.cos(rad) * (length / 2);
  return { x1: cx - dx, y1: cy - dy, x2: cx + dx, y2: cy + dy };
}

// jsonLayoutState: { elements, background } — from getSideSnapshot (card-sides.js).
// mirrorHorizontal: true for the back sheet — see header comment above.
// sideLabel: 'Front' or 'Back', used only for the print tab's document title.
function compileToPrintSheet(jsonLayoutState, mirrorHorizontal = false, sideLabel = '') {
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
      const s = el.style || {};
      const swPx = s.strokeEnabled ? s.strokeWidth : 0;
      const swMm = (swPx * pxToMmFactor).toFixed(4);
      const fillAttr = s.fillEnabled ? s.fill : 'none';
      const strokeAttr = s.strokeEnabled ? s.stroke : 'none';
      const insetPx = swPx / 2;
      const w = el.width, h = el.height;

      let shapeMarkup = '';
      const strokeStyleAttr = `style="stroke-width:${swMm}mm"`;
      if (el.shapeKind === 'rectangle') {
        shapeMarkup = `<rect x="${insetPx}" y="${insetPx}" width="${Math.max(0, w - swPx)}" height="${Math.max(0, h - swPx)}" fill="${fillAttr}" stroke="${strokeAttr}" vector-effect="non-scaling-stroke" ${strokeStyleAttr} />`;
      } else if (el.shapeKind === 'ellipse') {
        shapeMarkup = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${Math.max(0, w / 2 - insetPx)}" ry="${Math.max(0, h / 2 - insetPx)}" fill="${fillAttr}" stroke="${strokeAttr}" vector-effect="non-scaling-stroke" ${strokeStyleAttr} />`;
      } else if (el.shapeKind === 'triangle') {
        const points = `${w / 2},${insetPx} ${w - insetPx},${h - insetPx} ${insetPx},${h - insetPx}`;
        shapeMarkup = `<polygon points="${points}" fill="${fillAttr}" stroke="${strokeAttr}" stroke-linejoin="round" vector-effect="non-scaling-stroke" ${strokeStyleAttr} />`;
      }

      cardInnerHtml += `
        <svg style="position: absolute; left: ${leftMm}mm; top: ${topMm}mm; width: ${widthMm}mm; height: ${heightMm}mm;" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
          ${shapeMarkup}
        </svg>`;
    }
  });

  let cardBackgroundCss = 'background: #ffffff;';
  let overlayHtml = '';
  let gradientDef = null;

  if (jsonLayoutState.background) {
    const bg = jsonLayoutState.background;
    const fadeOpacity = (bg.fade || 0) / 100;

    overlayHtml = `<div style="position: absolute; top:0; left:0; width:100%; height:100%; background:#ffffff; opacity:${fadeOpacity}; z-index:0; pointer-events:none;"></div>`;

    if (bg.type === 'image') {
      cardBackgroundCss = `background: ${bg.value}; background-size: cover; background-position: center;`;
    } else if (bg.type === 'gradient' || bg.type === 'custom-gradient') {
      gradientDef = parseLinearGradient(bg.value);
      cardBackgroundCss = 'background: #ffffff;';
    } else {
      cardBackgroundCss = `background: ${bg.value};`;
    }
  }

  let cardsHtml = '';
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let backgroundLayer = '';

      if (gradientDef) {
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

  // Duplex alignment: see header comment. Only meaningful in imposed-a4
  // mode — single-sheet mode has no margin either side of the card, so
  // there's nothing to mirror (mirrorHorizontal is simply ignored there).
  let sheetPadLeft;
  if (isSingleSheet) {
    sheetPadLeft = 0;
  } else if (mirrorHorizontal) {
    sheetPadLeft = PAGE_WIDTH_MM - marginLeftMm - GRID_WIDTH_MM;
  } else {
    sheetPadLeft = marginLeftMm;
  }

  const titleSuffix = sideLabel ? ` — ${sideLabel}` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Print Sheet${titleSuffix}</title>
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

// Opens a new tab with the given HTML, using a Blob URL — see original
// header comment (removed above for brevity, logic unchanged): avoids
// document.write()'s deprecation warnings and handles large embedded-image
// payloads cleanly.
function openPrintTab(html) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Please allow pop-ups for this site to generate your print sheet.');
    return;
  }
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  printWindow.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const printFrontBtn = document.getElementById('printFrontBtn');
const printBackBtn = document.getElementById('printBackBtn');

printFrontBtn.addEventListener('click', () => {
  const frontData = getSideSnapshot('front'); // card-sides.js
  openPrintTab(compileToPrintSheet(frontData, false, 'Front'));
});

printBackBtn.addEventListener('click', () => {
  const backData = getSideSnapshot('back'); // card-sides.js
  // mirrorHorizontal = true: aligns the back sheet's grid margin to the
  // opposite page edge, so cutting lines land in the same physical spot
  // as the front sheet once the paper is flipped over its long edge.
  openPrintTab(compileToPrintSheet(backData, true, 'Back'));
});
