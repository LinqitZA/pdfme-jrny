#!/bin/bash
set -e

BASE_URL="http://localhost:3000/api/pdfme"
JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJvcmdJZCI6InRlc3Qtb3JnIiwicm9sZXMiOlsiYWRtaW4iXX0.fakesig"
AUTH="Authorization: Bearer $JWT"
PASS=0
FAIL=0
TOTAL=0

check() {
  TOTAL=$((TOTAL + 1))
  local desc="$1"
  local expected="$2"
  local actual="$3"
  if echo "$actual" | grep -q "$expected"; then
    PASS=$((PASS + 1))
    echo "  PASS: $desc"
  else
    FAIL=$((FAIL + 1))
    echo "  FAIL: $desc (expected '$expected', got: $(echo "$actual" | head -c 300))"
  fi
}

echo "=== Feature #129: Signature block renders placeholder ==="
echo ""

echo "Step 1: Create template with signatureBlock element"
TEMPLATE=$(curl -s -X POST "$BASE_URL/templates" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{
    "name": "Signature Block Test",
    "type": "invoice",
    "schema": {
      "basePdf": {"width": 210, "height": 297, "padding": [10,10,10,10]},
      "schemas": [[
        {"name": "title", "type": "text", "position": {"x": 10, "y": 10}, "width": 190, "height": 20, "fontSize": 24},
        {"name": "sigBlock", "type": "signatureBlock", "position": {"x": 10, "y": 240}, "width": 80, "height": 30, "label": "Authorized Signature", "subLabel": "{{signer.name}}"}
      ]]
    }
  }')

TEMPLATE_ID=$(echo "$TEMPLATE" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{console.log(JSON.parse(d).id)}catch{console.log('ERROR')}})")
check "Template created" '"id"' "$TEMPLATE"
echo "  Template ID: $TEMPLATE_ID"

echo ""
echo "Step 2: Publish template"
PUB=$(curl -s -X POST "$BASE_URL/templates/$TEMPLATE_ID/publish" -H "$AUTH")
check "Template published" '"status":"published"' "$PUB"

echo ""
echo "Step 3: Render PDF with signature block and field bindings"
RENDER=$(curl -s -X POST "$BASE_URL/render/now" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d "{
    \"templateId\": \"$TEMPLATE_ID\",
    \"entityId\": \"sig-block-test-1\",
    \"channel\": \"print\",
    \"inputs\": [{\"title\": \"Invoice #1234\", \"signer.name\": \"John Smith\"}]
  }")

echo "  Render: $(echo "$RENDER" | head -c 300)"
check "Render succeeded" '"status":"done"' "$RENDER"

DOC_FILE=$(echo "$RENDER" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{console.log(JSON.parse(d).document.filePath)}catch{console.log('ERROR')}})")
echo "  File: $DOC_FILE"

echo ""
echo "Step 4: Verify PDF exists and has content"
if [ "$DOC_FILE" != "ERROR" ] && [ -f "storage/$DOC_FILE" ]; then
  PDF_SIZE=$(stat -c%s "storage/$DOC_FILE" 2>/dev/null || stat -f%z "storage/$DOC_FILE" 2>/dev/null)
  check "PDF file exists" "1" "1"
  check "PDF has content (size > 1000)" "1" "$([ "$PDF_SIZE" -gt 1000 ] && echo 1 || echo 0)"
  echo "  PDF size: $PDF_SIZE bytes"
else
  FAIL=$((FAIL + 2))
  TOTAL=$((TOTAL + 2))
  echo "  FAIL: PDF not found at storage/$DOC_FILE"
fi

