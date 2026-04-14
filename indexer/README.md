# Indexer (EVM / ERC-4337)

Node + TypeScript service that indexes `EntryPoint` v0.7 events from **Ethereum Mainnet**, stores them in PostgreSQL (via Prisma), and exposes an HTTP API.

## Setup

1. Copy `.env.example` to `.env` and fill `DATABASE_URL`, `MAINNET_RPC_URL`, and `START_BLOCK`.
2. `npm install`
3. `npx prisma migrate dev` (or `npx prisma db push` for a quick local schema sync)
4. `npm run dev` (`tsx watch` — restarts the server when you edit `.ts` files)

Docker Compose uses `Dockerfile` stage `development` (same hot reload, bind mount + `indexer_node_modules` volume). Production image: `docker build --target production ./indexer`.

See the **root** `README.md` for the full project context and exam requirements.
