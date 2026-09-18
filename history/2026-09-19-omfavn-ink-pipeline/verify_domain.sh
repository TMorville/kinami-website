#!/bin/zsh
# Verify omfavn.app live, BY CONTENT, https only, with negative controls.
# --resolve bypasses the local resolver's stale negative cache; SNI + cert
# validation still happen against the real hostname.
IP=172.67.146.234
R="--resolve omfavn.app:443:$IP --resolve www.omfavn.app:443:$IP"
PASS=0; FAIL=0
chk() { # label expected_code expected_title url
  local out code title
  out=$(curl -sS $=R -w '\n__CODE__%{http_code}' "$4" 2>/dev/null)
  code=$(echo "$out" | tail -1 | sed 's/__CODE__//')
  title=$(echo "$out" | tr -d '\n' | sed -n 's/.*<title>\(.*\)<\/title>.*/\1/p')
  if [[ "$code" == "$2" && "$title" == "$3" ]]; then
    echo "PASS  $1  [$code] <title>$title</title>"; PASS=$((PASS+1))
  else
    echo "FAIL  $1  got [$code] <title>$title</title>  wanted [$2] <title>$3</title>"; FAIL=$((FAIL+1))
  fi
}

echo "=== positive: each page serves its own title ==="
chk "/"          200 "omfavn"                 https://omfavn.app/
chk "/beta/"     200 "Closed beta | omfavn"   https://omfavn.app/beta/
chk "/404.html"  200 "Page Not Found | omfavn" https://omfavn.app/404.html

echo "\n=== NEGATIVE CONTROL: unmatched paths must 404, not 200 the home page ==="
chk "NEG /this-path-does-not-exist-xyz/" 404 "Page Not Found | omfavn" https://omfavn.app/this-path-does-not-exist-xyz/
chk "NEG /garbage/deep/nope/"            404 "Page Not Found | omfavn" https://omfavn.app/garbage/deep/nope/

echo "\n=== assets must be assets, not HTML ==="
for p in assets/favicon.svg assets/apple-touch-icon.png assets/og.png; do
  ct=$(curl -sSI $=R -o /dev/null -w '%{content_type}' "https://omfavn.app/$p")
  code=$(curl -sSI $=R -o /dev/null -w '%{http_code}' "https://omfavn.app/$p")
  if [[ "$code" == 200 && "$ct" != *html* ]]; then
    echo "PASS  /$p  [$code] $ct"; PASS=$((PASS+1))
  else
    echo "FAIL  /$p  [$code] $ct"; FAIL=$((FAIL+1))
  fi
done

echo "\n=== www -> apex 301, query string preserved ==="
loc=$(curl -sSI $=R -o /dev/null -w '%{redirect_url}' "https://www.omfavn.app/beta/?ref=testquery")
code=$(curl -sSI $=R -o /dev/null -w '%{http_code}' "https://www.omfavn.app/beta/?ref=testquery")
if [[ "$code" == 301 && "$loc" == "https://omfavn.app/beta/?ref=testquery" ]]; then
  echo "PASS  www redirect  [$code] -> $loc"; PASS=$((PASS+1))
else
  echo "FAIL  www redirect  [$code] -> $loc  (wanted 301 -> https://omfavn.app/beta/?ref=testquery)"; FAIL=$((FAIL+1))
fi

echo "\n=== certificate ==="
sv=$(curl -sS $=R -o /dev/null -w '%{ssl_verify_result}' https://omfavn.app/)
[[ "$sv" == 0 ]] && { echo "PASS  cert verifies (ssl_verify_result=0)"; PASS=$((PASS+1)); } || { echo "FAIL  cert ssl_verify_result=$sv"; FAIL=$((FAIL+1)); }

echo "\n$PASS passed, $FAIL failed"
