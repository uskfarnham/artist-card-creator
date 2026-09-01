/**
 * elements.js
 * ---------------------------------------------------------------------------
 * Create/render/delete text & image elements, plus layer ordering, grouping,
 * and multi-select alignment (these operate on the same element data, so
 * they live alongside creation/rendering rather than in their own file).
 *
 * CHANGE FROM ORIGINAL: canvas text is now always a read-only preview.
 * Quill (in the sidebar, see text-formatting.js) is the only place text is
 * actually edited — the old `contentEditable` toggle on double-click and the
 * `isEditingText` state are gone. Double-clicking a text element now calls
 * `activateTextEditor(elData)`, implemented in text-formatting.js, which
 * loads the element's content into Quill and focuses it.
 * ---------------------------------------------------------------------------
 */

let spawnOffset = 0;

function incrementSpawnOffset() {
  spawnOffset += 15;
  if (spawnOffset > 80) spawnOffset = 0;
}

// --- Creation ---------------------------------------------------------

function createTextElement() {
  const id = 'el_' + Math.random().toString(36).substr(2, 9);
  const newElement = {
    id: id, type: 'text',
    x: 20 + spawnOffset, y: 20 + spawnOffset,
    width: 220, height: 50,
    content: 'Double-click to edit text',
    selected: true,
    zIndex: state.elements.length + 1,
    style: {
      fontFamily: 'Arial, sans-serif', fontSize: '14px', fontWeight: 'normal',
      fontStyle: 'normal', color: '#333333', textAlign: 'left', lineHeight: '1.2'
    }
  };

  incrementSpawnOffset();
  state.elements.forEach(el => el.selected = false);
  state.elements.push(newElement);
  renderElementToDOM(newElement);
  syncSelectionToDOM();
  pushHistory();
}

function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      // Re-encode at a print-appropriate resolution — critical because this
      // same image gets embedded 10x on the imposed A4 sheet, so an
      // uncompressed phone photo balloons the PDF conversion past its limits.
      const compressedSrc = compressImageForCard(img);

      let w = img.naturalWidth; let h = img.naturalHeight;
      const maxDim = 150; // on-canvas display size only
      if (w > maxDim || h > maxDim) {
        const ratio = w / h;
        if (w > h) { w = maxDim; h = maxDim / ratio; } else { h = maxDim; w = maxDim * ratio; }
      }
      createImageElement(compressedSrc, w, h);
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

