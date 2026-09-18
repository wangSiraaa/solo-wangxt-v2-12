#!/usr/bin/env bash
# Generate demo certificate fixtures with openssl:
#   ca.pem                     self-signed root CA
#   valid.pem                  api.example.com + *.example.com, 400 days
#   expiring.pem               api.example.com, 10 days (expiry warning path)
#   expired.pem                api.example.com, already expired (must be rejected)
#   wrong-domain.pem           other.org names (domain coverage must fail)
#   broken-chain.pem           valid leaf + unrelated CA (chain check must fail)
set -euo pipefail
cd "$(dirname "$0")/../fixtures"

mkdir -p tmp
DAYS_VALID=400

gen_ca() {
  local name=$1 cn=$2
  openssl req -x509 -newkey rsa:2048 -nodes -days 800 \
    -subj "/CN=$cn" -keyout tmp/$name.key -out tmp/$name.crt 2>/dev/null
}

gen_leaf() {
  local name=$1 ca=$2 cn=$3 san=$4 days=$5
  openssl req -newkey rsa:2048 -nodes \
    -subj "/CN=$cn" -keyout tmp/$name.key -out tmp/$name.csr 2>/dev/null
  cat > tmp/$name.ext <<EOF
subjectAltName=$san
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
EOF
  # days=0 yields a certificate that is already expired (used for rejection tests)
  openssl x509 -req -in tmp/$name.csr -CA tmp/$ca.crt -CAkey tmp/$ca.key \
    -CAcreateserial -days $days -extfile tmp/$name.ext \
    -out tmp/$name.crt 2>/dev/null
}

bundle() { # leaf ca out
  cat tmp/$1.crt tmp/$2.crt > $3
}

gen_ca mainca "Workbench Demo Root CA"
gen_ca otherca "Unrelated Other CA"

gen_leaf valid mainca api.example.com "DNS:api.example.com,DNS:*.example.com,DNS:example.com" $DAYS_VALID
bundle valid mainca valid.pem

gen_leaf expiring mainca api.example.com "DNS:api.example.com,DNS:*.example.com" 10
bundle expiring mainca expiring.pem

gen_leaf expired mainca api.example.com "DNS:api.example.com,DNS:*.example.com" 0
bundle expired mainca expired.pem

gen_leaf wrong mainca api.other.org "DNS:api.other.org" $DAYS_VALID
bundle wrong mainca wrong-domain.pem

# broken chain: valid leaf signed by mainca, but bundled with an unrelated CA
cat tmp/valid.crt tmp/otherca.crt > broken-chain.pem

cp tmp/mainca.crt ca.pem
rm -rf tmp
echo "fixtures written to fixtures/"
ls -1 .
