const BULLET_RE = /^([•·●▪▸▶→✓✗◆◇★◉○▷►–§■]\s*|-\s+|\*\s+)/u;
const NUMBERED_RE = /^(\d{1,2}[.)]\s+|[a-z][.)]\s+|\([a-z\d]\)\s+)/i;

function isMonoFont(name, styles) {
  const font = styles && styles[name];
  return font ? /courier|mono|code|consolas|fira|source.?code|inconsolata|hack/i.test(font.fontFamily || '') : false;
}

function isSymbolFont(name, styles) {
  const font = styles && styles[name];
  return font ? /symbol|wingdings|zapf|dingbat|webdings/i.test(font.fontFamily || '') : false;
}

function stripGarbledTail(text) {
  for (let i = 0; i < text.length - 3; i++) {
    const chunk = text.slice(i, i + 4);
    if ((chunk.match(/[$%^*+|\\]/g) || []).length >= 2) {
      let end = i;
      while (end > 0 && !/[a-zA-Z\xC0-\xFF]/.test(text[end - 1])) end--;
      if (end <= 3) return '';
      const good = text.slice(0, end);
      const punct = (text.slice(end, i).match(/^[.,;:!?)'"–\-\s]*/) || [''])[0];
      return (good + punct).trim();
    }
  }
  return text;
}

function itemsToLines(items, styles, viewport) {
  const pageHeight = viewport ? viewport.height : 842;
  const elements = [];

  for (const item of items) {
    if (!item.str) continue;
    const transform = item.transform || [1, 0, 0, 1, 0, 0];
    const size = Math.hypot(transform[2], transform[3]) || Math.abs(transform[3]) || item.height || 12;
    elements.push({
      text: item.str,
      x: transform[4],
      y: transform[5],
      w: item.width || 0,
      sz: size,
      pageWidth: viewport ? viewport.width : 595,
      pageHeight: viewport ? viewport.height : 842,
      isMono: isMonoFont(item.fontName, styles),
      isSymbol: isSymbolFont(item.fontName, styles),
    });
  }

  if (!elements.length) return [];

  elements.sort((a, b) => b.y - a.y || a.x - b.x);

  const bands = [];
  for (const element of elements) {
    const last = bands[bands.length - 1];
    let merge = false;
    if (last && last.y - element.y <= element.sz * 0.55) {
      // Also require horizontal continuity: two elements can share a Y-band by
      // coincidence (e.g. body text on the left and an unrelated diagram
      // label on the right sitting at nearly the same height) without
      // actually belonging to the same line of text. Elements are sorted by Y
      // first, so a slightly-higher-Y element (e.g. the label) can end up
      // processed before a slightly-lower-Y one (e.g. the body text) even
      // though it "reads" to the right — check the gap in both directions,
      // not just whether the new element extends past the band's right edge.
      const bandMinX = Math.min(...last.els.map(el => el.x));
      const bandMaxX = Math.max(...last.els.map(el => el.x + el.w));
      const gapThreshold = Math.max(element.sz * 6, 50);
      const gap = Math.max(0, bandMinX - (element.x + element.w), element.x - bandMaxX);
      if (gap <= gapThreshold) merge = true;
    }
    if (merge) {
      last.sz = Math.max(last.sz, element.sz);
      last.els.push(element);
    } else {
      bands.push({ y: element.y, sz: element.sz, els: [element] });
    }
  }

  const xs = elements.map(element => element.x);
  const pageLeft = Math.min(...xs);
  const pageRight = Math.max(...elements.map(element => element.x + element.w));
  const pageWidth = Math.max(pageRight - pageLeft, 1);

  const splitX = pageLeft + pageWidth * 0.45;
  const rightBandCount = bands.filter(band => band.els[0].x > splitX).length;
  const isTwoCol = bands.length > 8 && rightBandCount / bands.length > 0.30 && rightBandCount >= 6;

  const orderedBands = isTwoCol
    ? [...bands.filter(band => band.els[0].x <= splitX), ...bands.filter(band => band.els[0].x > splitX)]
    : bands;

  const lines = [];
  let previousY = null;
  let previousSize = null;

  for (const band of orderedBands) {
    band.els.sort((a, b) => a.x - b.x);

    let text = band.els.map(element => element.text).join('').replace(/\s+/g, ' ').trim();
    if (!text) continue;

    let monoChars = 0;
    let symbolChars = 0;
    for (const element of band.els) {
      if (element.isMono) monoChars += element.text.length;
      if (element.isSymbol) symbolChars += element.text.length;
    }

    const totalChars = text.length;
    if (totalChars > 0 && symbolChars === totalChars) continue;

    text = stripGarbledTail(text);
    if (!text) continue;

    const x = band.els[0].x;
    const size = band.sz;
    const isFooter = band.y / pageHeight < 0.10;
    const isPageHeader = band.y / pageHeight > 0.90;

    let paragraph = false;
    if (previousY !== null) {
      const gap = previousY - band.y;
      const reference = Math.max(size, previousSize || size);
      if (gap > reference * 1.7) paragraph = true;
    }

    const hasCodeWord = /[a-zA-Z]{4,}/.test(text);
    const isCode = !isFooter && !isPageHeader && totalChars > 0 && monoChars / totalChars > 0.6 && hasCodeWord;
    const inMargin = isFooter || isPageHeader;

    const bulletMatch = !inMargin && text.match(BULLET_RE);
    const isBullet = Boolean(bulletMatch);
    if (isBullet) text = text.slice(bulletMatch[0].length).trim();

    const numberedMatch = !isBullet && !inMargin && text.match(NUMBERED_RE);
    const isNumbered = Boolean(numberedMatch);
    const numPrefix = isNumbered ? numberedMatch[0].trimEnd() : '';
    if (isNumbered) text = text.slice(numberedMatch[0].length).trim();

    if (!text) continue;

    lines.push({ text, size, para: paragraph, x, y: band.els[0].y, pageWidth: pageWidth, pageHeight: pageHeight, isCode, isBullet, isNumbered, numPrefix, isFooter, isPageHeader });
    previousY = band.y;
    previousSize = size;
  }

  const bodyXs = lines.filter(line => !line.isCode && !line.isFooter && line.x > 0).map(line => line.x);
  const minX = bodyXs.length ? Math.min(...bodyXs) : 0;
  for (const line of lines) {
    line.indent = Math.max(0, Math.round((line.x - minX) / 18));
  }

  return lines;
}

function mergeListContinuations(lines) {
  const merged = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.isBullet && !line.isNumbered) {
      merged.push(line);
      continue;
    }

    let combined = line.text;
    while (i + 1 < lines.length) {
      const next = lines[i + 1];
      if (next.isPageDiv || next.isFooter || next.isPageHeader || next.isImage) break;
      if (next.para || next.isBullet || next.isNumbered || next.isCode) break;
      if (next.factor > 1.18) break;
      if (next.indent > (line.indent || 0) + 1) break;
      combined += ' ' + next.text;
      i++;
    }

    merged.push({ ...line, text: combined });
  }
  return merged;
}

