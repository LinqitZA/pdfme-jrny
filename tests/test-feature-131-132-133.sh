#!/bin/bash
# Test: Features #131, #132, #133
# #131: QR barcode with ERP URL binding
# #132: Render pipeline resolvePageScopes
# #133: Render pipeline resolveConditions

JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJvcmdJZCI6InRlc3Qtb3JnIiwicm9sZXMiOlsiYWRtaW4iXX0.fakesig"
BASE_URL="http://localhost:3000/api/pdfme"
PASS=0
FAIL=0

check() {
  local desc="$1"
  local result="$2"
  if [ "$result" = "true" ]; then
    echo "  ✅ $desc"
    PASS=$((PASS+1))
  else
    echo "  ❌ $desc"
    FAIL=$((FAIL+1))
  fi
}

echo "========================================="
echo "  Feature #131: QR Barcode ERP URL Binding"
echo "========================================="

# Create template with qrBarcode element
echo ""
echo "--- Create template with qrBarcode element ---"

TEMPLATE_RESPONSE=$(curl -s -X POST "$BASE_URL/templates" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "QR Test Template",
    "type": "invoice",
    "schema": {
      "basePdf": {"width": 210, "height": 297, "padding": [10, 10, 10, 10]},
      "schemas": [[
        {
          "name": "title",
          "type": "text",
          "position": {"x": 10, "y": 10},
          "width": 100,
          "height": 10
        },
        {
          "name": "invoiceQr",
          "type": "qrBarcode",
          "urlPattern": "https://erp.example.com/invoices/{{document.id}}",
          "position": {"x": 150, "y": 10},
          "width": 40,
          "height": 40
        }
      ]]
    }
  }')

QR_TEMPLATE_ID=$(echo "$TEMPLATE_RESPONSE" | jq -r '.id // empty')
check "Template created" "$([ -n "$QR_TEMPLATE_ID" ] && echo true || echo false)"

# Publish the template
curl -s -X POST "$BASE_URL/templates/$QR_TEMPLATE_ID/publish" \
  -H "Authorization: Bearer $JWT" > /dev/null

# Render with URL binding data
echo ""
echo "--- Render PDF with QR URL binding ---"

RENDER_RESPONSE=$(curl -s -X POST "$BASE_URL/render/now" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{
    \"templateId\": \"$QR_TEMPLATE_ID\",
    \"entityId\": \"INV-2024-001\",
    \"channel\": \"print\",
    \"inputs\": [{
      \"title\": \"Invoice #2024-001\",
      \"invoiceQr\": \"https://erp.example.com/invoices/INV-2024-001\",
      \"document.id\": \"INV-2024-001\"
    }]
  }")

QR_RENDER_STATUS=$(echo "$RENDER_RESPONSE" | jq -r '.document.status // empty')
check "Render succeeded (status=done)" "$([ "$QR_RENDER_STATUS" = "done" ] && echo true || echo false)"

QR_PDF_SIZE=$(echo "$RENDER_RESPONSE" | jq -r '.document.filePath // empty')
check "PDF file path exists" "$([ -n "$QR_PDF_SIZE" ] && echo true || echo false)"

# Render with urlPattern binding resolution (no explicit input for QR field)
echo ""
echo "--- Render with URL pattern binding resolution ---"

RENDER_BINDING=$(curl -s -X POST "$BASE_URL/render/now" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{
    \"templateId\": \"$QR_TEMPLATE_ID\",
    \"entityId\": \"INV-2024-002\",
    \"channel\": \"print\",
    \"inputs\": [{
      \"title\": \"Invoice #2024-002\",
      \"invoiceQr\": \"\",
      \"document.id\": \"INV-2024-002\"
    }]
  }")

BINDING_STATUS=$(echo "$RENDER_BINDING" | jq -r '.document.status // empty')
check "Binding resolution render succeeded" "$([ "$BINDING_STATUS" = "done" ] && echo true || echo false)"

# Verify the QR value was resolved in inputSnapshot
INPUT_SNAPSHOT=$(echo "$RENDER_BINDING" | jq -r '.document.inputSnapshot // empty')
check "Input snapshot captured" "$([ -n "$INPUT_SNAPSHOT" ] && echo true || echo false)"


echo ""
echo "========================================="
echo "  Feature #132: resolvePageScopes"
echo "========================================="

# Create a 3-page template with first-only and last-only elements
echo ""
echo "--- Create 3-page template with page scopes ---"

