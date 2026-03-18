#!/bin/bash
# Test script for Feature #127: Rich text renders HTML subset
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
    echo "  ✅ $desc"
  else
    FAIL=$((FAIL + 1))
    echo "  ❌ $desc (expected '$expected', got: $actual)"
  fi
}

echo "=== Feature #127: Rich text renders HTML subset ==="
echo ""

# Step 1: Create a template with a richText element
echo "Step 1: Create template with richText element"
TEMPLATE=$(curl -s -X POST "$BASE_URL/templates" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{
    "name": "RichText Test Template",
    "type": "invoice",
    "schema": {
      "basePdf": {"width": 210, "height": 297, "padding": [10,10,10,10]},
      "schemas": [[
        {
          "name": "title",
          "type": "text",
          "position": {"x": 10, "y": 10},
          "width": 190,
          "height": 20,
          "fontSize": 24
        },
        {
          "name": "richContent",
          "type": "richText",
          "position": {"x": 10, "y": 40},
          "width": 190,
          "height": 100,
          "fontSize": 12,
          "color": "#000000",
          "lineHeight": 1.4
        }
      ]]
    }
  }')

TEMPLATE_ID=$(echo "$TEMPLATE" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{console.log(JSON.parse(d).id)}catch{console.log('ERROR')}})")
check "Template created" '"id"' "$TEMPLATE"
echo "  Template ID: $TEMPLATE_ID"

# Step 2: Publish the template
echo ""
echo "Step 2: Publish template"
PUB_RESULT=$(curl -s -X POST "$BASE_URL/templates/$TEMPLATE_ID/publish" -H "$AUTH")
check "Template published" '"status":"published"' "$PUB_RESULT"

# Step 3: Render with rich text containing bold, italic, underline
echo ""
echo "Step 3: Render PDF with rich text (bold, italic, underline, font size)"
RENDER_RESULT=$(curl -s -X POST "$BASE_URL/render/now" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d "{
    \"templateId\": \"$TEMPLATE_ID\",
    \"entityId\": \"rich-text-test-1\",
    \"channel\": \"print\",
    \"inputs\": [{
      \"title\": \"Rich Text Test\",
      \"richContent\": \"<b>Bold text</b> and <i>italic text</i> and <u>underlined text</u><br/><span style=\\\"font-size: 18px; color: #ff0000\\\">Large red text</span>\"
    }]
  }")

check "Render succeeded" '"status":"done"' "$RENDER_RESULT"
DOC_ID=$(echo "$RENDER_RESULT" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{console.log(JSON.parse(d).document.id)}catch{console.log('ERROR')}})")
FILE_PATH=$(echo "$RENDER_RESULT" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{console.log(JSON.parse(d).document.filePath)}catch{console.log('ERROR')}})")
echo "  Document ID: $DOC_ID"
echo "  File path: $FILE_PATH"

# Step 4: Verify the PDF was created and has content
echo ""
echo "Step 4: Verify PDF file exists and has content"
if [ -f "storage/$FILE_PATH" ]; then
  PDF_SIZE=$(stat -f%z "storage/$FILE_PATH" 2>/dev/null || stat -c%s "storage/$FILE_PATH" 2>/dev/null)
  check "PDF file exists" "storage" "storage/$FILE_PATH"
  check "PDF has content (size > 1000)" "1" "$([ "$PDF_SIZE" -gt 1000 ] && echo 1 || echo 0)"
  echo "  PDF size: $PDF_SIZE bytes"
else
  FAIL=$((FAIL + 2))
  TOTAL=$((TOTAL + 2))
  echo "  ❌ PDF file not found at storage/$FILE_PATH"
fi

