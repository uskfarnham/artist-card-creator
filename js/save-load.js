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

  const dataStr = JSON.stringify(state, null, 2);
  let useFallback = false;

  try {
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'artist_card_design.json',
        types: [{ description: 'JSON File', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(dataStr);
      await writable.close();
    } else {
      useFallback = true;
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      useFallback = true;
    }
  }

  if (useFallback) {
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

          bgTypeSelect.value = state.background.type;
          canvasBgFadeSlider.value = state.background.fade;
          bgFadeDisplay.textContent = `${state.background.fade}%`;

          bgSolidGroup.style.display = state.background.type === 'color' ? 'block' : 'none';
          bgGradientGroup.style.display = state.background.type === 'gradient' ? 'block' : 'none';
          bgCustomGradientGroup.style.display = state.background.type === 'custom-gradient' ? 'block' : 'none';
          bgImageGroup.style.display = state.background.type === 'image' ? 'block' : 'none';

          if (state.background.type === 'color') {
            canvasBgColorPicker.value = state.background.value;
          } else if (state.background.type === 'gradient') {
            bgGradientPreset.value = state.background.value;
          } else if (state.background.type === 'custom-gradient') {
            const valueStr = state.background.value;
            const angleMatch = valueStr.match(/linear-gradient\s*\(\s*(\d+)deg/i);
            const colorsMatch = valueStr.match(/(#[a-fA-F0-9]{6})/g);

            if (angleMatch) {
              gradientAngleSlider.value = angleMatch[1];
              gradientAngleDisplay.textContent = angleMatch[1] + '°';
            }
            if (colorsMatch && colorsMatch.length >= 2) {
              gradientColor1.value = colorsMatch[0];
              gradientColor2.value = colorsMatch[1];
            }
          }

          // Wrapped in a tiny timeout so the browser's DOM layer fully
          // recognizes the slider/control values above before the canvas
          // opacity/background is calculated from them.
          setTimeout(() => {
            updateCanvasBackground(state.background.value);
          }, 10);
        }

        state.elements.forEach(el => el.selected = false);

        Array.from(canvas.children).forEach(child => {
          if (child.id !== 'smart-guides-container' && !child.classList.contains('safe-zone')) {
            child.remove();
          }
        });

        state.elements.forEach(el => renderElementToDOM(el));
        renderPalette();
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
