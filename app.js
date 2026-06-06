/* =============================================================================
   Readable — app.js
   -----------------------------------------------------------------------------
   Reads the text layer of a PDF, then re-sets that text in a dyslexia-friendly
   way (OpenDyslexic font, wider spacing, calmer background) and lets the user
   download the result as a new PDF.

   Everything runs in the browser. Two libraries do the heavy lifting:
     - pdf.js   -> reads / extracts text from the uploaded PDF
     - pdf-lib  -> builds the new PDF that gets downloaded
   Both are loaded via <script> tags in index.html, so they exist as globals
   (pdfjsLib and PDFLib) by the time this file runs.
============================================================================= */

// pdf.js does its parsing in a separate Web Worker for performance.
// We have to tell it where that worker file lives (here: the same CDN version).
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Pull the bits of pdf-lib we use into short names.
const { PDFDocument, StandardFonts, rgb } = PDFLib;

// Tiny helper: document.getElementById('x') -> $('x')
const $ = id => document.getElementById(id);

// Cache the DOM elements we touch repeatedly.
const drop = $('drop'), fileInput = $('file');
const cardUpload = $('card-upload'), cardEdit = $('card-edit');
const fname = $('fname'), fmeta = $('fmeta'), reset = $('reset');
const fontRow = $('opt-font-row'), oFont = $('o-font'), fontSub = $('font-sub');
const sizeEl = $('size'), sizeVal = $('size-val');
const previewEl = $('preview'), statusEl = $('status'), makeBtn = $('make');

// The extracted document, one entry per visual line:
//   { text: string, size: number (original pt), factor: number, para: boolean }
// `factor` is the line's size relative to the body text (1 = body, >1 = heading).
// `para` marks the start of a new paragraph (extra space before it).
let docLines = [];

// Used to name the downloaded file (taken from the uploaded file name).
let baseName = 'document';

/* -----------------------------------------------------------------------------
   Load the OpenDyslexic font (optional)
   -----------------------------------------------------------------------------
   The three core libraries are required, but OpenDyslexic is a "nice to have".
   We try to fetch it from a CDN; if that fails (offline, blocked, etc.) the app
   keeps working and simply falls back to a standard sans-serif font.

   To EMBED a custom font into a PDF, pdf-lib needs the "fontkit" plug-in.
   For the on-screen PREVIEW we register the same font via the FontFace API.
----------------------------------------------------------------------------- */
let openDyslexicBytes = null;   // raw .ttf bytes, used for embedding in the PDF
let fontkitLib = null;          // pdf-lib plug-in required to embed custom fonts
let odPreviewReady = false;     // true once the font is usable in the preview

(async () => {
  // A couple of fallback URLs in case the first source is unavailable.
  const fkUrls = [
    'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js',
    'https://unpkg.com/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js'
  ];
  const fontUrls = [
    'https://cdn.jsdelivr.net/gh/antijingoist/open-dyslexic@master/ttf/OpenDyslexic-Regular.ttf',
    'https://cdn.jsdelivr.net/gh/madjeek-web/open-dyslexic@main/OpenDyslexic-2025/opendyslexic-regular-webfont.ttf'
  ];
  try {
    // 1) Load the fontkit plug-in (stop at the first URL that works).
    for (const u of fkUrls) { try { await loadScript(u); if (window.fontkit) break; } catch(e){} }
    fontkitLib = window.fontkit;
    if (!fontkitLib) throw 0;

    // 2) Download the font file as raw bytes.
    let buf = null;
    for (const u of fontUrls) { try { const r = await fetch(u); if (r.ok) { buf = await r.arrayBuffer(); break; } } catch(e){} }
    if (!buf) throw 0;
    openDyslexicBytes = buf;

    // 3) Make the font available to the live preview (CSS) as well.
    try { const ff = new FontFace('ODPreview', buf); await ff.load(); document.fonts.add(ff); odPreviewReady = true; } catch(e){}

    // 4) Enable + tick the OpenDyslexic checkbox now that it's ready.
    fontRow.setAttribute('aria-disabled', 'false');
    oFont.disabled = false; oFont.checked = true;
    fontSub.textContent = 'typeface designed for dyslexia';
    syncOptStyles(); renderPreview();
  } catch (e) {
    // Font couldn't be loaded — leave the option disabled, everything else works.
    fontSub.textContent = 'currently unavailable (CDN unreachable)';
  }
})();

