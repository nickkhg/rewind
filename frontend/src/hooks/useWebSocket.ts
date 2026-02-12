import { useEffect, useRef, useCallback } from "react";
import { useBoardStore } from "../store/boardStore";
import type { ClientMessage, ServerMessage } from "../lib/types";

const BASE = import.meta.env.VITE_API_URL ?? "";

function getWsUrl(boardId: string): string {
  if (BASE) {
    const url = new URL(BASE);
    const protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${url.host}/ws/boards/${boardId}`;
  }
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/ws/boards/${boardId}`;
}

export function useWebSocket(boardId: string, participantName: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const { setBoard, setAuth, setConnected } = useBoardStore();

  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    if (!boardId || !participantName) return;

    let reconnectTimer: ReturnType<typeof setTimeout>;
    let alive = true;

    function connect() {
      if (!alive) return;

      const ws = new WebSocket(getWsUrl(boardId));
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        const joinMsg: ClientMessage = {
          type: "Join",
          payload: {
            participant_name: participantName,
          },
        };
        ws.send(JSON.stringify(joinMsg));
      };

      ws.onmessage = (event) => {
        const msg: ServerMessage = JSON.parse(event.data);
        switch (msg.type) {
          case "BoardState":
            setBoard(msg.payload.board);
            break;
          case "Authenticated":
            setAuth(msg.payload.participant_id, msg.payload.is_facilitator);
            break;
          case "Error":
            console.error("Server error:", msg.payload.message);
            break;
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (alive) {
          reconnectTimer = setTimeout(connect, 2000);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      alive = false;
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [boardId, participantName, setBoard, setAuth, setConnected]);

  return { send };
}
