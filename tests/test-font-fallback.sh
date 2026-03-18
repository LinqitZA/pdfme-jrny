#!/bin/bash
# Test: Feature #151 - Font fallback to Noto Sans on missing
# Verifies that templates with nonexistent fonts render successfully with fallback

set -e
PORT=${PORT:-3099}
BASE="http://localhost:$PORT/api/pdfme"
PASS=0
FAIL=0
TOTAL=0

# Dev JWT helper
jwt() {
  local payload="$1"
  local header='{"alg":"none","typ":"JWT"}'
  local h=$(echo -n "$header" | base64 -w0 | tr '+/' '-_' | tr -d '=')
  local p=$(echo -n "$payload" | base64 -w0 | tr '+/' '-_' | tr -d '=')
  echo "${h}.${p}."
}

TOKEN=$(jwt '{"sub":"user-font-test","orgId":"org-font-test","roles":["admin"]}')

check() {
  TOTAL=$((TOTAL + 1))
  local desc="$1"
  local result="$2"
  if [ "$result" = "true" ]; then
    PASS=$((PASS + 1))
    echo "  ✅ $desc"
  else
    FAIL=$((FAIL + 1))
    echo "  ❌ $desc"
  fi
}

echo "=== Feature #151: Font fallback to Noto Sans on missing ==="
echo ""

# Step 1: Create a template with a nonexistent font (fontName: "MyCustomFont")
echo "Step 1: Create template referencing nonexistent font..."
CREATE_RESP=$(curl -s -X POST "$BASE/templates" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "invoice",
    "name": "Font Fallback Test Template",
    "schema": {
      "basePdf": {"width": 210, "height": 297, "padding": [10,10,10,10]},
      "schemas": [[
        {
          "name": "title",
          "type": "text",
          "position": {"x": 10, "y": 10},
          "width": 100,
          "height": 15,
          "fontName": "NonExistentCustomFont",
          "fontSize": 18
        },
        {
          "name": "body",
          "type": "text",
          "position": {"x": 10, "y": 30},
          "width": 190,
          "height": 50,
          "fontName": "AnotherMissingFont",
          "fontSize": 12
        },
        {
          "name": "footer",
          "type": "text",
          "position": {"x": 10, "y": 85},
          "width": 100,
          "height": 10,
          "fontSize": 10
        }
      ]],
      "columns": [],
      "sampledata": [{}]
    }
  }')

