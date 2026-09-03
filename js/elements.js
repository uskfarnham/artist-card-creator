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
  const isLine = elData.shapeKind === 'line';

  document.getElementById('shapeFillGroup').style.display = isLine ? 'none' : 'block';
  document.getElementById('shapeLockAspectGroup').style.display = isLine ? 'none' : 'block';

  if (!isLine) {
    shapeFillEnabled.checked = s.fillEnabled;
    shapeFillColor.value = s.fill;
    shapeFillColor.disabled = !s.fillEnabled;
    shapeLockAspect.checked = s.lockAspect;
  }

  shapeStrokeEnabled.checked = s.strokeEnabled;
  shapeStrokeColor.value = s.stroke;
  shapeStrokeColor.disabled = !s.strokeEnabled;
  shapeStrokeWidth.value = s.strokeWidth;
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

// --- Line geometry & bounding box -----------------------------------------

// Minimum visual padding around a line's raw endpoint bounds — without this,
// a perfectly horizontal or vertical line computes a 0-height/0-width SVG
// viewBox (unrenderable), with no room for endpoint handles or a thick
// stroke to avoid clipping.
function getLineBoundingBox(elData) {
  const pad = Math.max(8, (elData.style.strokeWidth || 2) / 2 + 6);
  const minX = Math.min(elData.x1, elData.x2);
  const minY = Math.min(elData.y1, elData.y2);
  const maxX = Math.max(elData.x1, elData.x2);
  const maxY = Math.max(elData.y1, elData.y2);
  return {
    x: minX - pad, y: minY - pad,
    width: (maxX - minX) + pad * 2,
    height: (maxY - minY) + pad * 2
  };
}

// Returns the authoritative-or-derived bounding box for ANY element type —
// text/image/box-shape store x,y,width,height directly; line derives it from
// endpoints (see PROJECT_STATUS.md: "the wrapper div's bounding box is
// derived, not authoritative, for any non-box shape"). Used wherever generic
// code needs "a box" regardless of geometry model — snapping, alignment,
// whole-element drag.
function getElementBoundingBox(elData) {
  if (elData.type === 'shape' && elData.shapeKind === 'line') {
    return getLineBoundingBox(elData);
  }
  return { x: elData.x, y: elData.y, width: elData.width, height: elData.height };
}

function createLineElement() {
  const id = 'el_' + Math.random().toString(36).substr(2, 9);
  const newElement = {
    id, type: 'shape', shapeKind: 'line',
    x1: 20 + spawnOffset, y1: 20 + spawnOffset,
    x2: 140 + spawnOffset, y2: 90 + spawnOffset,
    selected: true,
    zIndex: state.elements.length + 1,
    style: { stroke: '#1f2937', strokeWidth: 2, strokeEnabled: true } // no fill fields — lines have none
  };

  incrementSpawnOffset();
  state.elements.forEach(el => el.selected = false);
  state.elements.push(newElement);
  renderElementToDOM(newElement);
  syncSelectionToDOM();
  pushHistory();
}

// Renders a <line> using coordinates relative to the derived bounding box
// (box.x/box.y are the viewBox origin) — separate from buildShapeMarkup
// since box-based shapes render relative to their OWN x,y (always 0,0 in
// their own viewBox), while a line's endpoints are in canvas space and need
// the box subtracted out first.
function buildLineMarkup(elData, box) {
  const s = elData.style;
  const sw = s.strokeEnabled ? s.strokeWidth : 0;
  const strokeAttr = s.strokeEnabled ? s.stroke : 'none';
  const x1 = elData.x1 - box.x, y1 = elData.y1 - box.y;
  const x2 = elData.x2 - box.x, y2 = elData.y2 - box.y;
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${strokeAttr}" stroke-width="${sw}" stroke-linecap="round" />`;
}

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

  // Per-element double-click/double-tap tracking, closure-scoped to this
  // element. Replaces the old native `dblclick` listener on contentNode —
  // initDrag() below calls preventDefault() on pointerdown, which per the
  // Pointer Events spec suppresses the browser's compatibility mouse events
  // (click/dblclick) that would normally follow. So dblclick never fires
  // once a drag-capable pointerdown handler is in the chain. Detecting the
  // double-click manually here, before that suppression happens, sidesteps
  // the issue entirely and also covers touch double-tap (whose dblclick
  // synthesis is unreliable anyway) with the same code path.
  let lastPointerDown = { time: 0, x: 0, y: 0 };

  let contentNode;

  if (elData.type === 'text') {
    contentNode = document.createElement('div');
    contentNode.className = 'element-content';
    contentNode.innerHTML = elData.content;

    // Read-only preview — actual editing happens in the sidebar Quill
    // instance, activated via the manual double-click detection in the
    // elNode pointerdown handler below.

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

  // Lines don't fit the 4-corner resize model (no width/height) — each
  // endpoint gets its own independently-draggable handle instead. Every
  // other element type (text, image, box-based shapes) keeps the existing
  // 4-corner handles.
  if (elData.type === 'shape' && elData.shapeKind === 'line') {
    ['start', 'end'].forEach(which => {
      const handle = document.createElement('div');
      handle.className = 'resize-handle endpoint-handle';
      handle.dataset.endpoint = which;
      handle.addEventListener('pointerdown', (e) => initLineEndpointDrag(e, elData.id, which));
      elNode.appendChild(handle);
    });
  } else {
    const handles = ['nw', 'ne', 'sw', 'se'];
    handles.forEach(pos => {
      const handle = document.createElement('div');
      handle.className = `resize-handle ${pos}`;
      handle.addEventListener('pointerdown', (e) => initResize(e, elData.id, pos));
      elNode.appendChild(handle);
    });
  }

  elNode.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('resize-handle')) return;

    // Manual double-click/double-tap detection — see comment on
    // lastPointerDown declaration above for why this replaced the native
    // dblclick listener.
    if (elData.type === 'text') {
      const now = Date.now();
      const dx = e.clientX - lastPointerDown.x;
      const dy = e.clientY - lastPointerDown.y;
      const isDoubleClick =
        (now - lastPointerDown.time) < 350 && (dx * dx + dy * dy) < 100;
      lastPointerDown = { time: now, x: e.clientX, y: e.clientY };

      if (isDoubleClick) {
        const selected = state.elements.filter(el => el.selected);
        if (selected.length > 1) return;
        e.preventDefault();
        e.stopPropagation();
        activateTextEditor(elData);
        return; // don't also start a drag on the activating click
      }
    }

    initDrag(e, elData.id);
  });

  canvas.appendChild(elNode);
  applyStylesToDOM(elData.id);
}

