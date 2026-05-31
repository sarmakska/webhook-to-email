#!/usr/bin/env bash
# Send a test webhook to a local instance.
#
# Usage:
#   ./examples/curl-test.sh                         unsigned request to /hooks/test
#   ./examples/curl-test.sh <url>                   unsigned request to a custom url
#   WEBHOOK_SECRET=secret ./examples/curl-test.sh   adds a valid X-Signature header
set -euo pipefail

URL="${1:-http://localhost:3000/hooks/test}"

BODY='{
  "event": "test",
  "user": {"name": "Sarma", "email": "you@example.com"},
  "amount": 4200,
  "currency": "GBP"
}'

if [[ -n "${WEBHOOK_SECRET:-}" ]]; then
  SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" -hex | awk '{print $2}')
  curl -sS -X POST "$URL" \
    -H "Content-Type: application/json" \
    -H "X-Signature: sha256=$SIG" \
    --data-raw "$BODY"
else
  curl -sS -X POST "$URL" \
    -H "Content-Type: application/json" \
    --data-raw "$BODY"
fi
echo