TEMPLATE_ID=$(echo "$CREATE_RESP" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data', c => d+=c); process.stdin.on('end', () => { try { console.log(JSON.parse(d).id); } catch(e) { console.log('ERROR'); } })")
check "Template created successfully" "$([ "$TEMPLATE_ID" != "ERROR" ] && [ "$TEMPLATE_ID" != "" ] && echo true || echo false)"
echo "  Template ID: $TEMPLATE_ID"

# Step 2: Check fonts via font-check endpoint
echo ""
echo "Step 2: Check font availability..."
FONT_CHECK=$(curl -s -X POST "$BASE/render/font-check" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"templateId\": \"$TEMPLATE_ID\"}")

echo "  Font check response: $FONT_CHECK"

FALLBACK_USED=$(echo "$FONT_CHECK" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data', c => d+=c); process.stdin.on('end', () => { try { console.log(JSON.parse(d).fallbackUsed); } catch(e) { console.log('ERROR'); } })")
check "Fallback used flag is true" "$([ "$FALLBACK_USED" = "true" ] && echo true || echo false)"

WARNINGS_COUNT=$(echo "$FONT_CHECK" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data', c => d+=c); process.stdin.on('end', () => { try { const r=JSON.parse(d); console.log(r.warnings.length); } catch(e) { console.log('0'); } })")
check "Warnings emitted for missing fonts (count >= 2)" "$([ "$WARNINGS_COUNT" -ge 2 ] && echo true || echo false)"

FONTS_REF=$(echo "$FONT_CHECK" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data', c => d+=c); process.stdin.on('end', () => { try { const r=JSON.parse(d); console.log(r.fontsReferenced.join(',')); } catch(e) { console.log('ERROR'); } })")
check "NonExistentCustomFont listed in references" "$(echo "$FONTS_REF" | grep -q "NonExistentCustomFont" && echo true || echo false)"
check "AnotherMissingFont listed in references" "$(echo "$FONTS_REF" | grep -q "AnotherMissingFont" && echo true || echo false)"

# Step 3: Publish the template so we can render
echo ""
echo "Step 3: Publish template and render..."
PUBLISH_RESP=$(curl -s -X POST "$BASE/templates/$TEMPLATE_ID/publish" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json")

PUB_STATUS=$(echo "$PUBLISH_RESP" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data', c => d+=c); process.stdin.on('end', () => { try { console.log(JSON.parse(d).status); } catch(e) { console.log('ERROR'); } })")
check "Template published successfully" "$([ "$PUB_STATUS" = "published" ] && echo true || echo false)"

# Step 4: Render the document with the missing font template
RENDER_RESP=$(curl -s -X POST "$BASE/render/now" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"templateId\": \"$TEMPLATE_ID\",
    \"entityId\": \"font-test-entity-1\",
    \"channel\": \"print\",
    \"inputs\": [{
      \"title\": \"Invoice #12345\",
      \"body\": \"This text uses a nonexistent font and should fall back gracefully.\",
      \"footer\": \"Page 1 of 1\"
    }]
  }")

echo "  Render response keys: $(echo "$RENDER_RESP" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data', c => d+=c); process.stdin.on('end', () => { try { console.log(Object.keys(JSON.parse(d)).join(',')); } catch(e) { console.log('ERROR: ' + d.substring(0,200)); } })")"

RENDER_STATUS=$(echo "$RENDER_RESP" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data', c => d+=c); process.stdin.on('end', () => { try { const r=JSON.parse(d); console.log(r.document ? r.document.status : r.status || 'unknown'); } catch(e) { console.log('ERROR'); } })")
check "Render succeeds (status=done) despite missing font" "$([ "$RENDER_STATUS" = "done" ] && echo true || echo false)"

DOC_FILE=$(echo "$RENDER_RESP" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data', c => d+=c); process.stdin.on('end', () => { try { const r=JSON.parse(d); console.log(r.document ? r.document.filePath : ''); } catch(e) { console.log(''); } })")
check "PDF file generated" "$([ "$DOC_FILE" != "" ] && echo true || echo false)"

# Step 5: Test with preview (draft template with missing font)
echo ""
echo "Step 4: Preview with missing fonts..."
# Create another template for preview test (stays as draft)
CREATE_RESP2=$(curl -s -X POST "$BASE/templates" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "invoice",
    "name": "Font Fallback Preview Test",
    "schema": {
      "basePdf": {"width": 210, "height": 297, "padding": [10,10,10,10]},
      "schemas": [[
        {
          "name": "header",
          "type": "text",
          "position": {"x": 10, "y": 10},
          "width": 100,
          "height": 15,
          "fontName": "YetAnotherMissingFont",
          "fontSize": 20
        }
      ]],
      "columns": [],
      "sampledata": [{}]
    }
  }')

TEMPLATE_ID2=$(echo "$CREATE_RESP2" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data', c => d+=c); process.stdin.on('end', () => { try { console.log(JSON.parse(d).id); } catch(e) { console.log('ERROR'); } })")

PREVIEW_RESP=$(curl -s -X POST "$BASE/templates/$TEMPLATE_ID2/preview" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channel": "print", "sampleRowCount": 5}')

echo "  Preview response: $(echo "$PREVIEW_RESP" | head -c 300)"

PREVIEW_ID=$(echo "$PREVIEW_RESP" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data', c => d+=c); process.stdin.on('end', () => { try { console.log(JSON.parse(d).previewId || ''); } catch(e) { console.log(''); } })")
check "Preview generates successfully with missing font" "$([ "$PREVIEW_ID" != "" ] && echo true || echo false)"

# Step 6: Verify warning contains font name
echo ""
echo "Step 5: Verify warning messages..."
WARNING_MSG=$(echo "$FONT_CHECK" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data', c => d+=c); process.stdin.on('end', () => { try { const r=JSON.parse(d); r.warnings.forEach(w => console.log(w.message)); } catch(e) { console.log(''); } })")
check "Warning mentions NonExistentCustomFont" "$(echo "$WARNING_MSG" | grep -q "NonExistentCustomFont" && echo true || echo false)"
check "Warning mentions fallback" "$(echo "$WARNING_MSG" | grep -qi "fallback\|falling back" && echo true || echo false)"

# Step 7: Template with NO custom fonts should work without fallback
echo ""
echo "Step 6: Template without custom fonts..."
FONT_CHECK_SYS=$(curl -s -X POST "$BASE/render/font-check" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"templateId": "sys-invoice-standard"}')

SYS_FALLBACK=$(echo "$FONT_CHECK_SYS" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data', c => d+=c); process.stdin.on('end', () => { try { console.log(JSON.parse(d).fallbackUsed); } catch(e) { console.log('ERROR'); } })")
check "System template with no custom fonts: fallbackUsed=false" "$([ "$SYS_FALLBACK" = "false" ] && echo true || echo false)"

SYS_WARNINGS=$(echo "$FONT_CHECK_SYS" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data', c => d+=c); process.stdin.on('end', () => { try { console.log(JSON.parse(d).warnings.length); } catch(e) { console.log('ERROR'); } })")
check "System template: no warnings" "$([ "$SYS_WARNINGS" = "0" ] && echo true || echo false)"

# Cleanup
echo ""
echo "Cleaning up test templates..."
curl -s -X DELETE "$BASE/templates/$TEMPLATE_ID" -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1
curl -s -X DELETE "$BASE/templates/$TEMPLATE_ID2" -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1

echo ""
echo "=== Results: $PASS/$TOTAL passed, $FAIL failed ==="

if [ $FAIL -gt 0 ]; then
  exit 1
fi
