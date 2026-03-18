#!/bin/bash
# Test watermark controlled by template variable (Feature #125)
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

echo "=== Watermark Variable Control Tests (Feature #125) ==="

# Create a template with watermark bound to a variable
echo ""
echo "Setup: Create template with watermark variable binding"
TMPL=$(curl -s -X POST "$BASE/templates" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{"name":"WM Variable Test","type":"invoice","schema":{"basePdf":{"width":210,"height":297,"padding":[10,10,10,10]},"schemas":[[{"name":"heading","type":"text","position":{"x":20,"y":20},"width":170,"height":20},{"name":"wm_var","type":"watermark","text":"DRAFT","opacity":0.3,"rotation":45,"color":{"r":0.8,"g":0.2,"b":0.2},"fontSize":72,"position":{"x":0,"y":0},"width":210,"height":297}]]}}')
TID=$(echo "$TMPL" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
echo "  Template ID: $TID"

# Publish
curl -s -X POST "$BASE/templates/$TID/publish" -H "Authorization: Bearer $JWT" > /dev/null
echo "  Template published"

# Test 1: Render with variable=DRAFT - watermark shows
echo ""
echo "Test 1: variable=DRAFT - watermark should show"
RDOC1=$(curl -s -X POST "$BASE/render/now" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d "{\"templateId\":\"$TID\",\"entityId\":\"wm-var-draft\",\"channel\":\"print\",\"inputs\":[{\"heading\":\"Invoice\",\"wm_var\":\"DRAFT\"}]}")
DOC1_STATUS=$(echo "$RDOC1" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("document",{}).get("status",""))')
DOC1_PATH=$(echo "$RDOC1" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("document",{}).get("filePath",""))')
DOC1_HASH=$(echo "$RDOC1" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("document",{}).get("pdfHash",""))')
check "Render with DRAFT succeeded" "test '$DOC1_STATUS' = 'done'"
DOC1_SIZE=$(wc -c < "/home/linqadmin/repo/pdfme-jrny/storage/$DOC1_PATH")
echo "  PDF size with DRAFT: $DOC1_SIZE bytes"

# Test 2: Render with variable='' (empty) - watermark hidden
echo ""
echo "Test 2: variable='' (empty) - watermark should be hidden"
RDOC2=$(curl -s -X POST "$BASE/render/now" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d "{\"templateId\":\"$TID\",\"entityId\":\"wm-var-empty\",\"channel\":\"print\",\"inputs\":[{\"heading\":\"Invoice\",\"wm_var\":\"\"}]}")
DOC2_STATUS=$(echo "$RDOC2" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("document",{}).get("status",""))')
DOC2_PATH=$(echo "$RDOC2" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("document",{}).get("filePath",""))')
DOC2_HASH=$(echo "$RDOC2" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("document",{}).get("pdfHash",""))')
check "Render with empty variable succeeded" "test '$DOC2_STATUS' = 'done'"
DOC2_SIZE=$(wc -c < "/home/linqadmin/repo/pdfme-jrny/storage/$DOC2_PATH")
echo "  PDF size without watermark: $DOC2_SIZE bytes"
check "PDF without watermark is smaller" "test $DOC2_SIZE -lt $DOC1_SIZE"
check "PDF hashes differ (watermark vs no watermark)" "test '$DOC1_HASH' != '$DOC2_HASH'"

# Test 3: Render with variable=COPY - text changes
echo ""
echo "Test 3: variable=COPY - watermark text should change"
RDOC3=$(curl -s -X POST "$BASE/render/now" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d "{\"templateId\":\"$TID\",\"entityId\":\"wm-var-copy\",\"channel\":\"print\",\"inputs\":[{\"heading\":\"Invoice\",\"wm_var\":\"COPY\"}]}")
DOC3_STATUS=$(echo "$RDOC3" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("document",{}).get("status",""))')
DOC3_HASH=$(echo "$RDOC3" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("document",{}).get("pdfHash",""))')
check "Render with COPY succeeded" "test '$DOC3_STATUS' = 'done'"
check "COPY hash differs from DRAFT hash" "test '$DOC3_HASH' != '$DOC1_HASH'"
check "COPY hash differs from empty hash" "test '$DOC3_HASH' != '$DOC2_HASH'"

# Test 4: Render with variable=VOID
echo ""
echo "Test 4: variable=VOID - another watermark text"
RDOC4=$(curl -s -X POST "$BASE/render/now" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d "{\"templateId\":\"$TID\",\"entityId\":\"wm-var-void\",\"channel\":\"print\",\"inputs\":[{\"heading\":\"Invoice\",\"wm_var\":\"VOID\"}]}")
DOC4_STATUS=$(echo "$RDOC4" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("document",{}).get("status",""))')
DOC4_HASH=$(echo "$RDOC4" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("document",{}).get("pdfHash",""))')
check "Render with VOID succeeded" "test '$DOC4_STATUS' = 'done'"
check "VOID hash unique" "test '$DOC4_HASH' != '$DOC1_HASH' && test '$DOC4_HASH' != '$DOC2_HASH' && test '$DOC4_HASH' != '$DOC3_HASH'"

# Test 5: No input for watermark field at all - uses schema default
echo ""
echo "Test 5: No variable in inputs - uses schema default text"
RDOC5=$(curl -s -X POST "$BASE/render/now" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d "{\"templateId\":\"$TID\",\"entityId\":\"wm-var-default\",\"channel\":\"print\",\"inputs\":[{\"heading\":\"Invoice\"}]}")
DOC5_STATUS=$(echo "$RDOC5" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("document",{}).get("status",""))')
DOC5_HASH=$(echo "$RDOC5" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("document",{}).get("pdfHash",""))')
check "Render with no variable succeeded" "test '$DOC5_STATUS' = 'done'"
check "Default uses DRAFT text (same hash as Test 1)" "test '$DOC5_HASH' = '$DOC1_HASH'"

echo ""
echo "================================"
echo "Results: $PASS passed, $FAIL failed"
echo "================================"
test $FAIL -eq 0
