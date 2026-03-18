const fs = require('fs');
const path = require('path');

async function main() {
  const { PDFDocument, PDFName, PDFDict, PDFArray } = await import('pdf-lib');

  const pdfPath = path.join(__dirname, '..', 'storage', 'test-org', 'documents', 'wuyxp8xq0cqyf6db4wllha25.pdf');
  const buf = fs.readFileSync(pdfPath);
  const pdfDoc = await PDFDocument.load(buf);

  const page = pdfDoc.getPages()[0];

  const resources = page.node.get(PDFName.of('Resources'));
  if (resources instanceof PDFDict) {
    const fonts = resources.get(PDFName.of('Font'));
    if (fonts instanceof PDFDict) {
      console.log('Fonts in page:');
      const entries = fonts.entries();
      for (const [key, val] of entries) {
        let fontDict = val;
        if (val && typeof val === 'object' && 'tag' in val) {
          fontDict = pdfDoc.context.lookup(val);
        }
        if (fontDict instanceof PDFDict) {
          const baseFont = fontDict.get(PDFName.of('BaseFont'));
          console.log(`  ${key}: BaseFont=${baseFont}`);
        } else {
          console.log(`  ${key}: ${val}`);
        }
      }
    } else {
      console.log('No font dictionary found on page');
    }
  } else {
    console.log('No resources dict found');
  }

  console.log('\nTotal fonts embedded in document:', pdfDoc.context.enumerateIndirectObjects().filter(([_, obj]) => {
    if (obj instanceof PDFDict) {
      const type = obj.get(PDFName.of('Type'));
      return type && type.toString() === '/Font';
    }
    return false;
  }).length);
}

main().catch(console.error);
