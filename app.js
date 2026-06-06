pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const { PDFDocument, StandardFonts, rgb } = PDFLib;

const $ = id => document.getElementById(id);
const drop = $('drop'), fileInput = $('file');
const cardUpload = $('card-upload'), cardEdit = $('card-edit');
const fname = $('fname'), fmeta = $('fmeta'), reset = $('reset');
const fontRow = $('opt-font-row'), oFont = $('o-font'), fontSub = $('font-sub');
const sizeEl = $('size'), sizeVal = $('size-val');
const previewEl = $('preview'), statusEl = $('status'), makeBtn = $('make');

let docLines = [];     // [{text, size, factor, para}]
let baseName = 'document';

// ---- Load OpenDyslexic optionally ----
let openDyslexicBytes = null, fontkitLib = null, odPreviewReady = false;
(async () => {
  const fkUrls = [
    'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js',
    'https://unpkg.com/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js'
  ];
  const fontUrls = [
    'https://cdn.jsdelivr.net/gh/antijingoist/open-dyslexic@master/ttf/OpenDyslexic-Regular.ttf',
    'https://cdn.jsdelivr.net/gh/madjeek-web/open-dyslexic@main/OpenDyslexic-2025/opendyslexic-regular-webfont.ttf'
  ];
  try {
    for (const u of fkUrls) { try { await loadScript(u); if (window.fontkit) break; } catch(e){} }
    fontkitLib = window.fontkit;
    if (!fontkitLib) throw 0;
    let buf = null;
    for (const u of fontUrls) { try { const r = await fetch(u); if (r.ok) { buf = await r.arrayBuffer(); break; } } catch(e){} }
    if (!buf) throw 0;
    openDyslexicBytes = buf;

    // register font for the preview
    try { const ff = new FontFace('ODPreview', buf); await ff.load(); document.fonts.add(ff); odPreviewReady = true; } catch(e){}

    fontRow.setAttribute('aria-disabled', 'false');
    oFont.disabled = false; oFont.checked = true;
    fontSub.textContent = 'typeface designed for dyslexia';
    syncOptStyles(); renderPreview();
  } catch (e) {
    fontSub.textContent = 'currently unavailable (CDN unreachable)';
  }
})();
function loadScript(src){ return new Promise((res,rej)=>{ const s=document.createElement('script'); s.src=src; s.onload=res; s.onerror=rej; document.head.appendChild(s); }); }

// ---- Read options ----
function opts(){
  return {
    font: oFont.checked && !oFont.disabled,
    line: $('o-line').checked,
    letter: $('o-letter').checked,
    word: $('o-word').checked,
    bg: $('o-bg').checked,
    size: parseInt(sizeEl.value, 10)
  };
}
function syncOptStyles(){
  document.querySelectorAll('.opt').forEach(l => {
    const cb = l.querySelector('input');
    l.classList.toggle('off', !cb.checked || cb.disabled);
  });
}

// ---- Events ----
drop.addEventListener('click', () => fileInput.click());
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag'); });
drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('drag'); if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]); });
fileInput.addEventListener('change', e => { if (e.target.files.length) handleFile(e.target.files[0]); });
reset.addEventListener('click', () => { cardEdit.classList.add('hidden'); cardUpload.classList.remove('hidden'); fileInput.value=''; setStatus('',''); docLines=[]; });

document.querySelectorAll('#opts input').forEach(cb => cb.addEventListener('change', () => { syncOptStyles(); renderPreview(); }));
sizeEl.addEventListener('input', () => { sizeVal.textContent = sizeEl.value + ' pt'; renderPreview(); });