// Downscales/recompresses an uploaded image to a print-safe resolution.
// 85x55mm at 300dpi is roughly 1000x650px, so capping the longest edge at
// 1000px comfortably covers print quality while keeping file size sane.
// Also used by background.js for the card backdrop image upload.
function compressImageForCard(img, maxEdge = 1000, quality = 0.85) {
  let w = img.naturalWidth, h = img.naturalHeight;
  if (Math.max(w, h) > maxEdge) {
    const ratio = w / h;
    if (w > h) { w = maxEdge; h = Math.round(maxEdge / ratio); }
    else { h = maxEdge; w = Math.round(maxEdge * ratio); }
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  // JPEG keeps file size down; transparency is lost, an acceptable tradeoff
  // for a card photo/logo background at this print size.
  return c.toDataURL('image/jpeg', quality);
}

function createImageElement(src, width, height) {
  const id = 'el_' + Math.random().toString(36).substr(2, 9);
  const newElement = {
    id: id, type: 'image',
    x: 20 + spawnOffset, y: 20 + spawnOffset,
    width: width, height: height,
    src: src,
    selected: true,
    zIndex: state.elements.length + 1
  };

  incrementSpawnOffset();
  state.elements.forEach(el => el.selected = false);
  state.elements.push(newElement);
  renderElementToDOM(newElement);
  syncSelectionToDOM();
  pushHistory();
}

// --- Shape defaults ---------------------------------------------------

// Shared by resize-lock logic (drag-resize.js) and future shape additions —
// any shapeKind added here automatically gets Shift/lock-proportions resize
// behavior for free, without touching drag-resize.js again.
const BOX_SHAPE_KINDS = ['rectangle', 'ellipse', 'triangle'];

const SHAPE_DEFAULT_STYLE = {
  fill: '#2563eb', fillEnabled: true,
  stroke: '#1f2937', strokeWidth: 2, strokeEnabled: true,
  lockAspect: false // persistent equivalent of holding Shift — the only
                     // option touch-only devices (no physical Shift key) have
};

// Equilateral triangle needs width:height ≈ 1.155:1, not 1:1 — derived from
// buildShapeMarkup's vertex layout (apex at top-center, base across the
// bottom): base length = width, and an equilateral triangle's height is
// (√3/2) × its base, so height = (√3/2) × width, i.e. width/height = 2/√3.
const TRIANGLE_EQUILATERAL_RATIO = 2 / Math.sqrt(3);

// The box width:height ratio "locked" resize should target for a given
// shape kind — 1:1 (square/circle) for rectangle/ellipse, the equilateral
// ratio above for triangle. Centralized here so drag-resize.js doesn't need
// its own shape-kind switch.
function getShapeLockRatio(shapeKind) {
  return shapeKind === 'triangle' ? TRIANGLE_EQUILATERAL_RATIO : 1;
}

function createShapeElement(shapeKind) {
  const id = 'el_' + Math.random().toString(36).substr(2, 9);
  const newElement = {
    id, type: 'shape', shapeKind,
    x: 20 + spawnOffset, y: 20 + spawnOffset,
    width: 120, height: 90,
    selected: true,
    zIndex: state.elements.length + 1,
    style: { ...SHAPE_DEFAULT_STYLE }
  };

  incrementSpawnOffset();
  state.elements.forEach(el => el.selected = false);
  state.elements.push(newElement);
  renderElementToDOM(newElement);
  syncSelectionToDOM();
  pushHistory();
}

// Builds the inner SVG markup for a shape element from its geometry/style.
// Stroke is inset by half its width so it isn't clipped at the viewBox edge
// (SVG strokes are centered on the path by default).
function buildShapeMarkup(elData) {
  const { width: w, height: h, style: s } = elData;
  const sw = s.strokeEnabled ? s.strokeWidth : 0;
  const fillAttr = s.fillEnabled ? s.fill : 'none';
  const strokeAttr = s.strokeEnabled ? s.stroke : 'none';
  const inset = sw / 2;

  switch (elData.shapeKind) {
    case 'rectangle':
      return `<rect x="${inset}" y="${inset}" width="${Math.max(0, w - sw)}" height="${Math.max(0, h - sw)}" fill="${fillAttr}" stroke="${strokeAttr}" stroke-width="${sw}" />`;
    case 'ellipse':
      return `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${Math.max(0, w / 2 - inset)}" ry="${Math.max(0, h / 2 - inset)}" fill="${fillAttr}" stroke="${strokeAttr}" stroke-width="${sw}" />`;
    case 'triangle': {
      const points = `${w / 2},${inset} ${w - inset},${h - inset} ${inset},${h - inset}`;
      return `<polygon points="${points}" fill="${fillAttr}" stroke="${strokeAttr}" stroke-width="${sw}" stroke-linejoin="round" />`;
    }
    default:
      return '';
  }
}

// --- Shape Properties Panel ---------------------------------------------
// Declared here (not main.js) — same forward-reference rule as propInputs
// in text-formatting.js: these addEventListener calls run at top-level
// script-load time, so main.js (loaded after) can't declare them first.

const shapeFillEnabled = document.getElementById('shapeFillEnabled');
const shapeFillColor = document.getElementById('shapeFillColor');
const shapeStrokeEnabled = document.getElementById('shapeStrokeEnabled');
const shapeStrokeColor = document.getElementById('shapeStrokeColor');
const shapeStrokeWidth = document.getElementById('shapeStrokeWidth');

const shapeLockAspect = document.getElementById('shapeLockAspect');
const shapeFillPalette = document.getElementById('shapeFillPalette');
const shapeStrokePalette = document.getElementById('shapeStrokePalette');

shapeLockAspect.addEventListener('change', (e) => {
  updateSelectedShapeStyle(s => s.lockAspect = e.target.checked);
});

document.getElementById('shapeSaveFillColorBtn').addEventListener('click', () => {
  addColorToPalette(shapeFillColor.value); // main.js
});
document.getElementById('shapeSaveStrokeColorBtn').addEventListener('click', () => {
  addColorToPalette(shapeStrokeColor.value); // main.js
});

// Populates the panel's controls from a shape element's current style.
// Called by syncPropertiesPanel (main.js) when a single shape is selected.
function syncShapePanelToElement(elData) {
  const s = elData.style;
  shapeFillEnabled.checked = s.fillEnabled;
  shapeFillColor.value = s.fill;
  shapeFillColor.disabled = !s.fillEnabled;
  shapeStrokeEnabled.checked = s.strokeEnabled;
  shapeStrokeColor.value = s.stroke;
  shapeStrokeColor.disabled = !s.strokeEnabled;
  shapeStrokeWidth.value = s.strokeWidth;
  shapeLockAspect.checked = s.lockAspect; 
}

// Applies a control change to the selected shape's style, re-renders it,
// and pushes history — shared by every control below since they all follow
// the same read-selected -> mutate -> re-render -> pushHistory pattern.
function updateSelectedShapeStyle(mutateFn) {
  const elData = state.elements.find(e => e.selected && e.type === 'shape');
  if (!elData) return;
  mutateFn(elData.style);
  applyStylesToDOM(elData.id);
  pushHistory();
}

shapeFillEnabled.addEventListener('change', (e) => {
  shapeFillColor.disabled = !e.target.checked;
  updateSelectedShapeStyle(s => s.fillEnabled = e.target.checked);
});
shapeFillColor.addEventListener('input', (e) => {
  updateSelectedShapeStyle(s => s.fill = e.target.value);
});
shapeStrokeEnabled.addEventListener('change', (e) => {
  shapeStrokeColor.disabled = !e.target.checked;
  updateSelectedShapeStyle(s => s.strokeEnabled = e.target.checked);
});
shapeStrokeColor.addEventListener('input', (e) => {
  updateSelectedShapeStyle(s => s.stroke = e.target.value);
});
shapeStrokeWidth.addEventListener('change', (e) => {
  updateSelectedShapeStyle(s => s.strokeWidth = parseInt(e.target.value));
});

// --- Deletion -----------------------------------------------------------

function deleteSelectedElements() {
  const selected = state.elements.filter(e => e.selected);
  if (selected.length === 0) return;

  state.elements = state.elements.filter(el => !el.selected);
  selected.forEach(el => {
    const elNode = document.getElementById(el.id);
    if (elNode) elNode.remove();
  });

  syncSelectionToDOM();
  pushHistory();
}

// --- DOM Rendering --------------------------------------------------------

function renderElementToDOM(elData) {
  const elNode = document.createElement('div');
  elNode.className = 'design-element';
  elNode.id = elData.id;

  let contentNode;

  if (elData.type === 'text') {
    contentNode = document.createElement('div');
    contentNode.className = 'element-content';
    contentNode.innerHTML = elData.content;

    // Read-only preview — actual editing happens in the sidebar Quill
    // instance. Double-click selects + hands off to it.
    contentNode.addEventListener('dblclick', () => {
      const selected = state.elements.filter(e => e.selected);
      if (selected.length > 1) return;
      activateTextEditor(elData);
    });

  } else if (elData.type === 'image') {
    contentNode = document.createElement('img');
    contentNode.className = 'element-content';

    // SECURITY FIX: Prevent empty src from triggering a local file load loop
    if (elData.src && elData.src.trim() !== '') {
      contentNode.src = elData.src;
    } else {
      // Fallback to transparent 1x1 pixel if image data is missing
      contentNode.src = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
    }

    contentNode.draggable = false;

  } else if (elData.type === 'shape') {
    contentNode = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    contentNode.classList.add('element-content', 'shape-svg');
    contentNode.setAttribute('preserveAspectRatio', 'none');
  }

  elNode.appendChild(contentNode);

  const handles = ['nw', 'ne', 'sw', 'se'];
  handles.forEach(pos => {
    const handle = document.createElement('div');
    handle.className = `resize-handle ${pos}`;
    handle.addEventListener('pointerdown', (e) => initResize(e, elData.id, pos));
    elNode.appendChild(handle);
  });

  elNode.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('resize-handle')) return;
    initDrag(e, elData.id);
  });

  canvas.appendChild(elNode);
  applyStylesToDOM(elData.id);
}

