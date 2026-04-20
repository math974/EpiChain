import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { router as apiRouter } from "./api.js";
import { setupWebSocket, broadcastNewEvents } from "./ws.js";
import { startIndexer } from "./indexer.js";

const app = express();
app.use(express.json());

// CORS for frontend dev server
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "epichain-indexer" });
});

app.use("/api", apiRouter);

const PORT = Number(process.env.PORT) || 4000;
const server = createServer(app);

setupWebSocket(server);

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Indexer API listening on 0.0.0.0:${PORT} (e.g. http://localhost:${PORT} from host)`,
  );
  console.log(`WebSocket available at ws://localhost:${PORT}/ws`);

  startIndexer(() => {
    broadcastNewEvents().catch((err) =>
      console.error("[main] broadcast error:", err),
    );
  }).catch((err) => {
    console.error("[main] Indexer fatal error:", err);
    process.exit(1);
  });
});