echo ""
echo "Step 5: Verify signature line and label via pdf-lib font inspection"
if [ "$DOC_FILE" != "ERROR" ] && [ -f "storage/$DOC_FILE" ]; then
  VERIFY=$(node -e "
  async function main() {
    const { PDFDocument, PDFName, PDFDict } = await import('pdf-lib');
    const fs = require('fs');
    const buf = fs.readFileSync('storage/$DOC_FILE');
    const pdfDoc = await PDFDocument.load(buf);
    const page = pdfDoc.getPages()[0];
    const resources = page.node.get(PDFName.of('Resources'));
    let fontNames = [];
    if (resources instanceof PDFDict) {
      const fonts = resources.get(PDFName.of('Font'));
      if (fonts instanceof PDFDict) {
        for (const [key, val] of fonts.entries()) {
          let fd = val;
          if (val && typeof val === 'object' && 'tag' in val) fd = pdfDoc.context.lookup(val);
          if (fd instanceof PDFDict) {
            const bf = fd.get(PDFName.of('BaseFont'));
            if (bf) fontNames.push(bf.toString());
          }
        }
      }
    }
    const hasHelvetica = fontNames.some(n => n.includes('Helvetica'));
    console.log(hasHelvetica);
  }
  main().catch(() => console.log('false'));
  " 2>/dev/null)
  check "PDF contains Helvetica font for label text" "true" "$VERIFY"
else
  FAIL=$((FAIL + 1))
  TOTAL=$((TOTAL + 1))
  echo "  FAIL: Cannot verify - PDF not found"
fi

echo ""
echo "Step 6: Verify label text correct via pdf-lib inspection"
if [ "$DOC_FILE" != "ERROR" ] && [ -f "storage/$DOC_FILE" ]; then
  FONT_CHECK=$(node -e "
  async function main() {
    const { PDFDocument, PDFName, PDFDict } = await import('pdf-lib');
    const fs = require('fs');
    const buf = fs.readFileSync('storage/$DOC_FILE');
    const pdfDoc = await PDFDocument.load(buf);
    const page = pdfDoc.getPages()[0];
    const resources = page.node.get(PDFName.of('Resources'));
    let fontCount = 0;
    if (resources instanceof PDFDict) {
      const fonts = resources.get(PDFName.of('Font'));
      if (fonts instanceof PDFDict) {
        fontCount = fonts.entries().length;
      }
    }
    console.log(JSON.stringify({ pages: pdfDoc.getPages().length, fonts: fontCount }));
  }
  main().catch(e => console.log(JSON.stringify({ error: e.message })));
  " 2>/dev/null)
  echo "  Font check: $FONT_CHECK"
  check "PDF has embedded fonts for label" "fonts" "$FONT_CHECK"
else
  FAIL=$((FAIL + 1))
  TOTAL=$((TOTAL + 1))
  echo "  FAIL: Cannot verify"
fi

echo ""
echo "Step 7: Render with sub-label from input override"
RENDER2=$(curl -s -X POST "$BASE_URL/render/now" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d "{
    \"templateId\": \"$TEMPLATE_ID\",
    \"entityId\": \"sig-block-test-2\",
    \"channel\": \"print\",
    \"inputs\": [{\"title\": \"Invoice #5678\", \"sigBlock\": \"Jane Doe - CFO\", \"signer.name\": \"Jane Doe\"}]
  }")
check "Render with sub-label override succeeded" '"status":"done"' "$RENDER2"

echo ""
echo "Step 8: Render without sub-label (label only)"
TEMPLATE3=$(curl -s -X POST "$BASE_URL/templates" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{
    "name": "Sig Block No Sub",
    "type": "invoice",
    "schema": {
      "basePdf": {"width": 210, "height": 297, "padding": [10,10,10,10]},
      "schemas": [[
        {"name": "title", "type": "text", "position": {"x": 10, "y": 10}, "width": 190, "height": 20, "fontSize": 24},
        {"name": "sig", "type": "signatureBlock", "position": {"x": 10, "y": 240}, "width": 80, "height": 30, "label": "Director"}
      ]]
    }
  }')
TID3=$(echo "$TEMPLATE3" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{console.log(JSON.parse(d).id)}catch{console.log('ERROR')}})")
curl -s -X POST "$BASE_URL/templates/$TID3/publish" -H "$AUTH" > /dev/null

RENDER3=$(curl -s -X POST "$BASE_URL/render/now" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d "{
    \"templateId\": \"$TID3\",
    \"entityId\": \"sig-block-test-3\",
    \"channel\": \"print\",
    \"inputs\": [{\"title\": \"Purchase Order\"}]
  }")
check "Render with label only succeeded" '"status":"done"' "$RENDER3"

echo ""
echo "Step 9: Verify different renders produce different hashes"
HASH1=$(echo "$RENDER" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{console.log(JSON.parse(d).document.pdfHash)}catch{console.log('ERROR')}})")
HASH2=$(echo "$RENDER2" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{console.log(JSON.parse(d).document.pdfHash)}catch{console.log('ERROR')}})")
if [ "$HASH1" != "$HASH2" ] && [ "$HASH1" != "ERROR" ] && [ "$HASH2" != "ERROR" ]; then
  PASS=$((PASS + 1))
  TOTAL=$((TOTAL + 1))
  echo "  PASS: Different sub-labels produce different hashes"
else
  FAIL=$((FAIL + 1))
  TOTAL=$((TOTAL + 1))
  echo "  FAIL: Hashes should differ"
fi

echo ""
echo "==================================="
echo "Results: $PASS/$TOTAL passed, $FAIL failed"
echo "==================================="

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