function applyStylesToDOM(id) {
  const elData = state.elements.find(e => e.id === id);
  const elNode = document.getElementById(id);
  if (!elData || !elNode) return;

  elNode.style.left = `${elData.x}px`;
  elNode.style.top = `${elData.y}px`;
  elNode.style.width = `${elData.width}px`;
  elNode.style.height = `${elData.height}px`;
  elNode.style.zIndex = elData.zIndex;

  if (elData.type === 'text') {
    const contentNode = elNode.querySelector('.element-content');
    const s = elData.style;

    // Canvas text is always read-only now, so no contentEditable check is
    // needed before syncing — the only writer of elData.content is Quill.
    if (contentNode.innerHTML !== elData.content) {
      contentNode.innerHTML = elData.content;
    }

    contentNode.style.fontFamily = s.fontFamily;
    contentNode.style.fontSize = s.fontSize;
    contentNode.style.fontWeight = s.fontWeight;
    contentNode.style.fontStyle = s.fontStyle;
    contentNode.style.textDecoration = s.textDecoration || 'none';
    contentNode.style.color = s.color;
    contentNode.style.textAlign = s.textAlign;
    contentNode.style.lineHeight = s.lineHeight;
  }

  if (elData.type === 'shape') {
    const svgNode = elNode.querySelector('.shape-svg');
    svgNode.setAttribute('viewBox', `0 0 ${elData.width} ${elData.height}`);
    svgNode.innerHTML = buildShapeMarkup(elData);
  }
}

