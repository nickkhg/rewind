import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useBoardStore } from "../store/boardStore";
import { useWebSocket } from "../hooks/useWebSocket";
import { BoardHeader } from "../components/board/BoardHeader";
import { Column } from "../components/board/Column";
import { TicketCard } from "../components/board/Ticket";
import { MergeUndoToast } from "../components/board/MergeUndoToast";
import { ScorecardPanel } from "../components/board/ScorecardPanel";
import { WheelOfMisfortuneButton } from "../components/board/WheelOfMisfortune";
import { BoardUnlockGate } from "../components/board/BoardUnlockGate";
import { columnColors } from "../utils/columnColors";
import { isLevel10 } from "../lib/types";
import type { BoardAccess, Ticket } from "../lib/types";
import { fetchBoardAccess, unlockBoard } from "../lib/api";
import { getAccessToken } from "../lib/boardAccess";
import { AppShell } from "../components/layout/AppShell";

export default function Board() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const board = useBoardStore((s) => s.board);
  const isFacilitator = useBoardStore((s) => s.isFacilitator);
  const reset = useBoardStore((s) => s.reset);
  const setPendingUndo = useBoardStore((s) => s.setPendingUndo);
  const passwordRequired = useBoardStore((s) => s.passwordRequired);
  const setPasswordRequired = useBoardStore((s) => s.setPasswordRequired);

  // Check for participant name — prompt if missing (joined via shared link)
  const [participantName, setParticipantName] = useState(() => {
    return sessionStorage.getItem(`participant_name_${id}`) ?? "";
  });
  const [nameInput, setNameInput] = useState("");

  // What this reader may know about the board before the gate opens: the name of it, whether it
  // is locked for them, and whether it will ask for their name.
  const [access, setAccess] = useState<BoardAccess | null>(null);
  const [accessToken, setAccessToken] = useState(() => (id ? getAccessToken(id) : null));
  const [accessError, setAccessError] = useState("");

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetchBoardAccess(id)
      .then((data) => {
        if (cancelled) return;
        setAccess(data);
        // An anonymous board asks for no name, so the prompt is skipped for a shared link too.
        if (data.is_anonymous && !data.is_locked) {
          sessionStorage.setItem(`participant_name_${id}`, "__anonymous__");
          setParticipantName("__anonymous__");
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setAccessError(err instanceof Error ? err.message : "The board did not load.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id, accessToken]);

  // The board stays shut until the key is in hand: the gate first, the name after it.
  const locked = (access?.is_locked ?? false) || passwordRequired;

  const { send } = useWebSocket(id ?? "", locked ? "" : participantName, accessToken);

  const handleUnlock = useCallback(
    async (password: string) => {
      if (!id) return;
      const token = await unlockBoard(id, password);
      // Both have to give way, or the gate would stand in front of a board we now hold the key to.
      setPasswordRequired(false);
      setAccessToken(token);
    },
    [id, setPasswordRequired],
  );

  useEffect(() => {
    return () => {
      reset();
    };
  }, [reset]);

  // Drag-and-drop for ticket merging
  const [activeTicket, setActiveTicket] = useState<{ ticket: Ticket; color: string } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const { ticket, columnId } = event.active.data.current as {
        ticket: Ticket;
        columnId: string;
      };
      // Find the color for this column
      const colIndex = board?.columns.findIndex((c) => c.id === columnId) ?? 0;
      const color = board ? columnColors(board.columns)[colIndex] : "";
      setActiveTicket({ ticket, color });
    },
    [board]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveTicket(null);
      const { over, active } = event;
      if (!over) return;

      const overData = over.data.current as { type: string; ticketId: string; columnId: string } | undefined;
      const activeData = active.data.current as { type: string; ticket: Ticket; columnId: string } | undefined;

      if (
        overData?.type === "merge" &&
        activeData?.type === "ticket" &&
        activeData.ticket.id !== overData.ticketId
      ) {
        send({
          type: "MergeTickets",
          payload: {
            source_ticket_id: activeData.ticket.id,
            target_ticket_id: overData.ticketId,
          },
        });
        setPendingUndo();
      }
    },
    [send, setPendingUndo]
  );

  if (!id) {
    navigate("/");
    return null;
  }

  if (accessError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-surface rounded-2xl shadow-sm border border-border p-8 text-center">
          <h2 className="font-display text-xl font-semibold">This board did not open</h2>
          <p className="text-sm text-muted mt-2">{accessError}</p>
          <button
            onClick={() => navigate("/")}
            className="mt-5 w-full bg-accent text-white font-medium py-2.5 rounded-lg hover:bg-accent-hover transition-colors"
          >
            Back to the start
          </button>
        </div>
      </div>
    );
  }

  // Until the board says whether it is locked, there is nothing to draw.
  if (!access) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted">Loading...</p>
      </div>
    );
  }

  // The gate stands before everything else, the name prompt included.
  if (locked) {
    return <BoardUnlockGate title={access.title} onUnlock={handleUnlock} />;
  }

  // Name entry for participants who joined via shared link (non-anonymous boards)
  if (!participantName) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-surface rounded-2xl shadow-sm border border-border p-8">
          <h2 className="font-display text-xl font-semibold mb-4">Join the retro</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = nameInput.trim();
              if (trimmed) {
                sessionStorage.setItem(`participant_name_${id}`, trimmed);
                setParticipantName(trimmed);
              }
            }}
          >
            <label htmlFor="join-name" className="block text-sm font-medium mb-1.5">
              Your name
            </label>
            <input
              id="join-name"
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="e.g. Alex"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 bg-canvas"
              autoFocus
            />
            <button
              type="submit"
              className="mt-4 w-full bg-accent text-white font-medium py-2.5 rounded-lg hover:bg-accent-hover transition-colors"
            >
              Join
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (!board) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted">Connecting...</p>
      </div>
    );
  }

  const colors = columnColors(board.columns);

  return (
    <AppShell>
      <BoardHeader send={send} />
      {/* The numbers a Level 10 team reads before it works the board. */}
      {isLevel10(board) && <ScorecardPanel send={send} />}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <main className="flex-1 overflow-x-auto min-h-0">
          <div className="max-w-[1400px] mx-auto px-4 py-6 h-full">
            <div className="flex gap-6 h-full">
              {board.columns.map((col, i) => (
                <Column
                  key={col.id}
                  column={col}
                  color={colors[i]}
                  send={send}
                />
              ))}
            </div>
          </div>
        </main>
        <DragOverlay>
          {activeTicket ? (
            <div style={{ transform: "rotate(2deg)", opacity: 0.85, width: 320 }}>
              <TicketCard
                ticket={activeTicket.ticket}
                color={activeTicket.color}
                send={send}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      <MergeUndoToast send={send} />
      {isFacilitator && (
        <WheelOfMisfortuneButton
          send={send}
          boardColumns={board.columns.map((c) => ({ id: c.id, name: c.name, role: c.role }))}
        />
      )}
    </AppShell>
  );
}
