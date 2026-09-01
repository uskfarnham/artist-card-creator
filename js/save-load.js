/**
 * save-load.js
 * ---------------------------------------------------------------------------
 * Save the current design to a .json file and load one back.
 *
 * "Save As" behavior: showSaveFilePicker() opens the browser's native save
 * dialog (Chrome/Edge and other Chromium browsers) letting the user pick
 * filename and location directly. Browsers without File System Access API
 * support (Firefox, Safari as of writing) fall back to a standard anchor-tag
 * download, which saves to the browser's configured downloads location —
 * the user can still rename/move it afterwards, just without an in-page
 * dialog. No server/Drive dependency either way, unlike the old GAS version.
 * ---------------------------------------------------------------------------
 */

async function saveStateToDisk() {
  state.elements.forEach(el => el.selected = false);
  syncSelectionToDOM();

  // cardSizeKey is a sibling field, not folded into `state` itself — state
  // stays the single live source of truth for elements/palette/background,
  // and card size is exported alongside it rather than reshaping state's
  // structure just to fit this one extra value in.
  const exportPayload = { ...state, cardSizeKey: currentCardSizeKey };
  const dataStr = JSON.stringify(exportPayload, null, 2);

  if (window.showSaveFilePicker) {
    let writable = null;

    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'artist_card_design.json',
        types: [{ description: 'JSON File', accept: { 'application/json': ['.json'] } }],
      });
      // Nothing has touched the target file yet at this point — createWritable()
      // below is what actually truncates it. Any failure up to and including
      // that call is safe to quietly fall back from.
      writable = await handle.createWritable();
    } catch (err) {
      if (err.name === 'AbortError') {
        return; // user deliberately cancelled the picker — not an error
      }
      // Failed before the file was touched — most commonly NotAllowedError,
      // seen in restricted/embedded browser contexts (e.g. VS Code's built-in
      // dev browser, which doesn't support the File System Access API's
      // write-permission model even though the picker dialog itself may
      // appear to work). Falls through to the plain download below, quietly.
      console.warn('File System Access API unavailable for writing (falling back to direct download):', err);
    }

    if (writable) {
      // A writable stream is open, which means the target file IS now
      // truncated. From here on, a failure can't be silently retried via a
      // different mechanism without risking leaving the original file
      // permanently empty if that retry isn't completed.
      try {
        await writable.write(dataStr);
        await writable.close();
        return; // success
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

  // Plain download: used for browsers without File System Access API
  // support at all (Firefox, Safari), and as the safe fallback above when
  // the picker/permission step failed before any file was touched.
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
      if (loadedState && Array.isArray(loadedState.elements)) {
        state.elements = loadedState.elements;

        if (loadedState.palette) state.palette = loadedState.palette;
        if (loadedState.background) {
          state.background = loadedState.background;
          if (state.background.fade === undefined) {
            state.background.fade = 0;
          }
        }

        state.elements.forEach(el => el.selected = false);

        Array.from(canvas.children).forEach(child => {
          if (child.id !== 'smart-guides-container' && !child.classList.contains('safe-zone')) {
            child.remove();
          }
        });

        state.elements.forEach(el => renderElementToDOM(el));

        // Restore card size selection. Older save files (from before card
        // sizes existed) won't have this field — fall back to uk-eu rather
        // than leaving whatever size happens to be active in the current
        // session, which was the reported bug.
        const targetCardSizeKey = (loadedState.cardSizeKey && CARD_SIZES[loadedState.cardSizeKey])
          ? loadedState.cardSizeKey
          : 'uk-eu';
        currentCardSizeKey = targetCardSizeKey;
        cardSizeSelect.value = targetCardSizeKey;
        // Resizes the canvas and re-renders the elements just loaded above
        // at the correct dimensions. No rescale needed here (unlike the
        // dropdown's own setCurrentCardSize) — these element coordinates
        // were saved AT this exact size already, so they're already correct.
        applyCardSizeToCanvas();

        // Background restoration (including the fade overlay div) must come
        // AFTER the cleanup loop above, not before — ...
        if (loadedState.background) {
          syncBackgroundControlsToState(); // background.js
        }

        renderAllPalettes();
        syncSelectionToDOM();

        historyStack = [];
        historyIndex = -1;
        pushHistory();
      } else {
        alert('Invalid design file format.');
      }
    } catch (err) {
      alert('Error reading file.');
      console.error(err);
    } finally {
      e.target.value = '';
    }
  };
  reader.readAsText(file);
}