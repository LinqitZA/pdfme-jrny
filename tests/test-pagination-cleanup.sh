#!/bin/bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJvcmdJZCI6InBhZy10ZXN0LW9yZyIsInJvbGVzIjpbImFkbWluIl19.fakesig"

echo "Cleaning up PagTest templates..."
IDS=$(curl -s "http://localhost:3000/api/pdfme/templates?limit=100" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data[] | select(.name | startswith("PagTest_")) | .id')

for id in $IDS; do
  curl -s -X DELETE "http://localhost:3000/api/pdfme/templates/$id" \
    -H "Authorization: Bearer $TOKEN" > /dev/null
done
echo "Cleanup done"
