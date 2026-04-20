import { useEffect, useRef, useState, useCallback } from "react";
import { formatEther } from "viem";

interface UserOpEvent {
  id: string;
  userOpHash: string;
  sender: string;
  paymaster: string;
  nonce: string;
  success: boolean;
  actualGasCost: string;
  actualGasUsed: string;
  blockNumber: string;
  blockHash: string;
  txHash: string;
  logIndex: number;
  blockTimestamp: string | null;
}

interface Stats {
  totalUserOps: number;
  successfulUserOps: number;
  failedUserOps: number;
  successRate: string;
  sponsoredUserOps: number;
  sponsorshipRate: string;
  totalAccountsDeployed: number;
  totalReverts: number;
  lastIndexedBlock: string;
}

const INDEXER_URL =
  import.meta.env.VITE_INDEXER_URL ?? "http://localhost:4000";
const WS_URL =
  import.meta.env.VITE_INDEXER_WS_URL ??
  INDEXER_URL.replace(/^http/, "ws") + "/ws";

const ETHERSCAN_TX = "https://etherscan.io/tx/";
const ETHERSCAN_ADDR = "https://etherscan.io/address/";

function truncate(hash: string, chars = 8): string {
  if (hash.length <= chars * 2 + 2) return hash;
  return `${hash.slice(0, chars + 2)}…${hash.slice(-chars)}`;
}

function formatGas(wei: string): string {
  try {
    return `${formatEther(BigInt(wei))} ETH`;
  } catch {
    return wei;
  }
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export default function IndexerFeed() {
  const [events, setEvents] = useState<UserOpEvent[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [senderFilter, setSenderFilter] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const PAGE_SIZE = 25;

  const fetchEvents = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (senderFilter) params.set("sender", senderFilter);
      const res = await fetch(`${INDEXER_URL}/api/events?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setEvents(data.events);
      setTotal(data.total);
      setError("");
    } catch (err) {
      setError(
        `Failed to fetch events: ${err instanceof Error ? err.message : "unknown"}`,
      );
    }
  }, [page, senderFilter]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${INDEXER_URL}/api/stats`);
      if (!res.ok) return;
      setStats(await res.json());
    } catch {
      /* stats are optional */
    }
  }, []);

  // Initial REST fetch + periodic refresh
  useEffect(() => {
    fetchEvents();
    fetchStats();
    const interval = setInterval(() => {
      fetchEvents();
      fetchStats();
    }, 15_000);
    return () => clearInterval(interval);
  }, [fetchEvents, fetchStats]);

  // WebSocket live feed
  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      try {
        ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => setConnected(true);
        ws.onclose = () => {
          setConnected(false);
          reconnectTimer = setTimeout(connect, 5_000);
        };
        ws.onerror = () => ws.close();
        ws.onmessage = (msg) => {
          try {
            const data = JSON.parse(msg.data);
            if (data.type === "initial" || data.type === "update") {
              if (page === 0 && !senderFilter) {
                setEvents((prev) => {
                  const merged = [...data.events];
                  const ids = new Set(merged.map((e: UserOpEvent) => e.id));
                  for (const e of prev) {
                    if (!ids.has(e.id)) merged.push(e);
                  }
                  return merged.slice(0, PAGE_SIZE);
                });
              }
              if (data.stats) {
                setStats((prev) => ({ ...prev, ...data.stats }));
              }
              fetchStats();
            }
          } catch {
            /* ignore malformed messages */
          }
        };
      } catch {
        reconnectTimer = setTimeout(connect, 5_000);
      }
    }

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [page, senderFilter, fetchStats]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="indexer-feed">
      {/* Stats panel */}
      <section className="card stats-panel">
        <h2>ERC-4337 Indexer Stats</h2>
        <div className="stats-grid">
          <div className="stat-item">
            <span className="stat-value">{stats?.totalUserOps ?? "—"}</span>
            <span className="stat-label">Total UserOps</span>
          </div>
          <div className="stat-item">
            <span className="stat-value success">
              {stats?.successRate ?? "—"}%
            </span>
            <span className="stat-label">Success Rate</span>
          </div>
          <div className="stat-item">
            <span className="stat-value sponsored">
              {stats?.sponsorshipRate ?? "—"}%
            </span>
            <span className="stat-label">Sponsored (Paymaster)</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{stats?.totalAccountsDeployed ?? "—"}</span>
            <span className="stat-label">Accounts Deployed</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{stats?.totalReverts ?? "—"}</span>
            <span className="stat-label">Reverts</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{stats?.lastIndexedBlock ?? "—"}</span>
            <span className="stat-label">Last Block</span>
          </div>
        </div>
        <div className="connection-status">
          <span className={`dot ${connected ? "green" : "red"}`} />
          {connected ? "Live (WebSocket)" : "Disconnected — polling every 15s"}
        </div>
      </section>

      {/* Filter */}
      <section className="card">
        <div className="filter-row">
          <label htmlFor="senderFilter">Filter by sender:</label>
          <input
            id="senderFilter"
            className="input"
            placeholder="0x..."
            value={senderFilter}
            onChange={(e) => {
              setSenderFilter(e.target.value);
              setPage(0);
            }}
          />
          {senderFilter && (
            <button
              className="btn btn-secondary"
              onClick={() => {
                setSenderFilter("");
                setPage(0);
              }}
            >
              Clear
            </button>
          )}
        </div>
      </section>

      {/* Events table */}
      <section className="card">
        <h2>UserOperation Events</h2>
        {error && <p className="error-text">{error}</p>}
        <div className="table-wrapper">
          <table className="events-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>UserOp Hash</th>
                <th>Sender</th>
                <th>Paymaster</th>
                <th>Gas Cost</th>
                <th>Block</th>
                <th>Time</th>
                <th>Tx</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty-row">
                    {error ? "Error loading events" : "No events indexed yet. Waiting for data..."}
                  </td>
                </tr>
              ) : (
                events.map((ev) => {
                  const isSponsored =
                    ev.paymaster !== "0x0000000000000000000000000000000000000000";
                  return (
                    <tr key={ev.id} className={ev.success ? "" : "row-failed"}>
                      <td>
                        <span className={`badge ${ev.success ? "badge-success" : "badge-fail"}`}>
                          {ev.success ? "OK" : "FAIL"}
                        </span>
                      </td>
                      <td className="mono">{truncate(ev.userOpHash)}</td>
                      <td className="mono">
                        <a
                          href={`${ETHERSCAN_ADDR}${ev.sender}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {truncate(ev.sender, 6)}
                        </a>
                      </td>
                      <td className="mono">
                        {isSponsored ? (
                          <a
                            href={`${ETHERSCAN_ADDR}${ev.paymaster}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="sponsored-link"
                          >
                            {truncate(ev.paymaster, 6)}
                          </a>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="mono">{formatGas(ev.actualGasCost)}</td>
                      <td>{ev.blockNumber}</td>
                      <td>{timeAgo(ev.blockTimestamp)}</td>
                      <td>
                        <a
                          href={`${ETHERSCAN_TX}${ev.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={ev.txHash}
                        >
                          View
                        </a>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="pagination">
            <button
              className="btn btn-secondary"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <span>
              Page {page + 1} / {totalPages} ({total} total)
            </span>
            <button
              className="btn btn-secondary"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
