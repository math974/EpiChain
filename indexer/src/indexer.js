/**
 * EVM Indexer for ERC-4337 EntryPoint v0.7 events.
 *
 * Strategy:
 *   - On startup, perform a historical backfill from START_BLOCK to the
 *     current chain head using getLogs() in batches of BATCH_SIZE blocks.
 *   - After backfill, switch to real-time polling (every POLL_INTERVAL ms)
 *     using getLogs() from the last indexed block + 1 to "latest".
 *
 * Why polling instead of WebSocket subscriptions?
 *   Polling is more robust against connection drops, rate-limit disconnects,
 *   and provider restarts.  It also handles reorgs naturally — if a block is
 *   replaced we simply re-query the affected range and upsert rows.
 *
 * Reorg handling:
 *   We store logs at block_number granularity.  During each poll cycle we
 *   re-process the last REORG_DEPTH blocks so that any shallow reorg (< 6
 *   blocks deep) automatically overwrites stale rows via the UNIQUE constraint
 *   on user_op_hash.
 */

import { createPublicClient, http, formatEther } from "viem";
import { mainnet } from "viem/chains";
import { getDb } from "./db.js";
import { ENTRY_POINT_ABI, ENTRY_POINT_ADDRESS } from "./abi.js";

// -------------------------------------------------------------------------
// Configuration
// -------------------------------------------------------------------------

const RPC_URL = process.env.RPC_URL;
const START_BLOCK = BigInt(process.env.START_BLOCK ?? "0");
const BATCH_SIZE = 2000n;          // blocks per getLogs request
const POLL_INTERVAL = 12_000;      // ms between poll cycles (~1 Ethereum block)
const REORG_DEPTH = 6n;            // re-process last N blocks on every poll

// -------------------------------------------------------------------------
// viem client
// -------------------------------------------------------------------------

const client = createPublicClient({
  chain: mainnet,
  transport: http(RPC_URL, {
    retryCount: 5,
    retryDelay: 1500,
    timeout: 30_000,
  }),
});

// -------------------------------------------------------------------------
// Broadcast helper (shared with WebSocket server in index.js)
// -------------------------------------------------------------------------

let _broadcast = (_event) => {};

export function setBroadcast(fn) {
  _broadcast = fn;
}

// -------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------

export async function startIndexer() {
  console.log("[indexer] Starting ERC-4337 indexer…");
  console.log("[indexer] EntryPoint:", ENTRY_POINT_ADDRESS);
  console.log("[indexer] RPC:", RPC_URL);

  const db = getDb();

  // Load or initialise last indexed block.
  const storedBlock = db
    .prepare("SELECT value FROM indexer_state WHERE key = 'last_block'")
    .get();

  let lastBlock = storedBlock
    ? BigInt(storedBlock.value)
    : START_BLOCK > 0n
    ? START_BLOCK - 1n
    : 0n;

  console.log("[indexer] Starting from block:", lastBlock.toString());

  // ---------- Historical backfill ----------
  if (START_BLOCK > 0n && lastBlock < START_BLOCK) {
    lastBlock = START_BLOCK - 1n;
  }

  const currentBlock = await client.getBlockNumber();
  if (lastBlock < currentBlock) {
    console.log(
      `[indexer] Backfilling blocks ${lastBlock + 1n} → ${currentBlock}…`
    );
    await _processRange(lastBlock + 1n, currentBlock, db);
    lastBlock = currentBlock;
    _saveLastBlock(db, lastBlock);
  }

  // ---------- Real-time polling ----------
  console.log("[indexer] Backfill complete. Starting real-time polling…");
  _poll(lastBlock, db);
}

// -------------------------------------------------------------------------
// Internals
// -------------------------------------------------------------------------

async function _poll(lastBlock, db) {
  try {
    const current = await client.getBlockNumber();
    if (current > lastBlock) {
      // Re-process last REORG_DEPTH blocks to handle shallow reorgs.
      const reorgStart = lastBlock >= REORG_DEPTH ? lastBlock - REORG_DEPTH + 1n : 1n;
      const from = reorgStart > lastBlock ? lastBlock + 1n : reorgStart;

      await _processRange(from, current, db);
      lastBlock = current;
      _saveLastBlock(db, lastBlock);
    }
  } catch (err) {
    console.error("[indexer] Poll error:", err.message);
  } finally {
    setTimeout(() => _poll(lastBlock, db), POLL_INTERVAL);
  }
}

async function _processRange(fromBlock, toBlock, db) {
  for (let start = fromBlock; start <= toBlock; start += BATCH_SIZE) {
    const end = start + BATCH_SIZE - 1n < toBlock ? start + BATCH_SIZE - 1n : toBlock;
    try {
      await _fetchAndStoreLogs(start, end, db);
    } catch (err) {
      console.error(
        `[indexer] Error fetching logs ${start}–${end}: ${err.message}`
      );
      // Continue with next batch rather than crashing.
    }
  }
}

