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

const state = {
  elements: [],
  palette: ['#808080', '#0056ff', '#ff4757', '#2ed573', '#ffa502', '#000000'],
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
  historyStack.push({ elements: clonedElements, background: clonedBackground });
  historyIndex++;
}

function loadHistory(index) {
  if (index < 0 || index >= historyStack.length) return;
  historyIndex = index;
  const snapshot = historyStack[historyIndex];

  state.elements = JSON.parse(JSON.stringify(snapshot.elements));
  state.background = JSON.parse(JSON.stringify(snapshot.background));

  Array.from(canvas.children).forEach(child => {
    if (child.id !== 'smart-guides-container' && !child.classList.contains('safe-zone')) {
      child.remove();
    }
  });

  state.elements.forEach(el => renderElementToDOM(el));

  // Restore background too, now that it's part of the snapshot — also fixes
  // the background overlay div being deleted by the cleanup loop above
  // (it isn't the guides container or safe-zone, so it got swept up) without
  // ever being recreated until the next background edit.
  syncBackgroundControlsToState(); // background.js — also re-applies to the DOM

  syncSelectionToDOM();
}