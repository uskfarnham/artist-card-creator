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

// Quill's DEFAULT 'font' format is class-based (ql-font-xxx classes) with a
// tiny built-in whitelist (just 'serif'/'monospace') — it silently rejects
// anything not on that list, which is why selecting a font from
// #propFontFamily previously appeared to do nothing (no error, no effect).
// Swap to the style-based attributor instead, which applies the value
// directly as inline `font-family: ...` CSS — no whitelist needed since our
// dropdown already constrains the valid options to known-good CSS strings.
const FontStyle = Quill.import('attributors/style/font');
FontStyle.whitelist = null; // null = accept any string value, no restriction
Quill.register(FontStyle, true);

// Quill's default 'align' format is class-based (adds ql-align-center etc.),
// and that class is only styled *inside* Quill's own stylesheet, scoped to
// .ql-editor — so it has no visible effect once the HTML is copied out to
// the canvas preview div, which sits outside .ql-editor entirely. Swap to
// the style-based attributor so alignment is baked in as inline
// `text-align: ...` CSS, which works anywhere the HTML is placed (canvas
// preview, and eventually the print sheet too).
const AlignStyle = Quill.import('attributors/style/align');
Quill.register(AlignStyle, true);

const quill = new Quill('#quillEditorContainer', {
  theme: 'snow',
  modules: { toolbar: false }, // our own sidebar buttons drive formatting instead
  formats: ['bold', 'italic', 'underline', 'color', 'size', 'font', 'align']
});

