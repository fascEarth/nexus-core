#!/usr/bin/env bash
# Run inside OCI Cloud Shell:
#   curl -fsSL https://raw.githubusercontent.com/fascEarth/nexus-core/main/deploy/server/oci-launch.sh | bash
#
# Creates (or reuses) a public VCN with ports 22/80/443 open, then keeps trying to
# launch the Always Free Ampere A1 server "fascinora-server" until Oracle has capacity.
# Tries 2 OCPU / 12 GB first, then 1 OCPU / 6 GB, every round. Safe to re-run.
set -uo pipefail

C="${OCI_TENANCY:?Run this in OCI Cloud Shell (OCI_TENANCY not set)}"
NAME=fascinora-server
SHAPE=VM.Standard.A1.Flex
WAIT=${WAIT:-60}
WORK="$HOME/fascinora"
mkdir -p "$WORK"; cd "$WORK"

log() { echo "[$(date -u +%H:%M:%S)] $*"; }
first() { jq -r '.data[0].id // empty' 2>/dev/null; }

existing=$(oci compute instance list -c "$C" --display-name "$NAME" --all 2>/dev/null \
  | jq -r '[.data[]? | select(."lifecycle-state" != "TERMINATED" and ."lifecycle-state" != "TERMINATING")][0].id // empty')
if [ -n "$existing" ]; then
  log "Instance $NAME already exists: $existing"
  INSTANCE=$existing
else
  AD=$(oci iam availability-domain list -c "$C" | jq -r '.data[0].name')
  log "Availability domain: $AD"

  VCN=$(oci network vcn list -c "$C" --display-name fascinora-vcn | first)
  if [ -z "$VCN" ]; then
    log "Creating VCN"
    VCN=$(oci network vcn create -c "$C" --cidr-blocks '["10.0.0.0/16"]' --display-name fascinora-vcn \
      --dns-label fascinora --wait-for-state AVAILABLE | jq -r .data.id)
  fi
  VCNJSON=$(oci network vcn get --vcn-id "$VCN")
  RT=$(echo "$VCNJSON" | jq -r '.data."default-route-table-id"')
  SL=$(echo "$VCNJSON" | jq -r '.data."default-security-list-id"')

  IGW=$(oci network internet-gateway list -c "$C" --vcn-id "$VCN" | first)
  if [ -z "$IGW" ]; then
    log "Creating internet gateway"
    IGW=$(oci network internet-gateway create -c "$C" --vcn-id "$VCN" --is-enabled true \
      --display-name fascinora-igw --wait-for-state AVAILABLE | jq -r .data.id)
  fi
  oci network route-table update --rt-id "$RT" --force \
    --route-rules "[{\"destination\":\"0.0.0.0/0\",\"destinationType\":\"CIDR_BLOCK\",\"networkEntityId\":\"$IGW\"}]" >/dev/null

  cat > ingress.json <<'JSON'
[
 {"protocol":"6","source":"0.0.0.0/0","tcpOptions":{"destinationPortRange":{"min":22,"max":22}}},
 {"protocol":"6","source":"0.0.0.0/0","tcpOptions":{"destinationPortRange":{"min":80,"max":80}}},
 {"protocol":"6","source":"0.0.0.0/0","tcpOptions":{"destinationPortRange":{"min":443,"max":443}}},
 {"protocol":"1","source":"0.0.0.0/0","icmpOptions":{"type":3,"code":4}},
 {"protocol":"1","source":"10.0.0.0/16","icmpOptions":{"type":3}}
]
JSON
  oci network security-list update --security-list-id "$SL" --force \
    --ingress-security-rules file://ingress.json >/dev/null
  log "Firewall: ports 22, 80, 443 open"

  SUB=$(oci network subnet list -c "$C" --vcn-id "$VCN" | first)
  if [ -z "$SUB" ]; then
    log "Creating public subnet"
    SUB=$(oci network subnet create -c "$C" --vcn-id "$VCN" --cidr-block 10.0.0.0/24 \
      --display-name fascinora-subnet --dns-label pub --route-table-id "$RT" \
      --security-list-ids "[\"$SL\"]" --wait-for-state AVAILABLE | jq -r .data.id)
  fi

  IMG=$(oci compute image list -c "$C" --operating-system "Canonical Ubuntu" --operating-system-version "24.04" \
    --shape "$SHAPE" --sort-by TIMECREATED --sort-order DESC | jq -r '[.data[] | select(."display-name" | test("Minimal") | not)][0].id')
  log "Image: $IMG"

  [ -f "$HOME/.ssh/fascinora" ] || ssh-keygen -t ed25519 -N "" -f "$HOME/.ssh/fascinora" -q
  cat > cloud-init.sh <<'EOF'
#!/bin/bash
export HOME=/root USER=root
curl -fsSL https://raw.githubusercontent.com/fascEarth/nexus-core/main/deploy/server/setup.sh -o /root/fascinora-setup.sh
bash /root/fascinora-setup.sh hello@fascinora.com > /var/log/fascinora-setup.log 2>&1
EOF

  try=0
  while :; do
    for cfg in "2 12" "1 6"; do
      set -- $cfg; try=$((try+1))
      log "Attempt $try: $1 OCPU / $2 GB"
      out=$(oci compute instance launch -c "$C" --availability-domain "$AD" --display-name "$NAME" \
        --shape "$SHAPE" --shape-config "{\"ocpus\":$1,\"memoryInGBs\":$2}" --image-id "$IMG" \
        --subnet-id "$SUB" --assign-public-ip true --boot-volume-size-in-gbs 50 \
        --ssh-authorized-keys-file "$HOME/.ssh/fascinora.pub" --user-data-file cloud-init.sh 2>&1)
      INSTANCE=$(echo "$out" | sed -n '/^{/,$p' | jq -r '.data.id // empty' 2>/dev/null)
      [ -n "$INSTANCE" ] && break 2
      echo "$out" | grep -o '"message": "[^"]*"' | head -1
      echo "$out" | grep -qiE 'capacity|TooManyRequests|InternalError|timed out' || { echo "$out"; log "Stopping: unexpected error"; exit 1; }
    done
    log "No capacity yet, retrying in ${WAIT}s (Ctrl+C to stop)"
    sleep "$WAIT"
  done
  log "Launched: $INSTANCE"
fi

log "Waiting for RUNNING"
oci compute instance get --instance-id "$INSTANCE" --wait-for-state RUNNING >/dev/null
IP=$(oci compute instance list-vnics --instance-id "$INSTANCE" | jq -r '.data[0]."public-ip"')
echo
echo "=============================================="
echo " fascinora-server is RUNNING"
echo " Public IP: $IP"
echo " SSH key:   ~/.ssh/fascinora (in Cloud Shell)"
echo " Setup log: ssh -i ~/.ssh/fascinora ubuntu@$IP sudo tail -f /var/log/fascinora-setup.log"
echo "=============================================="
