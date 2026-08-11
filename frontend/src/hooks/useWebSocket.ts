import { useEffect, useRef, useCallback } from "react";
import { useBoardStore } from "../store/boardStore";
import type { ClientMessage, ServerMessage } from "../lib/types";
import { getServerUrl } from "../lib/serverUrl";
import { clearAccessToken } from "../lib/boardAccess";
import { redirectIfSignedOut } from "../lib/auth";

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
      // A handshake the server refused looks the same to a browser as a network that dropped, so
      // the difference has to be asked for. It is asked once, after a socket that never opened.
      let everOpened = false;

      ws.onopen = () => {
        everOpened = true;
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
        if (!alive) return;

        // A sign-in that ran out mid-meeting turns the socket away at the handshake, and reconnecting
        // for ever would leave the board reading "Reconnecting..." with no way out. So a socket that
        // never opened asks the server whether the session is still there, and the answer sends the
        // browser to the door. On an open server this asks once and learns nothing, which costs a
        // request per failed reconnect and keeps the retry honest.
        if (!everOpened) {
          redirectIfSignedOut().then((leaving) => {
            if (!leaving && alive) reconnectTimer = setTimeout(connect, 2000);
          });
          return;
        }

        reconnectTimer = setTimeout(connect, 2000);
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
