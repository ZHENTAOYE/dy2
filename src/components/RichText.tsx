import React from 'react';

// Tiny markup: 【accent】, ^{superscript}, \n line breaks.
export type Glyph = {text: string; accent: boolean; sup: boolean; br: boolean};

export const parseRich = (src: string): Glyph[] => {
  const out: Glyph[] = [];
  let accent = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '【') {
      accent = true;
      continue;
    }
    if (ch === '】') {
      accent = false;
      continue;
    }
    if (ch === '\n') {
      out.push({text: '', accent, sup: false, br: true});
      continue;
    }
    if (ch === '^' && src[i + 1] === '{') {
      const end = src.indexOf('}', i);
      out.push({text: src.slice(i + 2, end), accent, sup: true, br: false});
      i = end;
      continue;
    }
    out.push({text: ch, accent, sup: false, br: false});
  }
  return out;
};

export const glyphStyle = (g: Glyph): React.CSSProperties =>
  g.sup ? {fontSize: '0.6em', verticalAlign: '0.75em', marginLeft: '0.05em', letterSpacing: 0} : {};
