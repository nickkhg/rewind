import { useEffect, useRef, useCallback } from "react";
import { useBoardStore } from "../store/boardStore";
import type { ClientMessage, ServerMessage } from "../lib/types";
import { getServerUrl } from "../lib/serverUrl";
import { clearAccessToken } from "../lib/boardAccess";

function getWsUrl(boardId: string): string {
  const base = getServerUrl();
  if (base) {
    const url = new URL(base);
    const protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${url.host}/ws/boards/${boardId}`;
  }
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/ws/boards/${boardId}`;
}

/**
 * Holds the socket of one board open.
 *
 * `accessToken` is the key to a locked board. It is sent with the Join, and a change of it
 * reconnects, which is how a reader who has just passed the gate gets onto the board.
 */
export function useWebSocket(
  boardId: string,
  participantName: string,
  accessToken?: string | null,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const { setBoard, setAuth, setConnected, setPasswordRequired } = useBoardStore();

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
        const storedId = sessionStorage.getItem(`participant_id_${boardId}`);
        const facToken = sessionStorage.getItem(`facilitator_token_${boardId}`);
        const joinMsg: ClientMessage = {
          type: "Join",
          payload: {
            participant_name: participantName,
            ...(storedId ? { participant_id: storedId } : {}),
            ...(facToken ? { facilitator_token: facToken } : {}),
            ...(accessToken ? { access_token: accessToken } : {}),
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
            sessionStorage.setItem(`participant_id_${boardId}`, msg.payload.participant_id);
            setAuth(msg.payload.participant_id, msg.payload.is_facilitator);
            setPasswordRequired(false);
            break;
          case "PasswordRequired":
            // The key we hold, if any, opens nothing. Drop it and let the gate ask again.
            clearAccessToken(boardId);
            setPasswordRequired(true);
            alive = false;
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
  }, [
    boardId,
    participantName,
    accessToken,
    setBoard,
    setAuth,
    setConnected,
    setPasswordRequired,
  ]);

  return { send };
}
