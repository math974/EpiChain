import { useState, useEffect, useRef, useCallback } from "react";
import { INDEXER_WS, INDEXER_URL } from "../config.js";

/**
 * useIndexerFeed — fetches existing events from the REST API and subscribes
 * to the WebSocket for real-time updates.
 *
 * Returns:
 *   events   — array of UserOperationEvent rows (newest first)
 *   stats    — aggregated stats object
 *   loading  — true while the initial fetch is in progress
 *   error    — error string or null
 *   wsStatus — "connecting" | "open" | "closed"
 */
export function useIndexerFeed() {
  const [events, setEvents] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [wsStatus, setWsStatus] = useState("connecting");

  const wsRef = useRef(null);

  // Fetch initial data from REST API.
  const fetchData = useCallback(async () => {
    try {
      const [eventsRes, statsRes] = await Promise.all([
        fetch(`${INDEXER_URL}/api/events?limit=100`),
        fetch(`${INDEXER_URL}/api/stats`),
      ]);

      if (!eventsRes.ok || !statsRes.ok) {
        throw new Error("Failed to fetch from indexer API");
      }

      const eventsJson = await eventsRes.json();
      const statsJson = await statsRes.json();

      setEvents(eventsJson.data ?? []);
      setStats(statsJson);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // WebSocket subscription for real-time updates.
  useEffect(() => {
    let ws;
    let reconnectTimer;

    function connect() {
      ws = new WebSocket(INDEXER_WS);
      wsRef.current = ws;
      setWsStatus("connecting");

      ws.onopen = () => setWsStatus("open");

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === "UserOperationEvent") {
            setEvents((prev) => [msg.data, ...prev]);
            // Refresh stats after each new event.
            fetch(`${INDEXER_URL}/api/stats`)
              .then((r) => r.json())
              .then(setStats)
              .catch(() => {});
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        setWsStatus("closed");
        // Reconnect after 5 s.
        reconnectTimer = setTimeout(connect, 5000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, []);

  return { events, stats, loading, error, wsStatus };
}
