/**
 * EpiChain Indexer — Express REST + WebSocket server
 *
 * Endpoints:
 *   GET  /api/events              → paginated UserOperationEvent list
 *   GET  /api/events/:userOpHash  → single event by hash
 *   GET  /api/stats               → aggregated stats
 *   GET  /api/deployed            → AccountDeployed events
 *   GET  /api/reverts             → UserOperationRevertReason events
 *   GET  /health                  → liveness check
 *
 * WebSocket:
 *   ws://host/ws  → receives JSON messages for every new indexed event
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { WebSocketServer } from "ws";
import { createServer } from "http";
import { getDb } from "./db.js";
import { startIndexer, setBroadcast } from "./indexer.js";
import { formatEther } from "viem";

const PORT = parseInt(process.env.PORT ?? "3001", 10);

// -------------------------------------------------------------------------
// Express app
// -------------------------------------------------------------------------

const app = express();
app.use(cors());
app.use(express.json());

// Apply rate limiting to all API routes (100 requests per minute per IP).
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — please slow down." },
});
app.use("/api", apiLimiter);

// --- Health ---
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

// --- UserOperationEvents ---
app.get("/api/events", (req, res) => {
  const db = getDb();
  const limit = Math.min(parseInt(req.query.limit ?? "50", 10), 200);
  const offset = parseInt(req.query.offset ?? "0", 10);

  const rows = db
    .prepare(
      `SELECT * FROM user_op_events
       ORDER BY block_number DESC, id DESC
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset);

  const total = db
    .prepare("SELECT COUNT(*) as count FROM user_op_events")
    .get().count;

  res.json({
    data: rows.map(_enrichUserOpRow),
    total,
    limit,
    offset,
  });
});

app.get("/api/events/:userOpHash", (req, res) => {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM user_op_events WHERE user_op_hash = ?")
    .get(req.params.userOpHash);

  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(_enrichUserOpRow(row));
});

// --- Stats ---
app.get("/api/stats", (_req, res) => {
  const db = getDb();

  const total = db
    .prepare("SELECT COUNT(*) as count FROM user_op_events")
    .get().count;

  const successes = db
    .prepare("SELECT COUNT(*) as count FROM user_op_events WHERE success = 1")
    .get().count;

  const sponsored = db
    .prepare(
      `SELECT COUNT(*) as count FROM user_op_events
       WHERE paymaster != '0x0000000000000000000000000000000000000000'`
    )
    .get().count;

  res.json({
    total_user_ops: total,
    success_rate: total > 0 ? ((successes / total) * 100).toFixed(2) : "0.00",
    sponsored_pct: total > 0 ? ((sponsored / total) * 100).toFixed(2) : "0.00",
    successes,
    failures: total - successes,
    sponsored,
  });
});

// --- AccountDeployed ---
app.get("/api/deployed", (req, res) => {
  const db = getDb();
  const limit = Math.min(parseInt(req.query.limit ?? "50", 10), 200);
  const offset = parseInt(req.query.offset ?? "0", 10);

  const rows = db
    .prepare(
      `SELECT * FROM account_deployed_events
       ORDER BY block_number DESC LIMIT ? OFFSET ?`
    )
    .all(limit, offset);

  const total = db
    .prepare("SELECT COUNT(*) as count FROM account_deployed_events")
    .get().count;

  res.json({ data: rows, total, limit, offset });
});

// --- Reverts ---
app.get("/api/reverts", (req, res) => {
  const db = getDb();
  const limit = Math.min(parseInt(req.query.limit ?? "50", 10), 200);
  const offset = parseInt(req.query.offset ?? "0", 10);

  const rows = db
    .prepare(
      `SELECT * FROM revert_reason_events
       ORDER BY block_number DESC LIMIT ? OFFSET ?`
    )
    .all(limit, offset);

  const total = db
    .prepare("SELECT COUNT(*) as count FROM revert_reason_events")
    .get().count;

  res.json({ data: rows, total, limit, offset });
});

// -------------------------------------------------------------------------
// HTTP server + WebSocket
// -------------------------------------------------------------------------

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const clients = new Set();

wss.on("connection", (ws) => {
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));
  ws.on("error", () => clients.delete(ws));

  // Send a welcome message so the client knows the connection is live.
  ws.send(JSON.stringify({ type: "connected", timestamp: Date.now() }));
});

// Wire up the indexer broadcast to WebSocket clients.
setBroadcast((event) => {
  const payload = JSON.stringify(event);
  for (const ws of clients) {
    try {
      if (ws.readyState === ws.OPEN) {
        ws.send(payload);
      }
    } catch {
      clients.delete(ws);
    }
  }
});

// -------------------------------------------------------------------------
// Start
// -------------------------------------------------------------------------

server.listen(PORT, () => {
  console.log(`[server] EpiChain indexer API listening on http://localhost:${PORT}`);
  console.log(`[server] WebSocket endpoint: ws://localhost:${PORT}/ws`);
  startIndexer().catch((err) => {
    console.error("[indexer] Fatal error:", err);
    process.exit(1);
  });
});

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

function _enrichUserOpRow(row) {
  return {
    ...row,
    actual_gas_cost_eth: formatEther(BigInt(row.actual_gas_cost)),
    success: row.success === 1,
  };
}
