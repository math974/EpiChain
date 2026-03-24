import { useIndexerFeed } from "../hooks/useIndexerFeed.js";

const ZERO_PAYMASTER = "0x0000000000000000000000000000000000000000";
const ETHERSCAN_BASE = "https://etherscan.io";

function shortHash(hash) {
  if (!hash) return "—";
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

function formatTimestamp(ts) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString();
}

export default function IndexerPage() {
  const { events, stats, loading, error, wsStatus } = useIndexerFeed();

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.4rem", fontWeight: 700 }}>
          ERC-4337 Live Feed
        </h1>
        <span>
          <span
            className="live-dot"
            style={{ background: wsStatus === "open" ? "#48bb78" : "#e53e3e" }}
          />
          {wsStatus === "open" ? "Live" : wsStatus === "connecting" ? "Connecting…" : "Disconnected"}
        </span>
      </div>

      {/* Stats panel */}
      {stats && (
        <div className="stats-grid">
          <div className="stat-box">
            <div className="value">{stats.total_user_ops}</div>
            <div className="label">Total UserOps</div>
          </div>
          <div className="stat-box">
            <div className="value">{stats.success_rate}%</div>
            <div className="label">Success Rate</div>
          </div>
          <div className="stat-box">
            <div className="value">{stats.sponsored_pct}%</div>
            <div className="label">Sponsored</div>
          </div>
          <div className="stat-box">
            <div className="value">{stats.successes}</div>
            <div className="label">Successes</div>
          </div>
          <div className="stat-box">
            <div className="value">{stats.failures}</div>
            <div className="label">Failures</div>
          </div>
        </div>
      )}

      {error && (
        <div className="msg-error">
          ⚠ Could not connect to indexer API: {error}
          <br />
          <small>Make sure the indexer is running at the configured URL.</small>
        </div>
      )}

      {loading && !error && (
        <div className="msg-info">Loading events…</div>
      )}

      {!loading && events.length === 0 && !error && (
        <div className="msg-info">
          No UserOperationEvents indexed yet. Waiting for new events…
        </div>
      )}

      {events.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>UserOpHash</th>
                  <th>Sender</th>
                  <th>Status</th>
                  <th>Gas Cost (ETH)</th>
                  <th>Gas Used</th>
                  <th>Paymaster</th>
                  <th>Block</th>
                  <th>Time</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => {
                  const isSponsored =
                    ev.paymaster &&
                    ev.paymaster.toLowerCase() !== ZERO_PAYMASTER;

                  return (
                    <tr key={ev.user_op_hash}>
                      <td className="mono" title={ev.user_op_hash}>
                        {shortHash(ev.user_op_hash)}
                      </td>
                      <td className="mono" title={ev.sender}>
                        {shortHash(ev.sender)}
                      </td>
                      <td>
                        {ev.success ? (
                          <span className="badge badge-success">✓ OK</span>
                        ) : (
                          <span className="badge badge-fail">✗ Fail</span>
                        )}
                      </td>
                      <td>{Number(ev.actual_gas_cost_eth).toFixed(6)}</td>
                      <td>{Number(ev.actual_gas_used).toLocaleString()}</td>
                      <td>
                        {isSponsored ? (
                          <span className="badge badge-sponsored" title={ev.paymaster}>
                            Sponsored
                          </span>
                        ) : (
                          <span style={{ color: "#4a5568" }}>—</span>
                        )}
                      </td>
                      <td>{ev.block_number?.toLocaleString()}</td>
                      <td style={{ fontSize: "0.75rem" }}>
                        {formatTimestamp(ev.block_timestamp)}
                      </td>
                      <td>
                        {ev.tx_hash && (
                          <a
                            href={`${ETHERSCAN_BASE}/tx/${ev.tx_hash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="View on Etherscan"
                          >
                            ↗
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
