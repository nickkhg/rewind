import { useDraggable, useDroppable } from "@dnd-kit/core";
import { TicketCard } from "./Ticket";
import type { Ticket as TicketType, ClientMessage } from "../../lib/types";

interface DraggableTicketProps {
  ticket: TicketType;
  color: string;
  columnId: string;
  voteLimitReached?: boolean;
  send: (msg: ClientMessage) => void;
}

export function DraggableTicket({ ticket, color, columnId, voteLimitReached, send }: DraggableTicketProps) {
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: ticket.id,
    data: { type: "ticket", ticket, columnId },
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop-${ticket.id}`,
    data: { type: "merge", ticketId: ticket.id, columnId },
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
        <TicketCard ticket={ticket} color={color} voteLimitReached={voteLimitReached} send={send} />
      </div>
    </div>
  );
}
