/**
 * clipboard.js
 * ---------------------------------------------------------------------------
 * Cut/copy/paste for canvas elements (replaces the old "duplicate" backlog
 * item).
 *
 * DESIGN: paste always targets whatever `state`/`canvas` currently point to
 * — i.e. the active side. Cross-side paste is therefore just "copy/cut,
 * click the other canvas to switch to it (existing card-sides.js behavior),
 * paste" — no separate "paste to other side" path needed.
 *
 * `clipboard` is a module-level array, NOT part of `state` — it must survive
 * a side switch (state gets reassigned wholesale in switchToSide) so a
 * copy/cut made on Front is still there after switching to Back.
 * ---------------------------------------------------------------------------
 */

let clipboard = [];

// Cascades pasted copies apart, same idea as elements.js's spawnOffset for
// newly-created elements — kept as its own counter (not shared with
// spawnOffset) so creating a new text box and pasting don't interfere with
// each other's cascade sequence.
let pasteCascadeOffset = 0;

function copySelectedElements() {
  const selected = state.elements.filter(el => el.selected);
  if (selected.length === 0) return;

  clipboard = JSON.parse(JSON.stringify(selected)).map(el => {
    delete el.selected;
    return el;
  });

  // Reset so the FIRST paste after a fresh copy/cut still cascades once
  // (avoids landing exactly on the original per the same-side offset
  // decision), rather than resuming wherever a previous paste sequence
  // left off.
  pasteCascadeOffset = 0;

  updateClipboardButtonStates();
}

// Copy + delete as ONE undo step, not two — mirrors deleteSelectedElements
// (elements.js) for the removal half, but skips its own pushHistory() since
// this function pushes exactly once at the end for the whole cut.
function cutSelectedElements() {
  const selected = state.elements.filter(el => el.selected);
  if (selected.length === 0) return;

  copySelectedElements(); // clipboard + cascade reset + button states

  state.elements = state.elements.filter(el => !el.selected);
  selected.forEach(el => {
    const elNode = document.getElementById(el.id);
    if (elNode) elNode.remove();
  });

  syncSelectionToDOM();
  pushHistory();
}

function pasteClipboard() {
  if (clipboard.length === 0) return;

  // Wrap at 80 like spawnOffset, but never back to 0 — 0 would stack the
  // paste exactly on the original, which the offset-cascade choice rules out.
  pasteCascadeOffset += 15;
  if (pasteCascadeOffset > 80) pasteCascadeOffset = 15;

  const maxZ = state.elements.reduce((max, el) => Math.max(max, el.zIndex || 0), 0);

  // Only elements that were grouped together WITHIN this clipboard should
  // end up grouped together in the new paste — each old groupId present in
  // the clipboard maps to exactly one fresh groupId, generated once and
  // reused for every clipboard element that shared it.
  const groupIdMap = {};

  state.elements.forEach(el => el.selected = false);

  const pastedElements = clipboard.map((sourceEl, i) => {
    const el = JSON.parse(JSON.stringify(sourceEl));
    el.id = 'el_' + Math.random().toString(36).substr(2, 9);
    el.selected = true;
    el.zIndex = maxZ + i + 1;

    if (el.groupId) {
      if (!groupIdMap[el.groupId]) {
        groupIdMap[el.groupId] = 'grp_' + Math.random().toString(36).substr(2, 9);
      }
      el.groupId = groupIdMap[el.groupId];
    }

    if (el.type === 'shape' && el.shapeKind === 'line') {
      el.x1 += pasteCascadeOffset; el.y1 += pasteCascadeOffset;
      el.x2 += pasteCascadeOffset; el.y2 += pasteCascadeOffset;
    } else {
      el.x += pasteCascadeOffset;
      el.y += pasteCascadeOffset;
    }

    return el;
  });

  pastedElements.forEach(el => {
    state.elements.push(el);
    renderElementToDOM(el);
  });

  syncSelectionToDOM();
  pushHistory(); // one entry for the whole paste batch, not per element
}

// Called from syncSelectionToDOM (main.js) and after cut/copy/paste, so the
// topbar buttons always reflect whether there's a selection to cut/copy and
// whether there's clipboard content to paste.
function updateClipboardButtonStates() {
  const hasSelection = state.elements.some(el => el.selected);
  cutBtn.disabled = !hasSelection;
  copyBtn.disabled = !hasSelection;
  pasteBtn.disabled = clipboard.length === 0;
}