// Append a <script> and resolve once it has loaded (or reject on error).
function loadScript(src){ return new Promise((res,rej)=>{ const s=document.createElement('script'); s.src=src; s.onload=res; s.onerror=rej; document.head.appendChild(s); }); }

/* -----------------------------------------------------------------------------
   Current UI state
----------------------------------------------------------------------------- */

// Read all the checkboxes + the size slider into one plain object.
function opts(){
  return {
    font: oFont.checked && !oFont.disabled,  // use OpenDyslexic?
    line: $('o-line').checked,               // wider line spacing?
    letter: $('o-letter').checked,           // wider letter spacing?
    word: $('o-word').checked,               // wider word spacing?
    bg: $('o-bg').checked,                    // cream background?
    size: parseInt(sizeEl.value, 10)          // body text size in pt
  };
}

// Visually dim the rows whose checkbox is off (or disabled).
function syncOptStyles(){
  document.querySelectorAll('.opt').forEach(l => {
    const cb = l.querySelector('input');
    l.classList.toggle('off', !cb.checked || cb.disabled);
  });
}

/* -----------------------------------------------------------------------------
   Event wiring
----------------------------------------------------------------------------- */

// Drag & drop + click-to-pick on the drop zone.
drop.addEventListener('click', () => fileInput.click());
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag'); });
drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('drag'); if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]); });
fileInput.addEventListener('change', e => { if (e.target.files.length) handleFile(e.target.files[0]); });

// "change PDF" link -> go back to the upload view.
reset.addEventListener('click', () => { cardEdit.classList.add('hidden'); cardUpload.classList.remove('hidden'); fileInput.value=''; setStatus('',''); docLines=[]; });

// Any option change -> update the dimming + re-render the preview live.
document.querySelectorAll('#opts input').forEach(cb => cb.addEventListener('change', () => { syncOptStyles(); renderPreview(); }));
sizeEl.addEventListener('input', () => { sizeVal.textContent = sizeEl.value + ' pt'; renderPreview(); });

/* -----------------------------------------------------------------------------
   Small helpers
----------------------------------------------------------------------------- */

// Write a message into the status line (cls: '', 'work', 'ok' or 'err').
function setStatus(msg, cls){ statusEl.className = 'status ' + (cls||''); statusEl.innerHTML = msg; }

// Human-readable file size.
function fmtSize(b){ if (b<1024) return b+' B'; if (b<1048576) return (b/1024).toFixed(0)+' KB'; return (b/1048576).toFixed(1)+' MB'; }

// Escape text before inserting it into the preview HTML (avoids broken markup / injection).
function escapeHtml(s){ return s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

/* -----------------------------------------------------------------------------
   Step 1: read the uploaded PDF and extract its text
----------------------------------------------------------------------------- */
async function handleFile(file){
  // Basic type check.
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    cardUpload.classList.add('hidden'); cardEdit.classList.remove('hidden');
    fname.textContent = file.name; setStatus("That's not a PDF. Please choose a PDF file.", 'err'); return;
  }

  // Derive the download name and switch to the editing view.
  baseName = file.name.replace(/\.pdf$/i,'') || 'document';
  fname.textContent = file.name; fmeta.textContent = fmtSize(file.size);
  cardUpload.classList.add('hidden'); cardEdit.classList.remove('hidden');
  previewEl.innerHTML = ''; setStatus('<span class="spinner"></span>Reading text …', 'work');

  try {
    // Hand the file bytes to pdf.js and open the document.
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

    // Walk every page and collect its lines.
    let lines = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();   // raw positioned text fragments
      const pageLines = itemsToLines(content.items);
      if (p > 1 && pageLines.length) pageLines[0].para = true; // treat a page break as a new paragraph
      lines = lines.concat(pageLines);
      setStatus(`<span class="spinner"></span>Page ${p} of ${pdf.numPages} …`, 'work');
    }

    // No text usually means the PDF is a scan (images only) -> needs OCR.
    if (!lines.length) {
      setStatus('No text found — this PDF is probably scanned (images only). That would need OCR.', 'err');
      docLines = []; return;
    }

    // Work out the heading/body size relationships, then show the preview.
    computeFactors(lines);
    docLines = lines;
    renderPreview();
    setStatus(`Done — read ${pdf.numPages} page${pdf.numPages>1?'s':''}. Tick the reading aids and export.`, 'ok');
  } catch (err) {
    console.error(err);
    let msg = 'The PDF could not be read.';
    if (/password/i.test(err && err.message || '')) msg = "The PDF is password-protected — I can't open it.";
    setStatus(msg, 'err');
  }
}

