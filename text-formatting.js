/**
 * text-formatting.js
 * ---------------------------------------------------------------------------
 * Rich text editing, now backed by Quill instead of hand-rolled
 * contentEditable + Range manipulation.
 *
 * WHY: the old approach (extractContents()/insertNode() span-wrapping)
 * worked for simple single-style selections but produced deeply nested,
 * overlapping <span> soup when multiple styles were applied to different
 * overlapping word combinations — a realistic case for artists mixing
 * bold/italic/underline/color across a short text block. Quill stores
 * content as a Delta (a list of {insert, attributes} operations) rather
 * than nested DOM, so overlapping styles are just data — no span soup,
 * no manual Range surgery. This directly resolves the backlog item in
 * PROJECT_STATUS.md ("Rich-text styling via span-wrapping is fragile at
 * scale").
 *
 * DESIGN CHANGE: Quill lives ONLY in the sidebar (#quillEditorContainer).
 * The canvas text element is a read-only preview (see elements.js). This
 * replaces the old dual-editor setup (canvas contentEditable synced with a
 * separate sidebar rich-text div via `activeEditor`/`savedRange` tracking)
 * with a single source of truth for editing.
 *
 * REMOVED entirely by this rewrite: savedRange, activeEditor, isEditingText,
 * disableEditMode, the canvas-vs-sidebar branching in every toggle handler,
 * and the manual extractContents()/insertNode() formatting code.
 * ---------------------------------------------------------------------------
 */

// Register a custom size whitelist so the font-size slider's px values map
// directly onto Quill's inline style attributor (Quill's default size
// format is a fixed small/large/huge set, which doesn't match our slider).
const Size = Quill.import('attributors/style/size');
// Whitelist matches the #propFontSize dropdown options exactly (index.html) —
// a dropdown replaced the original slider since precise numeric selection
// via a slider was fiddly. Keep these two lists in sync if either changes.
Size.whitelist = ['8px','9px','10px','11px','12px','14px','16px','18px','20px','24px','28px','32px','36px','40px','44px','48px','54px','60px','66px','72px','80px','96px'];
Quill.register(Size, true);

const quill = new Quill('#quillEditorContainer', {
  theme: 'snow',
  modules: { toolbar: false }, // our own sidebar buttons drive formatting instead
  formats: ['bold', 'italic', 'underline', 'color', 'size', 'font', 'align']
});

// Guards against quill's own text-change firing while we're programmatically
// loading content into it (e.g. when switching selected elements) — without
// this, loading element A's content would immediately overwrite element A's
// own data with itself, harmless but wasteful, or worse, fire while we're
// mid-swap between elements.
let isLoadingIntoQuill = false;

// --- Activation: canvas double-click -> focus Quill with that element's content ---

function activateTextEditor(elData) {
  if (!elData || elData.type !== 'text') return;

  state.elements.forEach(el => el.selected = (el.id === elData.id));
  syncSelectionToDOM(); // defined in main.js — updates panel + canvas selection styling

  isLoadingIntoQuill = true;
  quill.root.innerHTML = elData.content;
  isLoadingIntoQuill = false;

  quill.focus();
}

// --- Sync: Quill content -> state -> canvas preview -------------------------

quill.on('text-change', () => {
  if (isLoadingIntoQuill) return;

  const elData = state.elements.find(el => el.selected);
  if (!elData || elData.type !== 'text') return;

  elData.content = quill.root.innerHTML;

  const canvasNode = document.getElementById(elData.id)?.querySelector('.element-content');
  if (canvasNode) canvasNode.innerHTML = elData.content;
});

// Push undo/redo history when the editor loses focus, mirroring the old
// blur-triggered pushHistory behavior.
quill.on('selection-change', (range) => {
  if (range === null && !isLoadingIntoQuill) pushHistory();
});

// --- Sidebar toolbar buttons -> Quill formatting API -------------------------
// Each handler applies to the current Quill selection. If nothing is
// selected in Quill (range is null/collapsed), format() still works as
// Quill applies it to the next-typed character — matching normal rich-text
// editor behavior, so no special "whole element" fallback is needed here.

function getQuillSelectionOrNull() {
  const range = quill.getSelection();
  return range; // may be null if Quill isn't focused
}

document.getElementById('btnBold').addEventListener('click', () => {
  const range = getQuillSelectionOrNull();
  if (!range) return;
  const current = quill.getFormat(range);
  quill.format('bold', !current.bold);
});

document.getElementById('btnItalic').addEventListener('click', () => {
  const range = getQuillSelectionOrNull();
  if (!range) return;
  const current = quill.getFormat(range);
  quill.format('italic', !current.italic);
});

document.getElementById('btnUnderline').addEventListener('click', () => {
  const range = getQuillSelectionOrNull();
  if (!range) return;
  const current = quill.getFormat(range);
  quill.format('underline', !current.underline);
});

document.getElementById('btnAlignLeftText').addEventListener('click', () => {
  const range = getQuillSelectionOrNull();
  if (!range) return;
  quill.format('align', false); // Quill's default (left) is represented as false
});

document.getElementById('btnAlignCenterText').addEventListener('click', () => {
  const range = getQuillSelectionOrNull();
  if (!range) return;
  quill.format('align', 'center');
});

document.getElementById('btnAlignRightText').addEventListener('click', () => {
  const range = getQuillSelectionOrNull();
  if (!range) return;
  quill.format('align', 'right');
});

propInputs.fontFamily.addEventListener('change', (e) => {
  const range = getQuillSelectionOrNull();
  if (!range) return;
  quill.format('font', e.target.value);
});

propInputs.fontSize.addEventListener('change', (e) => {
  const range = getQuillSelectionOrNull();
  if (!range) return;
  quill.format('size', e.target.value); // dropdown value already includes 'px'
});

propInputs.color.addEventListener('change', (e) => {
  const range = getQuillSelectionOrNull();
  if (!range) return;
  quill.format('color', e.target.value);
});

document.getElementById('saveColorBtn').addEventListener('click', () => {
  const currentColor = propInputs.color.value;
  if (!state.palette.includes(currentColor)) {
    state.palette.unshift(currentColor);
    if (state.palette.length > 6) state.palette.pop();
    renderPalette(); // defined in main.js
  }
});
