#!/bin/bash
# Test calculated field evaluates expression (Feature #126)
set -e

JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJvcmdJZCI6InRlc3Qtb3JnIiwicm9sZXMiOlsiYWRtaW4iXX0.fakesig"
BASE="http://localhost:3001/api/pdfme"
PASS=0
FAIL=0

check() {
  local desc="$1" condition="$2"
  if eval "$condition"; then
    echo "  PASS: $desc"
    PASS=$((PASS+1))
  else
    echo "  FAIL: $desc"
    FAIL=$((FAIL+1))
  fi
}

echo "=== Calculated Field Tests (Feature #126) ==="

# Test 1: Create template with calculatedField, publish, render
echo ""
echo "Test 1: Basic multiplication expression with format"
TMPL=$(curl -s -X POST "$BASE/templates" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{"name":"CalcField Test","type":"invoice","schema":{"basePdf":{"width":210,"height":297,"padding":[10,10,10,10]},"schemas":[[{"name":"qty","type":"text","position":{"x":20,"y":20},"width":50,"height":15},{"name":"unitPrice","type":"text","position":{"x":80,"y":20},"width":50,"height":15},{"name":"lineTotal","type":"calculatedField","expression":"qty * unitPrice","format":"#,##0.00","fontSize":12,"position":{"x":140,"y":20},"width":50,"height":15}]]}}')
TID=$(echo "$TMPL" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
echo "  Template ID: $TID"

curl -s -X POST "$BASE/templates/$TID/publish" -H "Authorization: Bearer $JWT" > /dev/null
echo "  Template published"

RDOC=$(curl -s -X POST "$BASE/render/now" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d "{\"templateId\":\"$TID\",\"entityId\":\"calc-test-1\",\"channel\":\"print\",\"inputs\":[{\"qty\":\"5\",\"unitPrice\":\"1250.50\"}]}")
DOC_STATUS=$(echo "$RDOC" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("document",{}).get("status",""))')
check "Render status=done" "test '$DOC_STATUS' = 'done'"

# Check the inputSnapshot to verify the calculated value was resolved
DOC_INPUTS=$(echo "$RDOC" | python3 -c 'import sys,json; d=json.load(sys.stdin).get("document",{}).get("inputSnapshot",[]); print(d[0].get("lineTotal","") if d else "")')
echo "  Calculated lineTotal value: $DOC_INPUTS"
check "lineTotal = 6,252.50 (5 * 1250.50)" "test '$DOC_INPUTS' = '6,252.50'"

# Test 2: Addition expression
echo ""
echo "Test 2: Addition expression"
TMPL2=$(curl -s -X POST "$BASE/templates" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{"name":"CalcField Add","type":"invoice","schema":{"basePdf":{"width":210,"height":297,"padding":[10,10,10,10]},"schemas":[[{"name":"subtotal","type":"text","position":{"x":20,"y":20},"width":50,"height":15},{"name":"vat","type":"text","position":{"x":80,"y":20},"width":50,"height":15},{"name":"total","type":"calculatedField","expression":"subtotal + vat","format":"#,##0.00","fontSize":12,"position":{"x":140,"y":20},"width":50,"height":15}]]}}')
TID2=$(echo "$TMPL2" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
curl -s -X POST "$BASE/templates/$TID2/publish" -H "Authorization: Bearer $JWT" > /dev/null

RDOC2=$(curl -s -X POST "$BASE/render/now" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d "{\"templateId\":\"$TID2\",\"entityId\":\"calc-test-2\",\"channel\":\"print\",\"inputs\":[{\"subtotal\":\"10000\",\"vat\":\"1500\"}]}")
DOC2_TOTAL=$(echo "$RDOC2" | python3 -c 'import sys,json; d=json.load(sys.stdin).get("document",{}).get("inputSnapshot",[]); print(d[0].get("total","") if d else "")')
echo "  Calculated total: $DOC2_TOTAL"
check "total = 11,500.00 (10000 + 1500)" "test '$DOC2_TOTAL' = '11,500.00'"

# Test 3: No format - raw number
echo ""
echo "Test 3: Expression without format (raw output)"
TMPL3=$(curl -s -X POST "$BASE/templates" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{"name":"CalcField Raw","type":"invoice","schema":{"basePdf":{"width":210,"height":297,"padding":[10,10,10,10]},"schemas":[[{"name":"a","type":"text","position":{"x":20,"y":20},"width":50,"height":15},{"name":"b","type":"text","position":{"x":80,"y":20},"width":50,"height":15},{"name":"result","type":"calculatedField","expression":"a * b","fontSize":12,"position":{"x":140,"y":20},"width":50,"height":15}]]}}')
TID3=$(echo "$TMPL3" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
curl -s -X POST "$BASE/templates/$TID3/publish" -H "Authorization: Bearer $JWT" > /dev/null

RDOC3=$(curl -s -X POST "$BASE/render/now" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d "{\"templateId\":\"$TID3\",\"entityId\":\"calc-test-3\",\"channel\":\"print\",\"inputs\":[{\"a\":\"7\",\"b\":\"3\"}]}")
DOC3_RESULT=$(echo "$RDOC3" | python3 -c 'import sys,json; d=json.load(sys.stdin).get("document",{}).get("inputSnapshot",[]); print(d[0].get("result","") if d else "")')
echo "  Raw result: $DOC3_RESULT"
check "result = 21" "test '$DOC3_RESULT' = '21'"

# Test 4: Complex expression with parentheses
echo ""
echo "Test 4: Complex expression (subtotal * 1.15)"
TMPL4=$(curl -s -X POST "$BASE/templates" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{"name":"CalcField Complex","type":"invoice","schema":{"basePdf":{"width":210,"height":297,"padding":[10,10,10,10]},"schemas":[[{"name":"subtotal","type":"text","position":{"x":20,"y":20},"width":50,"height":15},{"name":"totalWithVat","type":"calculatedField","expression":"subtotal * 1.15","format":"#,##0.00","fontSize":12,"position":{"x":80,"y":20},"width":60,"height":15}]]}}')
TID4=$(echo "$TMPL4" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
curl -s -X POST "$BASE/templates/$TID4/publish" -H "Authorization: Bearer $JWT" > /dev/null

RDOC4=$(curl -s -X POST "$BASE/render/now" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d "{\"templateId\":\"$TID4\",\"entityId\":\"calc-test-4\",\"channel\":\"print\",\"inputs\":[{\"subtotal\":\"10000\"}]}")
DOC4_RESULT=$(echo "$RDOC4" | python3 -c 'import sys,json; d=json.load(sys.stdin).get("document",{}).get("inputSnapshot",[]); print(d[0].get("totalWithVat","") if d else "")')
echo "  Total with VAT: $DOC4_RESULT"
check "totalWithVat = 11,500.00 (10000 * 1.15)" "test '$DOC4_RESULT' = '11,500.00'"

# Test 5: Verify PDF file was actually generated
echo ""
echo "Test 5: Verify PDF file exists"
DOC_PATH=$(echo "$RDOC" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("document",{}).get("filePath",""))')
FULL_PATH="/home/linqadmin/repo/pdfme-jrny/storage/$DOC_PATH"
check "PDF file exists on disk" "test -f '$FULL_PATH'"
check "PDF file size > 0" "test -s '$FULL_PATH'"

echo ""
echo "================================"
echo "Results: $PASS passed, $FAIL failed"
echo "================================"
test $FAIL -eq 0
