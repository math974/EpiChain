import {
  createPublicClient,
  http,
  type Log,
  type PublicClient,
  parseAbiItem,
  formatEther,
} from "viem";
import { mainnet } from "viem/chains";
import { prisma } from "./prisma.js";
import { entryPointAbi } from "./abi.js";
import { type EventCallback } from "./types.js";

const ENTRY_POINT = (process.env.ENTRY_POINT_ADDRESS ??
  "0x0000000071727De22E5E9d8BAf0edAc6f37da032") as `0x${string}`;

const BATCH_SIZE = 2000n;
const POLL_INTERVAL_MS = 12_000;
const MAX_RPC_RETRIES = 5;
const RPC_RETRY_BASE_MS = 2_000;

let client: PublicClient;

function getClient(): PublicClient {
  if (!client) {
    const rpcUrl = process.env.MAINNET_RPC_URL;
    if (!rpcUrl) throw new Error("MAINNET_RPC_URL is required");
    client = createPublicClient({
      chain: mainnet,
      transport: http(rpcUrl, { retryCount: 3, retryDelay: 1000 }),
    });
  }
  return client;
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < MAX_RPC_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const isRateLimit =
        lastError.message.includes("429") ||
        lastError.message.toLowerCase().includes("rate");
      const delay = RPC_RETRY_BASE_MS * Math.pow(2, attempt) * (isRateLimit ? 2 : 1);
      console.warn(
        `[indexer] RPC error (attempt ${attempt + 1}/${MAX_RPC_RETRIES}): ${lastError.message}. Retrying in ${delay}ms...`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

async function getLastIndexedBlock(): Promise<bigint> {
  const state = await prisma.indexerState.findUnique({ where: { id: "singleton" } });
  if (state) return state.lastIndexedBlock;
  const startBlock = BigInt(process.env.START_BLOCK ?? "0");
  await prisma.indexerState.create({
    data: { id: "singleton", lastIndexedBlock: startBlock },
  });
  return startBlock;
}

async function setLastIndexedBlock(block: bigint): Promise<void> {
  await prisma.indexerState.upsert({
    where: { id: "singleton" },
    update: { lastIndexedBlock: block },
    create: { id: "singleton", lastIndexedBlock: block },
  });
}

async function getBlockTimestamp(blockNumber: bigint): Promise<Date | null> {
  try {
    const block = await withRetry(() =>
      getClient().getBlock({ blockNumber }),
    );
    return new Date(Number(block.timestamp) * 1000);
  } catch {
    return null;
  }
}

interface ParsedUserOpEvent {
  userOpHash: string;
  sender: string;
  paymaster: string;
  nonce: string;
  success: boolean;
  actualGasCost: string;
  actualGasUsed: string;
  blockNumber: bigint;
  blockHash: string;
  txHash: string;
  logIndex: number;
}

interface ParsedAccountDeployed {
  userOpHash: string;
  sender: string;
  factory: string;
  paymaster: string;
  blockNumber: bigint;
  blockHash: string;
  txHash: string;
  logIndex: number;
}

interface ParsedRevertReason {
  userOpHash: string;
  sender: string;
  nonce: string;
  revertReason: string;
  blockNumber: bigint;
  blockHash: string;
  txHash: string;
  logIndex: number;
}

function parseUserOpEvents(logs: Log[]): ParsedUserOpEvent[] {
  return logs
    .filter((l) => l.blockNumber !== null && l.transactionHash !== null)
    .map((log) => {
      const args = (log as any).args;
      return {
        userOpHash: args.userOpHash as string,
        sender: args.sender as string,
        paymaster: args.paymaster as string,
        nonce: String(args.nonce),
        success: args.success as boolean,
        actualGasCost: String(args.actualGasCost),
        actualGasUsed: String(args.actualGasUsed),
        blockNumber: log.blockNumber!,
        blockHash: log.blockHash!,
        txHash: log.transactionHash!,
        logIndex: log.logIndex!,
      };
    });
}

function parseAccountDeployedEvents(logs: Log[]): ParsedAccountDeployed[] {
  return logs
    .filter((l) => l.blockNumber !== null && l.transactionHash !== null)
    .map((log) => {
      const args = (log as any).args;
      return {
        userOpHash: args.userOpHash as string,
        sender: args.sender as string,
        factory: args.factory as string,
        paymaster: args.paymaster as string,
        blockNumber: log.blockNumber!,
        blockHash: log.blockHash!,
        txHash: log.transactionHash!,
        logIndex: log.logIndex!,
      };
    });
}

function parseRevertReasonEvents(logs: Log[]): ParsedRevertReason[] {
  return logs
    .filter((l) => l.blockNumber !== null && l.transactionHash !== null)
    .map((log) => {
      const args = (log as any).args;
      return {
        userOpHash: args.userOpHash as string,
        sender: args.sender as string,
        nonce: String(args.nonce),
        revertReason: args.revertReason as string,
        blockNumber: log.blockNumber!,
        blockHash: log.blockHash!,
        txHash: log.transactionHash!,
        logIndex: log.logIndex!,
      };
    });
}

async function persistBatch(
  userOps: ParsedUserOpEvent[],
  deploys: ParsedAccountDeployed[],
  reverts: ParsedRevertReason[],
  blockTimestamps: Map<bigint, Date | null>,
): Promise<{
  newUserOps: number;
  newDeploys: number;
  newReverts: number;
}> {
  let newUserOps = 0;
  let newDeploys = 0;
  let newReverts = 0;

  if (userOps.length > 0) {
    const result = await prisma.userOperationEvent.createMany({
      data: userOps.map((e) => ({
        ...e,
        blockTimestamp: blockTimestamps.get(e.blockNumber) ?? null,
      })),
      skipDuplicates: true,
    });
    newUserOps = result.count;
  }

  if (deploys.length > 0) {
    const result = await prisma.accountDeployed.createMany({
      data: deploys.map((e) => ({
        ...e,
        blockTimestamp: blockTimestamps.get(e.blockNumber) ?? null,
      })),
      skipDuplicates: true,
    });
    newDeploys = result.count;
  }

  if (reverts.length > 0) {
    const result = await prisma.userOperationRevertReason.createMany({
      data: reverts.map((e) => ({
        ...e,
        blockTimestamp: blockTimestamps.get(e.blockNumber) ?? null,
      })),
      skipDuplicates: true,
    });
    newReverts = result.count;
  }

  return { newUserOps, newDeploys, newReverts };
}

async function handleReorg(blockNumber: bigint): Promise<void> {
  const block = await withRetry(() => getClient().getBlock({ blockNumber }));
  const existingOp = await prisma.userOperationEvent.findFirst({
    where: { blockNumber },
  });

  if (existingOp && existingOp.blockHash !== block.hash) {
    console.warn(
      `[indexer] Reorg detected at block ${blockNumber}: stored=${existingOp.blockHash} chain=${block.hash}. Purging...`,
    );
    await prisma.$transaction([
      prisma.userOperationEvent.deleteMany({ where: { blockNumber: { gte: blockNumber } } }),
      prisma.accountDeployed.deleteMany({ where: { blockNumber: { gte: blockNumber } } }),
      prisma.userOperationRevertReason.deleteMany({ where: { blockNumber: { gte: blockNumber } } }),
    ]);
    await setLastIndexedBlock(blockNumber - 1n);
  }
}

async function indexRange(
  from: bigint,
  to: bigint,
  onNewEvents: EventCallback,
): Promise<void> {
  const c = getClient();

  const [userOpLogs, deployLogs, revertLogs] = await Promise.all([
    withRetry(() =>
      c.getLogs({
        address: ENTRY_POINT,
        event: parseAbiItem(
          "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
        ),
        fromBlock: from,
        toBlock: to,
      }),
    ),
    withRetry(() =>
      c.getLogs({
        address: ENTRY_POINT,
        event: parseAbiItem(
          "event AccountDeployed(bytes32 indexed userOpHash, address indexed sender, address factory, address paymaster)",
        ),
        fromBlock: from,
        toBlock: to,
      }),
    ),
    withRetry(() =>
      c.getLogs({
        address: ENTRY_POINT,
        event: parseAbiItem(
          "event UserOperationRevertReason(bytes32 indexed userOpHash, address indexed sender, uint256 nonce, bytes revertReason)",
        ),
        fromBlock: from,
        toBlock: to,
      }),
    ),
  ]);

  const userOps = parseUserOpEvents(userOpLogs as unknown as Log[]);
  const deploys = parseAccountDeployedEvents(deployLogs as unknown as Log[]);
  const reverts = parseRevertReasonEvents(revertLogs as unknown as Log[]);

  const blockNumbers = new Set<bigint>();
  for (const e of [...userOps, ...deploys, ...reverts]) {
    blockNumbers.add(e.blockNumber);
  }

  const blockTimestamps = new Map<bigint, Date | null>();
  for (const bn of blockNumbers) {
    blockTimestamps.set(bn, await getBlockTimestamp(bn));
  }

  const result = await persistBatch(userOps, deploys, reverts, blockTimestamps);
  await setLastIndexedBlock(to);

  const total = result.newUserOps + result.newDeploys + result.newReverts;
  if (total > 0) {
    console.log(
      `[indexer] Blocks ${from}–${to}: ${result.newUserOps} UserOps, ${result.newDeploys} deploys, ${result.newReverts} reverts`,
    );
    onNewEvents();
  }
}

export async function startIndexer(onNewEvents: EventCallback): Promise<void> {
  const c = getClient();
  console.log("[indexer] Starting...");

  const lastIndexed = await getLastIndexedBlock();
  const latestBlock = await withRetry(() => c.getBlockNumber());
  console.log(
    `[indexer] Resuming from block ${lastIndexed}, chain head is ${latestBlock}`,
  );

  // Reorg check on last indexed block
  if (lastIndexed > 0n) {
    await handleReorg(lastIndexed);
  }

  // --- Backfill phase ---
  let cursor = (await getLastIndexedBlock()) + 1n;
  if (cursor <= latestBlock) {
    console.log(`[indexer] Backfilling ${cursor} → ${latestBlock}...`);
  }
  while (cursor <= latestBlock) {
    const batchEnd = cursor + BATCH_SIZE - 1n > latestBlock ? latestBlock : cursor + BATCH_SIZE - 1n;
    await indexRange(cursor, batchEnd, onNewEvents);
    cursor = batchEnd + 1n;
  }
  console.log("[indexer] Backfill complete. Switching to live polling...");

  // --- Live polling phase ---
  const poll = async () => {
    try {
      const head = await withRetry(() => c.getBlockNumber());
      const last = await getLastIndexedBlock();

      // Small reorg check: re-verify last block before advancing
      if (last > 0n) {
        await handleReorg(last);
      }

      const from = (await getLastIndexedBlock()) + 1n;
      if (from <= head) {
        let cur = from;
        while (cur <= head) {
          const batchEnd = cur + BATCH_SIZE - 1n > head ? head : cur + BATCH_SIZE - 1n;
          await indexRange(cur, batchEnd, onNewEvents);
          cur = batchEnd + 1n;
        }
      }
    } catch (err) {
      console.error("[indexer] Poll error:", err);
    }
  };

  setInterval(poll, POLL_INTERVAL_MS);
}
