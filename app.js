pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const { PDFDocument, StandardFonts, rgb } = PDFLib;
const $ = id => document.getElementById(id);

const drop = $('drop');
const fileInput = $('file');
const previewFrame = $('preview-frame');
const previewScaler = $('preview-scaler');
const previewEl = $('preview');
const filebarEl = $('filebar');
const optsPanel = $('opts-panel');
const fname = $('fname');
const fmeta = $('fmeta');
const reset = $('reset');
const fontSelect = $('o-font-select');
const fontStatus = $('font-status');
const zoomBar = $('zoom-bar');
const zoomInBtn = $('zoom-in');
const zoomOutBtn = $('zoom-out');
const zoomResetBtn = $('zoom-reset');
const orientationToggleBtn = $('orientation-toggle');
const zoomLevelEl = $('zoom-level');
const sizeEl = $('size');
const sizeVal = $('size-val');
const statusEl = $('status');
const makeBtn = $('make');
const themeToggle = $('theme-toggle');
const ocrProgress = $('ocr-progress');
const ocrProgressBar = $('ocr-progress-bar');
const ocrProgressLabel = $('ocr-progress-label');
const ocrProgressText = $('ocr-progress-text');

const themeController = createThemeController(themeToggle);
const exportPdf = createPdfExporter(PDFDocument, StandardFonts, rgb);

let docLines = [];
let baseName = 'document';
let zoomLevel = 1;
let pageOrientation = 'portrait';
let tesseractLoading = null;

function getOptions() {
  return {
    font: fontSelect.value,
    line: $('o-line').checked,
    letter: $('o-letter').checked,
    word: $('o-word').checked,
    bg: $('o-bg').checked,
    size: parseInt(sizeEl.value, 10),
    orientation: pageOrientation,
  };
}

function syncOptStyles() {
  document.querySelectorAll('.opt').forEach(label => {
    const checkbox = label.querySelector('input');
    label.classList.toggle('off', !checkbox.checked);
  });
}

function setStatus(message, className = '') {
  statusEl.className = 'status ' + className;
  statusEl.innerHTML = message;
}

function resetOcrProgress() {
  if (ocrProgress) {
    ocrProgress.classList.add('hidden');
    if (ocrProgressBar) ocrProgressBar.style.width = '0%';
    if (ocrProgressText) ocrProgressText.textContent = '0%';
    if (ocrProgressLabel) ocrProgressLabel.textContent = 'OCR in progress…';
  }
}

function updateOcrProgress(percent, label = 'OCR in progress…') {
  if (!ocrProgress || !ocrProgressBar || !ocrProgressText || !ocrProgressLabel) return;
  ocrProgress.classList.remove('hidden');
  const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
  ocrProgressBar.style.width = safePercent + '%';
  ocrProgressText.textContent = safePercent + '%';
  ocrProgressLabel.textContent = label;
}

function applyZoom() {
  zoomLevelEl.textContent = Math.round(zoomLevel * 100) + ' %';
  previewScaler.style.transform = `scale(${zoomLevel})`;
}

function changeZoom(delta) {
  zoomLevel = Math.max(0.3, Math.min(3, parseFloat((zoomLevel + delta).toFixed(1))));
  applyZoom();
}

function updateOrientationButton() {
  if (!orientationToggleBtn) return;
  const isLandscape = pageOrientation === 'landscape';
  orientationToggleBtn.classList.toggle('active', isLandscape);
  orientationToggleBtn.title = isLandscape ? 'Switch to portrait' : 'Switch to landscape';
  orientationToggleBtn.setAttribute('aria-label', isLandscape ? 'Switch to portrait' : 'Switch to landscape');
}

function togglePageOrientation() {
  pageOrientation = pageOrientation === 'landscape' ? 'portrait' : 'landscape';
  updateOrientationButton();
}

function renderCurrentPreview() {
  renderPreview(docLines, getOptions(), previewEl, previewFrame);
}

async function ensureOcrEngine() {
  if (window.Tesseract?.recognize) return true;
  if (tesseractLoading) return tesseractLoading;

  updateOcrProgress(5, 'Loading OCR engine…');
  setStatus('<span class="spinner"></span>Loading OCR engine…', 'work');

  tesseractLoading = new Promise(resolve => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    script.async = true;
    script.onload = () => resolve(Boolean(window.Tesseract?.recognize));
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });

  return tesseractLoading;
}

function isComplexOcrText(text) {
  const raw = (text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return true;

  const letters = (raw.match(/[A-Za-z]/g) || []).length;
  const digits = (raw.match(/[0-9]/g) || []).length;
  const symbols = (raw.match(/[^A-Za-z0-9\s.,:;()\-\/]/g) || []).length;
  const words = raw.split(/\s+/).filter(Boolean);
  const alphaWords = words.filter(word => /[A-Za-z]/.test(word));
  const shortWords = words.filter(word => word.length <= 2).length;
  const vowelLessWords = words.filter(word => /[aeiou]/i.test(word) === false && word.length > 2).length;

  if (letters < 12 && digits < 4) return true;
  if (words.length > 4 && alphaWords.length < 3) return true;
  if (words.length > 6 && shortWords / words.length > 0.35) return true;
  if (words.length > 6 && vowelLessWords / words.length > 0.25) return true;
  if (symbols / Math.max(1, raw.length) > 0.28) return true;
  return false;
}

function buildOcrLines(text) {
  const blocks = (text || '').replace(/\r/g, '').split(/\n{2,}/);
  const lines = [];

  for (const block of blocks) {
    const paragraphLines = block
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);

    for (const line of paragraphLines) {
      if (!line || line.length < 2) continue;
      lines.push({
        text: line,
        size: 12,
        para: false,
        x: 0,
        isCode: false,
        isBullet: false,
        isNumbered: false,
        numPrefix: '',
        isFooter: false,
        isPageHeader: false,
      });
    }
  }

  return lines;
}

function normalizeLineTextForDedup(text) {
  return (text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?()\[\]{}"'`´]/g, '')
    .trim();
}

function dedupePageTextLines(lines) {
  const out = [];
  const byKey = new Map();

  for (const line of lines || []) {
    const normalized = normalizeLineTextForDedup(line.text);
    if (!normalized) continue;

    const indent = Math.round(line.indent || 0);
    const y = Number.isFinite(line.y) ? line.y : null;
    const yBucket = y === null ? 'na' : String(Math.round(y / 3));
    const key = [normalized, indent, line.isBullet ? 1 : 0, line.isNumbered ? 1 : 0, line.isCode ? 1 : 0, yBucket].join('|');

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, line);
      out.push(line);
      continue;
    }

    const sameY = y !== null && Number.isFinite(existing.y) ? Math.abs(y - existing.y) <= 3 : true;
    if (!sameY) {
      const fallbackKey = [normalized, indent, line.isBullet ? 1 : 0, line.isNumbered ? 1 : 0, line.isCode ? 1 : 0].join('|');
      const fallback = byKey.get(fallbackKey);
      if (!fallback) {
        byKey.set(fallbackKey, line);
        out.push(line);
      }
      continue;
    }
    // Duplicate line at near-identical position: skip.
  }

  return out;
}

async function renderPdfPageToCanvas(page, scale = 1.4) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const context = canvas.getContext('2d');
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas;
}

function getAverageColorForRegion(ctx, x, y, width, height) {
  const imageData = ctx.getImageData(x, y, width, height);
  const { data } = imageData;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let count = 0;

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha < 24) continue;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    a += alpha;
    count += 1;
  }

  if (!count) {
    return 'rgba(255,255,255,0.96)';
  }

  return `rgba(${Math.round(r / count)}, ${Math.round(g / count)}, ${Math.round(b / count)}, 0.96)`;
}

