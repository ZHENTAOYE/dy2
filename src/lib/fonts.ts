import '@fontsource/noto-sans-sc/300.css';
import '@fontsource/noto-sans-sc/400.css';
import '@fontsource/noto-sans-sc/700.css';
import '@fontsource/noto-serif-sc/700.css';
import '@fontsource/noto-serif-sc/900.css';
import '@fontsource/montserrat/200.css';
import '@fontsource/montserrat/300.css';
import '@fontsource/montserrat/500.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import {useEffect, useState} from 'react';
import {continueRender, delayRender} from 'remotion';
import {TL} from './timeline';
import {LABEL_TEXT} from './labels';

export const ZH = '"Noto Sans SC", "WenQuanYi Zen Hei", sans-serif';
export const SERIF = '"Noto Serif SC", "Noto Sans SC", serif';
export const EN = 'Montserrat, "Noto Sans SC", sans-serif';
export const MONO = '"JetBrains Mono", Montserrat, monospace';

const ALL_TEXT =
  TL.captions.map((c) => c.zh + c.en + ((c as {note?: string}).note ?? '')).join('') +
  LABEL_TEXT +
  '0123456789.,:;×+-−=≥≤→·%()[]⁰¹²³⁴⁵⁶⁷⁸⁹⁻ ';

const SPECS = [
  `300 40px "Noto Sans SC"`,
  `400 40px "Noto Sans SC"`,
  `700 40px "Noto Sans SC"`,
  `700 40px "Noto Serif SC"`,
  `900 40px "Noto Serif SC"`,
  `200 40px Montserrat`,
  `300 40px Montserrat`,
  `500 40px Montserrat`,
  `400 40px "JetBrains Mono"`,
  `700 40px "JetBrains Mono"`,
];

let ready: Promise<unknown> | null = null;
const loadAll = () => {
  if (!ready) {
    const uniq = Array.from(new Set(Array.from(ALL_TEXT))).join('');
    ready = Promise.all(SPECS.map((s) => document.fonts.load(s, uniq))).then(() => document.fonts.ready);
  }
  return ready;
};

/** Blocks rendering until every glyph used anywhere in the film is loaded. */
export const useFonts = () => {
  const [handle] = useState(() => delayRender('Loading fonts'));
  useEffect(() => {
    loadAll()
      .catch((e) => console.error('font load failed', e))
      .finally(() => continueRender(handle));
  }, [handle]);
};
