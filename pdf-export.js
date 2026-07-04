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

    const orientation = options.orientation === 'landscape' ? 'landscape' : 'portrait';
    const pageWidth = orientation === 'landscape' ? 841.89 : 595.28;
    const pageHeight = orientation === 'landscape' ? 595.28 : 841.89;
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

    let page = null;
    let y = pageHeight - margin;
    let hasPageContent = false;

    for (const line of docLines) {
      if (line.isPageDiv) {
        if (!page) {
          page = newPage();
          y = pageHeight - margin;
          hasPageContent = false;
          continue;
        }
        if (hasPageContent) {
          page = newPage();
          y = pageHeight - margin;
          hasPageContent = false;
        }
        continue;
      }

      if (line.isImage) {
        if (!page) {
          page = newPage();
          y = pageHeight - margin;
        }

        const imageBytes = await fetch(line.imageDataUrl).then(response => response.arrayBuffer());
        const image = await doc.embedPng(imageBytes);
        const pageContentWidth = maxWidth;
        const pageContentHeight = pageHeight - margin * 2;
        const imageAspect = image.width / image.height;
        const widthRatio = Math.max(0.18, Math.min(1, Number(line.imageWidthRatio) || 1));
        const xRatio = Math.max(0, Math.min(1, Number(line.imageXRatio) || 0));
        const yRatio = Math.max(0, Math.min(1, Number(line.imageYRatio) || 0));
        let imageWidth = pageContentWidth * widthRatio;
        let imageHeight = imageWidth / imageAspect;
        if (imageHeight > pageContentHeight) {
          imageHeight = pageContentHeight;
          imageWidth = imageHeight * imageAspect;
        }

        if (line.pageOnlyImage) {
          imageWidth = pageContentWidth;
          imageHeight = imageWidth / imageAspect;
          if (imageHeight > pageContentHeight) {
            imageHeight = pageContentHeight;
            imageWidth = imageHeight * imageAspect;
          }
          const xOnly = margin + (pageContentWidth - imageWidth) * 0.5;
          const yOnly = margin + (pageContentHeight - imageHeight) * 0.5;
          page.drawImage(image, { x: xOnly, y: yOnly, width: imageWidth, height: imageHeight });
          y = yOnly - Math.max(8, baseSize * 0.35);
          hasPageContent = true;
          continue;
        }

        const blockTopGap = Math.max(8, baseSize * 0.6);
        const desiredTopY = pageHeight - margin - yRatio * pageContentHeight;
        if (desiredTopY < y) {
          y = Math.max(margin + imageHeight, desiredTopY);
        }
        if (y - blockTopGap - imageHeight < margin) {
          page = newPage();
          y = pageHeight - margin;
        }

        y -= blockTopGap;
  const x = margin + (pageContentWidth - imageWidth) * xRatio;
        const yPos = y - imageHeight;
        page.drawImage(image, { x, y: yPos, width: imageWidth, height: imageHeight });
        y = yPos - Math.max(8, baseSize * 0.35);
        hasPageContent = true;

        continue;
      }

      if (!page) {
        page = newPage();
        y = pageHeight - margin;
        hasPageContent = false;
      }

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
          hasPageContent = true;
        }
        continue;
      }

      const size = baseSize * line.factor;
      const charSpacing = options.letter ? size * 0.07 : 0;
      const wordSpacing = options.word ? size * 0.18 : 0;
      const lineHeight = size * lineHeightFactor;
      if (line.para) y -= baseSize * lineHeightFactor * 0.5;
      else if (line.isSentenceBreak) y -= baseSize * lineHeightFactor * 0.2;

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
        hasPageContent = true;
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