/**
 * save-load.js
 * ---------------------------------------------------------------------------
 * Save the current design (both card sides) to a .json file and load one
 * back.
 *
 * STEP 4 of the front/back feature: the export payload is now
 * { front: {elements, background}, back: {elements, background}, palette,
 * cardSizeKey } instead of a flat single-sided { elements, palette,
 * background, cardSizeKey }. loadStateFromDisk detects and supports BOTH
 * formats — an old single-sided save file loads its one side into Front
 * and leaves Back empty, rather than erroring.
 *
 * "Save As" behavior unchanged from before — see original header comment
 * below.
 * ---------------------------------------------------------------------------
 */

async function saveStateToDisk() {
  state.elements.forEach(el => el.selected = false);
  syncSelectionToDOM();

  const frontData = getSideSnapshot('front'); // card-sides.js
  const backData = getSideSnapshot('back');

  // cardSizeKey and palette are shared, not duplicated per side — both
  // sides are always the same physical card size, and share one color
  // palette (see state.js / card-sides.js).
  const exportPayload = {
    front: { elements: frontData.elements, background: frontData.background },
    back: { elements: backData.elements, background: backData.background },
    palette: sharedPalette,
    cardSizeKey: currentCardSizeKey
  };
  const dataStr = JSON.stringify(exportPayload, null, 2);

  if (window.showSaveFilePicker) {
    let writable = null;

    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'artist_card_design.json',
        types: [{ description: 'JSON File', accept: { 'application/json': ['.json'] } }],
      });
      writable = await handle.createWritable();
    } catch (err) {
      if (err.name === 'AbortError') {
        return;
      }
      console.warn('File System Access API unavailable for writing (falling back to direct download):', err);
    }

    if (writable) {
      try {
        await writable.write(dataStr);
        await writable.close();
        return;
      } catch (err) {
        console.error('Save failed partway through writing:', err);
        alert(
          'Saving failed partway through (' + err.message + ').\n\n' +
          'The file you were saving to may now be empty or incomplete — ' +
          'please use "Save As..." again with a new filename to be safe.'
        );
        return;
      }
    }
  }

  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'artist_card_design.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function loadStateFromDisk(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const loadedState = JSON.parse(event.target.result);
      const emptyBackground = { type: 'color', value: '#ffffff', fade: 0 };

      // Two supported formats:
      // - NEW: { front: {elements, background}, back: {...}, palette, cardSizeKey }
      // - OLD (pre-front/back, single-sided): { elements, palette, background, cardSizeKey }
      // Old files load their one design into Front and leave Back empty.
      let frontPayload, backPayload, palette;

      if (loadedState && loadedState.front && Array.isArray(loadedState.front.elements)) {
        frontPayload = loadedState.front;
        backPayload = (loadedState.back && Array.isArray(loadedState.back.elements))
          ? loadedState.back
          : { elements: [], background: { ...emptyBackground } };
        palette = loadedState.palette;
      } else if (loadedState && Array.isArray(loadedState.elements)) {
        frontPayload = { elements: loadedState.elements, background: loadedState.background || { ...emptyBackground } };
        backPayload = { elements: [], background: { ...emptyBackground } };
        palette = loadedState.palette;
      } else {
        alert('Invalid design file format.');
        return;
      }

      if (palette) {
        // Mutate sharedPalette in place rather than reassigning — every
        // state object (front and back) holds the SAME array reference
        // (see state.js), so reassigning here would only update whichever
        // one happens to be `sharedPalette` at that moment, silently
        // orphaning the other.
        sharedPalette.length = 0;
        sharedPalette.push(...palette);
      }

      [frontPayload, backPayload].forEach(p => {
        if (p.background && p.background.fade === undefined) p.background.fade = 0;
      });

      frontPayload.elements.forEach(el => el.selected = false);
      backPayload.elements.forEach(el => el.selected = false);

      cardSides.front.elements = frontPayload.elements;
      cardSides.front.background = frontPayload.background;
      cardSides.front.historyStack = [];
      cardSides.front.historyIndex = -1;

      cardSides.back.elements = backPayload.elements;
      cardSides.back.background = backPayload.background;
      cardSides.back.historyStack = [];
      cardSides.back.historyIndex = -1;

      // Point the live globals at whichever side is currently active —
      // no need to preserve the old outgoing-side data here (unlike a
      // normal switchToSide), since we've just overwritten both sides
      // wholesale from the file.
      const activeData = cardSides[currentSide];
      state = { elements: activeData.elements, palette: sharedPalette, background: activeData.background };
      historyStack = activeData.historyStack;
      historyIndex = activeData.historyIndex;

      renderElementsOntoSide('front', cardSides.front.elements); // card-sides.js
      renderElementsOntoSide('back', cardSides.back.elements);

      const targetCardSizeKey = (loadedState.cardSizeKey && CARD_SIZES[loadedState.cardSizeKey])
        ? loadedState.cardSizeKey
        : 'uk-eu';
      currentCardSizeKey = targetCardSizeKey;
      cardSizeSelect.value = targetCardSizeKey;
      applyCardSizeToCanvas(); // resizes + repositions elements on BOTH canvases

      // syncBackgroundControlsToState (background.js) only ever paints the
      // ACTIVE side's canvas + sidebar controls — apply the inactive
      // side's background directly so it's correct without needing to
      // switch to it first.
      syncBackgroundControlsToState();
      const inactiveSide = CARD_SIDE_KEYS.find(s => s !== currentSide);
      applyBackgroundToDOM(cardSides[inactiveSide].canvasNode, cardSides[inactiveSide].background);

      renderAllPalettes();
      updateActiveSideStyling(); // card-sides.js
      syncSelectionToDOM();

      pushHistory();                        // fresh single entry, active side
      pushHistorySnapshotForInactiveSide();  // fresh single entry, inactive side
    } catch (err) {
      alert('Error reading file.');
      console.error(err);
    } finally {
      e.target.value = '';
    }
  };
  reader.readAsText(file);
}
