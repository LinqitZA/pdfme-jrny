const fs = require('fs');
const path = require('path');

const pdfDir = path.join(__dirname, '..', 'storage', 'test-org', 'documents');
const files = fs.readdirSync(pdfDir).filter(f => f.endsWith('.pdf')).sort((a, b) => {
  return fs.statSync(path.join(pdfDir, b)).mtimeMs - fs.statSync(path.join(pdfDir, a)).mtimeMs;
});

if (files.length === 0) {
  console.log('No PDF files found');
  process.exit(1);
}

const latest = files[0];
const pdfPath = path.join(pdfDir, latest);
const buf = fs.readFileSync(pdfPath);
const text = buf.toString('latin1');

console.log('PDF file:', latest);
console.log('Size:', buf.length, 'bytes');
console.log('Is valid PDF:', text.startsWith('%PDF'));

const hasHelvetica = text.includes('Helvetica');
const hasHelveticaBold = text.includes('Helvetica-Bold');
const hasHelveticaOblique = text.includes('Helvetica-Oblique');

console.log('Contains Helvetica (regular):', hasHelvetica);
console.log('Contains Helvetica-Bold:', hasHelveticaBold);
console.log('Contains Helvetica-Oblique:', hasHelveticaOblique);

const hasBoldText = text.includes('Bold text') || text.includes('Bold');
const hasItalicText = text.includes('italic text') || text.includes('italic');
console.log('Contains bold text content:', hasBoldText);
console.log('Contains italic text content:', hasItalicText);

if (hasHelvetica && hasHelveticaBold && hasHelveticaOblique) {
  console.log('\nVERIFIED: PDF contains multiple font variants (formatting preserved)');
} else {
  console.log('\nWARNING: Expected multiple font variants');
}
