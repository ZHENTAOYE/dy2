import {cancelRender, continueRender, delayRender, staticFile} from 'remotion';

export const SANS = '"Noto Sans SC", "WenQuanYi Zen Hei", sans-serif';
export const SERIF = '"Noto Serif SC", "Noto Sans SC", serif';
export const LATIN = '"Montserrat", "Noto Sans SC", sans-serif';
export const MONO = '"Montserrat", "Noto Sans SC", sans-serif';

const FACES: [string, string, string][] = [
  ['Noto Sans SC', 'fonts/NotoSansSC-Light.woff2', '300'],
  ['Noto Sans SC', 'fonts/NotoSansSC-Medium.woff2', '500'],
  ['Noto Sans SC', 'fonts/NotoSansSC-Black.woff2', '900'],
  ['Noto Serif SC', 'fonts/NotoSerifSC-Black.woff2', '900'],
  ['Montserrat', 'fonts/Montserrat-ExtraLight.woff2', '200'],
  ['Montserrat', 'fonts/Montserrat-Regular.woff2', '400'],
  ['Montserrat', 'fonts/Montserrat-Bold.woff2', '700'],
];

let started = false;

export const loadFonts = () => {
  if (started || typeof document === 'undefined') return;
  started = true;
  const handle = delayRender('Loading fonts');
  Promise.all(
    FACES.map(([family, file, weight]) =>
      new FontFace(family, `url(${staticFile(file)}) format("woff2")`, {weight}).load().then((f) => {
        document.fonts.add(f);
      }),
    ),
  )
    .then(() => continueRender(handle))
    .catch((err) => cancelRender(err));
};
