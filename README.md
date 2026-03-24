# EpiChain — ERC-4337 Smart Account System

A full-stack Ethereum project implementing ERC-4337 Account Abstraction.

**Stack:**
- Smart contracts → Solidity + Foundry
- Frontend → React + RainbowKit + wagmi + viem
- Backend → Node.js + SQLite
- Infra → Alchemy

---

## Repository Structure

```
/
├── contracts/          Foundry project — SmartAccount, Factory, Counter
├── indexer/            Node.js ERC-4337 event indexer + REST/WebSocket API
├── frontend/           React dashboard (smart account UI + live indexer feed)
└── README.md           This file
```

---

## Quick Start (local)

### Prerequisites

| Tool | Version |
|------|---------|
| Node.js | ≥ 18 |
| npm | ≥ 9 |
| Foundry (`forge`, `cast`) | latest — [install](https://getfoundry.sh) |

---

## Part 1 — Smart Contracts

### Setup

```bash
cd contracts

# Install Foundry dependencies
forge install OpenZeppelin/openzeppelin-contracts --no-commit
forge install foundry-rs/forge-std --no-commit

# Copy and fill environment variables
cp .env.example .env
# Edit .env: set PRIVATE_KEY, SEPOLIA_RPC_URL, ETHERSCAN_API_KEY
```

### Compile

```bash
forge build
```

### Test

```bash
forge test -vvv
```

All tests should pass. Key test cases:
- `test_factoryDeterministic` — CREATE2 address matches `getAddress`
- `test_validateUserOp_ownerECDSA` — ECDSA owner signature accepted
- `test_addSessionKey_and_validate` — session key signature accepted
- `test_sessionKey_revokedKey_fails` — revoked key rejected
- `test_sessionKey_selectorRestriction` — wrong selector rejected

### Deploy to Sepolia

```bash
source .env
forge script script/Deploy.s.sol \
  --rpc-url $SEPOLIA_RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY
```

After deployment, note the `SmartAccountFactory` and `Counter` addresses
and add them to `frontend/.env` (see [Frontend Setup](#frontend-setup)).

---

## Part 2 — EVM Indexer (Backend)

The indexer connects to Ethereum Mainnet via Alchemy, listens for three
ERC-4337 events from the EntryPoint v0.7
(`0x0000000071727De22E5E9d8BAf0edAc6f37da032`), persists them in SQLite,
and exposes them via a REST + WebSocket API.

**Why Alchemy?** Reliable archive node access with high rate limits and a
generous free tier — no self-hosted node needed for this use case.

**Why polling instead of WebSocket subscriptions?** Polling via `getLogs`
is more resilient against dropped connections and provider restarts.
It also handles chain reorgs naturally: each poll cycle re-processes the
last 6 blocks, so any shallow reorg automatically overwrites stale rows
(SQLite's `INSERT OR REPLACE` on the `user_op_hash` unique constraint).

**Why SQLite?** Minimal operational overhead — no separate process to
run, ACID guarantees, and more than sufficient throughput for an indexer
that processes ~1M events/day at most. Trade-off: not horizontally
scalable; swap for PostgreSQL if multi-node deployment is needed.

### Setup

```bash
cd indexer

npm install

cp .env.example .env
# Edit .env:
#   RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
#   START_BLOCK=19000000   # backfill start block (0 to skip)
#   PORT=3001
#   DB_PATH=./epichain.db
```

### Run

```bash
npm start
# or for auto-reload during development:
npm run dev
```

The server starts on `http://localhost:3001`. On first run it performs a
historical backfill from `START_BLOCK` to the current chain head, then
switches to real-time polling.

### API Reference

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness check |
| `GET` | `/api/events` | Paginated `UserOperationEvent` list (`limit`, `offset`) |
| `GET` | `/api/events/:userOpHash` | Single event by hash |
| `GET` | `/api/stats` | Aggregated stats (total, success rate, % sponsored) |
| `GET` | `/api/deployed` | `AccountDeployed` events |
| `GET` | `/api/reverts` | `UserOperationRevertReason` events |
| `WS` | `/ws` | WebSocket — real-time event push |

### WebSocket messages

```json
{ "type": "UserOperationEvent", "data": { ... } }
{ "type": "AccountDeployed",    "data": { ... } }
{ "type": "UserOperationRevertReason", "data": { ... } }
{ "type": "connected", "timestamp": 1712345678000 }
```

---

## Part 3 — Frontend

The React frontend provides two views:
1. **Indexer Feed** (`/`) — live table of `UserOperationEvent`s with stats
   panel, WebSocket auto-update, and Etherscan links.
2. **Smart Account** (`/account`) — deploy your smart account via the
   factory, call `increment()` as owner, add/revoke session keys.

### Frontend Setup

```bash
cd frontend

npm install

cp .env.example .env
# Edit .env:
#   VITE_ALCHEMY_ID=YOUR_ALCHEMY_KEY
#   VITE_FACTORY_ADDRESS=0x...   (from contracts deployment)
#   VITE_COUNTER_ADDRESS=0x...   (from contracts deployment)
#   VITE_INDEXER_URL=http://localhost:3001
#   VITE_INDEXER_WS=ws://localhost:3001/ws
```

### Run

```bash
npm run dev
# Opens http://localhost:3000
```

---

## Architecture — Reorg Handling

Every polling cycle re-processes the last `REORG_DEPTH` (6) blocks.
Because `user_op_hash` is a `UNIQUE` column in SQLite and rows are
inserted with `INSERT OR REPLACE`, any log re-fetched after a reorg
automatically overwrites the previous version. This handles all shallow
reorgs (< 6 blocks) correctly.

For deep reorgs (> 6 blocks, extremely rare on Ethereum mainnet) the
operator can reset `last_block` in the `indexer_state` table to trigger
a manual re-backfill.

---

## Smart Contract Architecture

### SmartAccount

`validateUserOp` dispatches on the first byte of `userOp.signature`:
- `0x00` → ECDSA owner path: recover signer, compare to `owner`.
- `0x01` → Session key path: extract 20-byte key address, verify ECDSA
  from that key, then check: not revoked, selector allowed, time bounds.

The function returns ERC-4337's packed `validationData`:
- `0` → success
- `1` → failure
- `validUntil << 160` → time-bounded success (for session key with expiry)

### SmartAccountFactory (CREATE2)

`CREATE2` salt is derived as `keccak256(abi.encodePacked(owner, salt))`,
binding the owner address into the salt to prevent cross-owner collisions.
The counterfactual address can be computed off-chain before deployment
using `getAddress(owner, salt)`, which is the key enabler for the
ERC-4337 `initCode` pattern.

### Session Key Security

- Session keys can only call selectors explicitly granted by the owner.
- An empty `allowedSelectors` list is equivalent to "allow all" — the
  owner must choose what to restrict.
- Expiry is enforced both on-chain (via `validUntil` in `validationData`)
  and by the EntryPoint itself.
- Revocation is immediate and permanent (`revoked = true`).
- Session keys are not owners — they cannot call `addSessionKey`,
  `revokeSessionKey`, or `execute` directly (only via EntryPoint).

---

## Demo Walkthrough (Sepolia)

1. **Connect wallet** — click "Connect Wallet", choose MetaMask on Sepolia.
2. **Deploy smart account** — go to `/account`, click "Deploy Smart
   Account". This calls `SmartAccountFactory.createAccount(owner, 0)`.
3. **Increment counter** — click "Increment Counter". This calls
   `SmartAccount.execute(counter, 0, increment())` on the owner's behalf.
4. **Add session key** — enter a second address (or a generated keypair)
   and an expiry. Click "Add Session Key". Only the `increment()` selector
   is granted.
5. **Revoke session key** — enter the session key address, click "Revoke".
6. **View live feed** — go to `/`, observe `UserOperationEvent` entries
   appear in real time as the indexer processes blocks.

---

## Environment Variables Summary

### contracts/.env

| Variable | Description |
|----------|-------------|
| `PRIVATE_KEY` | Deployer private key (0x-prefixed) |
| `SEPOLIA_RPC_URL` | Alchemy/Infura Sepolia endpoint |
| `MAINNET_RPC_URL` | Alchemy/Infura Mainnet endpoint |
| `ETHERSCAN_API_KEY` | For contract verification |

### indexer/.env

| Variable | Description |
|----------|-------------|
| `RPC_URL` | Ethereum mainnet RPC (Alchemy recommended) |
| `START_BLOCK` | Historical backfill start block |
| `PORT` | HTTP server port (default 3001) |
| `DB_PATH` | SQLite database file path |

### frontend/.env

| Variable | Description |
|----------|-------------|
| `VITE_ALCHEMY_ID` | Alchemy API key for wagmi |
| `VITE_FACTORY_ADDRESS` | Deployed SmartAccountFactory address |
| `VITE_COUNTER_ADDRESS` | Deployed Counter address |
| `VITE_INDEXER_URL` | Indexer REST base URL |
| `VITE_INDEXER_WS` | Indexer WebSocket URL |
