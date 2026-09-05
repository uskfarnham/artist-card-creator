/**
 * card-sides.js
 * ---------------------------------------------------------------------------
 * Front/back card sides.
 *
 * STEP 2: both canvases are now permanently in the DOM and visible at once
 * (see index.html) — switching sides no longer clears/re-renders a shared
 * canvas (Step 1's approach). Instead each side owns its own canvas DOM
 * node and its own elements/background/history, and "switching" just
 * reassigns which side's data the shared globals (`state`, `canvas`,
 * `historyStack`, `historyIndex`, `smartGuidesContainer`) point to — those
 * names are read/written throughout elements.js, drag-resize.js,
 * text-formatting.js, background.js, save-load.js, and print.js, so none
 * of those files need to know two sides exist at all.
 *
 * ACTIVATION: clicking anywhere on the inactive canvas — an element or
 * blank space — switches to that side FIRST, via a capture-phase listener
 * (fires before any element's own pointerdown handler, e.g. initDrag),
 * so by the time element-level code reads `state`/`canvas` they already
 * point at the right side.
 * ---------------------------------------------------------------------------
 */

const CARD_SIDE_KEYS = ['front', 'back'];

const cardSides = {
  front: {
    elements: [],
    background: { type: 'color', value: '#ffffff', fade: 0 },
    historyStack: [], historyIndex: -1,
    canvasNode: document.getElementById('canvas-front'),
    smartGuidesNode: document.getElementById('smart-guides-container-front')
  },
  back: {
    elements: [],
    background: { type: 'color', value: '#ffffff', fade: 0 },
    historyStack: [], historyIndex: -1,
    canvasNode: document.getElementById('canvas-back'),
    smartGuidesNode: document.getElementById('smart-guides-container-back')
  }
};

let currentSide = 'front';

function switchToSide(side) {
  if (!CARD_SIDE_KEYS.includes(side) || side === currentSide) return;

  // Persist the outgoing side's live data back into cardSides BEFORE
  // swapping the globals out from under it, and clear its selection so it
  // doesn't sit there visually "selected" while inactive.
  cardSides[currentSide].elements = state.elements;
  cardSides[currentSide].background = state.background;
  cardSides[currentSide].historyStack = historyStack;
  cardSides[currentSide].historyIndex = historyIndex;

  state.elements.forEach(el => el.selected = false);
  syncSelectionToDOM(); // clears outgoing side's DOM selection outlines

  currentSide = side;
  const incoming = cardSides[side];

  state = { elements: incoming.elements, palette: sharedPalette, background: incoming.background };
  historyStack = incoming.historyStack;
  historyIndex = incoming.historyIndex;
  canvas = incoming.canvasNode;
  smartGuidesContainer = incoming.smartGuidesNode;

  syncBackgroundControlsToState(); // background.js — re-applies incoming side's background + sidebar controls
  syncSelectionToDOM();            // main.js — properties panel now reflects incoming side (nothing selected yet)

  updateActiveSideStyling();
}

function updateActiveSideStyling() {
  CARD_SIDE_KEYS.forEach(side => {
    const slot = cardSides[side].canvasNode.closest('.card-side-slot');
    slot.classList.toggle('active-side', side === currentSide);
  });
}

// One capture-phase listener per canvas. Capture ensures this runs before
// any element's own pointerdown handler (initDrag, initResize, etc.), which
// is what makes it safe for those handlers to read `state`/`canvas` at
// call time and always get the correct, already-switched side.
CARD_SIDE_KEYS.forEach(side => {
  const node = cardSides[side].canvasNode;
  node.addEventListener('pointerdown', (e) => {
    if (side !== currentSide) switchToSide(side);

    // Blank-canvas tap deselects — but NOT while building a multi-select
    // (main.js's Multi-Select Mode toggle), otherwise a stray tap between
    // elements would wipe out the selection the person is deliberately
    // assembling one tap at a time.
    if (e.target === node || e.target.classList.contains('safe-zone')) {
      releaseFocusForCanvasInteraction();
      if (!multiSelectModeActive) {
        state.elements.forEach(el => el.selected = false);
        syncSelectionToDOM();
      }
    }
  }, true);
});

updateActiveSideStyling();

// Returns the live {elements, background} for a given side, whether it's
// the currently ACTIVE side (live in the `state` global) or the parked
// other side (live in cardSides[side]). save-load.js uses this so saving
// always captures BOTH sides' current data, regardless of which is active
// at the moment Save is clicked.
function getSideSnapshot(side) {
  if (side === currentSide) {
    return { elements: state.elements, background: state.background };
  }
  return { elements: cardSides[side].elements, background: cardSides[side].background };
}

// Renders a full elements array onto a specific side's canvas from
// scratch — used by loadStateFromDisk (save-load.js) to populate BOTH
// canvases on load, not just the active one. For the active side this is
// just a normal renderElementToDOM loop; for the inactive side, `canvas`/
// `state` are temporarily repointed at that side so renderElementToDOM
// (elements.js, unchanged) appends to the right DOM node and finds the
// right element data — then restored immediately after.
function renderElementsOntoSide(side, elementsArray) {
  const sideInfo = cardSides[side];
  const targetCanvas = sideInfo.canvasNode;

  Array.from(targetCanvas.children).forEach(child => {
    if (!child.classList.contains('smart-guides-container') && !child.classList.contains('safe-zone')) {
      child.remove();
    }
  });

  if (side === currentSide) {
    elementsArray.forEach(el => renderElementToDOM(el));
  } else {
    const savedState = state, savedCanvas = canvas, savedGuides = smartGuidesContainer;
    state = { elements: elementsArray, palette: sharedPalette, background: sideInfo.background };
    canvas = targetCanvas;
    smartGuidesContainer = sideInfo.smartGuidesNode;

    elementsArray.forEach(el => renderElementToDOM(el));

    state = savedState;
    canvas = savedCanvas;
    smartGuidesContainer = savedGuides;
  }
}