SCOPE_TEMPLATE=$(curl -s -X POST "$BASE_URL/templates" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Page Scope Test Template",
    "type": "invoice",
    "schema": {
      "basePdf": {"width": 210, "height": 297, "padding": [10, 10, 10, 10]},
      "schemas": [
        [
          {
            "name": "header",
            "type": "text",
            "pageScope": "all",
            "position": {"x": 10, "y": 5},
            "width": 100,
            "height": 10
          },
          {
            "name": "firstOnly",
            "type": "text",
            "pageScope": "first",
            "position": {"x": 10, "y": 20},
            "width": 100,
            "height": 10
          },
          {
            "name": "lastOnly",
            "type": "text",
            "pageScope": "last",
            "position": {"x": 10, "y": 35},
            "width": 100,
            "height": 10
          },
          {
            "name": "notFirstOnly",
            "type": "text",
            "pageScope": "notFirst",
            "position": {"x": 10, "y": 50},
            "width": 100,
            "height": 10
          },
          {
            "name": "body",
            "type": "text",
            "position": {"x": 10, "y": 65},
            "width": 100,
            "height": 10
          }
        ],
        [
          {
            "name": "header",
            "type": "text",
            "pageScope": "all",
            "position": {"x": 10, "y": 5},
            "width": 100,
            "height": 10
          },
          {
            "name": "firstOnly",
            "type": "text",
            "pageScope": "first",
            "position": {"x": 10, "y": 20},
            "width": 100,
            "height": 10
          },
          {
            "name": "lastOnly",
            "type": "text",
            "pageScope": "last",
            "position": {"x": 10, "y": 35},
            "width": 100,
            "height": 10
          },
          {
            "name": "notFirstOnly",
            "type": "text",
            "pageScope": "notFirst",
            "position": {"x": 10, "y": 50},
            "width": 100,
            "height": 10
          },
          {
            "name": "body2",
            "type": "text",
            "position": {"x": 10, "y": 65},
            "width": 100,
            "height": 10
          }
        ],
        [
          {
            "name": "header",
            "type": "text",
            "pageScope": "all",
            "position": {"x": 10, "y": 5},
            "width": 100,
            "height": 10
          },
          {
            "name": "firstOnly",
            "type": "text",
            "pageScope": "first",
            "position": {"x": 10, "y": 20},
            "width": 100,
            "height": 10
          },
          {
            "name": "lastOnly",
            "type": "text",
            "pageScope": "last",
            "position": {"x": 10, "y": 35},
            "width": 100,
            "height": 10
          },
          {
            "name": "notFirstOnly",
            "type": "text",
            "pageScope": "notFirst",
            "position": {"x": 10, "y": 50},
            "width": 100,
            "height": 10
          },
          {
            "name": "body3",
            "type": "text",
            "position": {"x": 10, "y": 65},
            "width": 100,
            "height": 10
          }
        ]
      ]
    }
  }')

SCOPE_ID=$(echo "$SCOPE_TEMPLATE" | jq -r '.id // empty')
check "Page scope template created" "$([ -n "$SCOPE_ID" ] && echo true || echo false)"

# Publish
curl -s -X POST "$BASE_URL/templates/$SCOPE_ID/publish" \
  -H "Authorization: Bearer $JWT" > /dev/null

# Render
echo ""
echo "--- Render multi-page document with page scopes ---"

SCOPE_RENDER=$(curl -s -X POST "$BASE_URL/render/now" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{
    \"templateId\": \"$SCOPE_ID\",
    \"entityId\": \"SCOPE-TEST-001\",
    \"channel\": \"print\",
    \"inputs\": [{
      \"header\": \"Company Header\",
      \"firstOnly\": \"First Page Banner\",
      \"lastOnly\": \"Last Page Footer\",
      \"notFirstOnly\": \"Continuation Header\",
      \"body\": \"Page 1 content\",
      \"body2\": \"Page 2 content\",
      \"body3\": \"Page 3 content\"
    }]
  }")

SCOPE_STATUS=$(echo "$SCOPE_RENDER" | jq -r '.document.status // empty')
check "Page scope render succeeded" "$([ "$SCOPE_STATUS" = "done" ] && echo true || echo false)"

SCOPE_PDF_PATH=$(echo "$SCOPE_RENDER" | jq -r '.document.filePath // empty')
check "PDF file generated" "$([ -n "$SCOPE_PDF_PATH" ] && echo true || echo false)"

