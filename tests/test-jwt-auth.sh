#!/bin/bash
# Test JWT authentication for Feature #7

# Create a valid JWT token with sub, orgId, roles claims
# JWT = base64(header).base64(payload).signature
HEADER=$(printf '{"alg":"HS256","typ":"JWT"}' | base64 -w0 | tr '+/' '-_' | tr -d '=')
PAYLOAD=$(printf '{"sub":"user-001","orgId":"org-test-7","roles":["admin"],"iat":1710000000}' | base64 -w0 | tr '+/' '-_' | tr -d '=')
TOKEN="${HEADER}.${PAYLOAD}.fake-signature"

echo "=== JWT Auth Test ==="
echo "Token: $TOKEN"

echo ""
echo "--- Test 1: List templates with valid JWT (should return 200) ---"
curl -s -w '\nHTTP_STATUS: %{http_code}\n' -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/pdfme/templates

echo ""
echo "--- Test 2: Create template with JWT (orgId from token) ---"
CREATE_RESULT=$(curl -s -w '\n%{http_code}' -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"JWT Test Feature7","type":"invoice","schema":{"fields":[]}}' \
  http://localhost:3000/api/pdfme/templates)
echo "$CREATE_RESULT"

TEMPLATE_ID=$(echo "$CREATE_RESULT" | head -1 | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo ""
echo "Created template ID: $TEMPLATE_ID"

echo ""
echo "--- Test 3: Get template by ID with JWT (should be scoped to orgId) ---"
curl -s -w '\nHTTP_STATUS: %{http_code}\n' -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/pdfme/templates/$TEMPLATE_ID

echo ""
echo "--- Test 4: List with different orgId JWT (should NOT see org-test-7 templates) ---"
PAYLOAD2=$(printf '{"sub":"user-002","orgId":"org-other-99","roles":["viewer"],"iat":1710000000}' | base64 -w0 | tr '+/' '-_' | tr -d '=')
TOKEN2="${HEADER}.${PAYLOAD2}.fake-signature"
curl -s -w '\nHTTP_STATUS: %{http_code}\n' -H "Authorization: Bearer $TOKEN2" http://localhost:3000/api/pdfme/templates

echo ""
echo "--- Cleanup: Delete test template ---"
curl -s -w '\nHTTP_STATUS: %{http_code}\n' -X DELETE -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/pdfme/templates/$TEMPLATE_ID