function normalizeBox(box, width, height) {
  const bbox = box || {};
  const x0 = Math.max(0, Math.round(bbox.x0 ?? bbox.x ?? bbox.left ?? 0));
  const y0 = Math.max(0, Math.round(bbox.y0 ?? bbox.y ?? bbox.top ?? 0));
  const x1 = Math.min(width, Math.round(bbox.x1 ?? bbox.x + bbox.w ?? bbox.right ?? width));
  const y1 = Math.min(height, Math.round(bbox.y1 ?? bbox.y + bbox.h ?? bbox.bottom ?? height));
  return { x0, y0, x1, y1 };
}

function mergeNearbyBoxes(boxes, gap = 4) {
  if (!boxes.length) return [];

  const sorted = [...boxes].sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0);
  const merged = [sorted[0]];

  for (const box of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    const overlapX = box.x0 <= last.x1 + gap && box.x1 >= last.x0 - gap;
    const overlapY = box.y0 <= last.y1 + gap && box.y1 >= last.y0 - gap;

    if (overlapX && overlapY) {
      last.x0 = Math.min(last.x0, box.x0);
      last.y0 = Math.min(last.y0, box.y0);
      last.x1 = Math.max(last.x1, box.x1);
      last.y1 = Math.max(last.y1, box.y1);
    } else {
      merged.push(box);
    }
  }

  return merged;
}

function maskTextInCanvas(sourceCanvas, ocrData) {
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = sourceCanvas.width;
  outputCanvas.height = sourceCanvas.height;
  const outputCtx = outputCanvas.getContext('2d');
  outputCtx.drawImage(sourceCanvas, 0, 0);

  const sourceCtx = sourceCanvas.getContext('2d');
  const boxes = [];

  (ocrData?.words || []).forEach(word => {
    if (word?.bbox) boxes.push(normalizeBox(word.bbox, sourceCanvas.width, sourceCanvas.height));
  });

  (ocrData?.lines || []).forEach(line => {
    if (line?.bbox) boxes.push(normalizeBox(line.bbox, sourceCanvas.width, sourceCanvas.height));
  });

  if (!boxes.length) return outputCanvas;

  const mergedBoxes = mergeNearbyBoxes(boxes, 5);

  mergedBoxes.forEach(box => {
    const { x0, y0, x1, y1 } = box;
    const width = Math.max(4, x1 - x0);
    const height = Math.max(4, y1 - y0);
    const pad = Math.max(3, Math.round(Math.min(width, height) * 0.18));

    const paddingX = Math.max(0, x0 - pad);
    const paddingY = Math.max(0, y0 - pad);
    const paddedWidth = Math.min(sourceCanvas.width - paddingX, width + pad * 2);
    const paddedHeight = Math.min(sourceCanvas.height - paddingY, height + pad * 2);

    outputCtx.fillStyle = getAverageColorForRegion(sourceCtx, paddingX, paddingY, paddedWidth, paddedHeight);
    outputCtx.fillRect(paddingX, paddingY, paddedWidth, paddedHeight);
  });

  return outputCanvas;
}