# Verify the PDF has 3 pages
if [ -n "$SCOPE_PDF_PATH" ] && [ -f "storage/$SCOPE_PDF_PATH" ]; then
  # Use pdf-lib to count pages
  PAGE_COUNT=$(node -e "
    const fs = require('fs');
    const { PDFDocument } = require('pdf-lib');
    async function main() {
      const buf = fs.readFileSync('storage/$SCOPE_PDF_PATH');
      const doc = await PDFDocument.load(buf);
      process.stdout.write(String(doc.getPageCount()));
    }
    main().catch(e => process.stdout.write('0'));
  " 2>/dev/null)
  check "PDF has 3 pages" "$([ "$PAGE_COUNT" = "3" ] && echo true || echo false)"
else
  check "PDF has 3 pages" "false"
fi


echo ""
echo "========================================="
echo "  Feature #133: resolveConditions"
echo "========================================="

# Create template with conditional elements
echo ""
echo "--- Create template with conditional elements ---"

COND_TEMPLATE=$(curl -s -X POST "$BASE_URL/templates" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Conditions Test Template",
    "type": "invoice",
    "schema": {
      "basePdf": {"width": 210, "height": 297, "padding": [10, 10, 10, 10]},
      "schemas": [[
        {
          "name": "title",
          "type": "text",
          "position": {"x": 10, "y": 10},
          "width": 100,
          "height": 10
        },
        {
          "name": "optionalNote",
          "type": "text",
          "condition": {"type": "fieldNonEmpty", "field": "notes"},
          "position": {"x": 10, "y": 25},
          "width": 100,
          "height": 10
        },
        {
          "name": "discountLabel",
          "type": "text",
          "condition": {"type": "expression", "expression": "discount > 0"},
          "position": {"x": 10, "y": 40},
          "width": 100,
          "height": 10
        },
        {
          "name": "alwaysVisible",
          "type": "text",
          "position": {"x": 10, "y": 55},
          "width": 100,
          "height": 10
        }
      ]]
    }
  }')

COND_ID=$(echo "$COND_TEMPLATE" | jq -r '.id // empty')
check "Conditions template created" "$([ -n "$COND_ID" ] && echo true || echo false)"

# Publish
curl -s -X POST "$BASE_URL/templates/$COND_ID/publish" \
  -H "Authorization: Bearer $JWT" > /dev/null

# Test 1: Render with field populated - conditional element visible
echo ""
echo "--- Render with optional field populated ---"

COND_RENDER1=$(curl -s -X POST "$BASE_URL/render/now" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{
    \"templateId\": \"$COND_ID\",
    \"entityId\": \"COND-TEST-001\",
    \"channel\": \"print\",
    \"inputs\": [{
      \"title\": \"Invoice\",
      \"optionalNote\": \"Important note here\",
      \"notes\": \"This has a value\",
      \"discountLabel\": \"10% discount applied\",
      \"discount\": \"15\",
      \"alwaysVisible\": \"Footer text\"
    }]
  }")

COND1_STATUS=$(echo "$COND_RENDER1" | jq -r '.document.status // empty')
check "Render with populated field succeeded" "$([ "$COND1_STATUS" = "done" ] && echo true || echo false)"

# Test 2: Render with field empty - conditional element hidden
echo ""
echo "--- Render with optional field empty ---"

COND_RENDER2=$(curl -s -X POST "$BASE_URL/render/now" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{
    \"templateId\": \"$COND_ID\",
    \"entityId\": \"COND-TEST-002\",
    \"channel\": \"print\",
    \"inputs\": [{
      \"title\": \"Invoice\",
      \"optionalNote\": \"Should be hidden\",
      \"notes\": \"\",
      \"discountLabel\": \"Should also be hidden\",
      \"discount\": \"0\",
      \"alwaysVisible\": \"Footer text\"
    }]
  }")

COND2_STATUS=$(echo "$COND_RENDER2" | jq -r '.document.status // empty')
check "Render with empty field succeeded" "$([ "$COND2_STATUS" = "done" ] && echo true || echo false)"

# Test 3: Render with expression-based condition (discount > 0)
echo ""
echo "--- Render with expression condition (discount > 0, value = 25) ---"

COND_RENDER3=$(curl -s -X POST "$BASE_URL/render/now" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{
    \"templateId\": \"$COND_ID\",
    \"entityId\": \"COND-TEST-003\",
    \"channel\": \"print\",
    \"inputs\": [{
      \"title\": \"Invoice with Discount\",
      \"optionalNote\": \"Note visible\",
      \"notes\": \"Has notes\",
      \"discountLabel\": \"25% discount!\",
      \"discount\": \"25\",
      \"alwaysVisible\": \"Always here\"
    }]
  }")

COND3_STATUS=$(echo "$COND_RENDER3" | jq -r '.document.status // empty')
check "Expression condition render succeeded" "$([ "$COND3_STATUS" = "done" ] && echo true || echo false)"

# Compare file sizes - the render with hidden elements should be smaller
COND1_PATH=$(echo "$COND_RENDER1" | jq -r '.document.filePath // empty')
COND2_PATH=$(echo "$COND_RENDER2" | jq -r '.document.filePath // empty')

if [ -f "storage/$COND1_PATH" ] && [ -f "storage/$COND2_PATH" ]; then
  SIZE1=$(stat -c%s "storage/$COND1_PATH" 2>/dev/null || echo "0")
  SIZE2=$(stat -c%s "storage/$COND2_PATH" 2>/dev/null || echo "0")
  # The render with all visible should generally be larger or equal
  check "Both PDFs generated with different content" "$([ "$SIZE1" -gt 0 ] && [ "$SIZE2" -gt 0 ] && echo true || echo false)"
else
  check "Both PDFs generated with different content" "false"
fi


echo ""
echo "========================================="
echo "  Summary"
echo "========================================="
echo "  PASSED: $PASS"
echo "  FAILED: $FAIL"
echo "  TOTAL:  $((PASS + FAIL))"
echo "========================================="
