const fs = require('fs');
const path = require('path');

const pdfDir = path.join(__dirname, '..', 'storage', 'test-org', 'documents');
const files = fs.readdirSync(pdfDir).filter(f => f.endsWith('.pdf')).sort((a, b) => {
  return fs.statSync(path.join(pdfDir, b)).mtimeMs - fs.statSync(path.join(pdfDir, a)).mtimeMs;
});

console.log('Recent PDFs:');
for (const f of files.slice(0, 8)) {
  const buf = fs.readFileSync(path.join(pdfDir, f));
  const text = buf.toString('latin1');
  const hasBold = text.includes('Helvetica-Bold');
  const hasOblique = text.includes('Helvetica-Oblique');
  const hasBoldOblique = text.includes('Helvetica-BoldOblique');
  console.log(`  ${f} (${buf.length}b) bold=${hasBold} oblique=${hasOblique} boldOblique=${hasBoldOblique}`);

  if (hasBold || hasOblique) {
    console.log('    -> This PDF has formatting!');
    const boldTextMatch = text.includes('Bold');
    const italicTextMatch = text.includes('italic');
    console.log(`    Contains "Bold": ${boldTextMatch}, Contains "italic": ${italicTextMatch}`);
  }
}
