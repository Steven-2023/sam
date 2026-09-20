export interface AnnotationSymbol {
  id: string;
  labelKey: string;
  /** Raw SVG markup, viewBox 0 0 24 24, black on transparent — converted to a data URL on demand. */
  svg: string;
}

// Every symbol declares explicit width/height (not just viewBox): without them, an <svg>'s
// intrinsic size defaults to the CSS spec's 300x150 replaced-element default, a 2:1 box that
// doesn't match the square viewBox. pdf.js's stamp editor sizes/anchors the inserted annotation
// off the bitmap's natural dimensions, so that mismatch made placed stamps land smaller than and
// offset from the requested rect (and from the toolbar/cursor-preview icons, which size correctly
// via CSS since [innerHTML] elements aren't affected by intrinsic size the way an <img> is).
export const ARTICULATION_SYMBOLS: AnnotationSymbol[] = [
  {
    id: 'staccato',
    labelKey: 'sheets.instrumentations.documents.symbols.staccato',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" fill="black"/></svg>',
  },
  {
    id: 'accent',
    labelKey: 'sheets.instrumentations.documents.symbols.accent',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M3 5 L3 19 L20 12 Z" fill="black"/></svg>',
  },
  {
    id: 'tenuto',
    labelKey: 'sheets.instrumentations.documents.symbols.tenuto',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect x="3" y="10.5" width="18" height="3" fill="black"/></svg>',
  },
  {
    id: 'marcato',
    labelKey: 'sheets.instrumentations.documents.symbols.marcato',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M3 19 L12 4 L21 19" stroke="black" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  },
];

export const STRING_SYMBOLS: AnnotationSymbol[] = [
  {
    id: 'down-bow',
    labelKey: 'sheets.instrumentations.documents.symbols.downBow',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M5 19 L5 5 L19 5 L19 19" stroke="black" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  },
  {
    id: 'up-bow',
    labelKey: 'sheets.instrumentations.documents.symbols.upBow',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M5 5 L12 19 L19 5" stroke="black" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  },
];

export const ALL_ANNOTATION_SYMBOLS: AnnotationSymbol[] = [...ARTICULATION_SYMBOLS, ...STRING_SYMBOLS];

export function symbolToDataUrl(symbol: AnnotationSymbol): string {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(symbol.svg);
}
