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
import { COLUMN_COLORS } from "../lib/types";
import type { Ticket } from "../lib/types";
import { AppShell } from "../components/layout/AppShell";

const BASE = import.meta.env.VITE_API_URL ?? "";

export default function Board() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const board = useBoardStore((s) => s.board);
  const reset = useBoardStore((s) => s.reset);
  const setPendingUndo = useBoardStore((s) => s.setPendingUndo);

  // Check for participant name — prompt if missing (joined via shared link)
  const [participantName, setParticipantName] = useState(() => {
    return sessionStorage.getItem(`participant_name_${id}`) ?? "";
  });
  const [nameInput, setNameInput] = useState("");
  const [checkingAnonymous, setCheckingAnonymous] = useState(!participantName);

  // For shared-link joins, check if board is anonymous before showing name prompt
  useEffect(() => {
    if (participantName || !id) return;
    let cancelled = false;
    fetch(`${BASE}/api/boards/${id}`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.is_anonymous) {
          sessionStorage.setItem(`participant_name_${id}`, "__anonymous__");
          setParticipantName("__anonymous__");
        }
        setCheckingAnonymous(false);
      })
      .catch(() => {
        if (!cancelled) setCheckingAnonymous(false);
      });
    return () => { cancelled = true; };
  }, [id, participantName]);

  const { send } = useWebSocket(id ?? "", participantName);

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
      const color = COLUMN_COLORS[colIndex % COLUMN_COLORS.length];
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
        activeData.ticket.id !== overData.ticketId &&
        activeData.columnId === overData.columnId
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

  // While checking if board is anonymous, show loading
  if (checkingAnonymous) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted">Loading...</p>
      </div>
    );
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

  return (
    <AppShell>
      <BoardHeader send={send} />
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <main className="flex-1 overflow-x-auto">
          <div className="max-w-[1400px] mx-auto px-4 py-6">
            <div className="flex gap-6">
              {board.columns.map((col, i) => (
                <Column
                  key={col.id}
                  column={col}
                  color={COLUMN_COLORS[i % COLUMN_COLORS.length]}
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
    </AppShell>
  );
}
