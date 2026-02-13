import { useBoardStore } from "../../store/boardStore";
import { sortTickets } from "../../utils/sort";
import { DraggableTicket } from "./DraggableTicket";
import { AddTicketForm } from "./AddTicketForm";
import type { Column as ColumnType, ClientMessage } from "../../lib/types";

interface ColumnProps {
  column: ColumnType;
  color: string;
  send: (msg: ClientMessage) => void;
}

export function Column({ column, color, send }: ColumnProps) {
  const sortMode = useBoardStore((s) => s.sortMode);
  const sorted = sortTickets(column.tickets, sortMode);

  return (
    <div className="flex-1 min-w-[280px] max-w-[400px]">
      <div className="flex items-center gap-2 mb-3">
        <div
          className="w-3 h-3 rounded-full shrink-0"
          style={{ backgroundColor: color }}
        />
        <h2 className="font-display font-semibold text-base">{column.name}</h2>
        <span className="text-xs text-muted">{column.tickets.length}</span>
      </div>

      <div className="space-y-2.5">
        {sorted.map((ticket) => (
          <DraggableTicket
            key={ticket.id}
            ticket={ticket}
            color={color}
            columnId={column.id}
            send={send}
          />
        ))}
      </div>

      <AddTicketForm columnId={column.id} send={send} />
    </div>
  );
}
