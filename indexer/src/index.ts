import "dotenv/config";
import express from "express";

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT) || 4000;

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "epichain-indexer" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Indexer API listening on 0.0.0.0:${PORT} (e.g. http://localhost:${PORT} from host)`);
});
