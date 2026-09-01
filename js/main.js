/**
 * main.js
 * ---------------------------------------------------------------------------
 * DOM references not already claimed by a feature-specific module, general
 * event wiring (add/undo/redo/save/load/zoom/keyboard shortcuts/layering/
 * alignment), and the two central sync functions — syncSelectionToDOM and
 * syncPropertiesPanel — that every other module calls into after mutating
 * state or the DOM.
 *
 * SIMPLER THAN THE ORIGINAL: the old syncPropertiesPanel re-attached the
 * bold/italic/underline button listeners every single time it ran (once per
 * selection change) — a listener-duplication pattern that worked but was
 * wasteful and fragile. Since text-formatting.js now attaches those
 * listeners exactly once at load time and reads the current Quill selection
 * live when clicked, that re-binding block is gone entirely.
 *
 * Also gone: disableEditMode/isEditingText. Canvas text was previously made
 * contentEditable on double-click and had to be explicitly un-set elsewhere
 * (e.g. on zoom). Since canvas text is now always a read-only preview
 * (Quill in the sidebar is the only editing surface), there's nothing to
 * disable.
 * ---------------------------------------------------------------------------
 */

// --- DOM References -------------------------------------------------------

const canvas = document.getElementById('canvas');
const smartGuidesContainer = document.getElementById('smart-guides-container');
const gridSnapToggle = document.getElementById('gridSnapToggle');

const addTextBtn = document.getElementById('addTextBtn');
const addImageBtn = document.getElementById('addImageBtn');
const imageUploadInput = document.getElementById('imageUploadInput');

const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const saveBtn = document.getElementById('saveBtn');
const loadBtn = document.getElementById('loadBtn');
// Note: printBtn is declared in print.js, not here — its click handler
// (print.js) runs as a top-level statement before main.js loads, so the
// declaration has to live there. See print.js header comment.
const loadJsonInput = document.getElementById('loadJsonInput');
const deleteElementBtn = document.getElementById('deleteElementBtn');

const propertiesPanel = document.getElementById('propertiesPanel');
const textPropertiesGroup = document.getElementById('textPropertiesGroup');
const imagePropertiesGroup = document.getElementById('imagePropertiesGroup');
const layerPropertiesGroup = document.getElementById('layerPropertiesGroup');
const alignmentPropertiesGroup = document.getElementById('alignmentPropertiesGroup');
const btnGroupToggle = document.getElementById('btnGroupToggle');
const paletteSwatches = document.getElementById('paletteSwatches');
const shapePropertiesGroup = document.getElementById('shapePropertiesGroup');

// Note: propInputs is declared in text-formatting.js, not here — its
// addEventListener calls run as top-level statements before main.js loads,
// so the declaration has to live there. See print.js/printBtn for the same
// pattern, and PROJECT_STATUS.md "Key Learnings" for the general rule.

let isNudging = false;

// Blurs whatever currently has focus, if anything. Called at the start of
// any canvas interaction (drag, resize, click-to-deselect) — without this,
// a previously-focused sidebar control (Quill, a color picker, a range
// slider, etc.) silently keeps focus even after clicking elsewhere, which
// then blocks arrow-key element nudging (see the `isInput` check below,
// which correctly excludes focused inputs/contentEditable — the bug was
// that focus lingered somewhere it shouldn't have, not that check itself).
// General-purpose despite an earlier, Quill-only version of this having
// briefly lived in text-formatting.js.
function releaseFocusForCanvasInteraction() {
  const active = document.activeElement;
  if (active && active !== document.body && typeof active.blur === 'function') {
    active.blur();
  }
}

// --- Accordion Toggle -------------------------------------------------

document.querySelectorAll('.accordion-trigger').forEach(trigger => {
  trigger.addEventListener('click', () => {
    const item = trigger.closest('.accordion-item');
    item.classList.toggle('active');
  });
});

// Tap-to-show support for ALL .tooltip-container elements (existing ones —
// grid snapping, safe zone, aspect ratio — get this for free too, not just
// the new shape hint). Hover still works normally for mouse users; this
// only adds the tap path that touch devices were missing entirely.
document.querySelectorAll('.tooltip-container').forEach(container => {
  container.addEventListener('click', (e) => {
    const wasOpen = container.classList.contains('tooltip-visible');
    document.querySelectorAll('.tooltip-container.tooltip-visible')
      .forEach(el => el.classList.remove('tooltip-visible'));
    if (!wasOpen) container.classList.add('tooltip-visible');
    e.stopPropagation();
  });
});

document.addEventListener('click', () => {
  document.querySelectorAll('.tooltip-container.tooltip-visible')
    .forEach(el => el.classList.remove('tooltip-visible'));
});

document.querySelectorAll('.tooltip-container').forEach(container => {
  container.addEventListener('click', (e) => {
    const wasOpen = container.classList.contains('tooltip-visible');
    document.querySelectorAll('.tooltip-container.tooltip-visible')
      .forEach(el => el.classList.remove('tooltip-visible'));
    if (!wasOpen) container.classList.add('tooltip-visible');
    e.stopPropagation();
  });

  // Mouse leaving should always close it on desktop, even if it was opened
  // via click rather than hover — otherwise a clicked-open tooltip outlives
  // the hover state that would normally hide it.
  container.addEventListener('mouseleave', () => {
    container.classList.remove('tooltip-visible');
  });
});

