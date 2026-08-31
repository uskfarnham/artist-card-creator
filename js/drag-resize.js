/**
 * drag-resize.js
 * ---------------------------------------------------------------------------
 * Drag, resize, snapping-to-guides/grid, and smart guide rendering.
 * Logic is unchanged from the original — this is a pure extraction.
 * Depends on `canvas`, `gridSnapToggle`, `smartGuidesContainer` (main.js),
 * and `applyStylesToDOM` (elements.js). All resolved at call time, so load
 * order relative to main.js doesn't matter (see state.js header comment).
 * ---------------------------------------------------------------------------
 */

const SNAP_THRESHOLD = 5;

function clearSmartGuides() {
  smartGuidesContainer.innerHTML = '';
}

function drawGuide(axis, position) {
  const guide = document.createElement('div');
  guide.className = `smart-guide ${axis === 'x' ? 'vertical' : 'horizontal'}`;
  if (axis === 'x') guide.style.left = `${position}px`;
  else guide.style.top = `${position}px`;
  smartGuidesContainer.appendChild(guide);
}

function getSnapTargets() {
  // Extract unscaled canvas boundaries rather than scaled client dimensions
  const currentZoomSlider = document.getElementById('canvasZoomSlider');
  const zoomScale = currentZoomSlider ? (parseInt(currentZoomSlider.value) / 100) : 1;

  const rect = canvas.getBoundingClientRect();
  const layoutWidth = rect.width / zoomScale;
  const layoutHeight = rect.height / zoomScale;

  const guidesX = [layoutWidth / 2];
  const guidesY = [layoutHeight / 2];

  state.elements.forEach(el => {
    if (!el.selected) {
      guidesX.push(el.x, el.x + el.width / 2, el.x + el.width);
      guidesY.push(el.y, el.y + el.height / 2, el.y + el.height);
    }
  });

  let gridStep = 0;
  if (gridSnapToggle.checked) {
    gridStep = (layoutWidth / 85) * 5; // precise 5mm grid under any transform
  }

  return { guidesX, guidesY, gridStep };
}

function evaluateSnap(value, guides, gridStep) {
  // Adjust proximity threshold so snapping feels consistent at any zoom level
  const currentZoomSlider = document.getElementById('canvasZoomSlider');
  const zoomScale = currentZoomSlider ? (parseInt(currentZoomSlider.value) / 100) : 1;
  const adjustedThreshold = SNAP_THRESHOLD / zoomScale;

  let closestGuide = null;
  let minDiff = adjustedThreshold;

  for (let g of guides) {
    const diff = Math.abs(value - g);
    if (diff < minDiff) {
      minDiff = diff;
      closestGuide = g;
    }
  }
  if (closestGuide !== null) return { snapped: closestGuide, isGuide: true };

  if (gridStep > 0) {
    const gridSnap = Math.round(value / gridStep) * gridStep;
    if (Math.abs(value - gridSnap) < adjustedThreshold) {
      return { snapped: gridSnap, isGuide: false };
    }
  }

  return { snapped: value, isGuide: false };
}

function snapDrag(proposedX, proposedY, w, h) {
  const { guidesX, guidesY, gridStep } = getSnapTargets();
  clearSmartGuides();

  let finalX = proposedX;
  let finalY = proposedY;

  const ptsX = [
    { val: proposedX, offset: 0 },
    { val: proposedX + w / 2, offset: w / 2 },
    { val: proposedX + w, offset: w }
  ];
  for (let pt of ptsX) {
    const res = evaluateSnap(pt.val, guidesX, gridStep);
    if (res.snapped !== pt.val) {
      finalX = res.snapped - pt.offset;
      if (res.isGuide) drawGuide('x', res.snapped);
      break;
    }
  }

  const ptsY = [
    { val: proposedY, offset: 0 },
    { val: proposedY + h / 2, offset: h / 2 },
    { val: proposedY + h, offset: h }
  ];
  for (let pt of ptsY) {
    const res = evaluateSnap(pt.val, guidesY, gridStep);
    if (res.snapped !== pt.val) {
      finalY = res.snapped - pt.offset;
      if (res.isGuide) drawGuide('y', res.snapped);
      break;
    }
  }

  return { finalX, finalY };
}

