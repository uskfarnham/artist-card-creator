/**
 * fonts.js
 * ---------------------------------------------------------------------------
 * Single source of truth for the self-hosted font set, layered on top of
 * the original 10 system/web-safe fonts in the propFontFamily dropdown.
 * Generates @font-face CSS for two contexts from one list:
 *  1. The main document (relative paths, injected here at load).
 *  2. print.js's generated print sheet — a SEPARATE document opened via
 *     Blob URL, where relative font paths don't reliably resolve. print.js
 *     calls buildFontFaceCSS() with an absolute base URL instead.
 * ---------------------------------------------------------------------------
 */

const CUSTOM_FONTS = [
  { family: 'Inter',              file: 'Inter',             weights: ['regular', 'bold', 'italic'] },
  { family: 'Work Sans',          file: 'WorkSans',          weights: ['regular', 'bold', 'italic'] },
  { family: 'Lora',               file: 'Lora',              weights: ['regular', 'bold', 'italic'] },
  { family: 'Cormorant Garamond', file: 'CormorantGaramond', weights: ['regular', 'bold', 'italic'] },
  { family: 'Playfair Display',   file: 'PlayfairDisplay',   weights: ['regular', 'bold', 'italic'] },
  { family: 'Oswald',             file: 'Oswald',             weights: ['regular', 'bold', 'italic'] },
  { family: 'Abril Fatface',      file: 'AbrilFatface',      weights: ['regular'] },
  { family: 'Dancing Script',     file: 'DancingScript',     weights: ['regular', 'bold'] },
  { family: 'Caveat',             file: 'Caveat',            weights: ['regular', 'bold'] },
  { family: 'Bebas Neue',         file: 'BebasNeue',         weights: ['regular'] }
];

// Fonts with no true italic face — the Italic toolbar button gets disabled
// for these rather than letting the browser fake a mechanically-slanted
// "faux italic", which looks bad on a script/display face. See
// text-formatting.js updateItalicAvailability().
const CUSTOM_FONTS_NO_ITALIC = ['Dancing Script', 'Caveat', 'Abril Fatface', 'Bebas Neue'];

function weightToFontWeight(w) { return w === 'bold' ? 700 : 400; }
function weightToFontStyle(w) { return w === 'italic' ? 'italic' : 'normal'; }

function buildFontFaceCSS(baseUrl) {
  return CUSTOM_FONTS.map(font =>
    font.weights.map(w => {
      const suffix = w === 'regular' ? 'Regular' : w === 'bold' ? 'Bold' : 'Italic';
      return `@font-face {
  font-family: '${font.family}';
  src: url('${baseUrl}${font.file}-${suffix}.woff2') format('woff2');
  font-weight: ${weightToFontWeight(w)};
  font-style: ${weightToFontStyle(w)};
  font-display: swap;
}`;
    }).join('\n')
  ).join('\n');
}

// Injects @font-face into the main document's <head> at load — keeps
// styles.css free of a 30-rule hand-maintained block, and guarantees the
// main app and print sheet build from the exact same list.
(function injectFontFacesIntoDocument() {
  const styleTag = document.createElement('style');
  styleTag.id = 'custom-font-faces';
  styleTag.textContent = buildFontFaceCSS('fonts/');
  document.head.appendChild(styleTag);
})();

