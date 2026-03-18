#!/bin/bash
JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJvcmdJZCI6InRlc3Qtb3JnIiwicm9sZXMiOlsiYWRtaW4iXX0.fakesig"
TMPL_ID="zchyjhvtltr46gfi3y62w8uw"

echo "=== Step 1: Create bulk render ==="
BULK=$(curl -s -X POST http://localhost:3001/api/pdfme/render/bulk \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{
    \"templateId\": \"$TMPL_ID\",
    \"entityIds\": [\"merge-1\", \"merge-2\", \"merge-3\"],
    \"channel\": \"print\",
    \"entityType\": \"invoice\"
  }")
echo "Bulk response: $BULK"
BATCH_ID=$(echo "$BULK" | python3 -c "import sys,json; print(json.load(sys.stdin)['batchId'])")
echo "Batch ID: $BATCH_ID"

sleep 3

echo ""
echo "=== Step 2: Verify batch completed ==="
STATUS=$(curl -s "http://localhost:3001/api/pdfme/render/batch/$BATCH_ID" \
  -H "Authorization: Bearer $JWT")
echo "Status: $STATUS"

echo ""
echo "=== Step 3: POST merge ==="
MERGE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST \
  "http://localhost:3001/api/pdfme/render/batch/$BATCH_ID/merge" \
  -H "Authorization: Bearer $JWT")
echo "Merge result: $MERGE"

echo ""
echo "=== Step 4: Test merge on running batch (should fail) ==="
FAIL_BATCH=$(curl -s -X POST http://localhost:3001/api/pdfme/render/bulk \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{
    \"templateId\": \"$TMPL_ID\",
    \"entityIds\": [\"f1\", \"f2\", \"f3\", \"f4\", \"f5\", \"f6\", \"f7\", \"f8\", \"f9\", \"f10\"],
    \"channel\": \"email\",
    \"entityType\": \"invoice\"
  }")
FAIL_BATCH_ID=$(echo "$FAIL_BATCH" | python3 -c "import sys,json; print(json.load(sys.stdin)['batchId'])")
FAIL_MERGE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST \
  "http://localhost:3001/api/pdfme/render/batch/$FAIL_BATCH_ID/merge" \
  -H "Authorization: Bearer $JWT")
echo "Merge on running batch: $FAIL_MERGE"
echo ""

echo "=== Step 5: Test merge on non-existent batch (should 404) ==="
NOT_FOUND=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST \
  "http://localhost:3001/api/pdfme/render/batch/nonexistent/merge" \
  -H "Authorization: Bearer $JWT")
echo "Non-existent batch: $NOT_FOUND"
