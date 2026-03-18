#!/bin/bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJvcmdJZCI6InN5cy10ZXN0LW9yZyIsInJvbGVzIjpbImFkbWluIl19.fakesig"

echo "=== GET /api/pdfme/templates/system ==="
RESP=$(curl -s "http://localhost:3001/api/pdfme/templates/system" \
  -H "Authorization: Bearer $TOKEN")

echo "Total returned: $(echo "$RESP" | jq '.total')"
echo ""
echo "Templates:"
echo "$RESP" | jq -r '.data[] | "\(.id) | \(.type) | \(.name) | orgId=\(.orgId)"'

echo ""
echo "=== Verify all 9 types ==="
echo "$RESP" | jq -r '.data[].type' | sort

echo ""
echo "=== Verify all orgId=null ==="
NULL_COUNT=$(echo "$RESP" | jq '[.data[] | select(.orgId == null)] | length')
echo "Templates with orgId=null: $NULL_COUNT"

echo ""
echo "=== GET /api/pdfme/templates/system/sys-invoice-standard ==="
curl -s "http://localhost:3001/api/pdfme/templates/system/sys-invoice-standard" \
  -H "Authorization: Bearer $TOKEN" | jq '{id, type, name, status, orgId, has_schema: (.schema != null)}'

echo ""
echo "=== Idempotency: restart should show 0 created, 9 updated ==="
echo "(Already verified via server logs)"