function cropCanvasToContent(sourceCanvas, padding = 10) {
  const ctx = sourceCanvas.getContext('2d');
  const { width, height } = sourceCanvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;

  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let found = false;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const alpha = data[index + 3];
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const isBackground = alpha < 24 || (r > 240 && g > 240 && b > 240);

      if (!isBackground) {
        found = true;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (!found) return sourceCanvas;

  const cropX = Math.max(0, minX - padding);
  const cropY = Math.max(0, minY - padding);
  const cropWidth = Math.min(width - cropX, maxX - cropX + padding * 2 + 1);
  const cropHeight = Math.min(height - cropY, maxY - cropY + padding * 2 + 1);

  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = cropWidth;
  outputCanvas.height = cropHeight;
  const outputCtx = outputCanvas.getContext('2d');
  outputCtx.drawImage(sourceCanvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

  return outputCanvas;
}

async function renderPageCanvas(page, scale = 1.6, ocrData = null) {
  const canvas = await renderPdfPageToCanvas(page, scale);
  let outputCanvas = canvas;

  if (ocrData) {
    outputCanvas = maskTextInCanvas(canvas, ocrData);
  }

  return cropCanvasToContent(outputCanvas, 8);
}

async function renderPdfPageToImageDataUrl(page, scale = 1.6, ocrData = null) {
  const outputCanvas = await renderPageCanvas(page, scale, ocrData);
  return {
    imageDataUrl: outputCanvas.toDataURL('image/png'),
    landscape: outputCanvas.width > outputCanvas.height * 1.05,
  };
}

function createCanvasRegion(sourceCanvas, region, padding = 8) {
  const { x0, y0, x1, y1 } = region;
  const width = Math.max(4, x1 - x0);
  const height = Math.max(4, y1 - y0);
  const aspect = width / Math.max(1, height);
  const extraX = aspect > 1.35 ? Math.max(padding, Math.round(width * 0.04)) : padding;
  const extraY = aspect > 1.35 ? Math.max(padding + 8, Math.round(height * 0.18)) : padding;

  const cropX = Math.max(0, x0 - extraX);
  const cropY = Math.max(0, y0 - extraY);
  const cropWidth = Math.min(sourceCanvas.width - cropX, width + extraX * 2);
  const cropHeight = Math.min(sourceCanvas.height - cropY, height + extraY * 2);

  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = cropWidth;
  outputCanvas.height = cropHeight;
  const outputCtx = outputCanvas.getContext('2d');
  outputCtx.drawImage(sourceCanvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  return outputCanvas;
}

function expandRegionToContent(canvas, region, textRegions = [], maxGrowOverride = null) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;
  const textMask = new Uint8Array(width * height);

  for (const t of textRegions) {
    const x0 = Math.max(0, Math.floor(t.x0));
    const y0 = Math.max(0, Math.floor(t.y0));
    const x1 = Math.min(width, Math.ceil(t.x1));
    const y1 = Math.min(height, Math.ceil(t.y1));
    for (let y = y0; y < y1; y += 1) {
      const row = y * width;
      for (let x = x0; x < x1; x += 1) textMask[row + x] = 1;
    }
  }

  function isVisualPixel(x, y) {
    const p = y * width + x;
    if (textMask[p]) return false;
    const i = p * 4;
    const alpha = data[i + 3];
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    return alpha > 24 && !(r > 247 && g > 247 && b > 247);
  }

  let x0 = Math.max(0, Math.floor(region.x0));
  let y0 = Math.max(0, Math.floor(region.y0));
  let x1 = Math.min(width, Math.ceil(region.x1));
  let y1 = Math.min(height, Math.ceil(region.y1));

  const maxGrow = maxGrowOverride ?? Math.max(18, Math.round(Math.min(width, height) * 0.09));

  for (let step = 0; step < maxGrow; step += 1) {
    let grew = false;

    if (x0 > 0) {
      let hit = 0;
      for (let y = y0; y < y1; y += 1) if (isVisualPixel(x0 - 1, y)) hit += 1;
      if (hit > Math.max(2, Math.round((y1 - y0) * 0.02))) {
        x0 -= 1;
        grew = true;
      }
    }
    if (x1 < width) {
      let hit = 0;
      for (let y = y0; y < y1; y += 1) if (isVisualPixel(x1, y)) hit += 1;
      if (hit > Math.max(2, Math.round((y1 - y0) * 0.02))) {
        x1 += 1;
        grew = true;
      }
    }
    if (y0 > 0) {
      let hit = 0;
      for (let x = x0; x < x1; x += 1) if (isVisualPixel(x, y0 - 1)) hit += 1;
      if (hit > Math.max(2, Math.round((x1 - x0) * 0.015))) {
        y0 -= 1;
        grew = true;
      }
    }
    if (y1 < height) {
      let hit = 0;
      for (let x = x0; x < x1; x += 1) if (isVisualPixel(x, y1)) hit += 1;
      if (hit > Math.max(2, Math.round((x1 - x0) * 0.015))) {
        y1 += 1;
        grew = true;
      }
    }

    if (!grew) break;
  }

  return { ...region, x0, y0, x1, y1, area: Math.max(1, (x1 - x0) * (y1 - y0)) };
}

function buildTextMask(width, height, textRegions = []) {
  const mask = new Uint8Array(width * height);
  for (const t of textRegions) {
    const x0 = Math.max(0, Math.floor(t.x0));
    const y0 = Math.max(0, Math.floor(t.y0));
    const x1 = Math.min(width, Math.ceil(t.x1));
    const y1 = Math.min(height, Math.ceil(t.y1));
    for (let y = y0; y < y1; y += 1) {
      const row = y * width;
      for (let x = x0; x < x1; x += 1) mask[row + x] = 1;
    }
  }
  return mask;
}

function trimRegionTextEdges(canvas, region, textRegions = []) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;
  const textMask = buildTextMask(width, height, textRegions);

  let x0 = Math.max(0, Math.floor(region.x0));
  let y0 = Math.max(0, Math.floor(region.y0));
  let x1 = Math.min(width, Math.ceil(region.x1));
  let y1 = Math.min(height, Math.ceil(region.y1));

  const minWidth = Math.max(40, Math.round(width * 0.12));
  const minHeight = Math.max(40, Math.round(height * 0.12));
  const maxTrimX = Math.max(14, Math.round((x1 - x0) * 0.24));
  const maxTrimY = Math.max(14, Math.round((y1 - y0) * 0.24));
  const trimStep = 4;
  let trimmedLeft = 0;
  let trimmedRight = 0;
  let trimmedTop = 0;
  let trimmedBottom = 0;

  function isInkPixel(pixelIndex) {
    const i = pixelIndex * 4;
    const alpha = data[i + 3];
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const nearWhite = r > 247 && g > 247 && b > 247;
    return alpha > 24 && !nearWhite;
  }

  function sideStats(side, stripSize) {
    let ink = 0;
    let textInk = 0;
    let visualInk = 0;

    if (side === 'left' || side === 'right') {
      const startX = side === 'left' ? x0 : Math.max(x0, x1 - stripSize);
      const endX = side === 'left' ? Math.min(x1, x0 + stripSize) : x1;
      for (let y = y0; y < y1; y += 1) {
        const row = y * width;
        for (let x = startX; x < endX; x += 1) {
          const p = row + x;
          if (!isInkPixel(p)) continue;
          ink += 1;
          if (textMask[p]) textInk += 1;
          else visualInk += 1;
        }
      }
    } else {
      const startY = side === 'top' ? y0 : Math.max(y0, y1 - stripSize);
      const endY = side === 'top' ? Math.min(y1, y0 + stripSize) : y1;
      for (let y = startY; y < endY; y += 1) {
        const row = y * width;
        for (let x = x0; x < x1; x += 1) {
          const p = row + x;
          if (!isInkPixel(p)) continue;
          ink += 1;
          if (textMask[p]) textInk += 1;
          else visualInk += 1;
        }
      }
    }

    return { ink, textInk, visualInk };
  }

  function shouldTrim(side) {
    const strip = Math.min(trimStep * 2, side === 'left' || side === 'right' ? x1 - x0 : y1 - y0);
    if (strip <= 0) return false;
    const { ink, textInk, visualInk } = sideStats(side, strip);
    if (ink < 24) return false;
    const textShare = textInk / ink;
    const visualShare = visualInk / ink;
    return textShare >= 0.62 && visualShare <= 0.28;
  }

  let changed = true;
  while (changed) {
    changed = false;

    if (x1 - x0 > minWidth && trimmedLeft < maxTrimX && shouldTrim('left')) {
      x0 = Math.min(x1 - minWidth, x0 + trimStep);
      trimmedLeft += trimStep;
      changed = true;
    }
    if (x1 - x0 > minWidth && trimmedRight < maxTrimX && shouldTrim('right')) {
      x1 = Math.max(x0 + minWidth, x1 - trimStep);
      trimmedRight += trimStep;
      changed = true;
    }
    if (y1 - y0 > minHeight && trimmedTop < maxTrimY && shouldTrim('top')) {
      y0 = Math.min(y1 - minHeight, y0 + trimStep);
      trimmedTop += trimStep;
      changed = true;
    }
    if (y1 - y0 > minHeight && trimmedBottom < maxTrimY && shouldTrim('bottom')) {
      y1 = Math.max(y0 + minHeight, y1 - trimStep);
      trimmedBottom += trimStep;
      changed = true;
    }
  }

  return { ...region, x0, y0, x1, y1, area: Math.max(1, (x1 - x0) * (y1 - y0)) };
}

// expandRegionToContent only grows toward unmasked ("non-text") pixels, so a
// caption sitting right next to a figure (e.g. an axis label like "Y=128")
// gets sliced in half instead of cleanly included or excluded — its masked
// core doesn't count as growth fuel, only its antialiased edge does. Since we
// already know each text item's exact box, pull in ones that sit just
// outside the region and are caption-sized (not a stray nearby paragraph).
function growRegionWithNearbyLabels(region, textRegions, maxGap = 10) {
  let { x0, y0, x1, y1 } = region;
  const start = { x0, y0, x1, y1 };
  const startWidth = Math.max(1, start.x1 - start.x0);
  const startHeight = Math.max(1, start.y1 - start.y0);
  const maxExpandX = Math.max(14, Math.min(86, Math.round(startWidth * 0.32)));
  const maxExpandY = Math.max(14, Math.min(96, Math.round(startHeight * 0.34)));

  function intersectionSize(a0, a1, b0, b1) {
    return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  }

  function canExpandTo(candidate) {
    const growLeft = Math.max(0, start.x0 - candidate.x0);
    const growTop = Math.max(0, start.y0 - candidate.y0);
    const growRight = Math.max(0, candidate.x1 - start.x1);
    const growBottom = Math.max(0, candidate.y1 - start.y1);
    return growLeft <= maxExpandX && growRight <= maxExpandX && growTop <= maxExpandY && growBottom <= maxExpandY;
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const t of textRegions) {
      const boxWidth = t.x1 - t.x0;
      const boxHeight = t.y1 - t.y0;
      // Large typeset formulas run taller than a normal caption, so the
      // height cap is generous. The width cap is an absolute figure-caption
      // size (not relative to the region, which can start out very small,
      // e.g. just an icon) — wide enough for a typeset formula line, but
      // well short of a full bullet/paragraph line of body text.
      if (boxHeight > 92 || boxWidth > 260) continue;
      const overlapsX = t.x1 >= x0 - maxGap && t.x0 <= x1 + maxGap;
      const overlapsY = t.y1 >= y0 - maxGap && t.y0 <= y1 + maxGap;
      if (!overlapsX || !overlapsY) continue;

      const overlapW = intersectionSize(x0, x1, t.x0, t.x1);
      const overlapH = intersectionSize(y0, y1, t.y0, t.y1);
      const overlapXRatio = overlapW / Math.max(1, boxWidth);
      const overlapYRatio = overlapH / Math.max(1, boxHeight);
      const horizontalGap = Math.max(0, Math.max(x0 - t.x1, t.x0 - x1));
      const verticalGap = Math.max(0, Math.max(y0 - t.y1, t.y0 - y1));

      const stronglyAligned = (overlapXRatio >= 0.58 && verticalGap <= maxGap)
        || (overlapYRatio >= 0.58 && horizontalGap <= maxGap);
      if (!stronglyAligned) continue;

      const newX0 = Math.min(x0, t.x0);
      const newY0 = Math.min(y0, t.y0);
      const newX1 = Math.max(x1, t.x1);
      const newY1 = Math.max(y1, t.y1);

      const candidate = { x0: newX0, y0: newY0, x1: newX1, y1: newY1 };
      if (!canExpandTo(candidate)) continue;

      if (newX0 !== x0 || newY0 !== y0 || newX1 !== x1 || newY1 !== y1) {
        x0 = newX0; y0 = newY0; x1 = newX1; y1 = newY1;
        changed = true;
      }
    }
  }
  return { ...region, x0, y0, x1, y1, area: Math.max(1, (x1 - x0) * (y1 - y0)) };
}

