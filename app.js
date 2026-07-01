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
const zoomLevelEl = $('zoom-level');
const sizeEl = $('size');
const sizeVal = $('size-val');
const statusEl = $('status');
const makeBtn = $('make');
const themeToggle = $('theme-toggle');

const themeController = createThemeController(themeToggle);
const exportPdf = createPdfExporter(PDFDocument, StandardFonts, rgb);

let mergedLines = [];
let docLines = [];
let baseName = 'document';
let zoomLevel = 1;

function getOptions() {
  return {
    font: fontSelect.value,
    line: $('o-line').checked,
    letter: $('o-letter').checked,
    word: $('o-word').checked,
    bg: $('o-bg').checked,
    size: parseInt(sizeEl.value, 10),
    split: $('o-split').checked,
  };
}

function rebuildDocLines() {
  docLines = getOptions().split ? splitSentences(mergedLines) : mergedLines;
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

function applyZoom() {
  zoomLevelEl.textContent = Math.round(zoomLevel * 100) + ' %';
  previewScaler.style.transform = `scale(${zoomLevel})`;
}

function changeZoom(delta) {
  zoomLevel = Math.max(0.3, Math.min(3, parseFloat((zoomLevel + delta).toFixed(1))));
  applyZoom();
}

function renderCurrentPreview() {
  rebuildDocLines();
  renderPreview(docLines, getOptions(), previewEl, previewFrame);
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

    let lines = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const pageLines = itemsToLines(content.items, content.styles, viewport);

      if (pageNumber > 1 && pageLines.length) {
        lines.push({ isPageDiv: true, pageNum: pageNumber });
      }

      lines = lines.concat(pageLines);
      setStatus(`<span class="spinner"></span>Page ${pageNumber} of ${pdf.numPages} ...`, 'work');
    }

    if (!lines.length) {
      setStatus('No text found — this PDF is probably scanned (images only). That would need OCR.', 'err');
      docLines = [];
      renderCurrentPreview();
      return;
    }

    computeFactors(lines);
    mergedLines = mergeListContinuations(lines);
    renderCurrentPreview();
    setStatus(`Done — ${pdf.numPages} page${pdf.numPages > 1 ? 's' : ''} read. Adjust the settings and export.`, 'ok');
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
  mergedLines = [];
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
renderCurrentPreview();
initOpenDyslexicSupport(fontSelect, fontStatus, renderCurrentPreview);

if (fontSelect.value !== 'none') handleFontChange();