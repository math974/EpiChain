import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import { prisma } from "./prisma.js";

let wss: WebSocketServer;

export function setupWebSocket(server: Server): void {
  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", async (socket) => {
    console.log("[ws] Client connected");

    // Send last 20 events as initial payload
    try {
      const recent = await prisma.userOperationEvent.findMany({
        orderBy: { blockNumber: "desc" },
        take: 20,
      });
      socket.send(
        JSON.stringify({
          type: "initial",
          events: recent.map((e) => ({
            ...e,
            blockNumber: e.blockNumber.toString(),
          })),
        }),
      );
    } catch (err) {
      console.error("[ws] Error sending initial data:", err);
    }

    socket.on("close", () => {
      console.log("[ws] Client disconnected");
    });
  });
}

/**
 * Broadcast new events to all connected WS clients.
 * Called by the indexer whenever new events are persisted.
 */
export async function broadcastNewEvents(): Promise<void> {
  if (!wss || wss.clients.size === 0) return;

  try {
    const latest = await prisma.userOperationEvent.findMany({
      orderBy: { blockNumber: "desc" },
      take: 10,
    });

    const stats = await getQuickStats();

    const message = JSON.stringify({
      type: "update",
      events: latest.map((e) => ({
        ...e,
        blockNumber: e.blockNumber.toString(),
      })),
      stats,
    });

    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  } catch (err) {
    console.error("[ws] Broadcast error:", err);
  }
}

async function getQuickStats() {
  const [total, successful, sponsored] = await Promise.all([
    prisma.userOperationEvent.count(),
    prisma.userOperationEvent.count({ where: { success: true } }),
    prisma.userOperationEvent.count({
      where: {
        paymaster: { not: "0x0000000000000000000000000000000000000000" },
      },
    }),
  ]);

  return {
    totalUserOps: total,
    successRate: total > 0 ? ((successful / total) * 100).toFixed(2) : "0.00",
    sponsorshipRate: total > 0 ? ((sponsored / total) * 100).toFixed(2) : "0.00",
  };
}
