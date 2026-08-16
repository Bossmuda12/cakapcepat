import { useEffect, useRef } from "react";
import { getToken } from "./api";

/**
 * Hook WebSocket sederhana untuk update real-time dashboard. Alih-alih
 * mem-patch state secara manual per event (rawan meleset dari bentuk data
 * asli), setiap event yang masuk cuma memicu onEvent() — dipakai pemanggil
 * untuk refetch data terkini. Auto-reconnect kalau koneksi putus.
 */
export function useRealtime(onEvent) {
  const cbRef = useRef(onEvent);
  cbRef.current = onEvent;

  useEffect(() => {
    const token = getToken();
    if (!token) return undefined;

    let ws;
    let retryTimer;
    let stopped = false;

    function connect() {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${window.location.host}/ws?token=${encodeURIComponent(token)}`);
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data?.type && data.type !== "connected") cbRef.current?.(data);
        } catch {
          // abaikan pesan yang bukan JSON
        }
      };
      ws.onclose = () => {
        if (!stopped) retryTimer = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      ws?.close();
    };
  }, []);
}
