/**
 * card-sizes.js
 * ---------------------------------------------------------------------------
 * Single source of truth for card dimensions.
 *
 * STEP 3 of the front/back feature: card size is shared by both sides (it's
 * one physical card), so every function here that touches canvas dims or
 * element geometry now loops CARD_SIDE_KEYS instead of only ever acting on
 * the active side. getSideElements() is the key helper this all leans on —
 * it returns the LIVE elements array for whichever side is asked about,
 * whether that's the active side (state.elements) or the parked one
 * (cardSides[side].elements) — see card-sides.js for why those are two
 * different sources depending on which side is currently active.
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

const PX_PER_MM = 321 / CARD_SIZES['uk-eu'].widthMm;

function getCurrentCardSize() {
  return CARD_SIZES[currentCardSizeKey];
}

function getCanvasPixelDims(key = currentCardSizeKey) {
  const size = CARD_SIZES[key];
  return { widthPx: size.widthMm * PX_PER_MM, heightPx: size.heightMm * PX_PER_MM };
}

function getPxToMmFactor() {
  return 1 / PX_PER_MM;
}

// Returns the LIVE elements array for the given side — state.elements if
// it's the currently active side, or cardSides[side].elements otherwise.
// Needed because the active side's real data lives in the `state` global,
// not in cardSides[currentSide] (that only gets refreshed on switch-out —
// see switchToSide in card-sides.js).
function getSideElements(side) {
  return (side === currentSide) ? state.elements : cardSides[side].elements;
}

// Scales one side's element geometry to fit the new canvas box. Unchanged
// logic from before Step 3 — just takes the elements array as a parameter
// now instead of always reaching for state.elements directly, so it can be
// called once per side.
function rescaleElementsToNewCanvas(elementsArray, oldDims, newDims) {
  const scaleX = newDims.widthPx / oldDims.widthPx;
  const scaleY = newDims.heightPx / oldDims.heightPx;
  const uniformScale = Math.sqrt(scaleX * scaleY);

  elementsArray.forEach(el => {
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
      // Font-size rescale still deliberately unimplemented — see
      // PROJECT_STATUS.md backlog.
    }
  });
}

// Applies currentCardSizeKey to BOTH sides' canvases and re-renders every
// element on both — previously only ever touched the single shared canvas.
function applyCardSizeToCanvas() {
  const size = getCurrentCardSize();
  const dims = getCanvasPixelDims();

  CARD_SIDE_KEYS.forEach(side => {
    const canvasNode = cardSides[side].canvasNode;
    canvasNode.style.width = `${dims.widthPx}px`;
    canvasNode.style.height = `${dims.heightPx}px`;

    // Pass elData directly (elements.js's applyStylesToDOM override) since
    // for the inactive side, state.elements.find() would find nothing.
    getSideElements(side).forEach(el => applyStylesToDOM(el.id, el));
  });

  document.documentElement.style.setProperty('--card-width', `${size.widthMm}mm`);
  document.documentElement.style.setProperty('--card-height', `${size.heightMm}mm`);

  const subtitle = document.getElementById('cardSizeSubtitle');
  if (subtitle) subtitle.textContent = size.label;

  state.elements.forEach(el => applyStylesToDOM(el.id));
  syncSelectionToDOM();

  // Slot sizing reserved for zoom (main.js) depends on both card size and
  // zoom level — re-apply now so it reflects the just-changed size
  // immediately, at whatever zoom level is currently set.
  applyZoomToBothSides(parseInt(canvasZoomSlider.value));
}

// Records the card-size-change rescale in the INACTIVE side's own history,
// mirroring what pushHistory() (state.js) does for the active side's live
// historyStack/historyIndex globals. Without this, the inactive side's
// elements would be rescaled with no corresponding history entry — a later
// undo after switching to that side would have no record the resize ever
// happened.
function pushHistorySnapshotForInactiveSide() {
  const inactiveSide = CARD_SIDE_KEYS.find(s => s !== currentSide);
  const sideData = cardSides[inactiveSide];
  const clonedElements = JSON.parse(JSON.stringify(sideData.elements));
  const clonedBackground = JSON.parse(JSON.stringify(sideData.background));
  sideData.historyStack = sideData.historyStack.slice(0, sideData.historyIndex + 1);
  sideData.historyStack.push({ elements: clonedElements, background: clonedBackground, cardSizeKey: currentCardSizeKey });
  sideData.historyIndex++;
}

function setCurrentCardSize(key) {
  if (!CARD_SIZES[key]) { console.warn(`Unknown card size key: ${key}`); return; }
  if (key === currentCardSizeKey) return;

  const hasElements = CARD_SIDE_KEYS.some(side => getSideElements(side).length > 0);
  if (hasElements) {
    const proceed = confirm(
      'Switching card size will rescale all existing elements on BOTH the front and back to fit the new canvas dimensions.\n\n' +
      'Font sizes are NOT automatically rescaled — please check and re-adjust text size on each ' +
      'text box afterward, especially if any text has mixed font sizes within it.\n\n' +
      'Continue?'
    );
    if (!proceed) {
      cardSizeSelect.value = currentCardSizeKey;
      return;
    }
  }

  const oldDims = getCanvasPixelDims();
  currentCardSizeKey = key;
  const newDims = getCanvasPixelDims();

  CARD_SIDE_KEYS.forEach(side => {
    const elementsForSide = getSideElements(side);
    if (elementsForSide.length > 0) {
      rescaleElementsToNewCanvas(elementsForSide, oldDims, newDims);
    }
  });

  applyCardSizeToCanvas();

  pushHistory();                          // active side
  pushHistorySnapshotForInactiveSide();   // inactive side

  cardSizeSelect.value = currentCardSizeKey;
}

const cardSizeSelect = document.getElementById('cardSizeSelect');
Object.keys(CARD_SIZES).forEach(key => {
  const opt = document.createElement('option');
  opt.value = key;
  opt.textContent = CARD_SIZES[key].label;
  cardSizeSelect.appendChild(opt);
});
cardSizeSelect.value = currentCardSizeKey;
cardSizeSelect.addEventListener('change', (e) => setCurrentCardSize(e.target.value));