# Step 5: Render with field bindings in rich text
echo ""
echo "Step 5: Render with field bindings in rich text"
RENDER_BINDINGS=$(curl -s -X POST "$BASE_URL/render/now" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d "{
    \"templateId\": \"$TEMPLATE_ID\",
    \"entityId\": \"rich-text-test-2\",
    \"channel\": \"print\",
    \"inputs\": [{
      \"title\": \"Bindings Test\",
      \"richContent\": \"<b>Invoice for:</b> {{customer.name}}<br/><i>Amount: {{total}}</i>\",
      \"customer.name\": \"Acme Corp\",
      \"total\": \"R 15,000.00\"
    }]
  }")

check "Render with bindings succeeded" '"status":"done"' "$RENDER_BINDINGS"
BINDINGS_DOC_ID=$(echo "$RENDER_BINDINGS" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{console.log(JSON.parse(d).document.id)}catch{console.log('ERROR')}})")
echo "  Document ID: $BINDINGS_DOC_ID"

# Step 6: Render with multiple formatting combinations
echo ""
echo "Step 6: Render with nested formatting (bold+italic, styled spans)"
RENDER_NESTED=$(curl -s -X POST "$BASE_URL/render/now" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d "{
    \"templateId\": \"$TEMPLATE_ID\",
    \"entityId\": \"rich-text-test-3\",
    \"channel\": \"print\",
    \"inputs\": [{
      \"title\": \"Nested Formatting\",
      \"richContent\": \"<b><i>Bold and italic</i></b><br/><span style=\\\"font-size: 16px; font-weight: bold; color: blue\\\">Styled span</span><br/><u><b>Bold underlined</b></u>\"
    }]
  }")

check "Render with nested formatting succeeded" '"status":"done"' "$RENDER_NESTED"

# Step 7: Render with paragraph tags
echo ""
echo "Step 7: Render with <p> paragraphs and <strong>/<em> tags"
RENDER_PARA=$(curl -s -X POST "$BASE_URL/render/now" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d "{
    \"templateId\": \"$TEMPLATE_ID\",
    \"entityId\": \"rich-text-test-4\",
    \"channel\": \"print\",
    \"inputs\": [{
      \"title\": \"Paragraph Test\",
      \"richContent\": \"<p><strong>First paragraph</strong> with text.</p><p><em>Second paragraph</em> with more text.</p>\"
    }]
  }")

check "Render with paragraphs succeeded" '"status":"done"' "$RENDER_PARA"

# Step 8: Render with plain text (no HTML)
echo ""
echo "Step 8: Render with plain text (no HTML tags)"
RENDER_PLAIN=$(curl -s -X POST "$BASE_URL/render/now" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d "{
    \"templateId\": \"$TEMPLATE_ID\",
    \"entityId\": \"rich-text-test-5\",
    \"channel\": \"print\",
    \"inputs\": [{
      \"title\": \"Plain Text\",
      \"richContent\": \"Just plain text without any HTML formatting at all.\"
    }]
  }")

check "Render with plain text succeeded" '"status":"done"' "$RENDER_PLAIN"

# Step 9: Verify pdfHash is unique for different content
echo ""
echo "Step 9: Verify pdfHash uniqueness"
HASH1=$(echo "$RENDER_RESULT" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{console.log(JSON.parse(d).document.pdfHash)}catch{console.log('ERROR')}})")
HASH2=$(echo "$RENDER_BINDINGS" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{console.log(JSON.parse(d).document.pdfHash)}catch{console.log('ERROR')}})")
if [ "$HASH1" != "$HASH2" ] && [ "$HASH1" != "ERROR" ] && [ "$HASH2" != "ERROR" ]; then
  PASS=$((PASS + 1))
  TOTAL=$((TOTAL + 1))
  echo "  ✅ Different content produces different hashes"
else
  FAIL=$((FAIL + 1))
  TOTAL=$((TOTAL + 1))
  echo "  ❌ Hashes should differ for different content (hash1=$HASH1, hash2=$HASH2)"
fi

echo ""
echo "==================================="
echo "Results: $PASS/$TOTAL passed, $FAIL failed"
echo "==================================="

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