// --- Layering ---------------------------------------------------------

function moveLayer(direction) {
  const selected = state.elements.filter(e => e.selected);
  if (selected.length !== 1) return;

  const el = selected[0];
  state.elements.sort((a, b) => a.zIndex - b.zIndex);
  const index = state.elements.findIndex(e => e.id === el.id);

  state.elements.splice(index, 1);

  if (direction === 'front') state.elements.push(el);
  else if (direction === 'back') state.elements.unshift(el);
  else if (direction === 'forward') state.elements.splice(Math.min(state.elements.length, index + 1), 0, el);
  else if (direction === 'backward') state.elements.splice(Math.max(0, index - 1), 0, el);

  state.elements.forEach((e, i) => {
    e.zIndex = i + 1;
    applyStylesToDOM(e.id);
  });

  pushHistory();
}

// --- Grouping ---------------------------------------------------------

function groupSelected() {
  const selected = state.elements.filter(e => e.selected);
  if (selected.length < 2) return;
  const newGroupId = 'grp_' + Math.random().toString(36).substr(2, 9);
  selected.forEach(el => el.groupId = newGroupId);
  syncPropertiesPanel();
  pushHistory();
}

function ungroupSelected() {
  const selected = state.elements.filter(e => e.selected);
  selected.forEach(el => delete el.groupId);
  syncPropertiesPanel();
  pushHistory();
}

// --- Alignment ---------------------------------------------------------

function alignElements(type) {
  const selected = state.elements.filter(e => e.selected);
  if (selected.length < 2) return;

  const minX = Math.min(...selected.map(e => e.x));
  const maxX = Math.max(...selected.map(e => e.x + e.width));
  const minY = Math.min(...selected.map(e => e.y));
  const maxY = Math.max(...selected.map(e => e.y + e.height));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  selected.forEach(el => {
    if (type === 'left') el.x = minX;
    if (type === 'center') el.x = centerX - (el.width / 2);
    if (type === 'right') el.x = maxX - el.width;
    if (type === 'top') el.y = minY;
    if (type === 'middle') el.y = centerY - (el.height / 2);
    if (type === 'bottom') el.y = maxY - el.height;
    applyStylesToDOM(el.id);
  });

  pushHistory();
}