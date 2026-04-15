# EpiChain

Full-stack project for the **Blockchain Developer — Final Exam**: ERC-4337 smart accounts (session keys), an **EntryPoint v0.7** event indexer on **Ethereum Mainnet**, and a shared **React** frontend.

---

## Contents

1. [Repository layout](#repository-layout)
2. [Networks (Sepolia vs Mainnet)](#networks-sepolia-vs-mainnet)
3. [Prerequisites](#prerequisites)
4. [Environment variables](#environment-variables)
5. [Quick start with Docker Compose](#quick-start-with-docker-compose) (recommended)
6. [Local development without Docker](#local-development-without-docker)
7. [Scripts](#scripts)
8. [Production Docker images](#production-docker-images)
9. [Troubleshooting](#troubleshooting)
10. [Tech stack](#tech-stack)
11. [Exam submission checklist](#exam-submission-checklist)

---

## Repository layout

| Path | Role |
|------|------|
| `contracts/` | Solidity (**Foundry**): smart account, factory, demo contract, deployment scripts |
| `indexer/` | **Node.js** + **Express** + **Prisma** + **PostgreSQL**: index `UserOperationEvent` from Mainnet, HTTP API |
| `frontend/` | **React** + **Vite** + **RainbowKit** + **wagmi** + **viem** |
| `scripts/` | Helper scripts (e.g. clean rebuild for Docker) |

---

## Networks (Sepolia vs Mainnet)

| Part of the project | Network | Notes |
|---------------------|---------|--------|
| Smart contracts, AA demo, bundler | **Sepolia** | Deploy + verify on a testnet explorer |
| Indexer (EntryPoint logs) | **Ethereum Mainnet** | Required by the exam — use a Mainnet RPC (e.g. Alchemy) |

**EntryPoint v0.7 (same address on supported chains):**  
`0x0000000071727De22E5E9d8BAf0edAc6f37da032`

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
| `scripts/commit-all.sh` | Creates multiple conventional commits and enables `.githooks` so Cursor attribution trailers are stripped. |

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
- **Indexer:** Node.js, TypeScript, **Express**, **viem**, **Prisma**, **PostgreSQL**
- **Frontend:** **React**, **Vite**, **RainbowKit**, **wagmi**, **viem**, TanStack Query
- **Infra:** Docker Compose, optional **Alchemy** RPCs

PostgreSQL + Prisma: relational storage for events, migrations, and clear defense trade-offs in the oral exam.

---

## Exam submission checklist

- [ ] `/contracts` — sources, Foundry config, deploy scripts, demo contract verified on **Sepolia**
- [ ] `/indexer` — backend, `.env.example`, README, Mainnet indexing + persistence + API
- [ ] `/frontend` — AA flows + live feed + stats (per exam)
- [ ] Root `README.md` — setup reproducible (this document)

---

## License

See [LICENSE](./LICENSE).