function computeFactors(lines) {
  const frequencies = {};
  for (const line of lines) {
    if (line.isPageDiv || !line.size) continue;
    frequencies[line.size] = (frequencies[line.size] || 0) + (line.text || '').length;
  }

  let baseSize = 12;
  let max = -1;
  for (const key in frequencies) {
    if (frequencies[key] > max) {
      max = frequencies[key];
      baseSize = parseFloat(key);
    }
  }

  for (const line of lines) {
    if (line.isPageDiv) {
      line.factor = 1;
      continue;
    }
    let factor = line.size / baseSize;
    if (factor > 0.88 && factor < 1.18) factor = 1;
    factor = Math.max(0.75, Math.min(2.6, factor));
    line.factor = Math.round(factor * 100) / 100;
  }
}

const REPLACEMENTS = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"',
  '–': '-', '—': '-', '―': '-', '−': '-',
  '…': '...', '•': '-', '·': '-', '●': '-',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ',
  '​': '', '­': '', '﻿': '',
  'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl',
  '→': '->', '←': '<-', '«': '"', '»': '"',
};

function sanitizeWinAnsi(text) {
  let output = '';
  for (const ch of text) {
    if (REPLACEMENTS[ch] !== undefined) {
      output += REPLACEMENTS[ch];
      continue;
    }
    const code = ch.codePointAt(0);
    if (code <= 0xFF || code === 0x20AC) output += ch;
  }
  return output;
}

function sanitizeSoft(text) {
  return text.replace(/[​­﻿]/g, '').replace(/ /g, ' ');
}

function sw(font, text, size) {
  try { return font.widthOfTextAtSize(text, size); } catch (error) { return 0; }
}

function measure(text, font, size, charSpacing, wordSpacing) {
  if (charSpacing === 0 && wordSpacing === 0) return sw(font, text, size);
  let width = 0;
  for (const ch of text) {
    width += sw(font, ch, size) + charSpacing;
    if (ch === ' ') width += wordSpacing;
  }
  return width - charSpacing;
}

function wrap(text, font, size, maxWidth, charSpacing, wordSpacing) {
  const words = text.split(' ');
  const lines = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? current + ' ' + word : word;
    if (measure(candidate, font, size, charSpacing, wordSpacing) > maxWidth && current) {
      lines.push(current);
      if (measure(word, font, size, charSpacing, wordSpacing) > maxWidth) {
        let buffer = '';
        for (const ch of word) {
          const next = buffer + ch;
          if (measure(next, font, size, charSpacing, wordSpacing) > maxWidth && buffer) {
            lines.push(buffer);
            buffer = ch;
          } else {
            buffer = next;
          }
        }
        current = buffer;
      } else {
        current = word;
      }
    } else {
      current = candidate;
    }
  }

  if (current) lines.push(current);
  return lines;
}

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function formatFileSize(bytes) {
  return fmtSize(bytes);
}

function escapeHtml(text) {
  return text.replace(/[&<>\"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

Object.assign(window, {
  itemsToLines,
  mergeListContinuations,
  computeFactors,
  sanitizeWinAnsi,
  sanitizeSoft,
  sw,
  measure,
  wrap,
  formatFileSize,
  fmtSize,
  escapeHtml,
});