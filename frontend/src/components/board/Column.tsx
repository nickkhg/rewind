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
  const participantId = useBoardStore((s) => s.participantId);
  const voteLimit = useBoardStore((s) => s.board?.vote_limit_per_column ?? null);
  const hideVotes = useBoardStore((s) => s.board?.hide_votes ?? false);
  const isBlurred = useBoardStore((s) => s.board?.is_blurred ?? false);
  // Carried actions come from the last retro. They hold no votes and they never hide.
  const isArchive = column.role === "previous_actions";
  const effectiveSortMode = hideVotes ? "newest" : sortMode;
  const sorted = sortTickets(column.tickets, isArchive ? "newest" : effectiveSortMode);

  // Count how many votes the current participant has in this column
  const myVotesInColumn = participantId
    ? column.tickets.reduce(
        (count, t) => count + (t.votes.includes(participantId) ? 1 : 0),
        0,
      )
    : 0;

  const voteLimitReached = voteLimit !== null && myVotesInColumn >= voteLimit;

  return (
    <div className="flex-1 min-w-[280px] max-w-[400px] flex flex-col min-h-0">
      <div className="flex items-center gap-2 mb-3">
        <div
          className="w-3 h-3 rounded-full shrink-0"
          style={{ backgroundColor: color }}
        />
        <h2 className="font-display font-semibold text-base">{column.name}</h2>
        <span className="text-xs text-muted">{column.tickets.length}</span>
        {voteLimit !== null && !hideVotes && !isArchive && (
          <span className="text-xs text-muted ml-auto">
            {myVotesInColumn}/{voteLimit} votes
          </span>
        )}
      </div>

      <AddTicketForm columnId={column.id} send={send} />

      <div className="space-y-2.5 overflow-y-auto min-h-0 flex-1">
        {isArchive && column.tickets.length === 0 && (
          <p className="text-xs text-muted leading-relaxed border border-dashed border-border rounded-lg px-3 py-4">
            Nothing carried over yet. The facilitator can copy cards from an earlier board in
            Board Settings.
          </p>
        )}
        {sorted.map((ticket) => (
          <DraggableTicket
            key={ticket.id}
            ticket={ticket}
            color={color}
            columnId={column.id}
            columnName={column.name}
            columnRole={column.role}
            voteLimitReached={voteLimitReached}
            isBlurred={isBlurred && !isArchive}
            send={send}
          />
        ))}
      </div>
    </div>
  );
}