async function _fetchAndStoreLogs(fromBlock, toBlock, db) {
  const logs = await client.getLogs({
    address: ENTRY_POINT_ADDRESS,
    fromBlock,
    toBlock,
  });

  if (logs.length === 0) return;

  // Fetch block timestamps in bulk (deduplicate block numbers first).
  const blockNumbers = [...new Set(logs.map((l) => l.blockNumber))];
  const timestamps = {};
  await Promise.all(
    blockNumbers.map(async (bn) => {
      try {
        const block = await client.getBlock({ blockNumber: bn });
        timestamps[bn.toString()] = Number(block.timestamp);
      } catch {
        timestamps[bn.toString()] = null;
      }
    })
  );

  for (const log of logs) {
    try {
      _storeLog(log, timestamps[log.blockNumber.toString()], db);
    } catch (err) {
      console.error("[indexer] Store error:", err.message);
    }
  }

  console.log(
    `[indexer] Processed ${logs.length} logs in blocks ${fromBlock}–${toBlock}`
  );
}

function _storeLog(log, blockTimestamp, db) {
  const { eventName, args } = _decodeLog(log);
  if (!eventName) return;

  if (eventName === "UserOperationEvent") {
    const row = {
      user_op_hash: args.userOpHash,
      sender: args.sender,
      paymaster: args.paymaster,
      nonce: args.nonce.toString(),
      success: args.success ? 1 : 0,
      actual_gas_cost: args.actualGasCost.toString(),
      actual_gas_used: args.actualGasUsed.toString(),
      block_number: Number(log.blockNumber),
      block_timestamp: blockTimestamp,
      tx_hash: log.transactionHash,
    };

    db.prepare(`
      INSERT OR REPLACE INTO user_op_events
        (user_op_hash, sender, paymaster, nonce, success, actual_gas_cost,
         actual_gas_used, block_number, block_timestamp, tx_hash)
      VALUES
        (@user_op_hash, @sender, @paymaster, @nonce, @success, @actual_gas_cost,
         @actual_gas_used, @block_number, @block_timestamp, @tx_hash)
    `).run(row);

    _broadcast({ type: "UserOperationEvent", data: _formatUserOpEvent(row) });

  } else if (eventName === "AccountDeployed") {
    const row = {
      user_op_hash: args.userOpHash,
      sender: args.sender,
      factory: args.factory,
      paymaster: args.paymaster,
      block_number: Number(log.blockNumber),
      tx_hash: log.transactionHash,
    };

    db.prepare(`
      INSERT OR REPLACE INTO account_deployed_events
        (user_op_hash, sender, factory, paymaster, block_number, tx_hash)
      VALUES
        (@user_op_hash, @sender, @factory, @paymaster, @block_number, @tx_hash)
    `).run(row);

    _broadcast({ type: "AccountDeployed", data: row });

  } else if (eventName === "UserOperationRevertReason") {
    const row = {
      user_op_hash: args.userOpHash,
      sender: args.sender,
      nonce: args.nonce.toString(),
      revert_reason: args.revertReason,
      block_number: Number(log.blockNumber),
      tx_hash: log.transactionHash,
    };

    db.prepare(`
      INSERT OR REPLACE INTO revert_reason_events
        (user_op_hash, sender, nonce, revert_reason, block_number, tx_hash)
      VALUES
        (@user_op_hash, @sender, @nonce, @revert_reason, @block_number, @tx_hash)
    `).run(row);

    _broadcast({ type: "UserOperationRevertReason", data: row });
  }
}

// -------------------------------------------------------------------------
// Log decoding  (manual — avoids a full viem decodeEventLog import cycle)
// -------------------------------------------------------------------------

import { decodeEventLog } from "viem";

function _decodeLog(log) {
  for (const abiItem of ENTRY_POINT_ABI) {
    try {
      const decoded = decodeEventLog({
        abi: [abiItem],
        data: log.data,
        topics: log.topics,
      });
      return { eventName: decoded.eventName, args: decoded.args };
    } catch {
      // not this event type
    }
  }
  return { eventName: null, args: null };
}

function _formatUserOpEvent(row) {
  return {
    ...row,
    actual_gas_cost_eth: formatEther(BigInt(row.actual_gas_cost)),
  };
}

function _saveLastBlock(db, block) {
  db.prepare(
    "INSERT OR REPLACE INTO indexer_state (key, value) VALUES ('last_block', ?)"
  ).run(block.toString());
}