function buildTextRegionsFromItems(items, viewport, scale = 1.6) {
  const pageHeight = (viewport?.height || 842) * scale;
  const textRegions = [];

  for (const item of items || []) {
    if (!item?.str || !item.str.trim()) continue;
    const transform = item.transform || [1, 0, 0, 1, 0, 0];
    const x = Math.round((transform[4] || 0) * scale);
    const yBottom = Math.round((transform[5] || 0) * scale);
    const width = Math.max(3, Math.round((item.width || 0) * scale));
    const height = Math.max(8, Math.round((item.height || Math.abs(transform[3]) || 10) * scale));
    const yTop = Math.max(0, pageHeight - yBottom - height);

    textRegions.push({
      x0: Math.max(0, x - 3),
      y0: Math.max(0, yTop - 2),
      x1: x + width + 3,
      y1: yTop + height + 2,
    });
  }

  return textRegions;
}

function scoreImageRegion(region, canvasWidth) {
  const width = Math.max(1, region.x1 - region.x0);
  const height = Math.max(1, region.y1 - region.y0);
  const aspect = width / height;
  const centerX = (region.x0 + region.x1) * 0.5;
  const rightBias = centerX / Math.max(1, canvasWidth);
  const aspectPenalty = aspect < 0.25 || aspect > 4.5 ? 0.5 : 1;
  return region.area * (0.8 + rightBias * 0.2) * aspectPenalty;
}

function areaOfIntersection(a, b) {
  const x0 = Math.max(a.x0, b.x0);
  const y0 = Math.max(a.y0, b.y0);
  const x1 = Math.min(a.x1, b.x1);
  const y1 = Math.min(a.y1, b.y1);
  const w = Math.max(0, x1 - x0);
  const h = Math.max(0, y1 - y0);
  return w * h;
}

function estimateTextOverlapRatio(region, textRegions) {
  const regionArea = Math.max(1, (region.x1 - region.x0) * (region.y1 - region.y0));
  let overlap = 0;
  for (const textRegion of textRegions || []) {
    overlap += areaOfIntersection(region, textRegion);
  }
  return overlap / regionArea;
}

function countTouchedEdges(region, canvasWidth, canvasHeight, tolerance = 6) {
  let count = 0;
  if (region.x0 <= tolerance) count += 1;
  if (region.y0 <= tolerance) count += 1;
  if (region.x1 >= canvasWidth - tolerance) count += 1;
  if (region.y1 >= canvasHeight - tolerance) count += 1;
  return count;
}

function regionPassesHardFilter(region, canvasWidth, canvasHeight, textRegions, strictMode) {
  const boxWidth = Math.max(1, region.x1 - region.x0);
  const boxHeight = Math.max(1, region.y1 - region.y0);
  const areaRatio = region.area / Math.max(1, canvasWidth * canvasHeight);
  const widthRatio = boxWidth / Math.max(1, canvasWidth);
  const heightRatio = boxHeight / Math.max(1, canvasHeight);
  const fillRatio = region.area / Math.max(1, boxWidth * boxHeight);
  const aspect = boxWidth / boxHeight;
  const centerXRatio = (region.x0 + region.x1) * 0.5 / Math.max(1, canvasWidth);
  const textOverlapRatio = estimateTextOverlapRatio(region, textRegions);
  const touchedEdges = countTouchedEdges(region, canvasWidth, canvasHeight);

  if (strictMode) {
    // Small, dense, self-contained elements (an icon, a labeled diagram box)
    // must also be recognized as images, not just one big central figure —
    // so the size floor is low, and the text-overlap allowance is generous
    // because a real diagram box legitimately has its own caption drawn on
    // it. fillRatio alone can't reliably separate "leaked/merged body text"
    // from "genuine but visually sparse art" (thin line art or stylized
    // lettering has a lot of negative space too) — but a region that touches
    // no page edge and barely overlaps real text is strong independent
    // evidence it's a clean, self-contained figure, so it gets a much lower
    // density floor. A region touching an edge or overlapping text more
    // needs to be much denser to still count as a real image.
    if (areaRatio < 0.008 || areaRatio > 0.82) return false;
    if (widthRatio < 0.1 || heightRatio < 0.08) return false;
    const isCleanlyIsolated = touchedEdges === 0 && textOverlapRatio < 0.05;
    if (fillRatio < (isCleanlyIsolated ? 0.08 : 0.42)) return false;
    if (aspect < 0.22 || aspect > 4.8) return false;
    if (textOverlapRatio > 0.36) return false;
    if (touchedEdges >= 3) return false;
    if (centerXRatio < 0.12) return false;
    return true;
  }

  if (areaRatio < 0.035 || areaRatio > 0.9) return false;
  if (widthRatio < 0.16 || heightRatio < 0.12) return false;
  if (fillRatio < 0.18) return false;
  if (aspect < 0.18 || aspect > 6.0) return false;
  if (textOverlapRatio > 0.03) return false;
  if (touchedEdges >= 4) return false;
  return true;
}

function pickBestImageRegions(regions, canvasWidth, canvasHeight, textRegions, preferSingleMainRegion) {
  if (!regions.length) return [];

  const strictMode = Boolean(preferSingleMainRegion);
  const filtered = regions.filter(region => regionPassesHardFilter(region, canvasWidth, canvasHeight, textRegions, strictMode));
  if (!filtered.length) return [];

  const sorted = [...filtered].sort((a, b) => scoreImageRegion(b, canvasWidth) - scoreImageRegion(a, canvasWidth));
  // Each candidate here has already individually passed the hard filter (good
  // density, sane size/aspect, not hugging page edges), so several of them
  // can legitimately coexist — e.g. an icon plus a multi-part labeled diagram.
  // Keep all of them (capped to avoid pathological over-splitting) rather than
  // arbitrarily dropping all but one or two.
  return sorted.slice(0, 5);
}

function shouldKeepRegionsForPage(selectedRegions, pageTextLines, canvasWidth, canvasHeight) {
  if (!selectedRegions.length) return false;

  // A region that covers a sizeable chunk of the page but is only sparsely
  // filled (a lot of empty space inside its bounding box) is almost always
  // body text that leaked past masking and got merged into the region, not a
  // genuine image — reject it so the text below isn't duplicated as an image.
  // A dense, solid region (e.g. a real photo/illustration/banner) is kept
  // even if it's large.
  if ((pageTextLines || []).length > 2) {
    const hasSparseBlob = selectedRegions.some(region => {
      const boxWidth = Math.max(1, region.x1 - region.x0);
      const boxHeight = Math.max(1, region.y1 - region.y0);
      const boxAreaRatio = (boxWidth * boxHeight) / Math.max(1, canvasWidth * canvasHeight);
      const fillRatio = region.area / Math.max(1, boxWidth * boxHeight);
      return boxAreaRatio > 0.3 && fillRatio < 0.35;
    });
    if (hasSparseBlob) return false;
  }

  if (selectedRegions.length >= 2) return true;
  const isLowTextPage = (pageTextLines || []).length <= 2;
  if (!isLowTextPage) return true;

  const main = selectedRegions[0];
  if (!main) return false;

  const boxWidth = Math.max(1, main.x1 - main.x0);
  const boxHeight = Math.max(1, main.y1 - main.y0);
  const areaRatio = main.area / Math.max(1, canvasWidth * canvasHeight);
  const widthRatio = boxWidth / Math.max(1, canvasWidth);
  const heightRatio = boxHeight / Math.max(1, canvasHeight);

  return areaRatio >= 0.12 && widthRatio >= 0.28 && heightRatio >= 0.24;
}

