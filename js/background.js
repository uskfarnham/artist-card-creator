/**
 * background.js
 * ---------------------------------------------------------------------------
 * Card background: solid color, gradient presets, custom gradient builder,
 * and image backdrop, plus the fade-overlay slider.
 *
 * DOM references for these controls live here (rather than in main.js)
 * since they're specific to this one feature area and not needed elsewhere.
 * Depends on `canvas` (main.js), `compressImageForCard` (elements.js), and
 * `pushHistory` (state.js) — all resolved at call time, load order is fine.
 * ---------------------------------------------------------------------------
 */

const bgTypeSelect = document.getElementById('bgTypeSelect');
const bgSolidGroup = document.getElementById('bgSolidGroup');
const bgGradientGroup = document.getElementById('bgGradientGroup');
const bgCustomGradientGroup = document.getElementById('bgCustomGradientGroup');
const bgImageGroup = document.getElementById('bgImageGroup');

const canvasBgColorPicker = document.getElementById('canvasBgColorPicker');
const bgGradientPreset = document.getElementById('bgGradientPreset');
const btnUploadBgImage = document.getElementById('btnUploadBgImage');
const bgImageFileInput = document.getElementById('bgImageFileInput');
const canvasBgFadeSlider = document.getElementById('canvasBgFadeSlider');
const bgFadeDisplay = document.getElementById('bgFadeDisplay');

const gradientColor1 = document.getElementById('gradientColor1');
const gradientColor2 = document.getElementById('gradientColor2');
const gradientAngleSlider = document.getElementById('gradientAngleSlider');
const gradientAngleDisplay = document.getElementById('gradientAngleDisplay');

bgTypeSelect.addEventListener('change', (e) => {
  const type = e.target.value;
  state.background.type = type;

  bgSolidGroup.style.display = type === 'color' ? 'block' : 'none';
  bgGradientGroup.style.display = type === 'gradient' ? 'block' : 'none';
  bgCustomGradientGroup.style.display = type === 'custom-gradient' ? 'block' : 'none';
  bgImageGroup.style.display = type === 'image' ? 'block' : 'none';

  if (type === 'color') updateCanvasBackground(canvasBgColorPicker.value);
  if (type === 'gradient') updateCanvasBackground(bgGradientPreset.value);
  if (type === 'custom-gradient') compileCustomGradientString();
});

canvasBgColorPicker.addEventListener('input', (e) => updateCanvasBackground(e.target.value));
bgGradientPreset.addEventListener('change', (e) => updateCanvasBackground(e.target.value));
btnUploadBgImage.addEventListener('click', () => bgImageFileInput.click());

bgImageFileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => updateCanvasBackground(`url('${compressImageForCard(img, 1000, 0.85)}')`);
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
});

function compileCustomGradientString() {
  const c1 = gradientColor1.value;
  const c2 = gradientColor2.value;
  const deg = gradientAngleSlider.value;
  gradientAngleDisplay.textContent = `${deg}°`;

  const compiledGradient = `linear-gradient(${deg}deg, ${c1} 0%, ${c2} 100%)`;
  updateCanvasBackground(compiledGradient);
}

gradientColor1.addEventListener('input', compileCustomGradientString);
gradientColor2.addEventListener('input', compileCustomGradientString);
gradientAngleSlider.addEventListener('input', compileCustomGradientString);

canvasBgFadeSlider.addEventListener('input', (e) => {
  const fadeValue = parseInt(e.target.value);
  state.background.fade = fadeValue;
  bgFadeDisplay.textContent = `${fadeValue}%`;
  updateCanvasBackground(state.background.value);
});

// Applies state.background to the canvas DOM (overlay div + background CSS)
// without recording history. Split out from updateCanvasBackground so it can
// be reused by loadHistory (state.js) when restoring a snapshot — calling
// the full updateCanvasBackground there would incorrectly push a NEW history
// entry every time the user hits undo/redo.
function applyBackgroundToDOM() {
  let overlayNode = canvas.querySelector('.canvas-bg-overlay');
  if (!overlayNode) {
    overlayNode = document.createElement('div');
    overlayNode.className = 'canvas-bg-overlay';
    canvas.insertBefore(overlayNode, canvas.firstChild);
  }

  const opacityMultiplier = (state.background.fade || 0) / 100;
  overlayNode.style.opacity = opacityMultiplier;

  if (state.background.type === 'image') {
    canvas.style.background = state.background.value;
    canvas.style.backgroundSize = 'cover';
    canvas.style.backgroundPosition = 'center';
  } else {
    canvas.style.background = state.background.value;
    canvas.style.backgroundSize = 'initial';
    canvas.style.backgroundPosition = 'initial';
  }
}

// Syncs the sidebar's background controls (type dropdown, color/gradient
// pickers, fade slider) to match state.background — used both after loading
// a saved design (save-load.js) and after undo/redo restores a background
// snapshot (state.js). Previously this logic was duplicated inline in
// loadStateFromDisk; consolidating it here means the gradient-string
// reverse-engineering regex only needs to be correct in one place.
function syncBackgroundControlsToState() {
  bgTypeSelect.value = state.background.type;
  canvasBgFadeSlider.value = state.background.fade || 0;
  bgFadeDisplay.textContent = `${state.background.fade || 0}%`;

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

  applyBackgroundToDOM();
}

function updateCanvasBackground(styleValue) {
  state.background.value = styleValue;
  applyBackgroundToDOM();
  pushHistory();
}