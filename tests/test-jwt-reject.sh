#!/bin/bash
echo "=== Feature #8: JWT rejection tests ==="

echo ""
echo "--- Test 1: GET /api/pdfme/templates without auth (expect 401) ---"
curl -s -w '\nHTTP_STATUS: %{http_code}\n' http://localhost:3001/api/pdfme/templates

echo ""
echo "--- Test 2: POST /api/pdfme/templates without auth (expect 401) ---"
curl -s -w '\nHTTP_STATUS: %{http_code}\n' -X POST \
  -H "Content-Type: application/json" \
  -d '{"name":"test","type":"invoice","schema":{}}' \
  http://localhost:3001/api/pdfme/templates

echo ""
echo "--- Test 3: POST /api/pdfme/render/now without auth (expect 401) ---"
curl -s -w '\nHTTP_STATUS: %{http_code}\n' -X POST \
  -H "Content-Type: application/json" \
  -d '{"templateId":"abc"}' \
  http://localhost:3001/api/pdfme/render/now

echo ""
echo "--- Test 4: Health endpoint still public (expect 200) ---"
curl -s -w '\nHTTP_STATUS: %{http_code}\n' http://localhost:3001/api/pdfme/health

echo ""
echo "--- Test 5: Verify error envelope format ---"
curl -s http://localhost:3001/api/pdfme/templates | python3 -m json.tool 2>/dev/null || curl -s http://localhost:3001/api/pdfme/templates

echo ""
echo "--- Test 6: GET /api/pdfme/templates WITH valid JWT (expect 200) ---"
HEADER=$(printf '{"alg":"HS256","typ":"JWT"}' | base64 -w0 | tr '+/' '-_' | tr -d '=')
PAYLOAD=$(printf '{"sub":"user-001","orgId":"org-test-8","roles":["admin"],"iat":1710000000}' | base64 -w0 | tr '+/' '-_' | tr -d '=')
TOKEN="${HEADER}.${PAYLOAD}.fake-signature"
curl -s -w '\nHTTP_STATUS: %{http_code}\n' -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/pdfme/templates
