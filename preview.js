function renderPreview(docLines, options, previewEl, previewFrame) {
  if (!docLines.length) {
    previewEl.innerHTML = '<div style="color:#999;font-size:14px;padding:12px 0;">Preview appears once a file has been read.</div>';
    return;
  }

  const lineHeightFactor = options.line ? 1.8 : 1.35;
  const fontFamily = PREVIEW_FONTS[options.font] || PREVIEW_FONTS.none;
  const cardBg = options.bg ? '#fbf3e2' : '#ffffff';
  const cardColor = options.bg ? '#2b2620' : '#1a1a1a';
  const headerColor = options.bg ? 'rgba(43,38,32,.40)' : 'rgba(0,0,0,.32)';
  const codeColor = options.bg ? 'rgba(0,0,0,.08)' : 'rgba(0,0,0,.06)';
  const codeBorder = options.bg ? '1px solid rgba(0,0,0,.10)' : '1px solid rgba(0,0,0,.08)';
  const codeSize = options.size * 0.88;

  previewEl.style.background = 'transparent';
  previewEl.style.color = 'inherit';
  previewEl.style.fontFamily = fontFamily;

  const orientationClass = options.orientation === 'landscape' ? 'landscape-preview' : 'portrait-preview';
  previewEl.classList.remove('portrait-preview', 'landscape-preview');
  previewEl.classList.add(orientationClass);

  const rootStyles = getComputedStyle(document.documentElement);
  const warmBg = rootStyles.getPropertyValue('--preview-bg-warm').trim();
  const coolBg = rootStyles.getPropertyValue('--preview-bg-cool').trim();
  previewFrame.style.background = options.bg ? warmBg : coolBg;

  let html = '';
  let inPage = false;
  let index = 0;

  while (index < docLines.length) {
    const line = docLines[index];

    if (line.isPageDiv) {
      if (inPage) html += '</div>';
      html += `<div class="page-card" style="background:${cardBg};color:${cardColor};">`;
      inPage = true;
      index++;
      continue;
    }

    if (!inPage) {
      html += `<div class="page-card" style="background:${cardBg};color:${cardColor};">`;
      inPage = true;
    }

    if (line.isFooter) {
      index++;
      continue;
    }

    if (line.isImage) {
      if (line.pageOnlyImage) {
        const imageStyleOnly = 'width:100%;height:auto;display:block;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.14);object-fit:contain;';
        html += `<div style="margin:10px 0 10px;"><img src="${line.imageDataUrl}" alt="Kept image content" style="${imageStyleOnly}"></div>`;
        index++;
        continue;
      }
      const widthRatio = Math.max(0.18, Math.min(1, Number(line.imageWidthRatio) || 1));
      const xRatio = Math.max(0, Math.min(1, Number(line.imageXRatio) || 0));
      const widthPct = Math.round(widthRatio * 100);
      const leftPct = Math.max(0, Math.min(100 - widthPct, Math.round((100 - widthPct) * xRatio)));
      const imageStyle = `width:${widthPct}%;margin-left:${leftPct}%;height:auto;display:block;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.14);object-fit:contain;`;
      html += `<div style="margin:18px 0 8px;"><img src="${line.imageDataUrl}" alt="Kept image content" style="${imageStyle}"></div>`;
      index++;
      continue;
    }

    if (line.isPageHeader) {
      const size = options.size * 0.76;
      html += `<div style="font-size:${size}px;line-height:1.4;color:${headerColor};letter-spacing:0.05em;margin-bottom:4px;">${escapeHtml(line.text)}</div>`;
      index++;
      continue;
    }

    if (line.isCode) {
      const topMargin = line.para ? options.size * 0.7 : 4;
      const codeLines = [];
      while (index < docLines.length && docLines[index].isCode) {
        codeLines.push(docLines[index].text);
        index++;
      }
      html += `<pre style="font-family:'Courier New',Courier,monospace;font-size:${codeSize}px;line-height:${lineHeightFactor};letter-spacing:0;word-spacing:0;margin:${topMargin}px 0 4px;padding:8px 12px;background:${codeColor};border:${codeBorder};border-radius:6px;white-space:pre-wrap;overflow-x:auto;">${codeLines.map(text => escapeHtml(text)).join('\n')}</pre>`;
      continue;
    }

    const size = options.size * line.factor;
    const letterSpacing = options.letter ? size * 0.07 : 0;
    const wordSpacing = options.word ? size * 0.18 : 0;
    const topMargin = line.para ? options.size * 0.7 : 2;
    const fontWeight = line.factor > 1.18 ? 600 : 400;
    const indent = (line.isBullet || line.isNumbered) ? Math.min(line.indent || 0, 4) * 16 : 0;

    if (line.isBullet) {
      html += `<div style="font-size:${size}px;line-height:${lineHeightFactor};letter-spacing:${letterSpacing}px;word-spacing:${wordSpacing}px;margin-top:${topMargin}px;font-weight:${fontWeight};padding-left:${indent + 20}px;text-indent:-20px;"><span aria-hidden="true">•&thinsp;</span>${escapeHtml(line.text)}</div>`;
    } else if (line.isNumbered) {
      html += `<div style="font-size:${size}px;line-height:${lineHeightFactor};letter-spacing:${letterSpacing}px;word-spacing:${wordSpacing}px;margin-top:${topMargin}px;font-weight:${fontWeight};padding-left:${indent + 24}px;text-indent:-24px;">${escapeHtml(line.numPrefix)}&thinsp;${escapeHtml(line.text)}</div>`;
    } else {
      html += `<div style="font-size:${size}px;line-height:${lineHeightFactor};letter-spacing:${letterSpacing}px;word-spacing:${wordSpacing}px;margin-top:${topMargin}px;font-weight:${fontWeight};">${escapeHtml(line.text)}</div>`;
    }

    index++;
  }

  if (inPage) html += '</div>';
  previewEl.innerHTML = html;
}