function snapResize(proposedX, proposedY, proposedW, proposedH, handlePos, isImage, ratio) {
  const { guidesX, guidesY, gridStep } = getSnapTargets();
  clearSmartGuides();

  let finalX = proposedX;
  let finalY = proposedY;
  let finalW = proposedW;
  let finalH = proposedH;

  let snappedX = false;
  let snappedY = false;

  if (handlePos.includes('e')) {
    const res = evaluateSnap(proposedX + proposedW, guidesX, gridStep);
    if (res.snapped !== proposedX + proposedW) {
      finalW = res.snapped - proposedX;
      if (res.isGuide) drawGuide('x', res.snapped);
      snappedX = true;
    }
  } else if (handlePos.includes('w')) {
    const res = evaluateSnap(proposedX, guidesX, gridStep);
    if (res.snapped !== proposedX) {
      finalW = proposedW + (proposedX - res.snapped);
      finalX = res.snapped;
      if (res.isGuide) drawGuide('x', res.snapped);
      snappedX = true;
    }
  }

  if (handlePos.includes('s')) {
    const res = evaluateSnap(proposedY + proposedH, guidesY, gridStep);
    if (res.snapped !== proposedY + proposedH) {
      finalH = res.snapped - proposedY;
      if (res.isGuide) drawGuide('y', res.snapped);
      snappedY = true;
    }
  } else if (handlePos.includes('n')) {
    const res = evaluateSnap(proposedY, guidesY, gridStep);
    if (res.snapped !== proposedY) {
      finalH = proposedH + (proposedY - res.snapped);
      finalY = res.snapped;
      if (res.isGuide) drawGuide('y', res.snapped);
      snappedY = true;
    }
  }

  if (isImage) {
    if (snappedX) {
      finalH = finalW / ratio;
      if (handlePos.includes('n')) finalY = proposedY + (proposedH - finalH);
      document.querySelectorAll('.smart-guide.horizontal').forEach(g => g.remove());
    } else if (snappedY) {
      finalW = finalH * ratio;
      if (handlePos.includes('w')) finalX = proposedX + (proposedW - finalW);
      document.querySelectorAll('.smart-guide.vertical').forEach(g => g.remove());
    } else {
      finalH = finalW / ratio;
      if (handlePos.includes('n')) finalY = proposedY + (proposedH - finalH);
      if (handlePos.includes('w')) finalX = proposedX + (proposedW - finalW);
    }
  }

  return { finalX, finalY, finalW, finalH };
}

// --- Drag Engine (Multi-Select & Zoom Support) --------------------------

function initDrag(e, id) {
  releaseFocusForCanvasInteraction();
  e.preventDefault();
  e.stopPropagation();

  const clickedEl = state.elements.find(el => el.id === id);
  if (!clickedEl) return;

  if (e.shiftKey) {
    const targetState = !clickedEl.selected;
    if (clickedEl.groupId) {
      state.elements.filter(el => el.groupId === clickedEl.groupId).forEach(el => el.selected = targetState);
    } else {
      clickedEl.selected = targetState;
    }
  } else {
    if (!clickedEl.selected) {
      state.elements.forEach(el => el.selected = false);
      if (clickedEl.groupId) {
        state.elements.filter(el => el.groupId === clickedEl.groupId).forEach(el => el.selected = true);
      } else {
        clickedEl.selected = true;
      }
    }
  }
  syncSelectionToDOM();

  const selectedElements = state.elements.filter(el => el.selected);
  const startX = e.clientX;
  const startY = e.clientY;

  const initialPositions = selectedElements.map(el => ({ id: el.id, x: el.x, y: el.y }));
  const primaryEl = state.elements.find(e => e.id === id);
  const initialPrimaryPos = initialPositions.find(p => p.id === id);

  document.body.classList.add('is-dragging');

  function onPointerMove(ev) {
    const currentZoomSlider = document.getElementById('canvasZoomSlider');
    const zoomScale = currentZoomSlider ? (parseInt(currentZoomSlider.value) / 100) : 1;

    const dx = (ev.clientX - startX) / zoomScale;
    const dy = (ev.clientY - startY) / zoomScale;

    let proposedX = initialPrimaryPos.x + dx;
    let proposedY = initialPrimaryPos.y + dy;

    const { finalX, finalY } = snapDrag(proposedX, proposedY, primaryEl.width, primaryEl.height);

    const actualDx = finalX - initialPrimaryPos.x;
    const actualDy = finalY - initialPrimaryPos.y;

    initialPositions.forEach(pos => {
      const el = state.elements.find(e => e.id === pos.id);
      el.x = pos.x + actualDx;
      el.y = pos.y + actualDy;
      applyStylesToDOM(el.id);
    });
  }

  function onPointerUp() {
    document.body.classList.remove('is-dragging');
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    clearSmartGuides();
    pushHistory();
  }

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
}