function applyStylesToDOM(id, elDataOverride) {
  // elDataOverride lets a caller supply the element data directly, for
  // cases operating on the INACTIVE side (e.g. card-sizes.js resizing
  // both sides at once) — state.elements only ever holds the active
  // side's elements, so a plain id lookup can't find the other side's.
  const elData = elDataOverride || state.elements.find(e => e.id === id);
  const elNode = document.getElementById(id);
  if (!elData || !elNode) return;

  if (elData.type === 'shape' && elData.shapeKind === 'line') {
    const box = getLineBoundingBox(elData);
    elNode.style.left = `${box.x}px`;
    elNode.style.top = `${box.y}px`;
    elNode.style.width = `${box.width}px`;
    elNode.style.height = `${box.height}px`;
    elNode.style.zIndex = elData.zIndex;

    const svgNode = elNode.querySelector('.shape-svg');
    svgNode.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    svgNode.innerHTML = buildLineMarkup(elData, box);

    // Endpoint handles sit directly over their real canvas coordinates,
    // relative to the wrapper's own box — unlike box-shapes' fixed corner
    // handles, these move independently of each other.
    const startHandle = elNode.querySelector('.endpoint-handle[data-endpoint="start"]');
    const endHandle = elNode.querySelector('.endpoint-handle[data-endpoint="end"]');
    if (startHandle) {
      startHandle.style.left = `${elData.x1 - box.x - 5}px`;
      startHandle.style.top = `${elData.y1 - box.y - 5}px`;
    }
    if (endHandle) {
      endHandle.style.left = `${elData.x2 - box.x - 5}px`;
      endHandle.style.top = `${elData.y2 - box.y - 5}px`;
    }
    return;
  }

  elNode.style.left = `${elData.x}px`;
  elNode.style.top = `${elData.y}px`;
  elNode.style.width = `${elData.width}px`;
  elNode.style.height = `${elData.height}px`;
  elNode.style.zIndex = elData.zIndex;

  if (elData.type === 'text') {
    // Block-level default style was never actually applied to the preview
    // DOM (this was a stub) — .element-content silently fell back to the
    // browser's default font-size (~16px) instead of elData.style.fontSize
    // (14px default), causing the on-screen preview to run measurably wider
    // per character than the print output, which reads elData.style
    // correctly. Any Quill inline per-run override already baked into
    // elData.content's HTML (bold/italic/color/per-word size, etc.) still
    // takes precedence over these via normal CSS cascade, same as print.js.
    const contentNode = elNode.querySelector('.element-content');
    const s = elData.style;
    contentNode.style.fontFamily = s.fontFamily;
    contentNode.style.fontSize = s.fontSize;
    contentNode.style.fontWeight = s.fontWeight;
    contentNode.style.fontStyle = s.fontStyle;
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

  const boxes = selected.map(el => ({ el, box: getElementBoundingBox(el) }));

  const minX = Math.min(...boxes.map(b => b.box.x));
  const maxX = Math.max(...boxes.map(b => b.box.x + b.box.width));
  const minY = Math.min(...boxes.map(b => b.box.y));
  const maxY = Math.max(...boxes.map(b => b.box.y + b.box.height));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  boxes.forEach(({ el, box }) => {
    let targetX = box.x, targetY = box.y;
    if (type === 'left') targetX = minX;
    if (type === 'center') targetX = centerX - (box.width / 2);
    if (type === 'right') targetX = maxX - box.width;
    if (type === 'top') targetY = minY;
    if (type === 'middle') targetY = centerY - (box.height / 2);
    if (type === 'bottom') targetY = maxY - box.height;

    const dx = targetX - box.x, dy = targetY - box.y;

    if (el.type === 'shape' && el.shapeKind === 'line') {
      el.x1 += dx; el.y1 += dy; el.x2 += dx; el.y2 += dy;
    } else {
      el.x += dx; el.y += dy;
    }
    applyStylesToDOM(el.id);
  });

  pushHistory();
}