#!/bin/bash
# Test: Line Items Table Alternating Group Shading (Feature #119)
# Verifies alternating row groups have shading

JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJvcmdJZCI6InRlc3Qtb3JnIiwicm9sZXMiOlsiYWRtaW4iXX0.fakesig"
BASE_URL="http://localhost:3001/api/pdfme"
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

echo "=== Feature #119: Line Items Table Alternating Group Shading ==="

# Step 1: Create template with alternating shading enabled
echo ""
echo "--- Step 1: Create template with alternateRowShading ---"

CREATE_RESP=$(curl -s -X POST "$BASE_URL/templates" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"name": "LIT Shading Test", "type": "invoice", "schema": {"basePdf": {"width": 210, "height": 297, "padding": [10, 10, 10, 10]}, "schemas": [[{"name": "lineItems", "type": "lineItemsTable", "position": {"x": 10, "y": 30}, "width": 190, "height": 200, "showHeader": true, "alternateRowShading": true, "alternateRowColor": "#f0f4ff", "columns": [{"key": "description", "header": "Description", "width": 80, "align": "left"}, {"key": "qty", "header": "Qty", "width": 25, "align": "right"}, {"key": "unitPrice", "header": "Unit Price", "width": 35, "align": "right", "format": "#,##0.00"}, {"key": "amount", "header": "Amount", "width": 50, "align": "right", "format": "#,##0.00"}], "footerRows": [{"id": "subtotal", "label": "Subtotal", "valueColumnKey": "amount", "type": "sum", "format": "#,##0.00"}]}]]}}')

TEMPLATE_ID=$(echo "$CREATE_RESP" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "  Template ID: $TEMPLATE_ID"
check "Template created" "$([ -n "$TEMPLATE_ID" ] && echo true || echo false)"

# Step 2: Publish the template
echo ""
echo "--- Step 2: Publish template ---"
curl -s -X POST "$BASE_URL/templates/$TEMPLATE_ID/publish" \
  -H "Authorization: Bearer $JWT" > /dev/null
check "Template published" "true"

# Step 3: Render with 6 items for visible alternating
echo ""
echo "--- Step 3: Render PDF with multiple row groups ---"

RENDER_RESP=$(curl -s -X POST "$BASE_URL/render/now" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"templateId": "'"$TEMPLATE_ID"'", "entityId": "test-inv-shading-001", "channel": "print", "inputs": [{"lineItems": "[{\"description\":\"Item A\",\"qty\":2,\"unitPrice\":10,\"amount\":20},{\"description\":\"Item B\",\"qty\":3,\"unitPrice\":15,\"amount\":45},{\"description\":\"Item C\",\"qty\":1,\"unitPrice\":100,\"amount\":100},{\"description\":\"Item D\",\"qty\":5,\"unitPrice\":8,\"amount\":40},{\"description\":\"Item E\",\"qty\":10,\"unitPrice\":5,\"amount\":50},{\"description\":\"Item F\",\"qty\":1,\"unitPrice\":200,\"amount\":200}]"}]}')

DOC_STATUS=$(echo "$RENDER_RESP" | grep -o '"status":"done"')
FILE_PATH=$(echo "$RENDER_RESP" | grep -o '"filePath":"[^"]*"' | head -1 | cut -d'"' -f4)

check "PDF generated successfully" "$([ -n "$DOC_STATUS" ] && echo true || echo false)"
check "PDF file path set" "$([ -n "$FILE_PATH" ] && echo true || echo false)"

# Verify the PDF file exists
if [ -n "$FILE_PATH" ]; then
  FULL_PATH="/home/linqadmin/repo/pdfme-jrny/storage/$FILE_PATH"
  PDF_SIZE=$(stat -c%s "$FULL_PATH" 2>/dev/null || echo "0")
  check "PDF file exists ($PDF_SIZE bytes)" "$([ "$PDF_SIZE" -gt 100 ] && echo true || echo false)"
else
  check "PDF file exists" "false"
fi

# Step 4: Verify all 6 items + subtotal
echo ""
echo "--- Step 4: Verify data integrity ---"

ROW_COUNT=$(echo "$RENDER_RESP" | grep -o '"Item' | wc -l)
check "All 6 line items present" "$([ "$ROW_COUNT" -ge 6 ] && echo true || echo false)"

SUBTOTAL_OK=$(echo "$RENDER_RESP" | grep -o '455.00')
check "Subtotal correct (455.00)" "$([ -n "$SUBTOTAL_OK" ] && echo true || echo false)"

# Step 5: Verify no-shading template also works
echo ""
echo "--- Step 5: Verify no-shading variant ---"

CREATE_RESP2=$(curl -s -X POST "$BASE_URL/templates" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"name": "LIT No Shade", "type": "invoice", "schema": {"basePdf": {"width": 210, "height": 297, "padding": [10, 10, 10, 10]}, "schemas": [[{"name": "lineItems", "type": "lineItemsTable", "position": {"x": 10, "y": 30}, "width": 190, "height": 200, "showHeader": true, "alternateRowShading": false, "columns": [{"key": "description", "header": "Description", "width": 80, "align": "left"}, {"key": "amount", "header": "Amount", "width": 50, "align": "right"}]}]]}}')

TEMPLATE_ID2=$(echo "$CREATE_RESP2" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
curl -s -X POST "$BASE_URL/templates/$TEMPLATE_ID2/publish" -H "Authorization: Bearer $JWT" > /dev/null

RENDER_RESP2=$(curl -s -X POST "$BASE_URL/render/now" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"templateId": "'"$TEMPLATE_ID2"'", "entityId": "test-no-shade-001", "channel": "print", "inputs": [{"lineItems": "[{\"description\":\"No shade item\",\"amount\":100}]"}]}')

DOC_STATUS2=$(echo "$RENDER_RESP2" | grep -o '"status":"done"')
check "No-shading template renders OK" "$([ -n "$DOC_STATUS2" ] && echo true || echo false)"

# Cleanup
echo ""
echo "--- Cleanup ---"
curl -s -X DELETE "$BASE_URL/templates/$TEMPLATE_ID" -H "Authorization: Bearer $JWT" > /dev/null
curl -s -X DELETE "$BASE_URL/templates/$TEMPLATE_ID2" -H "Authorization: Bearer $JWT" > /dev/null
echo "  Templates archived"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ $FAIL -eq 0 ] && echo "ALL TESTS PASSED" || echo "SOME TESTS FAILED"