// --- Element Creation / History / Save-Load Wiring -------------------------

addTextBtn.addEventListener('click', createTextElement);
addImageBtn.addEventListener('click', () => imageUploadInput.click());
imageUploadInput.addEventListener('change', handleImageUpload);
document.getElementById('addRectBtn').addEventListener('click', () => createShapeElement('rectangle'));
document.getElementById('addEllipseBtn').addEventListener('click', () => createShapeElement('ellipse'));
document.getElementById('addTriangleBtn').addEventListener('click', () => createShapeElement('triangle'));
document.getElementById('addLineBtn').addEventListener('click', createLineElement);

undoBtn.addEventListener('click', () => loadHistory(historyIndex - 1));
redoBtn.addEventListener('click', () => loadHistory(historyIndex + 1));
deleteElementBtn.addEventListener('click', deleteSelectedElements);

saveBtn.addEventListener('click', saveStateToDisk);
loadBtn.addEventListener('click', () => loadJsonInput.click());
loadJsonInput.addEventListener('change', loadStateFromDisk);

// --- Workspace Zoom ---------------------------------------------------

const canvasZoomSlider = document.getElementById('canvasZoomSlider');
const zoomDisplay = document.getElementById('zoomDisplay');

canvasZoomSlider.addEventListener('input', (e) => {
  const zoomValue = parseInt(e.target.value);
  zoomDisplay.textContent = `${zoomValue}%`;

  const scaleMultiplier = zoomValue / 100;
  canvas.style.setProperty('transform', `scale(${scaleMultiplier})`, 'important');
  canvas.style.transformOrigin = 'center center';
});

// --- Layering -----------------------------------------------------------

document.getElementById('btnFront').addEventListener('click', () => moveLayer('front'));
document.getElementById('btnForward').addEventListener('click', () => moveLayer('forward'));
document.getElementById('btnBackward').addEventListener('click', () => moveLayer('backward'));
document.getElementById('btnBack').addEventListener('click', () => moveLayer('back'));

// --- Alignment ---------------------------------------------------------

document.getElementById('btnAlignLeft').addEventListener('click', () => alignElements('left'));
document.getElementById('btnAlignCenter').addEventListener('click', () => alignElements('center'));
document.getElementById('btnAlignRight').addEventListener('click', () => alignElements('right'));
document.getElementById('btnAlignTop').addEventListener('click', () => alignElements('top'));
document.getElementById('btnAlignMiddle').addEventListener('click', () => alignElements('middle'));
document.getElementById('btnAlignBottom').addEventListener('click', () => alignElements('bottom'));

// --- Canvas Deselection -------------------------------------------------

canvas.addEventListener('pointerdown', (e) => {
  if (e.target === canvas || e.target.classList.contains('safe-zone')) {
    releaseFocusForCanvasInteraction();
    state.elements.forEach(el => el.selected = false);
    syncSelectionToDOM();
  }
});

// --- Keyboard Shortcuts -------------------------------------------------

window.addEventListener('keydown', (e) => {
  // isContentEditable covers typing inside Quill's editor (its root div is
  // contenteditable), so shortcuts below correctly don't fire while typing.
  const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable;

  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); loadHistory(historyIndex - 1); }
    else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); loadHistory(historyIndex + 1); }
  }

  if ((e.key === 'Delete' || e.key === 'Backspace') && !isInput) {
    e.preventDefault();
    deleteSelectedElements();
  }

  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && !isInput) {
    e.preventDefault();
    const selected = state.elements.filter(el => el.selected);
    if (selected.length === 0) return;

    const currentZoomSlider = document.getElementById('canvasZoomSlider');
    const zoomScale = currentZoomSlider ? (parseInt(currentZoomSlider.value) / 100) : 1;

    const baseStep = e.shiftKey ? 10 : 1;
    const adjustedStep = Math.round(baseStep / zoomScale);

    selected.forEach(el => {
      let dx = 0, dy = 0;
      if (e.key === 'ArrowUp') dy = -adjustedStep;
      if (e.key === 'ArrowDown') dy = adjustedStep;
      if (e.key === 'ArrowLeft') dx = -adjustedStep;
      if (e.key === 'ArrowRight') dx = adjustedStep;

      if (el.type === 'shape' && el.shapeKind === 'line') {
        el.x1 += dx; el.y1 += dy;
        el.x2 += dx; el.y2 += dy;
      } else {
        el.x += dx; el.y += dy;
      }
      applyStylesToDOM(el.id);
    });
    isNudging = true;
  }
});

window.addEventListener('keyup', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && isNudging) {
    pushHistory();
    isNudging = false;
  }
});

// --- Color Palette ---------------------------------------------------------

