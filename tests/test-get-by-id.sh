#!/bin/bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJvcmdJZCI6ImdldC10ZXN0LW9yZyIsInJvbGVzIjpbImFkbWluIl19.fakesig"

echo "=== Create template with complex schema ==="
COMPLEX_SCHEMA='{"basePdf":"BLANK_PDF","schemas":[[{"name":{"type":"text","position":{"x":10,"y":10},"width":100,"height":20}},{"logo":{"type":"image","position":{"x":150,"y":10},"width":50,"height":50}},{"items":{"type":"table","position":{"x":10,"y":80},"width":180,"height":100,"columns":["desc","qty","price","total"]}}]],"columns":["desc","qty","price","total"],"sampledata":[{"name":"Test Invoice","logo":"data:image/png;base64,abc","items":[["Widget",2,10.00,20.00]]}]}'

CREATE_RESP=$(curl -s -X POST http://localhost:3000/api/pdfme/templates \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Complex Schema Test\",\"type\":\"invoice\",\"schema\":$COMPLEX_SCHEMA}")

echo "Create response:"
echo "$CREATE_RESP" | jq .

TEMPLATE_ID=$(echo "$CREATE_RESP" | jq -r '.id')
echo ""
echo "=== GET by ID: $TEMPLATE_ID ==="
GET_RESP=$(curl -s "http://localhost:3000/api/pdfme/templates/$TEMPLATE_ID" \
  -H "Authorization: Bearer $TOKEN")

echo "GET response:"
echo "$GET_RESP" | jq .

echo ""
echo "=== Verify all fields ==="
echo "id present: $(echo "$GET_RESP" | jq 'has("id")')"
echo "orgId: $(echo "$GET_RESP" | jq -r '.orgId')"
echo "type: $(echo "$GET_RESP" | jq -r '.type')"
echo "name: $(echo "$GET_RESP" | jq -r '.name')"
echo "status: $(echo "$GET_RESP" | jq -r '.status')"
echo "version: $(echo "$GET_RESP" | jq -r '.version')"
echo "schema present: $(echo "$GET_RESP" | jq 'has("schema")')"
echo "schema.basePdf: $(echo "$GET_RESP" | jq -r '.schema.basePdf')"
echo "schema has schemas array: $(echo "$GET_RESP" | jq '.schema.schemas | length')"
echo "schema has columns: $(echo "$GET_RESP" | jq '.schema.columns')"
echo "schema has sampledata: $(echo "$GET_RESP" | jq '.schema.sampledata | length')"
echo "createdAt present: $(echo "$GET_RESP" | jq 'has("createdAt")')"
echo "updatedAt present: $(echo "$GET_RESP" | jq 'has("updatedAt")')"
echo "createdBy: $(echo "$GET_RESP" | jq -r '.createdBy')"

echo ""
echo "=== Cleanup ==="
curl -s -X DELETE "http://localhost:3000/api/pdfme/templates/$TEMPLATE_ID" \
  -H "Authorization: Bearer $TOKEN" | jq .