// Browsers don't always preserve font-family strings verbatim when read back
// from an element's inline style — quotes around a font name can be added,
// stripped, or reformatted depending on the browser. Since our dropdown
// options are exact strings like "'Georgia', serif", a straight string
// comparison against whatever Quill/the DOM hands back can silently fail to
// match anything, leaving the <select> blank even though the correct font
// IS applied. Normalizing both sides before comparing avoids that.
function normalizeFontFamilyValue(value) {
  if (!value) return '';
  return value.replace(/['"]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Sets a <select>'s value by normalized match against its options, rather
// than requiring an exact string match (see normalizeFontFamilyValue above).
function setFontFamilySelectValue(selectEl, rawValue) {
  const target = normalizeFontFamilyValue(rawValue);
  const match = Array.from(selectEl.options).find(
    opt => normalizeFontFamilyValue(opt.value) === target
  );
  selectEl.value = match ? match.value : selectEl.value; // leave unchanged if no match found at all
}

// Declared here (not main.js) because the addEventListener calls below run
// as top-level statements at script-load time, before main.js executes —
// same reasoning as the printBtn fix in print.js. See PROJECT_STATUS.md
// "Key Learnings" for the general rule this follows.
const propInputs = {
  fontFamily: document.getElementById('propFontFamily'),
  fontSize: document.getElementById('propFontSize'),
  color: document.getElementById('propColor')
};

const quillEditorContainer = document.getElementById('quillEditorContainer');

// NOTE: the general-purpose focus-release helper used by drag-resize.js and
// main.js (releaseFocusForCanvasInteraction) now lives in main.js, since it
// covers all sidebar controls, not just Quill. See PROJECT_STATUS.md for
// the underlying issue.

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
  syncSelectionToDOM(); // also loads elData.content into Quill, via syncPropertiesPanel (main.js)

  // Deferred by one frame: if this element wasn't already selected, the line
  // above just switched #textPropertiesGroup from display:none to
  // display:block. Some browsers won't successfully focus an element inside
  // a container that was hidden moments earlier within the same synchronous
  // script run — the layout change needs a moment to actually take effect
  // first. requestAnimationFrame gives it that moment with no visible delay.
  requestAnimationFrame(() => quill.focus());
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
// blur-triggered pushHistory behavior. Also keeps the sidebar font/size/
// color controls live-synced to whatever's actually at the cursor or
// selection — without this, those controls only ever reflected the whole
// element's default style from the moment it was selected, and appeared
// "frozen" as you moved the cursor through differently-formatted text.
quill.on('selection-change', (range) => {
  // Visible feedback for which "mode" the user is in — editing text (Quill
  // focused) vs. arranging elements (canvas focused). Addresses the same
  // underlying confusion as exitTextEditingIfActive above, from the
  // opposite direction: this makes the *current* state visible, rather than
  // fixing what happens when you leave it.
  quillEditorContainer.classList.toggle('quill-editing-active', range !== null);

  if (range === null) {
    if (!isLoadingIntoQuill) pushHistory();
    return;
  }
  if (isLoadingIntoQuill) return; // programmatic content load, not a real cursor move

  syncToolbarToSelection(range);
});

function syncToolbarToSelection(range) {
  const elData = state.elements.find(el => el.selected);
  if (!elData || elData.type !== 'text') return;

  const format = quill.getFormat(range);

  // Fall back to the element's block-level default for any property with no
  // explicit inline override at this exact spot — e.g. a run of plain text
  // in an otherwise-default text box should still show that default font,
  // not a blank/undefined dropdown state.
  setFontFamilySelectValue(propInputs.fontFamily, format.font || elData.style.fontFamily);
  propInputs.fontSize.value = format.size || elData.style.fontSize;
  propInputs.color.value = format.color || elData.style.color;

  btnBold.classList.toggle('active', !!format.bold);
  btnItalic.classList.toggle('active', !!format.italic);
  btnUnderline.classList.toggle('active', !!format.underline);

  // Quill represents left (its default) as `false`/absent, not a string —
  // normalize so exactly one alignment button is ever active.
  const align = format.align || 'left';
  btnAlignLeftText.classList.toggle('active', align === 'left');
  btnAlignCenterText.classList.toggle('active', align === 'center');
  btnAlignRightText.classList.toggle('active', align === 'right');
}

// --- Sidebar toolbar buttons -> Quill formatting API -------------------------
// Each handler applies to the current Quill selection. If nothing is
// selected in Quill (range is null/collapsed), format() still works as
// Quill applies it to the next-typed character — matching normal rich-text
// editor behavior, so no special "whole element" fallback is needed here.

const btnBold = document.getElementById('btnBold');
const btnItalic = document.getElementById('btnItalic');
const btnUnderline = document.getElementById('btnUnderline');
const btnAlignLeftText = document.getElementById('btnAlignLeftText');
const btnAlignCenterText = document.getElementById('btnAlignCenterText');
const btnAlignRightText = document.getElementById('btnAlignRightText');

function getQuillSelectionOrNull() {
  const range = quill.getSelection();
  return range; // may be null if Quill isn't focused
}

btnBold.addEventListener('click', () => {
  const range = getQuillSelectionOrNull();
  if (!range) return;
  const current = quill.getFormat(range);
  quill.format('bold', !current.bold);
  syncToolbarToSelection(range);
});

btnItalic.addEventListener('click', () => {
  const range = getQuillSelectionOrNull();
  if (!range) return;
  const current = quill.getFormat(range);
  quill.format('italic', !current.italic);
  syncToolbarToSelection(range);
});

btnUnderline.addEventListener('click', () => {
  const range = getQuillSelectionOrNull();
  if (!range) return;
  const current = quill.getFormat(range);
  quill.format('underline', !current.underline);
  syncToolbarToSelection(range);
});

btnAlignLeftText.addEventListener('click', () => {
  const range = getQuillSelectionOrNull();
  if (!range) return;
  quill.format('align', false); // Quill's default (left) is represented as false
  syncToolbarToSelection(range);
});

btnAlignCenterText.addEventListener('click', () => {
  const range = getQuillSelectionOrNull();
  if (!range) return;
  quill.format('align', 'center');
  syncToolbarToSelection(range);
});

btnAlignRightText.addEventListener('click', () => {
  const range = getQuillSelectionOrNull();
  if (!range) return;
  quill.format('align', 'right');
  syncToolbarToSelection(range);
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
  addColorToPalette(propInputs.color.value); // was the inline unshift/pop/renderPalette block
});
