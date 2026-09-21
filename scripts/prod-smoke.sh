#!/usr/bin/env bash
# Unauthenticated production smoke test for AU Bounty.
# Usage: scripts/prod-smoke.sh [base-url]
# Default base is the course VM. Exit code 0 = all checks passed.

BASE="${1:-https://sai-aike-shwe-tun-aung-backend2.indonesiacentral.cloudapp.azure.com/aubounty}"
ORIGIN="$(dirname "$BASE")"
pass=0; fail=0

check() { # name, expected, actual
  if [ "$2" = "$3" ]; then echo "PASS  $1"; pass=$((pass+1))
  else echo "FAIL  $1 (expected [$2] got [$3])"; fail=$((fail+1)); fi
}

# 1. SPA shell
code=$(curl -s -o /tmp/au-smoke-index.html -w '%{http_code}' "$BASE/")
check "spa shell 200" 200 "$code"

# 2. API health
body=$(curl -sf "$BASE/api/health" 2>/dev/null)
okflag=$(echo "$body" | grep -o '"ok":true' | head -1)
check "api health body" '"ok":true' "$okflag"

# 3. Meta: dev auth off, entra configured, capabilities present
meta=$(curl -sf "$BASE/api/meta" 2>/dev/null)
check "devAuth off in prod" '"devAuth":false' "$(echo "$meta" | grep -o '"devAuth":[a-z]*' | head -1)"
check "entra configured" '"configured":true' "$(echo "$meta" | grep -o '"configured":[a-z]*' | head -1)"
check "capabilities reported" '"capabilities"' "$(echo "$meta" | grep -o '"capabilities"' | head -1)"

# 4. A built asset under the /aubounty prefix
asset=$(grep -o '/aubounty/assets/index-[^"]*\.js' /tmp/au-smoke-index.html | head -1)
check "index references prefixed asset" 1 "$([ -n "$asset" ] && echo 1 || echo 0)"
code=$(curl -s -o /dev/null -w '%{http_code}' "$ORIGIN$asset")
check "asset fetch 200" 200 "$code"

# 5. Socket.io handshake through the whole chain
hs=$(curl -sf "$BASE/socket.io/?EIO=4&transport=polling" 2>/dev/null | head -c 120)
check "socket.io handshake" 1 "$(echo "$hs" | grep -q '"sid"' && echo 1 || echo 0)"

# 6. Login redirects to Microsoft with the https callback
loc=$(curl -s -o /dev/null -w '%{redirect_url}' "$BASE/api/auth/login?returnTo=%2Fboard")
check "login 302 to microsoft" 1 "$(echo "$loc" | grep -q 'login\.microsoftonline\.com' && echo 1 || echo 0)"
check "redirect uri is https" 1 "$(echo "$loc" | grep -q 'https%3A%2F%2F.*auth%2Fcallback\|https://.*auth/callback' && echo 1 || echo 0)"

# 7. Old services on the shared domain still alive
code=$(curl -s -o /dev/null -w '%{http_code}' "$ORIGIN/")
check "old frontend still 200" 200 "$code"
code=$(curl -s -o /dev/null -w '%{http_code}' "$ORIGIN/content/")
check "wordpress still 200" 200 "$code"

echo
echo "passed $pass, failed $fail"
rm -f /tmp/au-smoke-index.html
[ "$fail" -eq 0 ]
