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

function compileToPrintSheet(jsonLayoutState) {
  const cardSize = getCurrentCardSize();
  const pxToMmFactor = getPxToMmFactor();

  // Usable imposition area inside the A4 sheet's margins (see .sheet/.grid
  // dimensions below: 170mm x 275mm after the 20mm/11mm page padding).
  const GRID_WIDTH_MM = 170;
  const GRID_HEIGHT_MM = 275;
  const cols = Math.max(1, Math.floor(GRID_WIDTH_MM / cardSize.widthMm));
  const rows = Math.max(1, Math.floor(GRID_HEIGHT_MM / cardSize.heightMm));

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
    }
  });

  let cardBackgroundCss = 'background: #ffffff;';
  let overlayHtml = '';

  if (jsonLayoutState.background) {
    const bg = jsonLayoutState.background;
    const fadeOpacity = (bg.fade || 0) / 100;

    overlayHtml = `<div style="position: absolute; top:0; left:0; width:100%; height:100%; background:#ffffff; opacity:${fadeOpacity}; z-index:0; pointer-events:none;"></div>`;

    cardBackgroundCss = bg.type === 'image' ? `background: ${bg.value}; background-size: cover; background-position: center;` : `background: ${bg.value};`;
  }

  let cardsHtml = '';
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      cardsHtml += `
        <div style="position: absolute; left: ${col * cardSize.widthMm}mm; top: ${row * cardSize.heightMm}mm; width: ${cardSize.widthMm}mm; height: ${cardSize.heightMm}mm; overflow: hidden; ${cardBackgroundCss}">
          ${overlayHtml}
          ${cardInnerHtml}
        </div>`;
    }
  }

  // Crop marks at every card boundary, including the outer edges.
  let cropMarksHtml = '';
  for (let c = 0; c <= cols; c++) {
    const x = c * cardSize.widthMm;
    cropMarksHtml += `<div class="crop-mark-v" style="left: ${x}mm;"></div>`;
  }
  for (let r = 0; r <= rows; r++) {
    const y = r * cardSize.heightMm;
    cropMarksHtml += `<div class="crop-mark-h" style="top: ${y}mm;"></div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>A4 Print Sheet - Imposed Card Matrix</title>
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #ffffff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      width: 210mm;
      height: 297mm;
      position: relative;
      page-break-inside: avoid;
      padding-top: 11mm;
      padding-left: 20mm;
    }
    .grid {
      width: ${GRID_WIDTH_MM}mm;
      height: ${GRID_HEIGHT_MM}mm;
      position: relative;
    }
    .crop-mark-v {
      position: absolute;
      width: 0;
      border-left: 0.5pt dashed #999999;
      top: -5mm;
      bottom: -5mm;
      z-index: 9999;
    }
    .crop-mark-h {
      position: absolute;
      height: 0;
      border-top: 0.5pt dashed #999999;
      left: -5mm;
      right: -5mm;
      z-index: 9999;
    }
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
    if (document.readyState === 'complete') {
      window.print();
    } else {
      window.addEventListener('DOMContentLoaded', () => window.print());
    }
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