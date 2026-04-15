#!/usr/bin/env bash
# Deploy SmartAccountFactory + Counter to Sepolia via Foundry, then sync addresses into local .env files.
# Runs forge tests by default, optionally verifies Factory + Counter on Etherscan (Sepolia).
#
# Usage (from repo root):
#   ./scripts/deploy-sepolia-core.sh
#   ./scripts/deploy-sepolia-core.sh --skip-balance-check
#   ./scripts/deploy-sepolia-core.sh --skip-tests
#   ./scripts/deploy-sepolia-core.sh --skip-verify
#
# Requires: forge, cast, python3; contracts/.env with SEPOLIA_RPC_URL, PRIVATE_KEY, ENTRY_POINT_V07
# Optional: ETHERSCAN_API_KEY in contracts/.env for source verification

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONTRACTS_DIR="$REPO_ROOT/contracts"
ENV_FILE="$CONTRACTS_DIR/.env"

SKIP_BALANCE_CHECK=0
SKIP_TESTS=0
SKIP_VERIFY=0
for arg in "$@"; do
  case "$arg" in
    --skip-balance-check) SKIP_BALANCE_CHECK=1 ;;
    --skip-tests) SKIP_TESTS=1 ;;
    --skip-verify) SKIP_VERIFY=1 ;;
    -h|--help)
      echo "Usage: $0 [options]"
      echo "  --skip-balance-check   Do not require a minimum Sepolia ETH balance before sending txs"
      echo "  --skip-tests           Skip forge test (still runs forge build)"
      echo "  --skip-verify          Skip Etherscan verification even if ETHERSCAN_API_KEY is set"
      exit 0
      ;;
  esac
done

die() {
  echo "error: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing command '$1' (install or add to PATH)"
}

need_cmd forge
need_cmd cast
need_cmd python3

[[ -f "$ENV_FILE" ]] || die "missing $ENV_FILE — copy contracts/.env.example and fill SEPOLIA_RPC_URL, PRIVATE_KEY, ENTRY_POINT_V07"

# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

[[ -n "${SEPOLIA_RPC_URL:-}" ]] || die "SEPOLIA_RPC_URL is not set in $ENV_FILE"
[[ -n "${PRIVATE_KEY:-}" ]] || die "PRIVATE_KEY is not set in $ENV_FILE"
[[ -n "${ENTRY_POINT_V07:-}" ]] || die "ENTRY_POINT_V07 is not set in $ENV_FILE"

DEPLOYER_ADDR="$(cast wallet address --private-key "$PRIVATE_KEY")"

# Conservative gas ceiling for two contract creations (Factory + Counter), ×1.3 margin vs naive gas*price.
check_balance() {
  python3 - "$SEPOLIA_RPC_URL" "$DEPLOYER_ADDR" <<'PY'
import json, subprocess, sys, urllib.request

rpc_url, deployer = sys.argv[1], sys.argv[2]

def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(rpc_url, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        out = json.loads(r.read().decode())
    if out.get("error"):
        raise SystemExit(f"RPC {method} error: {out['error']}")
    return out["result"]

def to_int(x):
    if isinstance(x, str) and x.startswith("0x"):
        return int(x, 16)
    return int(x)

bal_hex = rpc("eth_getBalance", [deployer, "latest"])
gp_hex = rpc("eth_gasPrice", [])

balance = to_int(bal_hex)
gas_price = to_int(gp_hex)
# Upper bound on gas units for Factory + Counter deployment (padding for bytecode growth).
gas_units = 8_000_000
required = gas_price * gas_units * 13 // 10

print(f"Deployer:     {deployer}")
print(f"Balance:      {balance} wei ({balance / 1e18:.6f} ETH)")
print(f"Gas price:    {gas_price} wei")
print(f"Min reserve:  ~{required} wei (~{required / 1e18:.6f} ETH) [8M gas × price × 1.3]")

if balance < required:
    raise SystemExit(
        f"Insufficient funds: need at least ~{required} wei for deployment estimate. "
        f"Fund the deployer or use --skip-balance-check if you know what you're doing."
    )
print("Balance check OK.")
PY
}

if [[ "$SKIP_BALANCE_CHECK" -eq 0 ]]; then
  check_balance
else
  echo "Skipping balance check (--skip-balance-check)."
  echo "Deployer: $DEPLOYER_ADDR"
fi

if [[ "$SKIP_TESTS" -eq 0 ]]; then
  echo "Running forge test..."
  ( cd "$CONTRACTS_DIR" && forge test -vv )
else
  echo "Skipping tests (--skip-tests)."
  echo "Building contracts..."
  ( cd "$CONTRACTS_DIR" && forge build )
fi

echo "Deploying DeployCore (Factory + Counter)..."
( cd "$CONTRACTS_DIR" && forge script script/DeployCore.s.sol:DeployCoreScript \
    --rpc-url "$SEPOLIA_RPC_URL" \
    --private-key "$PRIVATE_KEY" \
    --broadcast \
    -vvv )

BROADCAST_JSON="$(find "$CONTRACTS_DIR/broadcast/DeployCore.s.sol" -name run-latest.json 2>/dev/null | sort | tail -n 1)"
[[ -n "$BROADCAST_JSON" && -f "$BROADCAST_JSON" ]] || die "could not find broadcast run-latest.json under broadcast/DeployCore.s.sol"

read -r FACTORY_ADDR COUNTER_ADDR <<<"$(python3 - "$BROADCAST_JSON" <<'PY'
import json, sys
path = sys.argv[1]
with open(path) as f:
    data = json.load(f)
txs = data.get("transactions") or []
fac = ctr = None
for t in txs:
    name = t.get("contractName") or ""
    addr = t.get("contractAddress")
    if not addr:
        continue
    if name == "SmartAccountFactory":
        fac = addr
    elif name == "Counter":
        ctr = addr
if not fac or not ctr:
    raise SystemExit("Could not parse Factory/Counter addresses from broadcast JSON")
print(fac, ctr)
PY
)"

