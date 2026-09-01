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

// Guards against overlapping interaction sessions — e.g. a pointercancel
// event (fast/edge trackpad movement can trigger this instead of pointerup)
// previously left the old pointermove/pointerup listeners attached to
// window forever, so a NEW drag/resize would start on top of the still-live
// old one, both writing to state simultaneously. Root cause of "jumpy" and
// "ended up with a different object selected."
let activeInteraction = null;

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

function snapResize(proposedX, proposedY, proposedW, proposedH, handlePos, ratioLocked, ratio, lockDominantAxis) {
  const { guidesX, guidesY, gridStep } = getSnapTargets();
  clearSmartGuides();

  let finalX = proposedX;
  let finalY = proposedY;
  let finalW = proposedW;
  let finalH = proposedH;

  if (ratioLocked) {
    // Single-axis snap: only the dominant axis (already decided in
    // initResize, before this call) is tested against guides/grid — the
    // other axis is always DERIVED from it via the ratio, never
    // independently snap-evaluated. This is the fix for near-guide jitter:
    // previously each axis could snap on its own, and a corner hovering
    // right at the threshold flip-flopped between two differently-computed
    // "corrected" sizes frame to frame. One decision, made once, removes
    // the conflict entirely.
    if (lockDominantAxis === 'w') {
      const targetX = handlePos.includes('e') ? proposedX + proposedW : proposedX;
      const res = evaluateSnap(targetX, guidesX, gridStep);
      if (res.snapped !== targetX) {
        if (handlePos.includes('e')) {
          finalW = res.snapped - proposedX;
        } else {
          finalW = proposedW + (proposedX - res.snapped);
          finalX = res.snapped;
        }
        if (res.isGuide) drawGuide('x', res.snapped);
      }
      finalH = finalW / ratio;
      if (handlePos.includes('n')) finalY = proposedY + (proposedH - finalH);
    } else {
      const targetY = handlePos.includes('s') ? proposedY + proposedH : proposedY;
      const res = evaluateSnap(targetY, guidesY, gridStep);
      if (res.snapped !== targetY) {
        if (handlePos.includes('s')) {
          finalH = res.snapped - proposedY;
        } else {
          finalH = proposedH + (proposedY - res.snapped);
          finalY = res.snapped;
        }
        if (res.isGuide) drawGuide('y', res.snapped);
      }
      finalW = finalH * ratio;
      if (handlePos.includes('w')) finalX = proposedX + (proposedW - finalW);
    }

    return { finalX, finalY, finalW, finalH };
  }

  // --- Free (non-ratio-locked) resize: unchanged from before ---

  if (handlePos.includes('e')) {
    const res = evaluateSnap(proposedX + proposedW, guidesX, gridStep);
    if (res.snapped !== proposedX + proposedW) {
      finalW = res.snapped - proposedX;
      if (res.isGuide) drawGuide('x', res.snapped);
    }
  } else if (handlePos.includes('w')) {
    const res = evaluateSnap(proposedX, guidesX, gridStep);
    if (res.snapped !== proposedX) {
      finalW = proposedW + (proposedX - res.snapped);
      finalX = res.snapped;
      if (res.isGuide) drawGuide('x', res.snapped);
    }
  }

  if (handlePos.includes('s')) {
    const res = evaluateSnap(proposedY + proposedH, guidesY, gridStep);
    if (res.snapped !== proposedY + proposedH) {
      finalH = res.snapped - proposedY;
      if (res.isGuide) drawGuide('y', res.snapped);
    }
  } else if (handlePos.includes('n')) {
    const res = evaluateSnap(proposedY, guidesY, gridStep);
    if (res.snapped !== proposedY) {
      finalH = proposedH + (proposedY - res.snapped);
      finalY = res.snapped;
      if (res.isGuide) drawGuide('y', res.snapped);
    }
  }

  return { finalX, finalY, finalW, finalH };
}

// --- Drag Engine (Multi-Select & Zoom Support) --------------------------

function initDrag(e, id) {
  if (activeInteraction) return; // a previous session is still (or stuck) active
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
  activeInteraction = 'drag';

  // Capture the pointer on the element that started the drag — events for
  // this pointerId now route here regardless of what's physically under
  // the cursor (fast movement off the element, off-canvas, etc.), instead
  // of relying on window-level listeners plus hoping pointerup always fires.
  const captureTarget = e.currentTarget;
  captureTarget.setPointerCapture(e.pointerId);

  function onPointerMove(ev) {
    if (ev.pointerId !== e.pointerId) return;
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

  function endInteraction(ev) {
    if (ev.pointerId !== e.pointerId) return;
    document.body.classList.remove('is-dragging');
    captureTarget.removeEventListener('pointermove', onPointerMove);
    captureTarget.removeEventListener('pointerup', endInteraction);
    captureTarget.removeEventListener('pointercancel', endInteraction);
    try { captureTarget.releasePointerCapture(e.pointerId); } catch (_) {}
    clearSmartGuides();
    pushHistory();
    activeInteraction = null;
  }

  captureTarget.addEventListener('pointermove', onPointerMove);
  captureTarget.addEventListener('pointerup', endInteraction);
  captureTarget.addEventListener('pointercancel', endInteraction);
}

// --- Resize Engine --------------------------------------------------------

function initResize(e, id, handlePos) {
  if (activeInteraction) return;
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
  activeInteraction = 'resize';

  const captureTarget = e.currentTarget; // the resize handle itself
  captureTarget.setPointerCapture(e.pointerId);

  function onPointerMove(ev) {
    if (ev.pointerId !== e.pointerId) return;
    const currentZoomSlider = document.getElementById('canvasZoomSlider');
    const zoomScale = currentZoomSlider ? (parseInt(currentZoomSlider.value) / 100) : 1;

    let dx = (ev.clientX - startX) / zoomScale;
    let dy = (ev.clientY - startY) / zoomScale;

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

    const isBoxShape = elData.type === 'shape' && BOX_SHAPE_KINDS.includes(elData.shapeKind);
    const shapeRatioLock = isBoxShape && (elData.style.lockAspect || ev.shiftKey);
    const ratioLocked = elData.type === 'image' || shapeRatioLock;
    const lockRatio = elData.type === 'image'
      ? (initialW / initialH)
      : (isBoxShape ? getShapeLockRatio(elData.shapeKind) : 1);   // was: always 1
    let dominantAxis = null;

    if (ratioLocked) {
      dominantAxis = Math.abs(dx) >= Math.abs(dy) ? 'w' : 'h';

      if (dominantAxis === 'w') {
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
      handlePos, ratioLocked, lockRatio, dominantAxis
    );

    elData.x = finalX;
    elData.y = finalY;
    elData.width = finalW;
    elData.height = finalH;

    applyStylesToDOM(id);
  }

  function endInteraction(ev) {
    if (ev.pointerId !== e.pointerId) return;
    document.body.classList.remove(cursorClass);
    captureTarget.removeEventListener('pointermove', onPointerMove);
    captureTarget.removeEventListener('pointerup', endInteraction);
    captureTarget.removeEventListener('pointercancel', endInteraction);
    try { captureTarget.releasePointerCapture(e.pointerId); } catch (_) {}
    clearSmartGuides();
    pushHistory();
    activeInteraction = null;
  }

  captureTarget.addEventListener('pointermove', onPointerMove);
  captureTarget.addEventListener('pointerup', endInteraction);
  captureTarget.addEventListener('pointercancel', endInteraction);
}