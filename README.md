# EpiChain

Full-stack project for the **Blockchain Developer — Final Exam**: ERC-4337 smart accounts with session keys, an **EntryPoint v0.7** event indexer on **Ethereum Mainnet**, and a shared **React** frontend.

---

## Contents

1. [Repository layout](#repository-layout)
2. [Part 1 — Smart Contracts (How it works)](#part-1--smart-contracts)
3. [Part 2 — EVM Indexer (How it works)](#part-2--evm-indexer)
4. [Networks](#networks)
5. [Prerequisites](#prerequisites)
6. [Environment variables](#environment-variables)
7. [Quick start with Docker Compose](#quick-start-with-docker-compose) (recommended)
8. [Local development without Docker](#local-development-without-docker)
9. [Scripts](#scripts)
10. [Production Docker images](#production-docker-images)
11. [Troubleshooting](#troubleshooting)
12. [Tech stack](#tech-stack)
13. [Exam submission checklist](#exam-submission-checklist)

---

## Repository layout

| Path | Role |
|------|------|
| `contracts/` | Solidity (**Foundry**): SmartAccount, SmartAccountFactory, Counter, deploy scripts |
| `indexer/` | **Node.js** + **Express** + **Prisma** + **PostgreSQL** + **WebSocket**: ERC-4337 event indexer |
| `frontend/` | **React** + **Vite** + **RainbowKit** + **wagmi** + **viem**: shared UI for both pillars |
| `scripts/` | Deployment and Docker helper scripts |

---

## Part 1 — Smart Contracts

### What it does

An ERC-4337 compliant smart account system deployed on **Sepolia**, with two auth modes (owner ECDSA + session keys) and a demo Counter contract.

### How it works (implementation)

**SmartAccount.sol** implements `IAccount.validateUserOp()`. The signature field encodes an `authMode` byte:
- **Mode 0 (owner):** recovers the signer via `ecrecover(userOpHash, sig)` and checks it matches the stored `owner`.
- **Mode 1 (session key):** same `ecrecover`, but checks the recovered address is a registered session key, that the target function selector is in the key's allowlist, and packs the key's `expiry` into `validUntil` (the EntryPoint enforces the time check, since `block.timestamp` is a banned opcode in ERC-4337 validation).

Session keys are managed by the owner via `addSessionKey(address, expiry, selectors[])` and `revokeSessionKey(address)`. Each key has a per-selector allowlist and an expiry timestamp. Events `SessionKeyAdded` and `SessionKeyRevoked` are emitted for auditability.

**SmartAccountFactory.sol** uses `CREATE2` for deterministic addresses: `getAddress(owner, salt)` returns the counterfactual address before deployment. `createAccount(owner, salt)` deploys if not already deployed.

**Counter.sol** is the demo target: `increment()` and `getCount(address)` with a per-caller mapping.

**Frontend (Smart Account tab):** builds UserOperations, estimates gas via the bundler's `eth_estimateUserOperationGas`, gets the `userOpHash` from the EntryPoint, signs it (MetaMask for owner, in-app private key for session), submits via `eth_sendUserOperation`, and polls for the receipt. An adaptive retry loop adjusts `verificationGasLimit` automatically based on bundler feedback (`AA26` → increase, efficiency error → recalculate from actual gas ratio).

### Key files

| File | Role |
|------|------|
| `contracts/src/SmartAccount.sol` | IAccount implementation, session key storage, execute() |
| `contracts/src/SmartAccountFactory.sol` | CREATE2 factory |
| `contracts/src/Counter.sol` | Demo target (per-caller counter) |
| `frontend/src/App.tsx` | Owner flow, session key flow, UserOp building + bundler interaction |
| `frontend/src/lib/aa-userop.ts` | UserOp hash computation, signature encoding |

---

## Part 2 — EVM Indexer

### What it does

A backend service that indexes **all ERC-4337 activity on Ethereum Mainnet** by reading events from the EntryPoint v0.7 contract, stores them in PostgreSQL, and serves them via REST + WebSocket to a live frontend feed.

### How it works (implementation)

The indexer uses **viem** to call `eth_getLogs` on the EntryPoint address. It indexes 3 event types:
- `UserOperationEvent` — every UserOp execution (sender, paymaster, gas cost, success/fail)
- `AccountDeployed` — new smart account deployments
- `UserOperationRevertReason` — reverted UserOps with the revert reason

**Backfill:** on startup, reads the last indexed block from `IndexerState` (PostgreSQL singleton row) and catches up to the chain head in batches of `BATCH_SIZE` blocks (default 10, configurable — Alchemy free tier limits `eth_getLogs` to 10 blocks per request).

**Live polling:** after backfill, polls every ~12 seconds for new blocks. Each new batch of logs is parsed, enriched with block timestamps, and bulk-inserted via Prisma `createMany` with `skipDuplicates` (unique constraint on `txHash + logIndex`).

**Reorg handling:** before advancing, the indexer compares the stored `blockHash` for the last indexed block against the chain. If there's a mismatch (reorg), it purges all data from that block onward and re-indexes.

**RPC resilience:** all RPC calls are wrapped in exponential backoff retries (up to 5 attempts, 2x delay, doubled again for rate-limit errors).

**API:** Express REST endpoints for paginated event queries and aggregate stats. A WebSocket server (`/ws`) pushes new events to all connected clients whenever the indexer persists a new batch.

**Frontend (Indexer Feed tab):** connects via WebSocket for real-time updates, falls back to REST polling every 15s if WS is disconnected. Displays an events table (status, hash, sender, paymaster, gas cost, block, Etherscan link) and a stats panel (total UserOps, success rate, paymaster sponsorship rate).

### Why these choices

- **Alchemy (RPC):** reliable free tier, supports `eth_getLogs`.
- **Polling over WebSocket subscriptions:** more resilient to disconnects, works with all providers, no missed events on reconnect.
- **PostgreSQL + Prisma:** ACID for reorg safety, indexed queries, type-safe ORM with migrations.
- **REST + WebSocket:** REST for initial load + pagination + filters, WebSocket for real-time push.

### Key files

| File | Role |
|------|------|
| `indexer/src/indexer.ts` | Backfill + live polling loop, reorg detection, RPC retry logic |
| `indexer/src/api.ts` | REST endpoints (`/api/events`, `/api/stats`, etc.) |
| `indexer/src/ws.ts` | WebSocket server, broadcasts new events to clients |
| `indexer/src/abi.ts` | EntryPoint v0.7 event ABI (3 events) |
| `indexer/prisma/schema.prisma` | Database models (UserOperationEvent, AccountDeployed, etc.) |
| `frontend/src/IndexerFeed.tsx` | Live feed UI, stats panel, WebSocket client |

---

## Networks

| Part | Network | Why |
|------|---------|-----|
| Smart contracts + AA demo | **Sepolia** | Free testnet, no real ETH needed |
| Indexer | **Ethereum Mainnet** | Required by exam — real ERC-4337 traffic to index |

**EntryPoint v0.7:** `0x0000000071727De22E5E9d8BAf0edAc6f37da032`

---

## Prerequisites

- **Foundry** (`forge`, `cast`, `anvil`) — [installation](https://book.getfoundry.sh/getting-started/installation)
- **Node.js** 20+ and **npm**
- **Docker** + **Docker Compose** (for the stack below)
- **PostgreSQL** 15+ (only if you run the indexer **outside** Docker)
- **WalletConnect / Reown** [project ID](https://cloud.reown.com) for RainbowKit
- **Alchemy** (or similar) keys: **Sepolia** + **Ethereum Mainnet** as needed

---

## Environment variables

### Root `.env` (Docker Compose)

Copy from `.env.docker.example`:

```bash
cp .env.docker.example .env
```

| Variable (examples) | Purpose |
|---------------------|---------|
| `POSTGRES_*` | Postgres user, password, DB name, host port |
| `MAINNET_RPC_URL` | Mainnet JSON-RPC for the indexer worker |
| `ENTRY_POINT_ADDRESS` | EntryPoint v0.7 (default in example file) |
| `START_BLOCK` | Historical backfill start block |
| `VITE_WALLETCONNECT_PROJECT_ID` | RainbowKit / WalletConnect |
| `INDEXER_PORT`, `FRONTEND_PORT`, `PRISMA_STUDIO_PORT` | Published ports on the host |

**Important:** In `docker-compose.yml`, the **indexer** service sets `DATABASE_URL` to use the hostname **`postgres`** (the Compose service). Do not rely on `localhost` inside containers. For `npm run dev` **on your machine** against Postgres exposed on the host, use `localhost` in `indexer/.env` — see `indexer/.env.example`.

### `indexer/.env` (local indexer only)

Used when you run `cd indexer && npm run dev` **without** Docker. Copy from `indexer/.env.example`.

### `frontend/.env` (local frontend only)

`VITE_WALLETCONNECT_PROJECT_ID` and optional `VITE_SEPOLIA_RPC_URL`. Copy from `frontend/.env.example`.

---

## Beginner Setup (Copy/Paste)

If you are new to the project, follow this exact order.

### 1) Root `.env` for Docker

```bash
cp .env.docker.example .env
```

Edit `.env` and set at least:

```env
MAINNET_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
VITE_WALLETCONNECT_PROJECT_ID=YOUR_WALLETCONNECT_PROJECT_ID
```

Then start the stack:

```bash
docker compose up --build
```

### 2) Contracts `.env` for Sepolia deploy

```bash
cd contracts
cp .env.example .env
```

Edit `contracts/.env`:

```env
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
PRIVATE_KEY=0xYOUR_DEPLOYER_PRIVATE_KEY
ENTRY_POINT_V07=0x0000000071727De22E5E9d8BAf0edAc6f37da032
ETHERSCAN_API_KEY=YOUR_ETHERSCAN_KEY
SMART_ACCOUNT_OWNER=0xYOUR_METAMASK_ADDRESS
SMART_ACCOUNT_SALT=1
```

Deploy:

```bash
source .env
forge build
forge test -vv
forge script script/DeployCore.s.sol:DeployCoreScript --rpc-url "$SEPOLIA_RPC_URL" --private-key "$PRIVATE_KEY" --broadcast
```

After deploy, put the printed addresses into:

- `FACTORY_ADDRESS`
- `COUNTER_ADDRESS`

Then create the smart account:

```bash
forge script script/CreateSmartAccount.s.sol:CreateSmartAccountScript --rpc-url "$SEPOLIA_RPC_URL" --private-key "$PRIVATE_KEY" --broadcast
```

Put the deployed account in:

- `SMART_ACCOUNT_ADDRESS`

### 3) Frontend `.env` (local frontend)

```bash
cd ../frontend
cp .env.example .env
```

Edit `frontend/.env`:

```env
VITE_WALLETCONNECT_PROJECT_ID=YOUR_WALLETCONNECT_PROJECT_ID
VITE_FACTORY_ADDRESS=0xYOUR_FACTORY_ADDRESS
VITE_COUNTER_ADDRESS=0xYOUR_COUNTER_ADDRESS
# optional
# VITE_SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
```

Run frontend:

```bash
npm install
npm run dev
```

### 4) Verify contracts on Sepolia Etherscan

```bash
cd ../contracts
source .env
forge verify-contract --chain-id 11155111 --etherscan-api-key "$ETHERSCAN_API_KEY" "$COUNTER_ADDRESS" src/Counter.sol:Counter
forge verify-contract --chain-id 11155111 --etherscan-api-key "$ETHERSCAN_API_KEY" --constructor-args $(cast abi-encode "constructor(address)" "$ENTRY_POINT_V07") "$FACTORY_ADDRESS" src/SmartAccountFactory.sol:SmartAccountFactory
```

---

## Quick start with Docker Compose

From the **repository root**:

1. Create and edit the root `.env` (see above). At minimum set `VITE_WALLETCONNECT_PROJECT_ID` and `MAINNET_RPC_URL` for the indexer logic you implement.

2. Start the stack:

   ```bash
   docker compose up --build
   ```

   Add `-d` to run in the background.

3. Open the services:

| Service | URL (defaults) |
|---------|----------------|
| Frontend (Vite + HMR) | http://localhost:5173 |
| Indexer API | http://localhost:4000/health |
| Prisma Studio | http://localhost:5555 |
| PostgreSQL | `localhost:5432` (credentials from `.env`) |

**What runs:**

- **postgres** — data volume `postgres_data`
- **indexer** — image target `development`: `tsx watch`, bind mount `./indexer`, volume `indexer_node_modules`
- **frontend** — image target `development`: Vite + nodemon, bind mount `./frontend`, volume `frontend_node_modules`
- **prisma-studio** — Prisma Studio against the same DB as Compose (`postgres` hostname)

Stop containers:

```bash
docker compose down
```

Remove containers **and** named volumes (Postgres data + `node_modules` volumes):

```bash
docker compose down -v
```

---

## Local development without Docker

### Contracts

```bash
cd contracts
cp .env.example .env
# fill SEPOLIA_RPC_URL, PRIVATE_KEY, ENTRY_POINT_V07
forge build
forge test
```

Core deploy and deterministic account creation:

```bash
source .env
forge script script/DeployCore.s.sol:DeployCoreScript --rpc-url "$SEPOLIA_RPC_URL" --private-key "$PRIVATE_KEY" --broadcast
forge script script/CreateSmartAccount.s.sol:CreateSmartAccountScript --rpc-url "$SEPOLIA_RPC_URL" --private-key "$PRIVATE_KEY" --broadcast
```

### Indexer

1. Install and start **PostgreSQL** locally (or point to a hosted DB).
2. `cd indexer && cp .env.example .env` and set `DATABASE_URL`, `MAINNET_RPC_URL`, etc.
3. `npm install` → `npx prisma migrate dev` (or `prisma db push`) → `npm run dev`.

Health check: `GET http://localhost:4000/health`

### Indexer API endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `GET /api/events?limit=50&offset=0&sender=0x...` | Paginated UserOperationEvent list (newest first) |
| `GET /api/events/:userOpHash` | Single event by userOpHash |
| `GET /api/deploys?limit=50&offset=0` | AccountDeployed events |
| `GET /api/reverts?limit=50&offset=0` | UserOperationRevertReason events |
| `GET /api/stats` | Aggregate stats (total ops, success rate, sponsorship rate, etc.) |
| `ws://localhost:4000/ws` | WebSocket live feed — sends `initial` on connect, `update` on new events |

### Frontend

```bash
cd frontend
cp .env.example .env
# set VITE_WALLETCONNECT_PROJECT_ID
npm install
npm run dev
```

---

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/clean_rebuild.sh` | Stops Compose project, removes `epichain*` containers/images (and optionally volumes with `--full`), then `docker compose build --no-cache` and `up --build`. Run from repo root. Options: `--prod` (`.env.prod`), `--full`, `--clean-only`, `--help`. |
| `scripts/deploy-sepolia-core.sh` | Automated deploy of Factory + Counter to Sepolia: builds, tests, deploys, updates `.env` files, and verifies on Etherscan. Options: `--skip-tests`, `--skip-verify`, `--skip-balance-check`. |

Example:

```bash
./scripts/clean_rebuild.sh --clean-only   # cleanup only
./scripts/clean_rebuild.sh --full          # also delete volumes (destructive)
```

---

## Production Docker images

Multi-stage Dockerfiles use **`development`** targets in Compose and **`production`** as the default final stage for a static/image-only build.

**Indexer (compiled Node + migrations on start):**

```bash
docker build --target production -t epichain-indexer:prod ./indexer
```

**Frontend (nginx + static `dist`):**

```bash
docker build --target production -t epichain-frontend:prod ./frontend
# optional:
# --build-arg VITE_WALLETCONNECT_PROJECT_ID=...
```

---

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Indexer: `Can't reach database server at localhost:5432` inside Docker | Root `.env` used `localhost` for `DATABASE_URL`. Compose now forces `postgres` as host for the indexer service — do not override with a localhost URL for the container. |
| Prisma Studio: `ERR_STREAM_PREMATURE_CLOSE` in logs | Often harmless (tab closed, request aborted). If Studio UI loads, you can ignore. |
| Frontend env changes in Docker | Restart the `frontend` service after changing `VITE_*` in `.env`. |

### Git: `Made-with: Cursor` or `Co-authored-by` on commits

Cursor can append trailers when the **Agent** creates commits. Turn that off in the editor: **Settings → Agent → Attribution** (disable). Official note: [Cursor Git integration](https://cursor.com/docs/integrations/git).

Commits you run yourself in a normal terminal with plain `git commit -m "chore: …"` do not add that trailer unless the tool wraps the command with `--trailer`.

This repo includes **`.githooks/prepare-commit-msg`**: it deletes `Co-authored-by: … Cursor`, `Made-with: Cursor`, and `cursoragent@cursor.com` lines from the message file before the commit is recorded. Enable once per clone:

```bash
git config core.hooksPath .githooks
chmod +x .githooks/prepare-commit-msg
```

`bash scripts/commit-all.sh` sets `core.hooksPath` and runs the scripted commits.

---

## Tech stack

- **Smart contracts:** Solidity + **Foundry**
- **Indexer:** Node.js, TypeScript, **Express**, **viem**, **Prisma**, **PostgreSQL**, **ws** (WebSocket)
- **Frontend:** **React**, **Vite**, **RainbowKit**, **wagmi**, **viem**, TanStack Query
- **Infra:** Docker Compose, optional **Alchemy** RPCs

See the "How it works" sections above for architectural justifications.

---

## Exam submission checklist

- [ ] `/contracts` — sources, Foundry config, deploy scripts, demo contract verified on **Sepolia**
- [ ] `/indexer` — backend, `.env.example`, README, Mainnet indexing + persistence + API
- [ ] `/frontend` — AA flows + live feed + stats (per exam)
- [ ] Root `README.md` — setup reproducible (this document)

---

## License

See [LICENSE](./LICENSE).