/* -----------------------------------------------------------------------------
   Turn pdf.js text fragments into clean lines
   -----------------------------------------------------------------------------
   pdf.js gives us many little text pieces, each with a position (transform) and
   a height. We:
     1. group pieces into lines by their vertical (Y) position,
     2. record the dominant font size of each line (weighted by character count),
     3. flag a line as a new paragraph when the vertical gap before it is large.
   This is a heuristic — good for normal documents, shaky for complex layouts
   like multi-column pages or tables.
----------------------------------------------------------------------------- */
function itemsToLines(items){
  const raw = []; let cur = null, lastY = null;

  for (const it of items) {
    // transform = [a, b, c, d, e, f]; the font size is the scale of the matrix,
    // and transform[5] (f) is the Y position on the page.
    const tr = it.transform || [1,0,0,1,0,0];
    const sz = Math.hypot(tr[2]||0, tr[3]||0) || it.height || 12;
    const y = tr[5];

    if (it.str) {
      // Start a new line if the Y position jumped by more than half a line height.
      if (lastY === null || Math.abs(y - lastY) > sz * 0.5) { cur = { y, text:'', sizes:{} }; raw.push(cur); lastY = y; }
      cur.text += it.str;

      // Tally character counts per (rounded) size so we can pick the dominant one.
      const key = Math.round(sz * 2) / 2;  // round to nearest 0.5 pt
      cur.sizes[key] = (cur.sizes[key] || 0) + it.str.length;
    }

    // hasEOL = explicit end-of-line marker from pdf.js -> force a new line next.
    if (it.hasEOL) lastY = null;
  }

  // Convert the raw line buckets into the final {text, size, para} objects.
  const lines = []; let prevY = null, prevSize = null;
  for (const r of raw) {
    const text = r.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;

    // Dominant size = the size that the most characters in this line use.
    let dom = 12, max = -1;
    for (const k in r.sizes) { if (r.sizes[k] > max) { max = r.sizes[k]; dom = parseFloat(k); } }

    // Large vertical gap from the previous line => start of a new paragraph.
    let para = false;
    if (prevY !== null) {
      const gap = prevY - r.y;
      const ref = Math.max(dom, prevSize || dom);
      if (gap > ref * 1.7) para = true;
    }

    lines.push({ text, size: dom, para });
    prevY = r.y; prevSize = dom;
  }
  return lines;
}

/* -----------------------------------------------------------------------------
   Compute relative size factors
   -----------------------------------------------------------------------------
   The body text is whatever size covers the most characters in the document.
   Each line then gets a factor = its size / body size, so headings come out
   proportionally bigger no matter what body size the user picks later.
----------------------------------------------------------------------------- */
function computeFactors(lines){
  // Find the body size (most "text mass").
  const freq = {};
  for (const l of lines) freq[l.size] = (freq[l.size] || 0) + l.text.length;
  let base = 12, max = -1;
  for (const k in freq) { if (freq[k] > max) { max = freq[k]; base = parseFloat(k); } }

  // Assign a factor to every line.
  for (const l of lines) {
    let f = l.size / base;
    if (f > 0.88 && f < 1.18) f = 1;          // snap near-body sizes to exactly 1 (keeps body uniform)
    f = Math.max(0.75, Math.min(2.6, f));      // clamp extremes so nothing gets tiny or huge
    l.factor = Math.round(f * 100) / 100;
  }
}