function getPageTextStats(pageTextLines) {
  const lineCount = (pageTextLines || []).length;
  const charCount = (pageTextLines || []).reduce((sum, line) => sum + ((line?.text || '').trim().length), 0);
  return { lineCount, charCount };
}

function shouldPreferImageOnly(pageTextLines, pageImageBlocks) {
  const { lineCount, charCount } = getPageTextStats(pageTextLines);
  if (!lineCount || !pageImageBlocks.length) return false;
  if (lineCount > 3 || charCount > 42) return false;

  const hasDominantImage = pageImageBlocks.some(block => (Number(block.imageWidthRatio) || 0) >= 0.55);
  return hasDominantImage;
}

function detectImageRegionsFromCanvas(canvas, textRegions = []) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;
  const visited = new Uint8Array(width * height);
  const textMask = new Uint8Array(width * height);
  const regions = [];
  const minArea = Math.max(900, Math.round(width * height * 0.005));
  const minBox = Math.max(24, Math.round(Math.min(width, height) * 0.08));

  for (const region of textRegions) {
    const x0 = Math.max(0, Math.floor(region.x0));
    const y0 = Math.max(0, Math.floor(region.y0));
    const x1 = Math.min(width, Math.ceil(region.x1));
    const y1 = Math.min(height, Math.ceil(region.y1));
    for (let y = y0; y < y1; y += 1) {
      const row = y * width;
      for (let x = x0; x < x1; x += 1) {
        textMask[row + x] = 1;
      }
    }
  }

  function isSignificantPixel(x, y) {
    const pixelIndex = y * width + x;
    if (textMask[pixelIndex]) return false;

    const index = pixelIndex * 4;
    const alpha = data[index + 3];
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const nearWhite = r > 247 && g > 247 && b > 247;
    return alpha > 24 && !nearWhite;
  }

  function floodFill(startX, startY) {
    const stack = [[startX, startY]];
    const pixels = [];
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let area = 0;

    while (stack.length) {
      const [x, y] = stack.pop();
      const index = y * width + x;
      if (x < 0 || y < 0 || x >= width || y >= height || visited[index] || !isSignificantPixel(x, y)) continue;

      visited[index] = 1;
      pixels.push([x, y]);
      area += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      stack.push([x + 1, y]);
      stack.push([x - 1, y]);
      stack.push([x, y + 1]);
      stack.push([x, y - 1]);
      stack.push([x + 1, y + 1]);
      stack.push([x - 1, y + 1]);
      stack.push([x + 1, y - 1]);
      stack.push([x - 1, y - 1]);
    }

    if (!area) return null;
    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;
    if (area < minArea || boxWidth < minBox || boxHeight < minBox) return null;
    return { x0: minX, y0: minY, x1: maxX + 1, y1: maxY + 1, area };
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (visited[index] || !isSignificantPixel(x, y)) continue;
      const region = floodFill(x, y);
      if (region) regions.push(region);
    }
  }

  const merged = [];
  regions.sort((a, b) => b.area - a.area);

  for (const region of regions) {
    let mergedRegion = null;
    for (const candidate of merged) {
      const overlapX = region.x0 <= candidate.x1 + 8 && region.x1 >= candidate.x0 - 8;
      const overlapY = region.y0 <= candidate.y1 + 8 && region.y1 >= candidate.y0 - 8;
      if (overlapX && overlapY) {
        mergedRegion = candidate;
        break;
      }
    }
    if (!mergedRegion) {
      merged.push({ ...region });
    } else {
      mergedRegion.x0 = Math.min(mergedRegion.x0, region.x0);
      mergedRegion.y0 = Math.min(mergedRegion.y0, region.y0);
      mergedRegion.x1 = Math.max(mergedRegion.x1, region.x1);
      mergedRegion.y1 = Math.max(mergedRegion.y1, region.y1);
      mergedRegion.area = Math.max(mergedRegion.area, region.area);
    }
  }

  return merged;
}

function getDominantVisualRegion(canvas, textRegions = [], preferRightSide = true) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;
  const textMask = new Uint8Array(width * height);

  for (const region of textRegions) {
    const x0 = Math.max(0, Math.floor(region.x0));
    const y0 = Math.max(0, Math.floor(region.y0));
    const x1 = Math.min(width, Math.ceil(region.x1));
    const y1 = Math.min(height, Math.ceil(region.y1));
    for (let y = y0; y < y1; y += 1) {
      const row = y * width;
      for (let x = x0; x < x1; x += 1) textMask[row + x] = 1;
    }
  }

  // A full-width decorative header banner touching the top edge makes every
  // column "have content" near y=0, which defeats the gap search below (it
  // can never find a clean vertical split) and drags the whole page — banner
  // plus body text plus the real figure — into one box. Detect a thin, dense,
  // full-width band starting at the very top and mask it out before doing
  // any content analysis. A genuine full-bleed image (dense all the way
  // through the scanned zone, no transition back to sparse) is left alone.
  {
    const zoneEnd = Math.round(height * 0.25);
    let sawDense = false;
    let bannerBottom = 0;
    for (let y = 0; y < zoneEnd; y += 1) {
      let filled = 0;
      let sampled = 0;
      for (let x = 0; x < width; x += 4) {
        sampled += 1;
        const pixel = y * width + x;
        if (textMask[pixel]) continue;
        const idx = pixel * 4;
        const alpha = data[idx + 3];
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const nearWhite = r > 247 && g > 247 && b > 247;
        if (alpha > 24 && !nearWhite) filled += 1;
      }
      const density = filled / Math.max(1, sampled);
      if (density > 0.6) {
        sawDense = true;
        bannerBottom = y + 1;
      } else if (sawDense) {
        break;
      }
    }
    if (sawDense && bannerBottom < zoneEnd) {
      for (let y = 0; y < bannerBottom; y += 1) {
        const row = y * width;
        for (let x = 0; x < width; x += 1) textMask[row + x] = 1;
      }
    }
  }

  function bboxForRange(startX, endX) {
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let count = 0;

    for (let y = 0; y < height; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        const pixel = y * width + x;
        if (textMask[pixel]) continue;
        const idx = pixel * 4;
        const alpha = data[idx + 3];
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const nearWhite = r > 247 && g > 247 && b > 247;
        if (alpha <= 24 || nearWhite) continue;

        count += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }

    if (!count || maxX < minX || maxY < minY) return null;
    return { x0: minX, y0: minY, x1: maxX + 1, y1: maxY + 1, area: count };
  }

  const fullBox = bboxForRange(0, width);
  if (!fullBox) return null;

  // Find the widest real background gap inside the full content box. A genuine
  // gap (e.g. body text next to a separate small figure) means the content is
  // really two clusters and it's safe to keep only the right one. No gap means
  // the content is continuous (e.g. a full-bleed image with text drawn on top
  // of it) and must be kept whole, or its left edge gets cut off.
  let chosen = fullBox;
  if (preferRightSide) {
    const colHasContent = new Uint8Array(width);
    for (let x = fullBox.x0; x < fullBox.x1; x += 1) {
      for (let y = fullBox.y0; y < fullBox.y1; y += 1) {
        const pixel = y * width + x;
        if (textMask[pixel]) continue;
        const idx = pixel * 4;
        const alpha = data[idx + 3];
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const nearWhite = r > 247 && g > 247 && b > 247;
        if (alpha > 24 && !nearWhite) {
          colHasContent[x] = 1;
          break;
        }
      }
    }

    let gapStart = -1;
    let bestGapEnd = -1;
    let bestGapLen = 0;
    const minGap = Math.max(10, Math.round(width * 0.03));
    for (let x = fullBox.x0; x <= fullBox.x1; x += 1) {
      const isGapCol = x < fullBox.x1 && !colHasContent[x];
      if (isGapCol) {
        if (gapStart === -1) gapStart = x;
      } else if (gapStart !== -1) {
        const gapLen = x - gapStart;
        if (gapLen > bestGapLen) {
          bestGapLen = gapLen;
          bestGapEnd = x;
        }
        gapStart = -1;
      }
    }

    if (bestGapLen >= minGap) {
      const rightBox = bboxForRange(bestGapEnd, width);
      if (rightBox && rightBox.area > width * height * 0.03) {
        chosen = rightBox;
      }
    }
  }

  const boxWidth = Math.max(1, chosen.x1 - chosen.x0);
  const boxHeight = Math.max(1, chosen.y1 - chosen.y0);
  const areaRatio = chosen.area / Math.max(1, width * height);
  const widthRatio = boxWidth / Math.max(1, width);
  const heightRatio = boxHeight / Math.max(1, height);
  const fillRatio = chosen.area / Math.max(1, boxWidth * boxHeight);
  const boxAreaRatio = (boxWidth * boxHeight) / Math.max(1, width * height);

  console.log(`[img-debug] getDominantVisualRegion: fullBox=${JSON.stringify(fullBox)} chosen=${JSON.stringify({ x0: chosen.x0, y0: chosen.y0, x1: chosen.x1, y1: chosen.y1 })} usedGapSplit=${chosen !== fullBox} areaRatio=${areaRatio.toFixed(3)} widthRatio=${widthRatio.toFixed(3)} heightRatio=${heightRatio.toFixed(3)} fillRatio=${fillRatio.toFixed(3)} boxAreaRatio=${boxAreaRatio.toFixed(3)}`);

  if (areaRatio < 0.05 || widthRatio < 0.2 || heightRatio < 0.16) {
    console.log('[img-debug] getDominantVisualRegion: rejected by min-size floor');
    return null;
  }
  // A box that spans a large chunk of the page but is only sparsely filled
  // (e.g. a thin decorative header banner whose bounding box happens to
  // stretch all the way down to a stray shadow/logo pixel near the bottom,
  // with properly-masked body text in between) isn't a real image — it's
  // mostly just page background. Reject it instead of dragging the whole
  // text area along as a redundant "image". Gate on the box's own footprint
  // (boxAreaRatio), not on areaRatio, since a sparse box has a low pixel
  // count even when its bounding box covers most of the page.
  if (boxAreaRatio > 0.3 && fillRatio < 0.35) {
    console.log('[img-debug] getDominantVisualRegion: rejected by sparse-blob check');
    return null;
  }
  return chosen;
}

