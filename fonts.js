const PREVIEW_FONTS = {
  none: 'Arial, Helvetica, sans-serif',
  opendyslexic: "'ODPreview', sans-serif",
  andika: "'Andika', sans-serif",
  abeezee: "'ABeeZee', sans-serif",
  lexia: "'LexiaReadable', sans-serif",
  tiresias: "'TiresiasFont', sans-serif",
};

// Local font files — tried first before CDN fallback
const LOCAL_FONT_FILES = {
  lexia:    { file: 'fonts/LexiaReadable.ttf',    familyName: 'LexiaReadable' },
  tiresias: { file: 'fonts/TiresiasInfofont.ttf', familyName: 'TiresiasFont' },
};

const FONT_CSS_CANDIDATES = {
  lexia: [
    'https://fonts.cdnfonts.com/css/lexia-readable',
    'https://fonts.cdnfonts.com/css/lexia',
  ],
  tiresias: [
    'https://fonts.cdnfonts.com/css/tiresias-infofont',
    'https://fonts.cdnfonts.com/css/tiresias-pcfont',
  ],
};

const loadedFonts = new Set();
const fontAssets = new Map();
let openDyslexicBytes = null;
let _fontkitLib = null;
let odPreviewReady = false;

function getFontkitLib() { return _fontkitLib; }

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function ensureFontkit() {
  if (_fontkitLib) return _fontkitLib;
  const fontkitUrls = [
    'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js',
    'https://unpkg.com/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js',
  ];
  for (const url of fontkitUrls) {
    try {
      await loadScript(url);
      if (window.fontkit) { _fontkitLib = window.fontkit; return _fontkitLib; }
    } catch (e) {}
  }
  return null;
}

async function loadFontViaCSS(cssUrl, familyName) {
  const css = await fetch(cssUrl).then(response => response.ok ? response.text() : Promise.reject(new Error('css 404')));
  const match = css.match(/url\(['"]?([^'")\s]+\.(?:woff2?|ttf))['"]?\)/i);
  if (!match) throw new Error('no font url in css');

  const fontUrl = new URL(match[1], cssUrl).href;
  const buffer = await fetch(fontUrl).then(response => response.ok ? response.arrayBuffer() : Promise.reject(new Error('font 404')));
  return buffer;
}

async function registerFontFace(familyName, buffer) {
  const fontFace = new FontFace(familyName, buffer);
  await fontFace.load();
  document.fonts.add(fontFace);
}

async function loadExternalFont(key, familyName) {
  if (loadedFonts.has(key)) return true;

  // Try bundled local file first
  const local = LOCAL_FONT_FILES[key];
  if (local) {
    try {
      const response = await fetch(local.file);
      if (response.ok) {
        const buffer = await response.arrayBuffer();
        await registerFontFace(familyName, buffer);
        loadedFonts.add(key);
        fontAssets.set(key, { bytes: buffer, familyName });
        await ensureFontkit();
        return true;
      }
    } catch (e) {}
  }

  // CDN fallback
  for (const cssUrl of FONT_CSS_CANDIDATES[key] || []) {
    try {
      const buffer = await loadFontViaCSS(cssUrl, familyName);
      await registerFontFace(familyName, buffer);
      loadedFonts.add(key);
      fontAssets.set(key, { bytes: buffer, familyName });
      await ensureFontkit();
      return true;
    } catch (error) {}
  }

  return false;
}

async function initOpenDyslexicSupport(fontSelect, fontStatus, renderPreview) {
  const fontUrls = [
    'https://cdn.jsdelivr.net/gh/antijingoist/open-dyslexic@master/ttf/OpenDyslexic-Regular.ttf',
    'https://cdn.jsdelivr.net/gh/madjeek-web/open-dyslexic@main/OpenDyslexic-2025/opendyslexic-regular-webfont.ttf',
  ];

  try {
    const fk = await ensureFontkit();
    if (!fk) throw new Error('fontkit unavailable');

    let buffer = null;
    for (const url of fontUrls) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          buffer = await response.arrayBuffer();
          break;
        }
      } catch (error) {}
    }
    if (!buffer) throw new Error('OpenDyslexic unavailable');
    openDyslexicBytes = buffer;
    fontAssets.set('opendyslexic', { bytes: buffer, familyName: 'ODPreview' });

    try {
      await registerFontFace('ODPreview', buffer);
      odPreviewReady = true;
    } catch (error) {}

    if (fontSelect.value === 'opendyslexic') {
      fontStatus.textContent = '';
      renderPreview();
    }
  } catch (error) {
    if (fontSelect.value === 'opendyslexic') fontStatus.textContent = 'unavailable';
  }
}

function getFontAsset(key) {
  return fontAssets.get(key) || null;
}

Object.assign(window, {
  PREVIEW_FONTS,
  FONT_CSS_CANDIDATES,
  loadedFonts,
  openDyslexicBytes,
  odPreviewReady,
  loadExternalFont,
  initOpenDyslexicSupport,
  getFontAsset,
  getFontkitLib,
});