/* -----------------------------------------------------------------------------
   Live preview
   -----------------------------------------------------------------------------
   Renders the extracted lines as HTML using the currently selected options, so
   the user sees roughly what the exported PDF will look like. Sizes here are in
   px but mirror the pt values used in the PDF closely enough for a preview.
----------------------------------------------------------------------------- */
function renderPreview(){
  if (!docLines.length) { previewEl.innerHTML = '<div style="color:#999;font-size:14px;">Preview appears once a file has been read.</div>'; return; }

  const o = opts();
  const lhF = o.line ? 1.8 : 1.35;   // line-height factor

  // Background, text colour and font follow the chosen options.
  previewEl.style.background = o.bg ? '#fbf3e2' : '#ffffff';
  previewEl.style.color = o.bg ? '#2b2620' : '#1a1a1a';
  previewEl.style.fontFamily = (o.font && odPreviewReady) ? "'ODPreview', sans-serif" : "Arial, Helvetica, sans-serif";

  // One <div> per line, scaled by its factor; headings (factor > 1.18) go bolder.
  let html = '';
  for (const l of docLines) {
    const s = o.size * l.factor;
    const cs = o.letter ? s * 0.07 : 0;          // letter spacing
    const ws = o.word ? s * 0.18 : 0;            // word spacing
    const mt = l.para ? (o.size * 0.7) : 0;      // extra top margin for new paragraphs
    const weight = l.factor > 1.18 ? 600 : 400;
    html += `<div style="font-size:${s}px;line-height:${lhF};letter-spacing:${cs}px;word-spacing:${ws}px;margin-top:${mt}px;font-weight:${weight};">${escapeHtml(l.text)}</div>`;
  }
  previewEl.innerHTML = html;
}

/* -----------------------------------------------------------------------------
   Text sanitising
   -----------------------------------------------------------------------------
   pdf-lib's built-in standard fonts (Helvetica etc.) can only encode the WinAnsi
   character set. So when we DON'T embed a Unicode font, we map fancy typography
   (smart quotes, dashes, ellipsis, ligatures …) down to plain equivalents and
   drop anything still out of range. Embedded fonts cover Unicode, so they only
   need a light clean-up of invisible control characters.
----------------------------------------------------------------------------- */
const REPL = {
  '\u2018':"'", '\u2019':"'", '\u201A':"'", '\u201B':"'", '\u201C':'"', '\u201D':'"', '\u201E':'"', '\u201F':'"',
  '\u2013':'-', '\u2014':'-', '\u2015':'-', '\u2212':'-', '\u2026':'...', '\u2022':'-', '\u00B7':'-', '\u25CF':'-',
  '\u00A0':' ', '\u2007':' ', '\u2008':' ', '\u2009':' ', '\u200A':' ', '\u202F':' ', '\u200B':'', '\u00AD':'', '\uFEFF':'',
  '\uFB00':'ff','\uFB01':'fi','\uFB02':'fl','\uFB03':'ffi','\uFB04':'ffl', '\u2192':'->','\u2190':'<-','\u00AB':'"','\u00BB':'"'
};

// For standard fonts: replace known characters, keep Latin-1 (incl. umlauts) + Euro, drop the rest.
function sanitizeWinAnsi(s){ let o=''; for (const ch of s){ if (REPL[ch]!==undefined){ o+=REPL[ch]; continue; } const c=ch.codePointAt(0); if (c<=0xFF||c===0x20AC) o+=ch; } return o; }

// For embedded Unicode fonts: just strip zero-width / soft-hyphen characters.
function sanitizeSoft(s){ return s.replace(/[\u200B\u00AD\uFEFF]/g,'').replace(/\u00A0/g,' '); }

/* -----------------------------------------------------------------------------
   Measuring + line wrapping
   -----------------------------------------------------------------------------
   pdf-lib's drawText knows nothing about the extra letter/word spacing we add
   by hand, so we measure widths ourselves to wrap text correctly to the page.
----------------------------------------------------------------------------- */

// Safe width: returns 0 instead of throwing if a glyph can't be measured.
function sw(font, s, size){ try { return font.widthOfTextAtSize(s, size); } catch(e){ return 0; } }

// Width of a string at a given size, including our manual letter/word spacing.
function measure(text, font, size, cs, ws){
  if (cs === 0 && ws === 0) return sw(font, text, size);   // fast path: no custom spacing
  let w = 0;
  for (const ch of text){ w += sw(font, ch, size) + cs; if (ch === ' ') w += ws; }
  return w - cs;   // no trailing spacing after the last character
}

