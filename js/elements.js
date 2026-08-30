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