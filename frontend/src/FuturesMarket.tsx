import { useState, useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import "./FuturesMarket.css";

type Market = "ETH/USDC" | "BTC/USDC" | "SOL/USDC";
type TradeSide = "long" | "short";

const BASE_PRICES: Record<Market, number> = {
  "ETH/USDC": 3245.5,
  "BTC/USDC": 67420.0,
  "SOL/USDC": 178.3,
};

const FUNDING_RATES: Record<Market, number> = {
  "ETH/USDC": 0.0023,
  "BTC/USDC": 0.0018,
  "SOL/USDC": -0.0012,
};

const VOLUMES_24H: Record<Market, number> = {
  "ETH/USDC": 1_234_567_890,
  "BTC/USDC": 4_820_000_000,
  "SOL/USDC": 287_000_000,
};

const OI: Record<Market, number> = {
  "ETH/USDC": 450_000_000,
  "BTC/USDC": 2_100_000_000,
  "SOL/USDC": 95_000_000,
};

const CHANGE_24H: Record<Market, number> = {
  "ETH/USDC": 2.31,
  "BTC/USDC": -1.04,
  "SOL/USDC": 4.87,
};

interface Position {
  id: number;
  market: Market;
  side: TradeSide;
  size: number;
  leverage: number;
  entryPrice: number;
  collateral: number;
}

interface RecentTrade {
  id: number;
  price: number;
  size: number;
  side: "buy" | "sell";
  ts: number;
}

interface OrderBookEntry {
  price: number;
  size: number;
}

function fmt(p: number, dec = 2): string {
  return p.toLocaleString("en-US", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

function generateOrderBook(
  mid: number,
  levels = 8
): { asks: OrderBookEntry[]; bids: OrderBookEntry[] } {
  const tick = mid < 10 ? 0.01 : mid < 1000 ? 0.1 : 1;
  const asks: OrderBookEntry[] = [];
  const bids: OrderBookEntry[] = [];
  for (let i = levels; i >= 1; i--) {
    asks.push({
      price: mid + tick * i,
      size: parseFloat((Math.random() * 4 + 0.1).toFixed(3)),
    });
  }
  for (let i = 1; i <= levels; i++) {
    bids.push({
      price: mid - tick * i,
      size: parseFloat((Math.random() * 4 + 0.1).toFixed(3)),
    });
  }
  return { asks, bids };
}

export default function FuturesMarket() {
  const { address } = useAccount();

  const [market, setMarket] = useState<Market>("ETH/USDC");
  const [price, setPrice] = useState(BASE_PRICES["ETH/USDC"]);
  const [prevPrice, setPrevPrice] = useState(BASE_PRICES["ETH/USDC"]);
  const [orderBook, setOrderBook] = useState(() =>
    generateOrderBook(BASE_PRICES["ETH/USDC"])
  );
  const [recentTrades, setRecentTrades] = useState<RecentTrade[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);

  const [side, setSide] = useState<TradeSide>("long");
  const [leverage, setLeverage] = useState(5);
  const [sizeInput, setSizeInput] = useState("");
  const [collateralInput, setCollateralInput] = useState("");
  const [orderStatus, setOrderStatus] = useState("");
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);

  const priceRef = useRef(BASE_PRICES["ETH/USDC"]);
  const nextId = useRef(1);
  const lastTradeTs = useRef(0);

  useEffect(() => {
    const base = BASE_PRICES[market];
    priceRef.current = base;
    lastTradeTs.current = 0;
    setPrice(base);
    setPrevPrice(base);
    setOrderBook(generateOrderBook(base));
    setRecentTrades([]);
  }, [market]);

  useEffect(() => {
    const interval = setInterval(() => {
      const delta = (Math.random() - 0.499) * BASE_PRICES[market] * 0.0008;
      const next = Math.max(priceRef.current + delta, BASE_PRICES[market] * 0.85);
      const prev = priceRef.current;
      priceRef.current = next;
      setPrice(next);
      setPrevPrice(prev);
      setOrderBook(generateOrderBook(next));

      const now = Date.now();
      if (now - lastTradeTs.current > 1200 + Math.random() * 800) {
        lastTradeTs.current = now;
        const trade: RecentTrade = {
          id: nextId.current++,
          price: next + (Math.random() - 0.5) * (BASE_PRICES[market] * 0.0003),
          size: parseFloat((Math.random() * 3 + 0.01).toFixed(4)),
          side: Math.random() > 0.5 ? "buy" : "sell",
          ts: now,
        };
        setRecentTrades((prev) => [trade, ...prev].slice(0, 25));
      }
    }, 800);
    return () => clearInterval(interval);
  }, [market]);

  const ticker = market.split("/")[0];
  const priceUp = price >= prevPrice;
  const notional = parseFloat(sizeInput || "0") * price;
  const col = parseFloat(collateralInput || "0");
  const effLeverage = col > 0 && notional > 0 ? notional / col : leverage;

  const liqPrice =
    parseFloat(sizeInput) > 0 && col > 0
      ? side === "long"
        ? price * (1 - col / notional + 0.05)
        : price * (1 + col / notional - 0.05)
      : null;

  const placeOrder = async () => {
    const size = parseFloat(sizeInput);
    const collateral = parseFloat(collateralInput);
    if (!size || !collateral || size <= 0 || collateral <= 0) {
      setOrderStatus("Please enter a valid size and collateral.");
      return;
    }
    if (!address) {
      setOrderStatus("Connect your wallet to trade.");
      return;
    }
    setIsPlacingOrder(true);
    setOrderStatus("Submitting order via smart account...");
    await new Promise((r) => setTimeout(r, 1200));
    setPositions((prev) => [
      ...prev,
      {
        id: nextId.current++,
        market,
        side,
        size,
        leverage: Math.round(effLeverage * 10) / 10,
        entryPrice: priceRef.current,
        collateral,
      },
    ]);
    setOrderStatus(
      `${side === "long" ? "Long" : "Short"} ${size} ${ticker} opened at $${fmt(priceRef.current)}`
    );
    setSizeInput("");
    setCollateralInput("");
    setIsPlacingOrder(false);
  };

  const closePosition = (id: number) => {
    setPositions((prev) => prev.filter((p) => p.id !== id));
  };

  const getPnl = (pos: Position) => {
    const delta = price - pos.entryPrice;
    return pos.side === "long" ? pos.size * delta : -pos.size * delta;
  };

  const maxAsk = Math.max(...orderBook.asks.map((a) => a.size), 0.001);
  const maxBid = Math.max(...orderBook.bids.map((b) => b.size), 0.001);

  return (
    <div className="futures-root">
      {/* ── Market header ── */}
      <div className="card futures-header">
        <div className="market-tabs">
          {(["ETH/USDC", "BTC/USDC", "SOL/USDC"] as Market[]).map((m) => (
            <button
              key={m}
              className={`market-tab ${market === m ? "market-tab-active" : ""}`}
              onClick={() => setMarket(m)}
            >
              {m}
            </button>
          ))}
        </div>
        <div className="market-stats-row">
          <div className="mkt-price-block">
            <span className={`mkt-price ${priceUp ? "f-green" : "f-red"}`}>
              ${fmt(price)}
            </span>
            <span className={`mkt-change ${CHANGE_24H[market] >= 0 ? "f-green" : "f-red"}`}>
              {CHANGE_24H[market] >= 0 ? "+" : ""}
              {CHANGE_24H[market].toFixed(2)}%
            </span>
          </div>
          <div className="mkt-stat">
            <span className="mkt-stat-label">24h Volume</span>
            <span className="mkt-stat-val">
              ${(VOLUMES_24H[market] / 1e9).toFixed(2)}B
            </span>
          </div>
          <div className="mkt-stat">
            <span className="mkt-stat-label">Open Interest</span>
            <span className="mkt-stat-val">
              ${(OI[market] / 1e6).toFixed(0)}M
            </span>
          </div>
          <div className="mkt-stat">
            <span className="mkt-stat-label">Funding (1h)</span>
            <span className={`mkt-stat-val ${FUNDING_RATES[market] >= 0 ? "f-green" : "f-red"}`}>
              {FUNDING_RATES[market] >= 0 ? "+" : ""}
              {FUNDING_RATES[market].toFixed(4)}%
            </span>
          </div>
        </div>
      </div>

      {/* ── Body: order book + trade panel + recent trades ── */}
      <div className="futures-body">
        {/* Order book */}
        <div className="card futures-ob">
          <h3 className="futures-panel-title">Order Book</h3>
          <div className="ob-col-headers">
            <span>Price (USDC)</span>
            <span>Size ({ticker})</span>
          </div>
          <div className="ob-asks">
            {orderBook.asks.map((row, i) => (
              <div key={i} className="ob-row">
                <div
                  className="ob-bar ob-ask-bar"
                  style={{ width: `${(row.size / maxAsk) * 100}%` }}
                />
                <span className="ob-price f-red">{fmt(row.price)}</span>
                <span className="ob-sz">{row.size.toFixed(3)}</span>
              </div>
            ))}
          </div>
          <div className="ob-mid">
            <span className={priceUp ? "f-green" : "f-red"}>
              {priceUp ? "▲" : "▼"} ${fmt(price)}
            </span>
          </div>
          <div className="ob-bids">
            {orderBook.bids.map((row, i) => (
              <div key={i} className="ob-row">
                <div
                  className="ob-bar ob-bid-bar"
                  style={{ width: `${(row.size / maxBid) * 100}%` }}
                />
                <span className="ob-price f-green">{fmt(row.price)}</span>
                <span className="ob-sz">{row.size.toFixed(3)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Trade panel */}
        <div className="card futures-trade">
          <div className="trade-side-row">
            <button
              className={`trade-side-btn ${side === "long" ? "side-long-active" : "side-inactive"}`}
              onClick={() => setSide("long")}
            >
              Long
            </button>
            <button
              className={`trade-side-btn ${side === "short" ? "side-short-active" : "side-inactive"}`}
              onClick={() => setSide("short")}
            >
              Short
            </button>
          </div>

          <div className="trade-field">
            <span className="label">Leverage</span>
            <div className="lv-row">
              {[1, 2, 3, 5, 10, 20].map((lv) => (
                <button
                  key={lv}
                  className={`lv-btn ${leverage === lv ? "lv-active" : ""}`}
                  onClick={() => setLeverage(lv)}
                >
                  {lv}x
                </button>
              ))}
            </div>
          </div>

          <div className="trade-field">
            <label className="label" htmlFor="fm-size">
              Size ({ticker})
            </label>
            <input
              id="fm-size"
              className="input trade-inp"
              type="number"
              placeholder="0.00"
              min="0"
              value={sizeInput}
              onChange={(e) => setSizeInput(e.target.value)}
            />
            {parseFloat(sizeInput) > 0 && (
              <span className="inp-hint">≈ ${fmt(parseFloat(sizeInput) * price)}</span>
            )}
          </div>

          <div className="trade-field">
            <label className="label" htmlFor="fm-col">
              Collateral (USDC)
            </label>
            <input
              id="fm-col"
              className="input trade-inp"
              type="number"
              placeholder="0.00"
              min="0"
              value={collateralInput}
              onChange={(e) => setCollateralInput(e.target.value)}
            />
          </div>

          {parseFloat(sizeInput) > 0 && parseFloat(collateralInput) > 0 && (
            <div className="order-summary">
              <div className="sum-row">
                <span>Entry Price</span>
                <span>${fmt(price)}</span>
              </div>
              <div className="sum-row">
                <span>Notional</span>
                <span>${fmt(notional)}</span>
              </div>
              <div className="sum-row">
                <span>Effective Leverage</span>
                <span>{effLeverage.toFixed(1)}x</span>
              </div>
              {liqPrice !== null && (
                <div className="sum-row">
                  <span>Liq. Price</span>
                  <span className="f-red">${fmt(liqPrice)}</span>
                </div>
              )}
              <div className="sum-row">
                <span>Fees (est. 0.06%)</span>
                <span>${fmt(notional * 0.0006)}</span>
              </div>
            </div>
          )}

          <button
            className={`trade-submit-btn ${side === "long" ? "btn-long" : "btn-short"}`}
            onClick={() => void placeOrder()}
            disabled={
              isPlacingOrder ||
              !parseFloat(sizeInput) ||
              !parseFloat(collateralInput)
            }
          >
            {isPlacingOrder
              ? "Placing order..."
              : `${side === "long" ? "Buy / Long" : "Sell / Short"} ${ticker}`}
          </button>

          {orderStatus && (
            <p className={`futures-status ${orderStatus.includes("opened") ? "status-ok" : ""}`}>
              {orderStatus}
            </p>
          )}
          {!address && (
            <p className="futures-status status-warn">
              Connect your wallet to trade.
            </p>
          )}
        </div>

        {/* Recent trades */}
        <div className="card futures-trades">
          <h3 className="futures-panel-title">Recent Trades</h3>
          <div className="rt-headers">
            <span>Price</span>
            <span>Size</span>
            <span>Time</span>
          </div>
          <div className="rt-list">
            {recentTrades.length === 0 && (
              <p className="muted" style={{ textAlign: "center", paddingTop: "1rem" }}>
                Waiting for trades…
              </p>
            )}
            {recentTrades.map((t) => (
              <div key={t.id} className="rt-row">
                <span className={t.side === "buy" ? "f-green" : "f-red"}>
                  {fmt(t.price)}
                </span>
                <span>{t.size.toFixed(4)}</span>
                <span className="rt-time">{new Date(t.ts).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Open positions ── */}
      <div className="card futures-positions">
        <h3 className="futures-panel-title">
          Open Positions
          {positions.length > 0 && (
            <span className="pos-count">{positions.length}</span>
          )}
        </h3>
        {positions.length === 0 ? (
          <p className="muted" style={{ textAlign: "center", padding: "1.5rem 0" }}>
            No open positions. Place an order above.
          </p>
        ) : (
          <div className="table-wrapper">
            <table className="events-table">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Side</th>
                  <th>Size</th>
                  <th>Leverage</th>
                  <th>Entry</th>
                  <th>Mark</th>
                  <th>Unrealised PnL</th>
                  <th>Collateral</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos) => {
                  const pnl = getPnl(pos);
                  const pnlPct = (pnl / pos.collateral) * 100;
                  return (
                    <tr key={pos.id}>
                      <td>{pos.market}</td>
                      <td>
                        <span className={`badge ${pos.side === "long" ? "badge-long" : "badge-short"}`}>
                          {pos.side.toUpperCase()}
                        </span>
                      </td>
                      <td>
                        {pos.size} {pos.market.split("/")[0]}
                      </td>
                      <td>{pos.leverage}x</td>
                      <td>${fmt(pos.entryPrice)}</td>
                      <td className={price >= pos.entryPrice ? "f-green" : "f-red"}>
                        ${fmt(price)}
                      </td>
                      <td className={pnl >= 0 ? "f-green" : "f-red"}>
                        {pnl >= 0 ? "+" : ""}
                        {fmt(pnl)} ({pnlPct >= 0 ? "+" : ""}
                        {pnlPct.toFixed(2)}%)
                      </td>
                      <td>{fmt(pos.collateral)} USDC</td>
                      <td>
                        <button
                          className="btn btn-secondary pos-close-btn"
                          onClick={() => closePosition(pos.id)}
                        >
                          Close
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
