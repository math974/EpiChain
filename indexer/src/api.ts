import { Router } from "express";
import { prisma } from "./prisma.js";

export const router = Router();

/**
 * GET /api/events
 * Returns recent UserOperationEvents, newest first.
 * Query params: ?limit=50&offset=0&sender=0x...
 */
router.get("/events", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const sender = typeof req.query.sender === "string" ? req.query.sender : undefined;

    const where = sender ? { sender: { equals: sender, mode: "insensitive" as const } } : {};

    const [events, total] = await Promise.all([
      prisma.userOperationEvent.findMany({
        where,
        orderBy: { blockNumber: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.userOperationEvent.count({ where }),
    ]);

    res.json({
      events: events.map((e) => ({
        ...e,
        blockNumber: e.blockNumber.toString(),
      })),
      total,
      limit,
      offset,
    });
  } catch (err) {
    console.error("[api] /events error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/events/:hash
 * Get a single event by userOpHash.
 */
router.get("/events/:hash", async (req, res) => {
  try {
    const event = await prisma.userOperationEvent.findFirst({
      where: { userOpHash: req.params.hash },
    });
    if (!event) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ ...event, blockNumber: event.blockNumber.toString() });
  } catch (err) {
    console.error("[api] /events/:hash error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/deploys
 * Returns recent AccountDeployed events.
 */
router.get("/deploys", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;

    const [events, total] = await Promise.all([
      prisma.accountDeployed.findMany({
        orderBy: { blockNumber: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.accountDeployed.count(),
    ]);

    res.json({
      events: events.map((e) => ({
        ...e,
        blockNumber: e.blockNumber.toString(),
      })),
      total,
      limit,
      offset,
    });
  } catch (err) {
    console.error("[api] /deploys error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/reverts
 * Returns recent UserOperationRevertReason events.
 */
router.get("/reverts", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;

    const [events, total] = await Promise.all([
      prisma.userOperationRevertReason.findMany({
        orderBy: { blockNumber: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.userOperationRevertReason.count(),
    ]);

    res.json({
      events: events.map((e) => ({
        ...e,
        blockNumber: e.blockNumber.toString(),
      })),
      total,
      limit,
      offset,
    });
  } catch (err) {
    console.error("[api] /reverts error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/stats
 * Aggregate stats: total ops, success rate, paymaster sponsorship rate.
 */
router.get("/stats", async (_req, res) => {
  try {
    const [total, successful, sponsored, totalDeploys, totalReverts, lastIndexed] =
      await Promise.all([
        prisma.userOperationEvent.count(),
        prisma.userOperationEvent.count({ where: { success: true } }),
        prisma.userOperationEvent.count({
          where: {
            paymaster: { not: "0x0000000000000000000000000000000000000000" },
          },
        }),
        prisma.accountDeployed.count(),
        prisma.userOperationRevertReason.count(),
        prisma.indexerState.findUnique({ where: { id: "singleton" } }),
      ]);

    res.json({
      totalUserOps: total,
      successfulUserOps: successful,
      failedUserOps: total - successful,
      successRate: total > 0 ? ((successful / total) * 100).toFixed(2) : "0.00",
      sponsoredUserOps: sponsored,
      sponsorshipRate: total > 0 ? ((sponsored / total) * 100).toFixed(2) : "0.00",
      totalAccountsDeployed: totalDeploys,
      totalReverts,
      lastIndexedBlock: lastIndexed?.lastIndexedBlock?.toString() ?? "0",
    });
  } catch (err) {
    console.error("[api] /stats error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
