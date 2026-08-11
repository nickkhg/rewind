import { useDraggable, useDroppable } from "@dnd-kit/core";
import { TicketCard } from "./Ticket";
import type { Ticket as TicketType, ClientMessage, ColumnRole } from "../../lib/types";

interface DraggableTicketProps {
  ticket: TicketType;
  color: string;
  columnId: string;
  columnName: string;
  columnRole?: ColumnRole | null;
  voteLimitReached?: boolean;
  isBlurred?: boolean;
  send: (msg: ClientMessage) => void;
}

export function DraggableTicket({ ticket, color, columnId, columnName, columnRole, voteLimitReached, isBlurred, send }: DraggableTicketProps) {
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: ticket.id,
    data: { type: "ticket", ticket, columnId },
    disabled: isBlurred,
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop-${ticket.id}`,
    data: { type: "merge", ticketId: ticket.id, columnId },
    disabled: isBlurred,
  });

  return (
    <div
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      {...listeners}
      {...attributes}
      className="touch-none"
      style={{
        opacity: isDragging ? 0.4 : 1,
        transition: "opacity 150ms ease",
      }}
    >
      <div
        style={{
          boxShadow: isOver ? `0 0 0 2px ${color}` : "none",
          borderRadius: "0.5rem",
          transition: "box-shadow 150ms ease",
        }}
      >
        <TicketCard
          ticket={ticket}
          color={color}
          columnName={columnName}
          columnRole={columnRole}
          voteLimitReached={voteLimitReached}
          send={send}
        />
      </div>
    </div>
  );
}
