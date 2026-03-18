#!/bin/bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJvcmdJZCI6InBhZy10ZXN0LW9yZyIsInJvbGVzIjpbImFkbWluIl19.fakesig"

for i in $(seq 1 25); do
  curl -s -X POST http://localhost:3001/api/pdfme/templates \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"PagTest_$i\",\"type\":\"invoice\",\"schema\":{\"pages\":[{\"num\":$i}]}}" > /dev/null
done
echo "Created 25 templates"

echo ""
echo "=== Test 1: GET with limit=10 ==="
RESP1=$(curl -s "http://localhost:3001/api/pdfme/templates?limit=10" \
  -H "Authorization: Bearer $TOKEN")
echo "$RESP1" | jq '{total: .pagination.total, limit: .pagination.limit, hasMore: .pagination.hasMore, returned: (.data | length), nextCursor: .pagination.nextCursor}'

CURSOR=$(echo "$RESP1" | jq -r '.pagination.nextCursor')

echo ""
echo "=== Test 2: GET with cursor (next page) ==="
RESP2=$(curl -s "http://localhost:3001/api/pdfme/templates?limit=10&cursor=$CURSOR" \
  -H "Authorization: Bearer $TOKEN")
echo "$RESP2" | jq '{total: .pagination.total, limit: .pagination.limit, hasMore: .pagination.hasMore, returned: (.data | length), nextCursor: .pagination.nextCursor}'

CURSOR2=$(echo "$RESP2" | jq -r '.pagination.nextCursor')

echo ""
echo "=== Test 3: GET with cursor (third page) ==="
RESP3=$(curl -s "http://localhost:3001/api/pdfme/templates?limit=10&cursor=$CURSOR2" \
  -H "Authorization: Bearer $TOKEN")
echo "$RESP3" | jq '{total: .pagination.total, limit: .pagination.limit, hasMore: .pagination.hasMore, returned: (.data | length), nextCursor: .pagination.nextCursor}'

echo ""
echo "=== Collect all names across pages ==="
NAMES1=$(echo "$RESP1" | jq -r '.data[].name')
NAMES2=$(echo "$RESP2" | jq -r '.data[].name')
NAMES3=$(echo "$RESP3" | jq -r '.data[].name')
TOTAL_NAMES=$(echo -e "$NAMES1\n$NAMES2\n$NAMES3" | grep -c "PagTest")
echo "Total PagTest templates retrieved across 3 pages: $TOTAL_NAMES"
