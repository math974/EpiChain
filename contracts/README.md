# Contracts (ERC-4337)

This folder contains the smart contracts required by the exam:

- `SmartAccount.sol` (ERC-4337 `IAccount`-compatible)
- `SmartAccountFactory.sol` (CREATE2 deterministic deployment)
- `Counter.sol` (demo target contract)

## Requirements

- Foundry installed (`forge`, `cast`)
- A Sepolia RPC URL (e.g. Alchemy)
- A funded deployer key for Sepolia

## Setup

```bash
cp .env.example .env
# fill values (SEPOLIA_RPC_URL, PRIVATE_KEY, etc.)
```

## Build and test

```bash
forge build
forge test -vv
```

## Deploy core contracts (Factory + Counter)

```bash
source .env
forge script script/DeployCore.s.sol:DeployCoreScript \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  --broadcast
```

Copy printed addresses to `.env`:

- `FACTORY_ADDRESS=...`
- `COUNTER_ADDRESS=...`

## Create a deterministic SmartAccount

```bash
source .env
forge script script/CreateSmartAccount.s.sol:CreateSmartAccountScript \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  --broadcast
```

The script prints:

- predicted address (`getAddress`)
- deployed address (`createAccount`)

## Manage session keys

### Add session key (restricted to `increment()`)

```bash
source .env
forge script script/ManageSessionKey.s.sol:AddSessionKeyScript \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  --broadcast
```

### Revoke session key

```bash
source .env
forge script script/ManageSessionKey.s.sol:RevokeSessionKeyScript \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  --broadcast
```