// Greedy word wrap to fit `maxW`. Splits a single over-long word character by
// character so nothing ever overflows the right margin.
function wrap(text, font, size, maxW, cs, ws){
  const words = text.split(' '); const lines = []; let line = '';
  for (const w of words){
    const test = line ? line + ' ' + w : w;
    if (measure(test, font, size, cs, ws) > maxW && line){
      lines.push(line);
      if (measure(w, font, size, cs, ws) > maxW){
        // The word alone is wider than the line -> hard-break it.
        let buf = '';
        for (const ch of w){ const t = buf + ch; if (measure(t, font, size, cs, ws) > maxW && buf){ lines.push(buf); buf = ch; } else buf = t; }
        line = buf;
      } else line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

/* -----------------------------------------------------------------------------
   Step 2: build and download the new PDF
----------------------------------------------------------------------------- */
makeBtn.addEventListener('click', async () => {
  if (!docLines.length){ setStatus('No text to export.', 'err'); return; }
  makeBtn.disabled = true; setStatus('<span class="spinner"></span>Building PDF …', 'work');

  try {
    const o = opts();
    const doc = await PDFDocument.create();

    // Pick the font: embed OpenDyslexic if requested and available, else Helvetica.
    let font, embedded = false;
    if (o.font && openDyslexicBytes && fontkitLib){
      doc.registerFontkit(fontkitLib);                                  // needed for custom fonts
      font = await doc.embedFont(openDyslexicBytes, { subset: true });  // subset = only used glyphs
      embedded = true;
    } else {
      font = await doc.embedFont(StandardFonts.Helvetica);
    }

    // A4 page in PDF points (1 pt = 1/72 inch). 25 mm margins.
    const PW = 595.28, PH = 841.89;
    const marginPt = 25 * 2.83465;            // mm -> pt
    const maxW = PW - marginPt * 2;           // usable text width
    const baseS = o.size;                     // body text size
    const lhF = o.line ? 1.8 : 1.35;          // line-height factor

    // Calmer cream background + soft dark-brown text when the option is on.
    const bg = o.bg ? rgb(0.984, 0.953, 0.886) : null;
    const textColor = o.bg ? rgb(0.169, 0.149, 0.125) : rgb(0.1, 0.1, 0.1);

    // Helper: add a fresh page (painting the background first if needed).
    const newPage = () => { const p = doc.addPage([PW, PH]); if (bg) p.drawRectangle({ x:0, y:0, width:PW, height:PH, color:bg }); return p; };
    let page = newPage();
    let y = PH - marginPt;   // current baseline cursor, measured from the top

    // Draw one already-wrapped line, then advance the cursor down.
    // When letter/word spacing is active we draw character by character so we
    // can insert the exact extra spacing (pdf-lib can't do this on its own).
    const drawLine = (txt, size, cs, ws, lh) => {
      if (y - lh < marginPt){ page = newPage(); y = PH - marginPt; }  // page break
      let cx = marginPt; const baseY = y - size;
      if (cs === 0 && ws === 0){
        try { page.drawText(txt, { x: cx, y: baseY, size, font, color: textColor }); } catch(e){}
      } else {
        for (const ch of txt){
          if (ch !== ' '){ try { page.drawText(ch, { x: cx, y: baseY, size, font, color: textColor }); } catch(e){} }
          cx += sw(font, ch, size) + cs; if (ch === ' ') cx += ws;
        }
      }
      y -= lh;
    };

    // Lay out every line: scale by its factor, apply spacing, wrap, draw.
    for (const l of docLines){
      const size = baseS * l.factor;
      const cs = o.letter ? size * 0.07 : 0;
      const ws = o.word ? size * 0.18 : 0;
      const lh = size * lhF;
      if (l.para) y -= baseS * lhF * 0.5;   // extra gap before a new paragraph
      const clean = embedded ? sanitizeSoft(l.text) : sanitizeWinAnsi(l.text);
      const wrapped = wrap(clean.replace(/\s+/g,' ').trim(), font, size, maxW, cs, ws);
      for (const wl of wrapped) drawLine(wl, size, cs, ws, lh);
    }

    // Serialise the PDF and trigger a download via a temporary <a> element.
    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = baseName + '_readable.pdf';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);   // free the blob URL afterwards

    const pc = doc.getPageCount();
    setStatus(`Done — downloaded a PDF with ${pc} page${pc>1?'s':''}.`, 'ok');
  } catch (err) {
    console.error(err);
    setStatus('Something went wrong while generating: ' + (err.message || 'unknown'), 'err');
  } finally {
    makeBtn.disabled = false;
  }
});

// Render the empty-state preview on first load.
renderPreview();
