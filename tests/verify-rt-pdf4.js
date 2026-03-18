const fs = require('fs');
const path = require('path');

async function main() {
  const { PDFDocument } = await import('pdf-lib');

  const pdfPath = path.join(__dirname, '..', 'storage', 'test-org', 'documents', 'wuyxp8xq0cqyf6db4wllha25.pdf');
  const buf = fs.readFileSync(pdfPath);
  const pdfDoc = await PDFDocument.load(buf);

  const page = pdfDoc.getPages()[0];
  const ops = page.node.normalizedEntries();

  console.log('Page node keys:', Object.keys(page.node));

  const rawContent = buf.toString('binary');

  const streamMatches = [];
  let idx = 0;
  while ((idx = rawContent.indexOf('stream\n', idx)) !== -1) {
    const endIdx = rawContent.indexOf('endstream', idx);
    if (endIdx !== -1 && endIdx - idx < 5000) {
      const content = rawContent.substring(idx + 7, endIdx).trim();
      if (content.length > 5 && content.length < 3000) {
        streamMatches.push(content.substring(0, 500));
      }
    }
    idx++;
  }

  console.log('\nContent streams found:', streamMatches.length);
  for (let i = 0; i < streamMatches.length; i++) {
    const s = streamMatches[i];
    if (s.includes('Tf') || s.includes('Tj') || s.includes('BT')) {
      console.log(`\nStream ${i} (text content):`);
      console.log(s.substring(0, 800));
    }
  }
}

main().catch(console.error);