// --- Resize Engine --------------------------------------------------------

function initResize(e, id, handlePos) {
  releaseFocusForCanvasInteraction();
  e.preventDefault();
  e.stopPropagation();

  state.elements.forEach(el => el.selected = (el.id === id));
  syncSelectionToDOM();

  const elData = state.elements.find(el => el.id === id);
  if (!elData) return;

  const startX = e.clientX;
  const startY = e.clientY;
  const initialX = elData.x;
  const initialY = elData.y;
  const initialW = elData.width;
  const initialH = elData.height;

  const minW = 20; const minH = 20;
  const cursorClass = (handlePos === 'nw' || handlePos === 'se') ? 'is-resizing-nwse' : 'is-resizing-nesw';
  document.body.classList.add(cursorClass);

  function onPointerMove(ev) {
    const currentZoomSlider = document.getElementById('canvasZoomSlider');
    const zoomScale = currentZoomSlider ? (parseInt(currentZoomSlider.value) / 100) : 1;

    const dx = (ev.clientX - startX) / zoomScale;
    const dy = (ev.clientY - startY) / zoomScale;

    let proposedW = initialW;
    let proposedH = initialH;
    let proposedX = initialX;
    let proposedY = initialY;

    if (handlePos.includes('e')) proposedW = Math.max(minW, initialW + dx);
    if (handlePos.includes('s')) proposedH = Math.max(minH, initialH + dy);
    if (handlePos.includes('w')) {
      proposedW = Math.max(minW, initialW - dx);
      proposedX = initialX + (initialW - proposedW);
    }
    if (handlePos.includes('n')) {
      proposedH = Math.max(minH, initialH - dy);
      proposedY = initialY + (initialH - proposedH);
    }

    // Ratio-lock applies to images always; to any box-based shape
    // (rectangle, ellipse, triangle — BOX_SHAPE_KINDS in elements.js) when
    // either the persistent "Lock proportions" toggle is on, or Shift is
    // held as a temporary override (desktop only — no physical Shift key
    // on touch, hence the toggle).
    const isBoxShape = elData.type === 'shape' && BOX_SHAPE_KINDS.includes(elData.shapeKind);
    const shapeRatioLock = isBoxShape && (elData.style.lockAspect || ev.shiftKey);
    const ratioLocked = elData.type === 'image' || shapeRatioLock;
    const lockRatio = elData.type === 'image' ? (initialW / initialH) : 1; // target W:H

    if (ratioLocked) {
      // Whichever axis has moved further (relative to its own starting
      // size) drives the resize; the OTHER axis is derived from THAT
      // axis's proposed SIZE via the ratio — not from its raw mouse delta.
      // Deriving from size (always correctly signed, already computed
      // above per-handle) instead of delta (which flips sign whenever dx
      // and dy have opposite signs — e.g. dragging up-and-right on an
      // 'se' handle) is what fixes the jitter: the old approach forced one
      // axis's sign onto the other depending on which raw delta happened
      // to be larger that frame, flip-flopping between growing/shrinking.
      const wChange = Math.abs(proposedW - initialW) / initialW;
      const hChange = Math.abs(proposedH - initialH) / initialH;

      if (wChange >= hChange) {
        proposedH = proposedW / lockRatio;
      } else {
        proposedW = proposedH * lockRatio;
      }
      proposedW = Math.max(minW, proposedW);
      proposedH = Math.max(minH, proposedH);

      if (handlePos.includes('w')) proposedX = initialX + (initialW - proposedW);
      if (handlePos.includes('n')) proposedY = initialY + (initialH - proposedH);
    }

    const { finalX, finalY, finalW, finalH } = snapResize(
      proposedX, proposedY, proposedW, proposedH,
      handlePos, ratioLocked, lockRatio
    );

    elData.x = finalX;
    elData.y = finalY;
    elData.width = finalW;
    elData.height = finalH;

    applyStylesToDOM(id);
  }

  function onPointerUp() {
    document.body.classList.remove(cursorClass);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    clearSmartGuides();
    pushHistory();
  }

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
}