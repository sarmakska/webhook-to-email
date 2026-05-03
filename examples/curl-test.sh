#!/usr/bin/env bash
# Send a test webhook to a local instance.
set -euo pipefail

URL="${1:-http://localhost:3000/hooks/test}"

curl -sS -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "test",
    "user": {"name": "Sarma", "email": "you@example.com"},
    "amount": 4200,
    "currency": "GBP"
  }'
echo
