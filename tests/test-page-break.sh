#!/bin/bash
JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJvcmdJZCI6InRlc3Qtb3JnIiwicm9sZXMiOlsiYWRtaW4iXX0.fakesig"
PORT="${1:-3005}"
BASE="http://localhost:$PORT/api/pdfme"

SCHEMA='{"basePdf":{"width":210,"height":297,"padding":[10,10,10,10]},"schemas":[[{"lineItems":{"type":"lineItemsTable","name":"lineItems","position":{"x":10,"y":10},"width":190,"height":270,"showHeader":true,"repeatHeader":true,"maxRowsPerPage":10,"columns":[{"key":"description","header":"Description","width":80,"align":"left"},{"key":"qty","header":"Qty","width":30,"align":"right"},{"key":"unitPrice","header":"Unit Price","width":40,"align":"right","format":"#,##0.00"},{"key":"total","header":"Total","width":40,"align":"right","format":"#,##0.00"}]}}]],"columns":[],"sampledata":[{}]}'

echo "Step 1: Create template with maxRowsPerPage=10"
RESULT=$(curl -s -X POST "$BASE/templates" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d "{\"name\":\"Page Break Test\",\"type\":\"invoice\",\"schema\":$SCHEMA}")
echo "$RESULT"
TEMPLATE_ID=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "Template ID: $TEMPLATE_ID"

echo ""
echo "Step 2: Publish template"
curl -s -X POST "$BASE/templates/$TEMPLATE_ID/publish" -H "Authorization: Bearer $JWT" | python3 -c "import sys,json; d=json.load(sys.stdin); print('Status:', d.get('status'))"

echo ""
echo "Step 3: Generate 25 line items JSON"
ITEMS='['
for i in $(seq 1 25); do
  if [ $i -gt 1 ]; then ITEMS="$ITEMS,"; fi
  PRICE=$((i * 10))
  TOTAL=$((i * 10 * i))
  ITEMS="${ITEMS}{\"description\":\"Item $i\",\"qty\":$i,\"unitPrice\":$PRICE,\"total\":$TOTAL}"
done
ITEMS="$ITEMS]"

ESCAPED=$(echo "$ITEMS" | sed 's/"/\\"/g')

echo "Step 4: Render PDF with 25 line items"
RENDER_RESULT=$(curl -s -X POST "$BASE/render/now" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d "{\"templateId\":\"$TEMPLATE_ID\",\"entityId\":\"test-pagebreak-117\",\"channel\":\"download\",\"inputs\":[{\"lineItems\":\"$ESCAPED\"}]}")
echo "$RENDER_RESULT" | python3 -c "
import sys, json
d = json.load(sys.stdin)
if 'document' in d:
    doc = d['document']
    print('Status:', doc.get('status'))
    print('File:', doc.get('filePath'))
    snap = doc.get('inputSnapshot', [{}])
    if snap and len(snap) > 0:
        keys = list(snap[0].keys())
        print('Input keys:', keys)
        for k in keys:
            v = snap[0][k]
            if isinstance(v, str) and v.startswith('['):
                rows = json.loads(v)
                print(f'  {k}: {len(rows)} rows')
else:
    print('Error:', d.get('message', d.get('error', 'unknown')))
"