async function renderPageImageWithTextMask(page, pageNumber, totalPages) {
  const ocrReady = await ensureOcrEngine();
  if (!ocrReady) {
    return renderPdfPageToImageDataUrl(page, 1.6);
  }

  const canvas = await renderPdfPageToCanvas(page, 1.6);
  const languages = ['deu+eng', 'eng'];

  for (const language of languages) {
    try {
      const result = await window.Tesseract.recognize(canvas, language);
      const ocrData = result?.data;
      const hasTextBoxes = (ocrData?.words?.length || 0) + (ocrData?.lines?.length || 0);
      if (hasTextBoxes) {
        return renderPdfPageToImageDataUrl(page, 1.6, ocrData);
      }
    } catch (error) {
      console.warn(`Text masking OCR failed for ${language}:`, error);
    }
  }

  return renderPdfPageToImageDataUrl(page, 1.6);
}

async function getPageImageOperatorStats(page) {
  try {
    const operatorList = await page.getOperatorList();
    const { OPS } = pdfjsLib;
    let imageOps = 0;
    let formOps = 0;
    for (const fn of operatorList?.fnArray || []) {
      if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) {
        imageOps += 1;
      }
      if (fn === OPS.paintFormXObject) {
        formOps += 1;
      }
    }
    return { imageOps, formOps };
  } catch (error) {
    console.warn('Image detection failed:', error);
    return { imageOps: 0, formOps: 0 };
  }
}

async function runOcrForPage(page, pageNumber, totalPages) {
  const ocrReady = await ensureOcrEngine();
  if (!ocrReady) return [];

  const canvas = await renderPdfPageToCanvas(page, 1.6);
  const languages = ['deu+eng', 'eng'];

  for (const language of languages) {
    try {
      updateOcrProgress(10, `OCR page ${pageNumber} of ${totalPages}…`);
      setStatus(`<span class="spinner"></span>OCR page ${pageNumber} of ${totalPages} ...`, 'work');
      const result = await window.Tesseract.recognize(canvas, language, {
        logger: ({ status, progress }) => {
          if (!status) return;
          if (status === 'loading tesseract core' || status === 'initializing tesseract') {
            updateOcrProgress(10, `Starting OCR (${language})…`);
          } else if (status === 'recognizing text') {
            const pct = Math.max(10, Math.min(95, Math.round((progress || 0) * 100)));
            updateOcrProgress(pct, `Recognizing text (${language})…`);
          } else if (status === 'done') {
            updateOcrProgress(100, 'OCR finished');
          }
        },
      });
      resetOcrProgress();
      const text = result?.data?.text || '';
      if (isComplexOcrText(text)) {
        return { type: 'empty', ocrData: result?.data };
      }
      return { type: 'text', lines: buildOcrLines(text), ocrData: result?.data };
    } catch (error) {
      console.warn(`OCR failed for ${language}:`, error);
    }
  }

  resetOcrProgress();
  return { type: 'empty' };
}

async function handleFontChange() {
  const value = fontSelect.value;
  fontStatus.textContent = '';

  if (value === 'opendyslexic') {
    if (!odPreviewReady) fontStatus.textContent = 'unavailable';
  } else if (FONT_CSS_CANDIDATES[value]) {
    fontStatus.textContent = 'loading ...';
    const families = { lexia: 'LexiaReadable', tiresias: 'TiresiasFont' };
    const familyName = families[value];
    const ok = await loadExternalFont(value, familyName);
    if (ok) await document.fonts.load(`1em "${familyName}"`);
    fontStatus.textContent = ok ? '' : 'unavailable';
  }

  renderCurrentPreview();
}

