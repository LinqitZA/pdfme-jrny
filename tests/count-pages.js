const fs = require('fs');
const { PDFDocument } = require('pdf-lib');

const filePath = process.argv[2];
if (!filePath) { console.log('Usage: node count-pages.js <pdf-path>'); process.exit(1); }

PDFDocument.load(fs.readFileSync(filePath)).then(pdf => {
  console.log('Page count:', pdf.getPageCount());
  pdf.getPages().forEach((p, i) => {
    console.log('Page', i+1, ':', p.getWidth().toFixed(0), 'x', p.getHeight().toFixed(0));
  });
}).catch(e => console.error(e));
