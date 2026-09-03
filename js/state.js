/**
 * state.js
 * ---------------------------------------------------------------------------
 * Core application state and undo/redo history.
 *
 * NOTE on script loading: this app uses plain <script> tags (not ES modules)
 * loaded in dependency order from index.html. Top-level `const`/`let`
 * declarations in classic scripts share one global lexical scope across the
 * whole page, so `state`, `pushHistory`, etc. declared here are usable from
 * every module loaded after this one without any import/export machinery.
 * `loadHistory` below references `canvas`, `renderElementToDOM`, and
 * `syncSelectionToDOM`, which are defined in main.js/elements.js (loaded
 * later) — that's fine, since those names are only resolved when the
 * function actually runs, not when it's defined.
 * ---------------------------------------------------------------------------
 */

// Shared across front and back card sides — see card-sides.js. A single
// array reference, not duplicated per side, so a palette edit made while
// on Front is immediately visible when switching to Back.
const sharedPalette = ['#808080', '#0056ff', '#ff4757', '#2ed573', '#ffa502', '#000000'];

let state = {
  elements: [],
  palette: sharedPalette,
  background: {
    type: 'color',
    value: '#ffffff',
    fade: 0 // background transparency, 0–100
  }
};

let historyStack = [];
let historyIndex = -1;

function pushHistory() {
  const clonedElements = JSON.parse(JSON.stringify(state.elements));
  const clonedBackground = JSON.parse(JSON.stringify(state.background));
  historyStack = historyStack.slice(0, historyIndex + 1);
  // cardSizeKey is now part of every snapshot — see loadHistory below for
  // why undo/redo needs this, not just elements/background.
  historyStack.push({ elements: clonedElements, background: clonedBackground, cardSizeKey: currentCardSizeKey });
  historyIndex++;
}

function loadHistory(index) {
  if (index < 0 || index >= historyStack.length) return;
  historyIndex = index;
  const snapshot = historyStack[historyIndex];

  state.elements = JSON.parse(JSON.stringify(snapshot.elements));
  state.background = JSON.parse(JSON.stringify(snapshot.background));

  // Card size was previously NOT part of the undo snapshot at all — element
  // geometry reverted correctly, but the canvas container's own pixel
  // dimensions stayed wherever they currently were, since nothing called
  // applyCardSizeToCanvas() during undo/redo. Restoring it here fixes that.
  const targetCardSizeKey = snapshot.cardSizeKey || currentCardSizeKey;
  const sizeChanged = targetCardSizeKey !== currentCardSizeKey;
  if (sizeChanged) {
    currentCardSizeKey = targetCardSizeKey;
    cardSizeSelect.value = currentCardSizeKey;
  }

  Array.from(canvas.children).forEach(child => {
    if (!child.classList.contains('smart-guides-container') && !child.classList.contains('safe-zone')) {
      child.remove();
    }
  });

  state.elements.forEach(el => renderElementToDOM(el));

  // Resizes BOTH canvases and re-renders both sides' elements at the
  // (possibly reverted) size. NOTE — known edge case: this does NOT
  // retroactively touch the INACTIVE side's own elements/history. A size
  // change always pushes one history entry on BOTH sides at the same
  // moment (see pushHistorySnapshotForInactiveSide, card-sizes.js), so
  // undoing the same number of steps on both sides stays consistent —
  // it only gets out of sync if you deliberately undo one side past a
  // resize point without ever undoing the other side to match.
  if (sizeChanged) applyCardSizeToCanvas();

  syncBackgroundControlsToState();
  syncSelectionToDOM();
}