async function handleFile(file) {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    drop.classList.add('hidden');
    filebarEl.classList.remove('hidden');
    fname.textContent = file.name;
    setStatus("That's not a PDF. Please choose a PDF file.", 'err');
    return;
  }

  baseName = file.name.replace(/\.pdf$/i, '') || 'document';
  fname.textContent = file.name;
  fmeta.textContent = formatFileSize(file.size);

  drop.classList.add('hidden');
  filebarEl.classList.remove('hidden');
  zoomBar.classList.remove('hidden');
  optsPanel.classList.remove('panel-disabled');
  makeBtn.disabled = false;

  previewEl.innerHTML = '';
  setStatus('<span class="spinner"></span>Reading text ...', 'work');

  try {
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

    const firstPage = await pdf.getPage(1);
    const firstPageViewport = firstPage.getViewport({ scale: 1 });
    pageOrientation = firstPageViewport.width > firstPageViewport.height ? 'landscape' : 'portrait';
    updateOrientationButton();

    let lines = [];
    let usedOcr = false;
    let preservedImagePages = 0;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const extractedText = (content.items || [])
        .map(item => item.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      const pageLines = itemsToLines(content.items, content.styles, viewport);
      const imageOperatorStats = await getPageImageOperatorStats(page);
      const hasEmbeddedImages = imageOperatorStats.imageOps > 0 || imageOperatorStats.formOps > 0;
      const pageHeight = viewport ? viewport.height : 842;
      const hasNativeTextFlow = pageLines.length >= 2 || extractedText.length >= 24;

      let pageTextLines = [];
      let pageImageBlocks = [];
      let usedTextFlow = false;
      let ocrData = null;

      if (hasNativeTextFlow) {
        pageTextLines = pageLines;
        usedTextFlow = true;
      } else {
        const ocrResult = await runOcrForPage(page, pageNumber, pdf.numPages);
        if (ocrResult.type === 'text' && ocrResult.lines.length) {
          usedOcr = true;
          pageTextLines = ocrResult.lines;
          usedTextFlow = true;
        }
        ocrData = ocrResult.ocrData || null;
      }

      if (pageTextLines.length) {
        computeFactors(pageTextLines);
        pageTextLines = mergeListContinuations(pageTextLines);
        pageTextLines = dedupePageTextLines(pageTextLines);
      }

      const keptImageCanvasRegions = [];

      if (hasEmbeddedImages) {
        const pageCanvas = await renderPageCanvas(page, 1.6, ocrData || null);
        const textRegions = buildTextRegionsFromItems(content.items, viewport, 1.6);
        const regions = detectImageRegionsFromCanvas(pageCanvas, textRegions);
        const selectedRegions = pickBestImageRegions(regions, pageCanvas.width, pageCanvas.height, textRegions, pageTextLines.length > 0);
        const describeRegion = r => ({
          x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1,
          areaRatio: +(r.area / Math.max(1, pageCanvas.width * pageCanvas.height)).toFixed(3),
          widthRatio: +((r.x1 - r.x0) / Math.max(1, pageCanvas.width)).toFixed(3),
          heightRatio: +((r.y1 - r.y0) / Math.max(1, pageCanvas.height)).toFixed(3),
          fillRatio: +(r.area / Math.max(1, (r.x1 - r.x0) * (r.y1 - r.y0))).toFixed(3),
          touchedEdges: countTouchedEdges(r, pageCanvas.width, pageCanvas.height),
          textOverlapRatio: +estimateTextOverlapRatio(r, textRegions).toFixed(3),
        });
        console.log(`[img-debug] p${pageNumber}: canvas=${pageCanvas.width}x${pageCanvas.height} textRegions=${textRegions.length} pageTextLines=${pageTextLines.length} rawRegions=${regions.length} JSON=${JSON.stringify(regions.map(describeRegion))}`);
        console.log(`[img-debug] p${pageNumber}: selectedRegions=${selectedRegions.length} JSON=${JSON.stringify(selectedRegions.map(describeRegion))}`);
        const keepPrimary = shouldKeepRegionsForPage(selectedRegions, pageTextLines, pageCanvas.width, pageCanvas.height);
        console.log(`[img-debug] p${pageNumber}: keepPrimary=${keepPrimary}`);
        if (keepPrimary) {
          // Several independently-validated regions on the same page are
          // overwhelmingly likely to be parts of one figure (a multi-box
          // diagram, a grid of small tiles, ...) — render them as one
          // combined image, which also picks up thin connectors like arrows
          // between them since the crop is just the raw pixels of that area.
          // Splitting them up tends to scatter a single figure into a
          // disconnected, wrongly-ordered mess, which is worse than
          // occasionally pulling in a small unrelated icon along the way.
          let regionsToRender = selectedRegions;
          if (selectedRegions.length > 1) {
            const envelope = selectedRegions.reduce((acc, r) => ({
              x0: Math.min(acc.x0, r.x0),
              y0: Math.min(acc.y0, r.y0),
              x1: Math.max(acc.x1, r.x1),
              y1: Math.max(acc.y1, r.y1),
              area: acc.area + r.area,
            }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, area: 0 });
            const envelopeAreaRatio = ((envelope.x1 - envelope.x0) * (envelope.y1 - envelope.y0)) / Math.max(1, pageCanvas.width * pageCanvas.height);
            regionsToRender = envelopeAreaRatio <= 0.75 ? [envelope] : selectedRegions;
          }
          for (const region of regionsToRender) {
            const grownRegion = expandRegionToContent(pageCanvas, region, textRegions);
            const expandedRegion = growRegionWithNearbyLabels(grownRegion, textRegions);
            const trimmedRegion = trimRegionTextEdges(pageCanvas, expandedRegion, textRegions);
            console.log(`[img-debug] p${pageNumber}: region=${JSON.stringify({ x0: region.x0, y0: region.y0, x1: region.x1, y1: region.y1 })} grown=${JSON.stringify({ x0: grownRegion.x0, y0: grownRegion.y0, x1: grownRegion.x1, y1: grownRegion.y1 })} withLabels=${JSON.stringify({ x0: expandedRegion.x0, y0: expandedRegion.y0, x1: expandedRegion.x1, y1: expandedRegion.y1 })} trimmed=${JSON.stringify({ x0: trimmedRegion.x0, y0: trimmedRegion.y0, x1: trimmedRegion.x1, y1: trimmedRegion.y1 })}`);
            console.log(`[img-debug] p${pageNumber}: nearbyTextBoxes(top of grown, y0-150..y0)=${JSON.stringify(textRegions.filter(t => t.y1 >= grownRegion.y0 - 150 && t.y0 <= grownRegion.y0 + 20).map(t => ({ x0: t.x0, y0: t.y0, x1: t.x1, y1: t.y1 })))}`);
            const regionCanvas = createCanvasRegion(pageCanvas, trimmedRegion, 10);
            keptImageCanvasRegions.push(trimmedRegion);
            pageImageBlocks.push({
              isImage: true,
              imageDataUrl: regionCanvas.toDataURL('image/png'),
              imageLandscape: regionCanvas.width > regionCanvas.height * 1.05,
              imageWidthRatio: Math.max(0.18, Math.min(1, regionCanvas.width / Math.max(1, pageCanvas.width))),
              imageXRatio: Math.max(0, Math.min(1, trimmedRegion.x0 / Math.max(1, pageCanvas.width))),
              imageYRatio: Math.max(0, Math.min(1, trimmedRegion.y0 / Math.max(1, pageCanvas.height))),
              sortY: trimmedRegion.y0 / Math.max(1, pageCanvas.height),
              isFooter: false,
              isPageHeader: false,
            });
          }
        } else {
          const textStats = getPageTextStats(pageTextLines);
          const isLowTextPage = textStats.lineCount <= 3 && textStats.charCount <= 42;
          const fallbackRegion = getDominantVisualRegion(pageCanvas, textRegions, true);
          console.log(`[img-debug] p${pageNumber}: fallback textStats=${JSON.stringify(textStats)} isLowTextPage=${isLowTextPage} fallbackRegion=${JSON.stringify(fallbackRegion ? describeRegion(fallbackRegion) : null)}`);
          if (fallbackRegion) {
            // Unlike the flood-fill-detected regions above, this box already
            // comes from a full-page pixel scan (incl. its own banner/gap
            // handling), so growing it by the usual ~9%-of-page amount tends
            // to regrow it right back into the banner/body text it
            // deliberately excluded (that growth only needs ~2% of border
            // pixels to look "visual" to keep expanding, and a banner row is
            // ~100% "visual"). A much smaller cap still lets it pick up a
            // close-by caption (like an axis label just outside a chart)
            // without being enough to cross a real banner/paragraph gap.
            const grownRegion = expandRegionToContent(pageCanvas, fallbackRegion, textRegions, 22);
            const expandedRegion = growRegionWithNearbyLabels(grownRegion, textRegions);
            const trimmedRegion = trimRegionTextEdges(pageCanvas, expandedRegion, textRegions);
            const regionCanvas = createCanvasRegion(pageCanvas, trimmedRegion, 12);
            const dataUrl = regionCanvas.toDataURL('image/png');
            console.log(`[img-debug] p${pageNumber}: fallback push regionCanvas=${regionCanvas.width}x${regionCanvas.height} dataUrlLen=${dataUrl.length} expandedRegion=${JSON.stringify(expandedRegion)} trimmedRegion=${JSON.stringify(trimmedRegion)}`);
            keptImageCanvasRegions.push(trimmedRegion);
            pageImageBlocks.push({
              isImage: true,
              imageDataUrl: dataUrl,
              imageLandscape: regionCanvas.width > regionCanvas.height * 1.05,
              imageWidthRatio: Math.max(0.2, Math.min(1, regionCanvas.width / Math.max(1, pageCanvas.width))),
              imageXRatio: Math.max(0, Math.min(1, trimmedRegion.x0 / Math.max(1, pageCanvas.width))),
              imageYRatio: Math.max(0, Math.min(1, trimmedRegion.y0 / Math.max(1, pageCanvas.height))),
              sortY: trimmedRegion.y0 / Math.max(1, pageCanvas.height),
              isFooter: false,
              isPageHeader: false,
            });
          } else if (isLowTextPage) {
            keptImageCanvasRegions.push({ x0: 0, y0: 0, x1: pageCanvas.width, y1: pageCanvas.height });
            pageImageBlocks.push({
              isImage: true,
              imageDataUrl: pageCanvas.toDataURL('image/png'),
              imageLandscape: pageCanvas.width > pageCanvas.height * 1.05,
              imageWidthRatio: 1,
              imageXRatio: 0,
              imageYRatio: 0,
              sortY: 0.12,
              isFooter: false,
              isPageHeader: false,
            });
          }
        }
      }

      console.log(`[img-debug] p${pageNumber}: before shouldPreferImageOnly, pageImageBlocks=${pageImageBlocks.length}`, JSON.stringify(pageImageBlocks.map(b => ({ w: b.imageWidthRatio, x: b.imageXRatio, y: b.imageYRatio, sortY: b.sortY, len: b.imageDataUrl?.length }))));

      // Text items that sit inside a region we kept as an image (e.g. a
      // caption baked into a diagram box, like "Medium" or a single "R"/"G"/
      // "B" channel label) are already visible in that image — keep them out
      // of the separate reading-text flow so they don't show up a second
      // time as a stray standalone line.
      if (keptImageCanvasRegions.length && pageTextLines.length) {
        const scale = 1.6;
        const pageHeightCanvas = pageHeight * scale;
        pageTextLines = pageTextLines.filter(line => {
          const cx = (line.x || 0) * scale;
          const cyBaseline = pageHeightCanvas - (line.y || 0) * scale;
          const sizeCanvas = (line.size || 12) * scale;
          return !keptImageCanvasRegions.some(r => (
            cx >= r.x0 - 8 && cx <= r.x1 + 8 &&
            cyBaseline >= r.y0 - sizeCanvas && cyBaseline <= r.y1 + 8
          ));
        });
      }

      if (shouldPreferImageOnly(pageTextLines, pageImageBlocks)) {
        pageTextLines = [];
      }

      const isImageOnlyPage = pageTextLines.length === 0 && pageImageBlocks.length > 0;
      if (isImageOnlyPage) {
        pageImageBlocks = pageImageBlocks.map(block => ({ ...block, pageOnlyImage: true }));
      }

      if (pageImageBlocks.length) {
        preservedImagePages += 1;
      }

      console.log(`[img-debug] p${pageNumber}: final pageImageBlocks=${pageImageBlocks.length}`);

      const pageBlocks = [
        ...pageTextLines.map(line => ({ ...line, type: 'text', sortY: Math.max(0, Math.min(1, (pageHeight - (line.y || 0)) / Math.max(1, pageHeight))) })),
        ...pageImageBlocks.map(block => ({ ...block, type: 'image' })),
      ].sort((a, b) => (a.sortY ?? 0) - (b.sortY ?? 0));

      if (pageBlocks.length) {
        if (pageNumber > 1) {
          lines.push({ isPageDiv: true, pageNum: pageNumber });
        }
        for (const block of pageBlocks) {
          lines.push(block);
        }
      }

      setStatus(`<span class="spinner"></span>Page ${pageNumber} of ${pdf.numPages} ...`, 'work');
    }

    if (!lines.length) {
      const message = 'No text could be detected. OCR could not extract readable text from this PDF.';
      setStatus(message, 'err');
      docLines = [];
      renderCurrentPreview();
      return;
    }

    computeFactors(lines);
    docLines = mergeListContinuations(lines);
    console.log(`[img-debug] global: lines images=${lines.filter(l => l.isImage).length} docLines images=${docLines.filter(l => l.isImage).length}`);
    renderCurrentPreview();
    const summary = usedOcr || preservedImagePages
      ? `Done — ${pdf.numPages} page${pdf.numPages > 1 ? 's' : ''} read${preservedImagePages ? `, with ${preservedImagePages} image page${preservedImagePages > 1 ? 's' : ''} kept as images` : ' with OCR fallback'}. Adjust the settings and export.`
      : `Done — ${pdf.numPages} page${pdf.numPages > 1 ? 's' : ''} read. Adjust the settings and export.`;
    setStatus(summary, 'ok');
  } catch (error) {
    console.error(error);
    const message = /password/i.test(error?.message || '')
      ? "The PDF is password-protected — can't open it."
      : 'The PDF could not be read.';
    setStatus(message, 'err');
  }
}

