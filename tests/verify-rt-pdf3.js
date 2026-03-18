const fs = require('fs');
const path = require('path');

async function main() {
  const { PDFDocument } = await import('pdf-lib');

  const pdfPath = path.join(__dirname, '..', 'storage', 'test-org', 'documents', 'wuyxp8xq0cqyf6db4wllha25.pdf');
  const buf = fs.readFileSync(pdfPath);

  const pdfDoc = await PDFDocument.load(buf);
  const pages = pdfDoc.getPages();
  console.log('Pages:', pages.length);

  const page = pages[0];
  const { width, height } = page.getSize();
  console.log('Page size:', width, 'x', height);

  const rawContent = buf.toString('latin1');

  const fontRefs = rawContent.match(/\/[A-Za-z0-9_-]+-?[A-Za-z]*\s/g);
  const uniqueFonts = [...new Set(fontRefs || [])].filter(f => f.includes('Helvetica') || f.includes('Font') || f.includes('F1') || f.includes('F2') || f.includes('F3') || f.includes('F4'));
  console.log('Font references found:', uniqueFonts);

  const tjMatches = rawContent.match(/\(([^)]{1,50})\)\s*Tj/g);
  if (tjMatches) {
    console.log('Text operations found:');
    for (const m of tjMatches.slice(0, 20)) {
      console.log('  ', m);
    }
  }

  const tfMatches = rawContent.match(/\/\w+\s+\d+\.?\d*\s+Tf/g);
  if (tfMatches) {
    console.log('Font selections (Tf):');
    for (const m of [...new Set(tfMatches)]) {
      console.log('  ', m);
    }
  }
}

main().catch(console.error);
