#!/bin/bash
# Test: Line Items Table Conditional Sub-Rows (Feature #120)
# Verifies sub-rows appear based on RowCondition

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

echo "=== Feature #120: Line Items Table Sub-Rows Render Conditionally ==="

# Step 1: Create template with sub-row config
echo ""
echo "--- Step 1: Create template with conditional sub-rows ---"

CREATE_RESP=$(curl -s -X POST "$BASE_URL/templates" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"name": "LIT SubRow Test", "type": "invoice", "schema": {"basePdf": {"width": 210, "height": 297, "padding": [10, 10, 10, 10]}, "schemas": [[{"name": "lineItems", "type": "lineItemsTable", "position": {"x": 10, "y": 30}, "width": 190, "height": 200, "showHeader": true, "columns": [{"key": "description", "header": "Description", "width": 80, "align": "left"}, {"key": "qty", "header": "Qty", "width": 25, "align": "right"}, {"key": "amount", "header": "Amount", "width": 50, "align": "right", "format": "#,##0.00"}], "subRows": [{"id": "notes-row", "condition": {"type": "fieldNonEmpty", "field": "notes"}, "cells": {"description": "  Note: {{notes}}"}}], "footerRows": [{"id": "total", "label": "Total", "valueColumnKey": "amount", "type": "sum", "format": "#,##0.00"}]}]]}}')

TEMPLATE_ID=$(echo "$CREATE_RESP" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "  Template ID: $TEMPLATE_ID"
check "Template created" "$([ -n "$TEMPLATE_ID" ] && echo true || echo false)"

# Step 2: Publish
echo ""
echo "--- Step 2: Publish template ---"
curl -s -X POST "$BASE_URL/templates/$TEMPLATE_ID/publish" -H "Authorization: Bearer $JWT" > /dev/null
check "Template published" "true"

# Step 3: Render with mixed data (some items have notes, some don't)
echo ""
echo "--- Step 3: Render with conditional sub-row data ---"

# Items: A has notes, B has no notes, C has notes
# Expected: A, sub-row(A), B, C, sub-row(C), Total = 6 rows
RENDER_RESP=$(curl -s -X POST "$BASE_URL/render/now" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"templateId": "'"$TEMPLATE_ID"'", "entityId": "test-subrow-001", "channel": "print", "inputs": [{"lineItems": "[{\"description\":\"Widget A\",\"qty\":10,\"amount\":250,\"notes\":\"Rush delivery\"},{\"description\":\"Widget B\",\"qty\":5,\"amount\":100,\"notes\":\"\"},{\"description\":\"Service C\",\"qty\":1,\"amount\":500,\"notes\":\"Monthly maintenance\"}]"}]}')

DOC_STATUS=$(echo "$RENDER_RESP" | grep -o '"status":"done"')
check "PDF generated successfully" "$([ -n "$DOC_STATUS" ] && echo true || echo false)"

# Verify the resolved data contains sub-rows
# Should see: "Rush delivery" and "Monthly maintenance" in sub-rows
RUSH_OK=$(echo "$RENDER_RESP" | grep -o 'Rush delivery')
MONTHLY_OK=$(echo "$RENDER_RESP" | grep -o 'Monthly maintenance')
check "Sub-row for item A (Rush delivery) present" "$([ -n "$RUSH_OK" ] && echo true || echo false)"
check "Sub-row for item C (Monthly maintenance) present" "$([ -n "$MONTHLY_OK" ] && echo true || echo false)"

# Verify total is correct: 250+100+500 = 850
TOTAL_OK=$(echo "$RENDER_RESP" | grep -o '850.00')
check "Total correct (850.00)" "$([ -n "$TOTAL_OK" ] && echo true || echo false)"

# Verify the PDF file exists
FILE_PATH=$(echo "$RENDER_RESP" | grep -o '"filePath":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -n "$FILE_PATH" ]; then
  FULL_PATH="/home/linqadmin/repo/pdfme-jrny/storage/$FILE_PATH"
  PDF_SIZE=$(stat -c%s "$FULL_PATH" 2>/dev/null || echo "0")
  check "PDF file exists ($PDF_SIZE bytes)" "$([ "$PDF_SIZE" -gt 100 ] && echo true || echo false)"
else
  check "PDF file exists" "false"
fi

# Step 4: Render with NO items having notes (no sub-rows should appear)
echo ""
echo "--- Step 4: Render with no sub-rows matching ---"

RENDER_RESP2=$(curl -s -X POST "$BASE_URL/render/now" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"templateId": "'"$TEMPLATE_ID"'", "entityId": "test-subrow-002", "channel": "print", "inputs": [{"lineItems": "[{\"description\":\"Item X\",\"qty\":1,\"amount\":50,\"notes\":\"\"},{\"description\":\"Item Y\",\"qty\":2,\"amount\":100}]"}]}')

DOC_STATUS2=$(echo "$RENDER_RESP2" | grep -o '"status":"done"')
check "No-sub-rows PDF generated" "$([ -n "$DOC_STATUS2" ] && echo true || echo false)"

# Total should be 150
TOTAL2_OK=$(echo "$RENDER_RESP2" | grep -o '150.00')
check "No-sub-rows total correct (150.00)" "$([ -n "$TOTAL2_OK" ] && echo true || echo false)"

# Step 5: Render with ALL items having notes (all sub-rows appear)
echo ""
echo "--- Step 5: Render with all sub-rows matching ---"

RENDER_RESP3=$(curl -s -X POST "$BASE_URL/render/now" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"templateId": "'"$TEMPLATE_ID"'", "entityId": "test-subrow-003", "channel": "print", "inputs": [{"lineItems": "[{\"description\":\"Item P\",\"qty\":1,\"amount\":100,\"notes\":\"Note P\"},{\"description\":\"Item Q\",\"qty\":2,\"amount\":200,\"notes\":\"Note Q\"}]"}]}')

DOC_STATUS3=$(echo "$RENDER_RESP3" | grep -o '"status":"done"')
check "All-sub-rows PDF generated" "$([ -n "$DOC_STATUS3" ] && echo true || echo false)"

NOTE_P=$(echo "$RENDER_RESP3" | grep -o 'Note P')
NOTE_Q=$(echo "$RENDER_RESP3" | grep -o 'Note Q')
check "Sub-row for Item P present" "$([ -n "$NOTE_P" ] && echo true || echo false)"
check "Sub-row for Item Q present" "$([ -n "$NOTE_Q" ] && echo true || echo false)"

# Cleanup
echo ""
echo "--- Cleanup ---"
curl -s -X DELETE "$BASE_URL/templates/$TEMPLATE_ID" -H "Authorization: Bearer $JWT" > /dev/null
echo "  Template archived"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ $FAIL -eq 0 ] && echo "ALL TESTS PASSED" || echo "SOME TESTS FAILED"