drop.addEventListener('click', () => fileInput.click());
drop.addEventListener('dragover', event => {
  event.preventDefault();
  drop.classList.add('drag');
});
drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
drop.addEventListener('drop', event => {
  event.preventDefault();
  drop.classList.remove('drag');
  if (event.dataTransfer.files.length) handleFile(event.dataTransfer.files[0]);
});

previewFrame.addEventListener('dragover', event => {
  event.preventDefault();
});
previewFrame.addEventListener('drop', event => {
  event.preventDefault();
  if (event.dataTransfer.files.length) handleFile(event.dataTransfer.files[0]);
});

fileInput.addEventListener('change', event => {
  if (event.target.files.length) handleFile(event.target.files[0]);
});

reset.addEventListener('click', () => {
  drop.classList.remove('hidden');
  filebarEl.classList.add('hidden');
  zoomBar.classList.add('hidden');
  optsPanel.classList.add('panel-disabled');
  makeBtn.disabled = true;
  fileInput.value = '';
  zoomLevel = 1;
  applyZoom();
  setStatus('', '');
  resetOcrProgress();
  docLines = [];
  previewFrame.style.background = '';
  renderCurrentPreview();
});

fontSelect.addEventListener('change', handleFontChange);
zoomInBtn.addEventListener('click', () => changeZoom(0.1));
zoomOutBtn.addEventListener('click', () => changeZoom(-0.1));
zoomResetBtn.addEventListener('click', () => {
  zoomLevel = 1;
  applyZoom();
});
orientationToggleBtn.addEventListener('click', () => {
  togglePageOrientation();
  renderCurrentPreview();
});

document.querySelectorAll('#opts input').forEach(checkbox => {
  checkbox.addEventListener('change', () => {
    syncOptStyles();
    renderCurrentPreview();
  });
});

sizeEl.addEventListener('input', () => {
  sizeVal.textContent = sizeEl.value + ' pt';
  renderCurrentPreview();
});

makeBtn.addEventListener('click', async () => {
  try {
    if (!docLines.length) {
      setStatus('No text to export.', 'err');
      return;
    }

    makeBtn.disabled = true;
    setStatus('<span class="spinner"></span>Building PDF ...', 'work');

    const options = getOptions();
    const fontAsset = getFontAsset(options.font);
    const pageCount = await exportPdf({
      docLines,
      options,
      baseName,
      fontAsset,
      fontkitLib: fontAsset ? getFontkitLib() : null,
    });

    setStatus(`Done — downloaded ${pageCount} page${pageCount > 1 ? 's' : ''}.`, 'ok');
  } catch (error) {
    console.error(error);
    setStatus('Something went wrong: ' + (error.message || 'unknown'), 'err');
  } finally {
    makeBtn.disabled = false;
  }
});

themeController.initTheme();
syncOptStyles();
sizeVal.textContent = sizeEl.value + ' pt';
applyZoom();
updateOrientationButton();
renderCurrentPreview();
initOpenDyslexicSupport(fontSelect, fontStatus, renderCurrentPreview);

if (fontSelect.value !== 'none') handleFontChange();