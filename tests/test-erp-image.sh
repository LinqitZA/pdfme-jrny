#!/bin/bash
set -e

BASE_URL="http://localhost:3001/api/pdfme"
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

echo "=== Feature #128: ERP image resolves from file storage ==="
echo ""

echo "Step 1: Create test PNG"
node tests/create-test-png.js > /dev/null

echo "Step 2: Upload logo via asset upload"
UPLOAD_RESULT=$(curl -s -X POST "$BASE_URL/assets/upload" \
  -H "$AUTH" \
  -F "file=@tests/test-logo.png;type=image/png")

echo "  Upload result: $(echo "$UPLOAD_RESULT" | head -c 300)"
check "Asset uploaded" '"id"' "$UPLOAD_RESULT"

ASSET_ID=$(echo "$UPLOAD_RESULT" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{console.log(JSON.parse(d).id)}catch{console.log('ERROR')}})")
STORAGE_PATH=$(echo "$UPLOAD_RESULT" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{console.log(JSON.parse(d).storagePath)}catch{console.log('ERROR')}})")
echo "  Asset ID: $ASSET_ID"
echo "  Storage path: $STORAGE_PATH"

echo ""
echo "Step 3: Create template with erpImage element referencing asset"
TEMPLATE=$(curl -s -X POST "$BASE_URL/templates" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d "{
    \"name\": \"ERP Image Test Template\",
    \"type\": \"invoice\",
    \"schema\": {
      \"basePdf\": {\"width\": 210, \"height\": 297, \"padding\": [10,10,10,10]},
      \"schemas\": [[
        {\"name\": \"title\", \"type\": \"text\", \"position\": {\"x\": 10, \"y\": 10}, \"width\": 190, \"height\": 20, \"fontSize\": 24},
        {\"name\": \"logo\", \"type\": \"erpImage\", \"position\": {\"x\": 10, \"y\": 40}, \"width\": 50, \"height\": 50, \"assetPath\": \"$STORAGE_PATH\"}
      ]]
    }
  }")

TEMPLATE_ID=$(echo "$TEMPLATE" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{console.log(JSON.parse(d).id)}catch{console.log('ERROR')}})")
check "Template created" '"id"' "$TEMPLATE"
echo "  Template ID: $TEMPLATE_ID"

echo ""
echo "Step 4: Publish template"
PUB_RESULT=$(curl -s -X POST "$BASE_URL/templates/$TEMPLATE_ID/publish" -H "$AUTH")
check "Template published" '"status":"published"' "$PUB_RESULT"

echo ""
echo "Step 5: Render PDF with erpImage (assetPath in schema)"
RENDER=$(curl -s -X POST "$BASE_URL/render/now" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d "{
    \"templateId\": \"$TEMPLATE_ID\",
    \"entityId\": \"erp-img-test-1\",
    \"channel\": \"print\",
    \"inputs\": [{\"title\": \"ERP Image Test\"}]
  }")

echo "  Render: $(echo "$RENDER" | head -c 300)"
check "Render succeeded" '"status":"done"' "$RENDER"
DOC_FILE=$(echo "$RENDER" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{console.log(JSON.parse(d).document.filePath)}catch{console.log('ERROR')}})")
echo "  File: $DOC_FILE"

echo ""
echo "Step 6: Verify PDF exists and has reasonable size"
if [ "$DOC_FILE" != "ERROR" ] && [ -f "storage/$DOC_FILE" ]; then
  PDF_SIZE=$(stat -c%s "storage/$DOC_FILE" 2>/dev/null || stat -f%z "storage/$DOC_FILE" 2>/dev/null)
  check "PDF file exists" "storage" "storage/$DOC_FILE"
  check "PDF has content (size > 1000)" "1" "$([ "$PDF_SIZE" -gt 1000 ] && echo 1 || echo 0)"
  echo "  PDF size: $PDF_SIZE bytes"
else
  FAIL=$((FAIL + 2))
  TOTAL=$((TOTAL + 2))
  echo "  FAIL: PDF not found at storage/$DOC_FILE"
fi

echo ""
echo "Step 7: Verify image XObject in PDF"
if [ "$DOC_FILE" != "ERROR" ] && [ -f "storage/$DOC_FILE" ]; then
  VERIFY_OUTPUT=$(node -e "
  const fs = require('fs');
  const buf = fs.readFileSync('storage/$DOC_FILE');
  const text = buf.toString('latin1');
  console.log(text.includes('/Image') || text.includes('/XObject'));
  ")
  check "PDF contains image XObject" "true" "$VERIFY_OUTPUT"
else
  FAIL=$((FAIL + 1))
  TOTAL=$((TOTAL + 1))
  echo "  FAIL: Cannot verify - PDF not found"
fi

echo ""
echo "Step 8: Render with erpImage via storage path in inputs"
TEMPLATE2=$(curl -s -X POST "$BASE_URL/templates" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{
    "name": "ERP Image Input Test",
    "type": "invoice",
    "schema": {
      "basePdf": {"width": 210, "height": 297, "padding": [10,10,10,10]},
      "schemas": [[
        {"name": "title", "type": "text", "position": {"x": 10, "y": 10}, "width": 190, "height": 20, "fontSize": 24},
        {"name": "dynamicLogo", "type": "erpImage", "position": {"x": 10, "y": 40}, "width": 50, "height": 50}
      ]]
    }
  }')
TID2=$(echo "$TEMPLATE2" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{console.log(JSON.parse(d).id)}catch{console.log('ERROR')}})")
curl -s -X POST "$BASE_URL/templates/$TID2/publish" -H "$AUTH" > /dev/null

RENDER2=$(curl -s -X POST "$BASE_URL/render/now" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d "{
    \"templateId\": \"$TID2\",
    \"entityId\": \"erp-img-test-2\",
    \"channel\": \"print\",
    \"inputs\": [{\"title\": \"Dynamic Logo\", \"dynamicLogo\": \"$STORAGE_PATH\"}]
  }")
echo "  Render2: $(echo "$RENDER2" | head -c 200)"
check "Render with input path succeeded" '"status":"done"' "$RENDER2"

echo ""
echo "Step 9: Render with base64 data URI in inputs"
B64_IMG="data:image/png;base64,$(base64 -w0 tests/test-logo.png)"
RENDER3=$(curl -s -X POST "$BASE_URL/render/now" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d "{
    \"templateId\": \"$TID2\",
    \"entityId\": \"erp-img-test-3\",
    \"channel\": \"print\",
    \"inputs\": [{\"title\": \"Base64 Logo\", \"dynamicLogo\": \"$B64_IMG\"}]
  }")
echo "  Render3: $(echo "$RENDER3" | head -c 200)"
check "Render with base64 input succeeded" '"status":"done"' "$RENDER3"

echo ""
echo "==================================="
echo "Results: $PASS/$TOTAL passed, $FAIL failed"
echo "==================================="

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
