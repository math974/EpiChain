# Indexer (EVM / ERC-4337)

Node + TypeScript service that indexes **EntryPoint v0.7** events from **Ethereum Mainnet**, stores them in PostgreSQL (via Prisma), and exposes a REST API + WebSocket live feed.

## Indexed Events

| Event | Description |
|-------|-------------|
| `UserOperationEvent` | Every UserOp execution (success/failure, gas cost, paymaster) |
| `AccountDeployed` | New smart account deployments through the EntryPoint |
| `UserOperationRevertReason` | Reverted UserOps with the revert reason bytes |

## Architecture

- **viem** connects to Mainnet via Alchemy/Infura (configurable RPC)
- **Backfill**: on startup, catches up from the last indexed block (persisted in `IndexerState`)
- **Live polling**: every ~12s for new blocks after backfill completes
- **Reorg handling**: detects block hash mismatches and purges stale data
- **RPC resilience**: exponential backoff retries (rate limit aware)
- **PostgreSQL + Prisma**: relational storage with unique constraints to prevent duplicates
- **REST API**: paginated event queries + aggregate stats
- **WebSocket** (`/ws`): pushes new events to connected clients in real-time

## Setup

1. Copy `.env.example` to `.env` and fill `DATABASE_URL`, `MAINNET_RPC_URL`, and `START_BLOCK`.
2. `npm install`
3. `npx prisma migrate dev` (or `npx prisma db push` for a quick local schema sync)
4. `npm run dev` (`tsx watch` — restarts the server when you edit `.ts` files)

## API

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `GET /api/events?limit=50&offset=0&sender=0x...` | Paginated UserOperationEvent list |
| `GET /api/events/:userOpHash` | Single event by hash |
| `GET /api/deploys` | AccountDeployed events |
| `GET /api/reverts` | UserOperationRevertReason events |
| `GET /api/stats` | Aggregate stats |
| `ws://HOST:PORT/ws` | WebSocket — `initial` payload on connect, `update` on new events |

## Why these choices?

- **Alchemy (RPC)**: reliable, free tier generous for Mainnet reads, supports `eth_getLogs` with large ranges.
- **Polling vs WebSocket subscriptions**: polling is more resilient to disconnects and works with all providers. WebSocket subscriptions can miss events on reconnect. Polling every 12s (1 block) is sufficient.
- **PostgreSQL**: ACID guarantees for reorg handling, efficient indexed queries, Prisma ORM for type safety and migrations.
- **REST + WebSocket**: REST for initial page load + pagination, WebSocket for real-time updates without polling from the frontend.

Docker Compose uses `Dockerfile` stage `development` (hot reload, bind mount). Production image: `docker build --target production ./indexer`.

See the **root** `README.md` for the full project context.
