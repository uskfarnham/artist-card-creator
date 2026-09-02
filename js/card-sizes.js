/**
 * card-sizes.js
 * ---------------------------------------------------------------------------
 * Single source of truth for card dimensions.
 *
 * TODO (see PROJECT_STATUS.md — "Card size configuration"):
 *  - Add a size-selector control to the "Canvas Settings" accordion
 *  - On change, recalculate:
 *      - .canvas-container width/height (css/styles.css or inline style)
 *      - BASE_CANVAS_WIDTH_PX / getPxToMmFactor() below
 *      - the imposition grid (rows/cols per A4 sheet) in print.js, which
 *        currently assumes a fixed 2 cols x 5 rows for 85x55mm cards
 * ---------------------------------------------------------------------------
 */

const CARD_SIZES = {
  'uk-eu': { label: 'UK / EU Standard (85 x 55mm)', widthMm: 85, heightMm: 55, printMode: 'imposed-a4' },
  'us':    { label: 'US Standard (89 x 51mm)', widthMm: 89, heightMm: 51, printMode: 'imposed-a4' },
  'square':{ label: 'Square (65 x 65mm)', widthMm: 65, heightMm: 65, printMode: 'imposed-a4' },
  'mini':  { label: 'Mini / Slim (70 x 28mm)', widthMm: 70, heightMm: 28, printMode: 'imposed-a4' },
  '6x4':   { label: '6 x 4 inch (152.4 x 101.6mm)', widthMm: 152.4, heightMm: 101.6, printMode: 'single-sheet' }
};

let currentCardSizeKey = 'uk-eu';

// Fixed on-screen scale shared by EVERY card size, derived from the
// original 85mm-wide card rendering at 321px. One constant scale — used
// on both axes, for every size — is what keeps getPxToMmFactor() correct;
// letting each size fit its own arbitrary target width would reintroduce
// a non-uniform x/y scale and silently break print.js's mm math for any
// non-square card.
const PX_PER_MM = 321 / CARD_SIZES['uk-eu'].widthMm;

function getCurrentCardSize() {
  return CARD_SIZES[currentCardSizeKey];
}

function getCanvasPixelDims(key = currentCardSizeKey) {
  const size = CARD_SIZES[key];
  return { widthPx: size.widthMm * PX_PER_MM, heightPx: size.heightMm * PX_PER_MM };
}

// Now constant — same px:mm ratio on both axes, for every size, since the
// canvas element itself is resized to each size's real mm aspect ratio
// (see applyCardSizeToCanvas below) rather than staying a fixed pixel box.
function getPxToMmFactor() {
  return 1 / PX_PER_MM;
}

// Scales every element's geometry to fit the new canvas box. Independent
// x/y scale factors (not a single uniform one) — this stretches designs
// to fill the new card's proportions rather than preserving the old
// aspect ratio and leaving empty margins, matching "fit new dimensions".
function rescaleElementsToNewCanvas(oldDims, newDims) {
  const scaleX = newDims.widthPx / oldDims.widthPx;
  const scaleY = newDims.heightPx / oldDims.heightPx;
  // Geometric mean gives shapes/lines a single proportional scale factor
  // even when switching between differently-shaped cards (e.g. UK-EU 85x55
  // to Mini 70x28, a much bigger height-squeeze than width-squeeze).
  const uniformScale = Math.sqrt(scaleX * scaleY);

  state.elements.forEach(el => {
    if (el.type === 'shape' && el.shapeKind === 'line') {
      el.x1 *= scaleX; el.y1 *= scaleY;
      el.x2 *= scaleX; el.y2 *= scaleY;
      el.style.strokeWidth = Math.max(1, Math.round(el.style.strokeWidth * uniformScale));
    } else {
      el.x *= scaleX; el.y *= scaleY;
      el.width *= scaleX; el.height *= scaleY;

      if (el.type === 'shape') {
        el.style.strokeWidth = Math.max(1, Math.round(el.style.strokeWidth * uniformScale));
      }
      // NOTE: text font-size is intentionally NOT auto-rescaled. A block's
      // default size lives in el.style.fontSize, but any per-character
      // size override (selecting a word and picking a different size) is
      // baked directly into el.content as inline Quill HTML — rescaling
      // only the block default would silently leave those overrides wrong,
      // which is worse than not touching it at all. Needs a dedicated pass
      // that parses/rescales el.content's inline runs before this is safe
      // to automate. Until then: warn and let the user manually recheck.
    }
  });
}

// Applies currentCardSizeKey to the live canvas: pixel dimensions, the
// (currently CSS-only, not yet consumed) --card-width/--card-height vars,
// and the topbar subtitle label. Re-renders every element afterward since
// their underlying x/y/width/height just changed.
function applyCardSizeToCanvas() {
  const size = getCurrentCardSize();
  const dims = getCanvasPixelDims();

  canvas.style.width = `${dims.widthPx}px`;
  canvas.style.height = `${dims.heightPx}px`;

  document.documentElement.style.setProperty('--card-width', `${size.widthMm}mm`);
  document.documentElement.style.setProperty('--card-height', `${size.heightMm}mm`);

  const subtitle = document.getElementById('cardSizeSubtitle');
  if (subtitle) subtitle.textContent = size.label;

  state.elements.forEach(el => applyStylesToDOM(el.id));
  syncSelectionToDOM();
}

function setCurrentCardSize(key) {
  if (!CARD_SIZES[key]) { console.warn(`Unknown card size key: ${key}`); return; }
  if (key === currentCardSizeKey) return;

  const hasElements = state.elements.length > 0;
  if (hasElements) {
    const proceed = confirm(
      'Switching card size will rescale all existing elements to fit the new canvas dimensions.\n\n' +
      'Font sizes are NOT automatically rescaled — please check and re-adjust text size on each ' +
      'text box afterward, especially if any text has mixed font sizes within it.\n\n' +
      'Continue?'
    );
    if (!proceed) {
      cardSizeSelect.value = currentCardSizeKey; // revert the dropdown
      return;
    }
  }

  const oldDims = getCanvasPixelDims();
  currentCardSizeKey = key;

  if (hasElements) rescaleElementsToNewCanvas(oldDims, getCanvasPixelDims());

  applyCardSizeToCanvas();
  pushHistory();
}

// Declared here (not main.js) — same forward-reference rule as propInputs
// in text-formatting.js. Populated from CARD_SIZES so new sizes only ever
// need adding in one place.
const cardSizeSelect = document.getElementById('cardSizeSelect');
Object.keys(CARD_SIZES).forEach(key => {
  const opt = document.createElement('option');
  opt.value = key;
  opt.textContent = CARD_SIZES[key].label;
  cardSizeSelect.appendChild(opt);
});
cardSizeSelect.value = currentCardSizeKey;
cardSizeSelect.addEventListener('change', (e) => setCurrentCardSize(e.target.value));
