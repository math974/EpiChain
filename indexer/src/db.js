import Database from "better-sqlite3";
import path from "path";

const DB_PATH = process.env.DB_PATH || "./epichain.db";

let db;

export function getDb() {
  if (!db) {
    db = new Database(path.resolve(DB_PATH));
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    _migrate(db);
  }
  return db;
}

function _migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_op_events (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      user_op_hash     TEXT    NOT NULL UNIQUE,
      sender           TEXT    NOT NULL,
      paymaster        TEXT    NOT NULL DEFAULT '0x0000000000000000000000000000000000000000',
      nonce            TEXT    NOT NULL,
      success          INTEGER NOT NULL,
      actual_gas_cost  TEXT    NOT NULL,
      actual_gas_used  TEXT    NOT NULL,
      block_number     INTEGER NOT NULL,
      block_timestamp  INTEGER,
      tx_hash          TEXT,
      created_at       INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS account_deployed_events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_op_hash  TEXT NOT NULL UNIQUE,
      sender        TEXT NOT NULL,
      factory       TEXT NOT NULL,
      paymaster     TEXT NOT NULL DEFAULT '0x0000000000000000000000000000000000000000',
      block_number  INTEGER NOT NULL,
      tx_hash       TEXT,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS revert_reason_events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_op_hash  TEXT NOT NULL UNIQUE,
      sender        TEXT NOT NULL,
      nonce         TEXT NOT NULL,
      revert_reason TEXT NOT NULL,
      block_number  INTEGER NOT NULL,
      tx_hash       TEXT,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS indexer_state (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}
