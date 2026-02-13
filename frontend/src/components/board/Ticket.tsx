import { useState, useRef, useEffect } from "react";
import { useBoardStore } from "../../store/boardStore";
import { VoteButton } from "./VoteButton";
import type { Ticket as TicketType, ClientMessage } from "../../lib/types";

interface TicketProps {
  ticket: TicketType;
  color: string;
  voteLimitReached?: boolean;
  send: (msg: ClientMessage) => void;
}

function seededRotation(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  return ((hash % 200) / 100) - 1; // -1 to 1 degrees
}

export function TicketCard({ ticket, color, voteLimitReached, send }: TicketProps) {
  const { participantId, isFacilitator, board } = useBoardStore();
  const isAuthor = ticket.author_id === participantId;
  const isBlurred = board?.is_blurred && !isAuthor;
  const hasVoted = participantId ? ticket.votes.includes(participantId) : false;
  const rotation = seededRotation(ticket.id);

  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(ticket.content);
  const [splitOpen, setSplitOpen] = useState(false);
  const splitRef = useRef<HTMLDivElement>(null);

  const segments = ticket.content.split("\n---\n");
  const isMerged = segments.length > 1;

  useEffect(() => {
    if (!splitOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (splitRef.current && !splitRef.current.contains(e.target as Node)) {
        setSplitOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [splitOpen]);

  function handleSplit(index: number) {
    send({ type: "SplitTicket", payload: { ticket_id: ticket.id, segment_index: index } });
    setSplitOpen(false);
  }

  function handleSaveEdit() {
    const trimmed = editContent.trim();
    if (trimmed && trimmed !== ticket.content) {
      send({ type: "EditTicket", payload: { ticket_id: ticket.id, content: trimmed } });
    }
    setEditing(false);
  }

  function handleRemove() {
    send({ type: "RemoveTicket", payload: { ticket_id: ticket.id } });
  }

  return (
    <div
      className="animate-card-enter bg-surface rounded-lg shadow-sm border border-border/60 p-3 relative group"
      style={{
        borderLeftWidth: "4px",
        borderLeftColor: color,
        transform: `rotate(${rotation}deg)`,
      }}
    >
      {/* Content */}
      {editing ? (
        <div>
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSaveEdit();
              }
              if (e.key === "Escape") setEditing(false);
            }}
            rows={2}
            className="w-full rounded border border-border px-2 py-1 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent/40 bg-surface"
            autoFocus
          />
          <div className="flex gap-1 mt-1">
            <button onClick={handleSaveEdit} className="text-xs text-accent hover:underline">
              Save
            </button>
            <button onClick={() => setEditing(false)} className="text-xs text-muted hover:underline">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p
          className="text-sm whitespace-pre-wrap transition-[filter] duration-500 ease-out"
          style={{ filter: isBlurred ? "blur(8px)" : "blur(0)" }}
        >
          {ticket.content}
        </p>
      )}

      {/* Footer: author, votes, actions */}
      <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-border/40">
        {!board?.is_anonymous && (
          <span
            className="text-xs text-muted truncate max-w-[120px] transition-[filter] duration-500 ease-out"
            style={{ filter: isBlurred ? "blur(8px)" : "blur(0)" }}
          >
            {ticket.author_name}
          </span>
        )}
        <div className="flex items-center gap-2">
          <VoteButton
            ticketId={ticket.id}
            voteCount={ticket.votes.length}
            hasVoted={hasVoted}
            voteLimitReached={voteLimitReached}
            hideVotes={board?.hide_votes}
            send={send}
          />
          {/* Edit/Delete/Split shown on hover for author or facilitator */}
          {(isAuthor || isFacilitator) && !editing && (
            <div className="hidden group-hover:flex items-center gap-1">
              {isMerged && (
                <div className="relative" ref={splitRef}>
                  <button
                    onClick={() => setSplitOpen((v) => !v)}
                    className="text-xs text-muted hover:text-ink"
                  >
                    Split
                  </button>
                  {splitOpen && (
                    <div className="absolute bottom-full mb-1 left-0 z-50 bg-surface border border-border rounded shadow-lg py-1 min-w-[180px] max-w-[260px]">
                      {segments.map((seg, i) => (
                        <button
                          key={i}
                          onClick={() => handleSplit(i)}
                          className="block w-full text-left text-xs text-ink px-3 py-1.5 hover:bg-accent/10 truncate"
                          title={seg.trim()}
                        >
                          {seg.trim().length > 60 ? seg.trim().slice(0, 60) + "..." : seg.trim()}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {isAuthor && (
                <button
                  onClick={() => {
                    setEditContent(ticket.content);
                    setEditing(true);
                  }}
                  className="text-xs text-muted hover:text-ink"
                >
                  Edit
                </button>
              )}
              <button onClick={handleRemove} className="text-xs text-muted hover:text-red-500">
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