// Renders state.palette's swatches into any container, with a caller-supplied
// selection handler — lets text/shape-fill/shape-stroke all share one saved
// palette instead of each maintaining their own separate list.
function renderPaletteInto(containerEl, onSelectColor) {
  containerEl.innerHTML = '';
  state.palette.forEach(color => {
    const swatch = document.createElement('div');
    swatch.className = 'swatch';
    swatch.style.background = color;
    swatch.dataset.color = color;
    swatch.addEventListener('mousedown', (e) => e.preventDefault());
    swatch.addEventListener('click', () => onSelectColor(color));
    containerEl.appendChild(swatch);
  });
}

function renderAllPalettes() {
  renderPaletteInto(paletteSwatches, (color) => {
    propInputs.color.value = color;
    propInputs.color.dispatchEvent(new Event('change')); // text-formatting.js handler
  });
  renderPaletteInto(shapeFillPalette, (color) => {
    shapeFillColor.value = color;
    updateSelectedShapeStyle(s => s.fill = color); // elements.js
  });
  renderPaletteInto(shapeStrokePalette, (color) => {
    shapeStrokeColor.value = color;
    updateSelectedShapeStyle(s => s.stroke = color);
  });
}

// Shared by text's saveColorBtn (text-formatting.js) and the two new shape
// save buttons (elements.js) — one path for "add this color to the palette".
function addColorToPalette(color) {
  if (!state.palette.includes(color)) {
    state.palette.unshift(color);
    if (state.palette.length > 6) state.palette.pop();
    renderAllPalettes();
  }
}

// --- Selection & Properties Panel Sync -------------------------------------

function syncSelectionToDOM() {
  const selectedCount = state.elements.filter(e => e.selected).length;

  state.elements.forEach(elData => {
    const elNode = document.getElementById(elData.id);
    if (!elNode) return;

    if (elData.selected) {
      elNode.classList.add('selected');
      if (selectedCount === 1) elNode.classList.add('single-selected');
      else elNode.classList.remove('single-selected');
    } else {
      elNode.classList.remove('selected', 'single-selected');
    }
  });

  syncPropertiesPanel();
}

function syncPropertiesPanel() {
  const selected = state.elements.filter(e => e.selected);

  propertiesPanel.style.display = 'flex';

  textPropertiesGroup.style.display = 'none';
  imagePropertiesGroup.style.display = 'none';
  shapePropertiesGroup.style.display = 'none';   // NEW
  layerPropertiesGroup.style.display = 'none';
  alignmentPropertiesGroup.style.display = 'none';
  deleteElementBtn.style.display = 'none';
  

  const targetScrollBox = propertiesPanel.querySelector('.sidebar-scroll-box') || propertiesPanel;

  let placeholderNode = document.getElementById('sidebarPlaceholderState');
  if (!placeholderNode) {
    placeholderNode = document.createElement('div');
    placeholderNode.id = 'sidebarPlaceholderState';
    placeholderNode.style.cssText = 'flex: 1; text-align: center; color: var(--label-color); padding: 24px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; margin: 0;';
    placeholderNode.innerHTML = '<span style="font-size: 32px; opacity: 0.6;">🎛️</span><p style="font-size: 13px; font-weight: 500; line-height: 1.5; margin: 0; max-width: 200px;">Select an element on the canvas to configure its properties.</p>';
    targetScrollBox.appendChild(placeholderNode);
  }

  if (selected.length === 0) {
    placeholderNode.style.display = 'flex';
    return;
  }

  placeholderNode.style.display = 'none';
  deleteElementBtn.style.display = 'block';

  if (selected.length === 1) {
    layerPropertiesGroup.style.display = 'block';
    const elData = selected[0];

    if (elData.type === 'text') {
      textPropertiesGroup.style.display = 'block';

      // Load this element's content into Quill for editing/preview. The
      // isLoadingIntoQuill guard (text-formatting.js) prevents this from
      // being mistaken for a user edit and re-triggering a state write.
      isLoadingIntoQuill = true;
      quill.root.innerHTML = elData.content;
      isLoadingIntoQuill = false;

      setFontFamilySelectValue(propInputs.fontFamily, elData.style.fontFamily);
      propInputs.fontSize.value = elData.style.fontSize;
      propInputs.color.value = elData.style.color;
    } else if (elData.type === 'image') {
      imagePropertiesGroup.style.display = 'block';
    } else if (elData.type === 'shape') {
      shapePropertiesGroup.style.display = 'block';
      syncShapePanelToElement(elData);
    }

  } else if (selected.length > 1) {
    alignmentPropertiesGroup.style.display = 'block';

    const firstGroupId = selected[0].groupId;
    const allSameGroup = firstGroupId && selected.every(el => el.groupId === firstGroupId);

    if (allSameGroup) {
      btnGroupToggle.textContent = 'Ungroup';
      btnGroupToggle.onclick = ungroupSelected;
    } else {
      btnGroupToggle.textContent = 'Group';
      btnGroupToggle.onclick = groupSelected;
    }
  }
}

// --- Init ---------------------------------------------------------------

applyCardSizeToCanvas(); // sets initial pixel size/subtitle from card-sizes.js
renderAllPalettes();
pushHistory();