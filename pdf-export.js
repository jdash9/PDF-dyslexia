function createPdfExporter(PDFDocument, StandardFonts, rgb) {
  return async function exportReadablePdf({ docLines, options, baseName, fontAsset, fontkitLib }) {
    if (!docLines.length) throw new Error('No text to export.');

    const doc = await PDFDocument.create();
    let font;
    let codeFont;
    let embedded = false;

    if (fontAsset?.bytes && fontkitLib) {
      doc.registerFontkit(fontkitLib);
      font = await doc.embedFont(fontAsset.bytes, { subset: true });
      embedded = true;
    } else {
      font = await doc.embedFont(StandardFonts.Helvetica);
    }
    codeFont = await doc.embedFont(StandardFonts.Courier);

    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const margin = 25 * 2.83465;
    const maxWidth = pageWidth - margin * 2;
    const baseSize = options.size;
    const lineHeightFactor = options.line ? 1.8 : 1.35;
    const background = options.bg ? rgb(0.984, 0.953, 0.886) : null;
    const textColor = options.bg ? rgb(0.169, 0.149, 0.125) : rgb(0.1, 0.1, 0.1);

    const newPage = () => {
      const page = doc.addPage([pageWidth, pageHeight]);
      if (background) page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: background });
      return page;
    };

    let page = newPage();
    let y = pageHeight - margin;

    for (const line of docLines) {
      if (line.isPageDiv) continue;

      const indent = (line.indent || 0) * 14;

      if (line.isCode) {
        const size = baseSize * line.factor * 0.88;
        const lineHeight = size * lineHeightFactor;
        if (line.para) y -= size * 0.3;
        const clean = sanitizeWinAnsi(line.text);
        const availableWidth = maxWidth - indent;
        const wrapped = wrap(clean.replace(/\s+/g, ' ').trim(), codeFont, size, availableWidth, 0, 0);

        for (const wrappedLine of wrapped) {
          if (y - lineHeight < margin) {
            page = newPage();
            y = pageHeight - margin;
          }
          const baseY = y - size;
          try { page.drawText(wrappedLine, { x: margin + indent, y: baseY, size, font: codeFont, color: textColor }); } catch (error) {}
          y -= lineHeight;
        }
        continue;
      }

      const size = baseSize * line.factor;
      const charSpacing = options.letter ? size * 0.07 : 0;
      const wordSpacing = options.word ? size * 0.18 : 0;
      const lineHeight = size * lineHeightFactor;
      if (line.para) y -= baseSize * lineHeightFactor * 0.5;

      let rawText = line.text;
      if (line.isBullet) rawText = (embedded ? '• ' : '- ') + rawText;
      if (line.isNumbered) rawText = line.numPrefix + ' ' + rawText;

      const clean = embedded ? sanitizeSoft(rawText) : sanitizeWinAnsi(rawText);
      const availableWidth = maxWidth - indent;
      const wrapped = wrap(clean.replace(/\s+/g, ' ').trim(), font, size, availableWidth, charSpacing, wordSpacing);

      for (const wrappedLine of wrapped) {
        if (y - lineHeight < margin) {
          page = newPage();
          y = pageHeight - margin;
        }

        const baseY = y - size;
        let x = margin + indent;
        if (charSpacing === 0 && wordSpacing === 0) {
          try { page.drawText(wrappedLine, { x, y: baseY, size, font, color: textColor }); } catch (error) {}
        } else {
          for (const ch of wrappedLine) {
            if (ch !== ' ') {
              try { page.drawText(ch, { x, y: baseY, size, font, color: textColor }); } catch (error) {}
            }
            x += sw(font, ch, size) + charSpacing;
            if (ch === ' ') x += wordSpacing;
          }
        }
        y -= lineHeight;
      }
    }

    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = baseName + '_readable.pdf';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);

    return doc.getPageCount();
  };
}