function setStatus(msg, cls){ statusEl.className = 'status ' + (cls||''); statusEl.innerHTML = msg; }
function fmtSize(b){ if (b<1024) return b+' B'; if (b<1048576) return (b/1024).toFixed(0)+' KB'; return (b/1048576).toFixed(1)+' MB'; }
function escapeHtml(s){ return s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// ---- Read the file ----
async function handleFile(file){
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    cardUpload.classList.add('hidden'); cardEdit.classList.remove('hidden');
    fname.textContent = file.name; setStatus("That's not a PDF. Please choose a PDF file.", 'err'); return;
  }
  baseName = file.name.replace(/\.pdf$/i,'') || 'document';
  fname.textContent = file.name; fmeta.textContent = fmtSize(file.size);
  cardUpload.classList.add('hidden'); cardEdit.classList.remove('hidden');
  previewEl.innerHTML = ''; setStatus('<span class="spinner"></span>Reading text …', 'work');

  try {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let lines = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const pageLines = itemsToLines(content.items);
      if (p > 1 && pageLines.length) pageLines[0].para = true; // page break = paragraph
      lines = lines.concat(pageLines);
      setStatus(`<span class="spinner"></span>Page ${p} of ${pdf.numPages} …`, 'work');
    }
    if (!lines.length) {
      setStatus('No text found — this PDF is probably scanned (images only). That would need OCR.', 'err');
      docLines = []; return;
    }
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

// Items -> lines with dominant font size + paragraph flag
function itemsToLines(items){
  const raw = []; let cur = null, lastY = null;
  for (const it of items) {
    const tr = it.transform || [1,0,0,1,0,0];
    const sz = Math.hypot(tr[2]||0, tr[3]||0) || it.height || 12;
    const y = tr[5];
    if (it.str) {
      if (lastY === null || Math.abs(y - lastY) > sz * 0.5) { cur = { y, text:'', sizes:{} }; raw.push(cur); lastY = y; }
      cur.text += it.str;
      const key = Math.round(sz * 2) / 2;
      cur.sizes[key] = (cur.sizes[key] || 0) + it.str.length;
    }
    if (it.hasEOL) lastY = null;
  }
  const lines = []; let prevY = null, prevSize = null;
  for (const r of raw) {
    const text = r.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    let dom = 12, max = -1;
    for (const k in r.sizes) { if (r.sizes[k] > max) { max = r.sizes[k]; dom = parseFloat(k); } }
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

// Body size = the size that covers the most text; derive relative factors from it
function computeFactors(lines){
  const freq = {};
  for (const l of lines) freq[l.size] = (freq[l.size] || 0) + l.text.length;
  let base = 12, max = -1;
  for (const k in freq) { if (freq[k] > max) { max = freq[k]; base = parseFloat(k); } }
  for (const l of lines) {
    let f = l.size / base;
    if (f > 0.88 && f < 1.18) f = 1;          // unify body text
    f = Math.max(0.75, Math.min(2.6, f));      // clamp outliers
    l.factor = Math.round(f * 100) / 100;
  }
}

// ---- Live preview ----
function renderPreview(){
  if (!docLines.length) { previewEl.innerHTML = '<div style="color:#999;font-size:14px;">Preview appears once a file has been read.</div>'; return; }
  const o = opts();
  const lhF = o.line ? 1.8 : 1.35;
  previewEl.style.background = o.bg ? '#fbf3e2' : '#ffffff';
  previewEl.style.color = o.bg ? '#2b2620' : '#1a1a1a';
  previewEl.style.fontFamily = (o.font && odPreviewReady) ? "'ODPreview', sans-serif" : "Arial, Helvetica, sans-serif";
  let html = '';
  for (const l of docLines) {
    const s = o.size * l.factor;
    const cs = o.letter ? s * 0.07 : 0;
    const ws = o.word ? s * 0.18 : 0;
    const mt = l.para ? (o.size * 0.7) : 0;
    const weight = l.factor > 1.18 ? 600 : 400;
    html += `<div style="font-size:${s}px;line-height:${lhF};letter-spacing:${cs}px;word-spacing:${ws}px;margin-top:${mt}px;font-weight:${weight};">${escapeHtml(l.text)}</div>`;
  }
  previewEl.innerHTML = html;
}

// ---- Sanitising ----
const REPL = {
  '\u2018':"'", '\u2019':"'", '\u201A':"'", '\u201B':"'", '\u201C':'"', '\u201D':'"', '\u201E':'"', '\u201F':'"',
  '\u2013':'-', '\u2014':'-', '\u2015':'-', '\u2212':'-', '\u2026':'...', '\u2022':'-', '\u00B7':'-', '\u25CF':'-',
  '\u00A0':' ', '\u2007':' ', '\u2008':' ', '\u2009':' ', '\u200A':' ', '\u202F':' ', '\u200B':'', '\u00AD':'', '\uFEFF':'',
  '\uFB00':'ff','\uFB01':'fi','\uFB02':'fl','\uFB03':'ffi','\uFB04':'ffl', '\u2192':'->','\u2190':'<-','\u00AB':'"','\u00BB':'"'
};
function sanitizeWinAnsi(s){ let o=''; for (const ch of s){ if (REPL[ch]!==undefined){ o+=REPL[ch]; continue; } const c=ch.codePointAt(0); if (c<=0xFF||c===0x20AC) o+=ch; } return o; }
function sanitizeSoft(s){ return s.replace(/[\u200B\u00AD\uFEFF]/g,'').replace(/\u00A0/g,' '); }

// ---- Measure width (incl. letter / word spacing) ----
function sw(font, s, size){ try { return font.widthOfTextAtSize(s, size); } catch(e){ return 0; } }
function measure(text, font, size, cs, ws){
  if (cs === 0 && ws === 0) return sw(font, text, size);
  let w = 0;
  for (const ch of text){ w += sw(font, ch, size) + cs; if (ch === ' ') w += ws; }
  return w - cs;
}
function wrap(text, font, size, maxW, cs, ws){
  const words = text.split(' '); const lines = []; let line = '';
  for (const w of words){
    const test = line ? line + ' ' + w : w;
    if (measure(test, font, size, cs, ws) > maxW && line){
      lines.push(line);
      if (measure(w, font, size, cs, ws) > maxW){
        let buf = '';
        for (const ch of w){ const t = buf + ch; if (measure(t, font, size, cs, ws) > maxW && buf){ lines.push(buf); buf = ch; } else buf = t; }
        line = buf;
      } else line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

// ---- Build the PDF ----
makeBtn.addEventListener('click', async () => {
  if (!docLines.length){ setStatus('No text to export.', 'err'); return; }
  makeBtn.disabled = true; setStatus('<span class="spinner"></span>Building PDF …', 'work');
  try {
    const o = opts();
    const doc = await PDFDocument.create();
    let font, embedded = false;
    if (o.font && openDyslexicBytes && fontkitLib){
      doc.registerFontkit(fontkitLib);
      font = await doc.embedFont(openDyslexicBytes, { subset: true }); embedded = true;
    } else {
      font = await doc.embedFont(StandardFonts.Helvetica);
    }

    const PW = 595.28, PH = 841.89;
    const marginPt = 25 * 2.83465;
    const maxW = PW - marginPt * 2;
    const baseS = o.size;
    const lhF = o.line ? 1.8 : 1.35;

    const bg = o.bg ? rgb(0.984, 0.953, 0.886) : null;
    const textColor = o.bg ? rgb(0.169, 0.149, 0.125) : rgb(0.1, 0.1, 0.1);

    const newPage = () => { const p = doc.addPage([PW, PH]); if (bg) p.drawRectangle({ x:0, y:0, width:PW, height:PH, color:bg }); return p; };
    let page = newPage(); let y = PH - marginPt;

    const drawLine = (txt, size, cs, ws, lh) => {
      if (y - lh < marginPt){ page = newPage(); y = PH - marginPt; }
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

    for (const l of docLines){
      const size = baseS * l.factor;
      const cs = o.letter ? size * 0.07 : 0;
      const ws = o.word ? size * 0.18 : 0;
      const lh = size * lhF;
      if (l.para) y -= baseS * lhF * 0.5;
      const clean = embedded ? sanitizeSoft(l.text) : sanitizeWinAnsi(l.text);
      const wrapped = wrap(clean.replace(/\s+/g,' ').trim(), font, size, maxW, cs, ws);
      for (const wl of wrapped) drawLine(wl, size, cs, ws, lh);
    }

    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = baseName + '_readable.pdf';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    const pc = doc.getPageCount();
    setStatus(`Done — downloaded a PDF with ${pc} page${pc>1?'s':''}.`, 'ok');
  } catch (err) {
    console.error(err);
    setStatus('Something went wrong while generating: ' + (err.message || 'unknown'), 'err');
  } finally {
    makeBtn.disabled = false;
  }
});

renderPreview();