[[ -n "$FACTORY_ADDR" && -n "$COUNTER_ADDR" ]] || die "failed to extract addresses"

echo ""
echo "Deployed:"
echo "  SmartAccountFactory: $FACTORY_ADDR"
echo "  Counter:             $COUNTER_ADDR"
echo ""

verify_on_etherscan() {
  local factory="$1" counter="$2"
  if [[ "$SKIP_VERIFY" -ne 0 ]]; then
    echo "Skipping Etherscan verification (--skip-verify)."
    return 0
  fi
  if [[ -z "${ETHERSCAN_API_KEY:-}" ]]; then
    echo "Note: ETHERSCAN_API_KEY not set in $ENV_FILE — skipping source verification."
    echo "      Add a key from https://etherscan.io/apis to verify Factory + Counter on the next run."
    return 0
  fi

  echo "Verifying SmartAccountFactory on Etherscan (Sepolia)..."
  ( cd "$CONTRACTS_DIR" && forge verify-contract "$factory" \
      src/SmartAccountFactory.sol:SmartAccountFactory \
      --chain sepolia \
      --etherscan-api-key "$ETHERSCAN_API_KEY" \
      --constructor-args "$(cast abi-encode "constructor(address)" "$ENTRY_POINT_V07")" )

  echo "Verifying Counter on Etherscan (Sepolia)..."
  ( cd "$CONTRACTS_DIR" && forge verify-contract "$counter" \
      src/Counter.sol:Counter \
      --chain sepolia \
      --etherscan-api-key "$ETHERSCAN_API_KEY" )

  echo "Etherscan verification submitted."
}

verify_on_etherscan "$FACTORY_ADDR" "$COUNTER_ADDR"

update_kv() {
  local file="$1" key="$2" val="$3"
  if [[ ! -f "$file" ]]; then
    return 0
  fi
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$file"
  else
    echo "${key}=${val}" >> "$file"
  fi
}

echo "Updating env files (only keys that exist or append if missing in that file)..."
update_kv "$ENV_FILE" "FACTORY_ADDRESS" "$FACTORY_ADDR"
update_kv "$ENV_FILE" "COUNTER_ADDRESS" "$COUNTER_ADDR"
echo "  $ENV_FILE"

FRONTEND_ENV="$REPO_ROOT/frontend/.env"
update_kv "$FRONTEND_ENV" "VITE_FACTORY_ADDRESS" "$FACTORY_ADDR"
update_kv "$FRONTEND_ENV" "VITE_COUNTER_ADDRESS" "$COUNTER_ADDR"
[[ -f "$FRONTEND_ENV" ]] && echo "  $FRONTEND_ENV" || echo "  (skip) $FRONTEND_ENV not found — copy frontend/.env.example and re-run, or set VITE_* manually"

ROOT_ENV="$REPO_ROOT/.env"
update_kv "$ROOT_ENV" "VITE_FACTORY_ADDRESS" "$FACTORY_ADDR"
update_kv "$ROOT_ENV" "VITE_COUNTER_ADDRESS" "$COUNTER_ADDR"
update_kv "$ROOT_ENV" "FACTORY_ADDRESS" "$FACTORY_ADDR"
update_kv "$ROOT_ENV" "COUNTER_ADDRESS" "$COUNTER_ADDR"
[[ -f "$ROOT_ENV" ]] && echo "  $ROOT_ENV" || echo "  (skip) $ROOT_ENV not found"

echo ""
echo "Done. Restart the Vite dev server if it was running so VITE_* changes apply."
echo "Next: set SMART_ACCOUNT_OWNER / SMART_ACCOUNT_SALT in contracts/.env and run CreateSmartAccount script if needed."
