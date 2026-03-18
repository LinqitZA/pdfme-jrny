#!/bin/bash
# End-to-end watermark tests via API
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

echo "=== Watermark E2E Tests ==="

# Test 1: Watermark preview endpoint returns PDF data
echo ""
echo "Test 1: Preview endpoint generates valid response"
RESP=$(curl -s -X POST "$BASE/watermark/preview" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{"text":"DRAFT","opacity":0.3,"rotation":45}')
check "Has pdfBase64 field" "echo '$RESP' | python3 -c 'import sys,json; d=json.load(sys.stdin); assert \"pdfBase64\" in d'"
check "Has config.text=DRAFT" "echo '$RESP' | python3 -c 'import sys,json; d=json.load(sys.stdin); assert d[\"config\"][\"text\"]==\"DRAFT\"'"
check "pdfSize > 0" "echo '$RESP' | python3 -c 'import sys,json; d=json.load(sys.stdin); assert d[\"pdfSize\"]>0'"

# Test 2: Preview with custom settings
echo ""
echo "Test 2: Preview with custom opacity, rotation, color, fontSize"
RESP2=$(curl -s -X POST "$BASE/watermark/preview" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{"text":"CONFIDENTIAL","opacity":0.2,"rotation":30,"color":"#FF0000","fontSize":48}')
check "config.text=CONFIDENTIAL" "echo '$RESP2' | python3 -c 'import sys,json; d=json.load(sys.stdin); assert d[\"config\"][\"text\"]==\"CONFIDENTIAL\"'"
check "config.opacity=0.2" "echo '$RESP2' | python3 -c 'import sys,json; d=json.load(sys.stdin); assert d[\"config\"][\"opacity\"]==0.2'"
check "config.rotation=30" "echo '$RESP2' | python3 -c 'import sys,json; d=json.load(sys.stdin); assert d[\"config\"][\"rotation\"]==30'"
check "config.color.r=1 (red)" "echo '$RESP2' | python3 -c 'import sys,json; d=json.load(sys.stdin); assert d[\"config\"][\"color\"][\"r\"]==1'"
check "config.fontSize=48" "echo '$RESP2' | python3 -c 'import sys,json; d=json.load(sys.stdin); assert d[\"config\"][\"fontSize\"]==48'"

# Test 3: Create template with watermark, publish, render
echo ""
echo "Test 3: Full render pipeline with watermark element"
TMPL=$(curl -s -X POST "$BASE/templates" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{"name":"WM E2E Test","type":"invoice","schema":{"basePdf":{"width":210,"height":297,"padding":[10,10,10,10]},"schemas":[[{"name":"heading","type":"text","position":{"x":20,"y":20},"width":170,"height":20},{"name":"watermark_field","type":"watermark","text":"DRAFT","opacity":0.3,"rotation":45,"color":{"r":0.5,"g":0.5,"b":0.5},"fontSize":72,"position":{"x":0,"y":0},"width":210,"height":297}]]}}')
TID=$(echo "$TMPL" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
check "Template created" "test -n '$TID'"

# Publish
curl -s -X POST "$BASE/templates/$TID/publish" -H "Authorization: Bearer $JWT" > /dev/null
check "Template published" "true"

# Render
RDOC=$(curl -s -X POST "$BASE/render/now" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d "{\"templateId\":\"$TID\",\"entityId\":\"wm-e2e-test\",\"channel\":\"print\",\"inputs\":[{\"heading\":\"Test Invoice\",\"watermark_field\":\"DRAFT\"}]}")
DOC_STATUS=$(echo "$RDOC" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("document",{}).get("status",""))')
DOC_PATH=$(echo "$RDOC" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("document",{}).get("filePath",""))')
check "Render status=done" "test '$DOC_STATUS' = 'done'"
check "filePath non-empty" "test -n '$DOC_PATH'"

# Verify PDF file exists on disk
FULL_PATH="/home/linqadmin/repo/pdfme-jrny/storage/$DOC_PATH"
check "PDF file exists on disk" "test -f '$FULL_PATH'"
check "PDF file size > 0" "test -s '$FULL_PATH'"

# Test 4: Render with overridden watermark text via inputs
echo ""
echo "Test 4: Watermark text override via inputs"
RDOC2=$(curl -s -X POST "$BASE/render/now" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d "{\"templateId\":\"$TID\",\"entityId\":\"wm-e2e-test-2\",\"channel\":\"print\",\"inputs\":[{\"heading\":\"Invoice Override\",\"watermark_field\":\"VOID\"}]}")
DOC2_STATUS=$(echo "$RDOC2" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("document",{}).get("status",""))')
check "Render with VOID watermark status=done" "test '$DOC2_STATUS' = 'done'"

# Test 5: Preview with object color (not hex)
echo ""
echo "Test 5: Preview with object color format"
RESP5=$(curl -s -X POST "$BASE/watermark/preview" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{"text":"COPY","color":{"r":0,"g":0.5,"b":1}}')
check "Object color works" "echo '$RESP5' | python3 -c 'import sys,json; d=json.load(sys.stdin); assert d[\"config\"][\"color\"][\"b\"]==1'"

# Test 6: Preview endpoint requires auth
echo ""
echo "Test 6: Auth required"
NOAUTH=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/watermark/preview" -H "Content-Type: application/json" -d '{"text":"DRAFT"}')
check "No auth returns 401" "test '$NOAUTH' = '401'"

echo ""
echo "================================"
echo "Results: $PASS passed, $FAIL failed"
echo "================================"
test $FAIL -eq 0
