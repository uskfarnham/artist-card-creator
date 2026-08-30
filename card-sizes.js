/**
 * card-sizes.js
 * ---------------------------------------------------------------------------
 * Placeholder module — single source of truth for card dimensions.
 *
 * Currently only 'uk-eu' is active, matching the app's original hardcoded
 * 85x55mm size. This module exists so that adding new sizes later is a
 * matter of adding entries here + wiring a selector UI, rather than hunting
 * down dimension values scattered across CSS (--card-width/--card-height),
 * the canvas pixel baseline (321x208px), and the A4 imposition grid math
 * in print.js.
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
  'uk-eu': {
    label: 'UK / EU Standard (85 x 55mm)',
    widthMm: 85,
    heightMm: 55
  }
  // Future sizes go here, e.g.:
  // 'us': { label: 'US Standard (89 x 51mm)', widthMm: 89, heightMm: 51 },
  // 'square': { label: 'Square (65 x 65mm)', widthMm: 65, heightMm: 65 },
  // 'mini': { label: 'Mini / Slim (70 x 28mm)', widthMm: 70, heightMm: 28 },
};

let currentCardSizeKey = 'uk-eu';

// On-screen canvas pixel width that the current UK/EU card is designed
// around (matches .canvas-container in css/styles.css: 321px x 208px).
// If a future size changes the on-screen canvas dimensions too, update
// this alongside the CSS.
const BASE_CANVAS_WIDTH_PX = 321;

function getCurrentCardSize() {
  return CARD_SIZES[currentCardSizeKey];
}

function setCurrentCardSize(key) {
  if (!CARD_SIZES[key]) {
    console.warn(`Unknown card size key: ${key}`);
    return;
  }
  currentCardSizeKey = key;
  // NOTE: not yet wired to trigger a canvas/print re-layout — this just
  // updates the stored selection for now. Hook this up when the size
  // selector UI is built.
}

// Used by print.js to convert on-screen px coordinates to real-world mm
// for the A4 imposition layout.
function getPxToMmFactor() {
  const size = getCurrentCardSize();
  return size.widthMm / BASE_CANVAS_WIDTH_PX;
}
