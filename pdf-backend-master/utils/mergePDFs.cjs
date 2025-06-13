const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

async function mergePDFs(inputDir, outputPath) {
  const files = fs.readdirSync(inputDir).filter(f => f.endsWith('.pdf'));
  const mergedPdf = await PDFDocument.create();

  for (const file of files) {
    const filePath = path.join(inputDir, file);
    const pdfBytes = fs.readFileSync(filePath);
    const pdf = await PDFDocument.load(pdfBytes);
    const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
    copiedPages.forEach((page) => mergedPdf.addPage(page));
  }

  const mergedBytes = await mergedPdf.save();
  fs.writeFileSync(outputPath, mergedBytes);
}

module.exports = { mergePDFs };
