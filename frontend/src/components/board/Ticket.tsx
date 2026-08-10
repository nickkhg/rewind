import { useState, useRef, useEffect } from "react";
import { useBoardStore } from "../../store/boardStore";
import { useGifComposer } from "../../hooks/useGifComposer";
import { VoteButton } from "./VoteButton";
import { CommentThread, CommentToggle } from "./CommentThread";
import { GifAttachment } from "./GifAttachment";
import { RockStatusControl } from "./RockStatusControl";
import type { Ticket as TicketType, ClientMessage, ColumnRole } from "../../lib/types";

interface TicketProps {
  ticket: TicketType;
  color: string;
  columnRole?: ColumnRole | null;
  voteLimitReached?: boolean;
  send: (msg: ClientMessage) => void;
}

export function TicketCard({ ticket, color, columnRole, voteLimitReached, send }: TicketProps) {
  const { participantId, isFacilitator, board, facilitatorPeek } = useBoardStore();
  const isAuthor = ticket.author_id === participantId;
  const isEditor = !!(board && participantId && board.editors.some((e) => e.participant_id === participantId));
  const isPrivileged = isFacilitator || isEditor;
  // A carried action is a record of the last retro, not fresh input: it stays visible and it
  // takes no votes.
  const isCarried = columnRole === "previous_actions";
  // A rock stands for the quarter, so its card carries where it stands.
  const isRock = columnRole === "rocks";
  // A card that came from another board is already public. It stays visible after a move too.
  const fromOtherBoard = isCarried || !!ticket.carried_from_board_title;
  const isBlurred =
    board?.is_blurred && !isAuthor && !fromOtherBoard && !(isPrivileged && facilitatorPeek);
  const hasVoted = participantId ? ticket.votes.includes(participantId) : false;
  // A carried action that is still open belongs in Actions, so that the next retro gets it again.
  const actionsColumn = board?.columns.find((c) => c.role === "actions");
  const canKeep = isCarried && isPrivileged && !!actionsColumn;

  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(ticket.content);
  const [splitOpen, setSplitOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const splitRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const [editGif, setEditGif] = useState<TicketType["gif"]>(ticket.gif);
  const threadId = `comments-${ticket.id}`;
  const comments = ticket.comments ?? [];

  // The editor can search for a GIF the same way the card was written.
  const {
    picker: editPicker,
    hint: editHint,
    text: editText,
  } = useGifComposer({
    value: editContent,
    onChange: setEditContent,
    gif: editGif,
    onGifChange: setEditGif,
    anchor: editRef.current,
    focus: () => editRef.current?.focus(),
  });

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
    // A card has to keep something. Nothing at all leaves it as it was.
    if (!editText && !editGif) {
      setEditing(false);
      return;
    }
    const changed = editText !== ticket.content || editGif?.id !== ticket.gif?.id;
    if (changed) {
      send({
        type: "EditTicket",
        payload: { ticket_id: ticket.id, content: editText, gif: editGif },
      });
    }
    setEditing(false);
  }

  function handleRemove() {
    send({ type: "RemoveTicket", payload: { ticket_id: ticket.id } });
  }

  function handleKeep() {
    if (!actionsColumn) return;
    send({
      type: "MoveTicket",
      payload: { ticket_id: ticket.id, column_id: actionsColumn.id },
    });
  }

  return (
    <div
      className={`animate-card-enter rounded-lg border p-3 relative group ${
        isCarried ? "bg-canvas border-border" : "bg-surface shadow-sm border-border/60"
      }`}
      style={{
        borderLeftWidth: "4px",
        borderLeftColor: color,
        ...(isCarried ? { borderLeftStyle: "dashed" as const } : {}),
      }}
    >
      {/* Where the carried action came from. It stays with the card after a move to Actions. */}
      {ticket.carried_from_board_title && (
        <p className="text-[10px] uppercase tracking-wider text-muted mb-1.5 truncate">
          {ticket.carried_from_board_id ? (
            <a
              href={`/board/${ticket.carried_from_board_id}`}
              onPointerDown={(e) => e.stopPropagation()}
              className="hover:text-accent transition-colors"
            >
              from {ticket.carried_from_board_title}
            </a>
          ) : (
            <>from {ticket.carried_from_board_title}</>
          )}
        </p>
      )}

      {/* Content */}
      {editing ? (
        <div>
          <textarea
            ref={editRef}
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
          {editGif && (
            <div className="flex">
              <GifAttachment gif={editGif} size="card" onRemove={() => setEditGif(null)} />
            </div>
          )}
          <div className="flex items-center gap-2 mt-1">
            <button onClick={handleSaveEdit} className="text-xs text-accent hover:underline">
              Save
            </button>
            <button onClick={() => setEditing(false)} className="text-xs text-muted hover:underline">
              Cancel
            </button>
            {editHint && <span className="ml-auto">{editHint}</span>}
          </div>
          {editPicker}
        </div>
      ) : (
        <div className="relative">
          <p
            className="text-sm whitespace-pre-wrap transition-[filter] duration-500 ease-out"
            style={{
              filter: isBlurred ? "blur(8px)" : "blur(0)",
              ...(isBlurred ? { userSelect: "none", pointerEvents: "none" } as React.CSSProperties : {}),
            }}
          >
            {ticket.content}
          </p>
          {isBlurred && (
            <p
              className="absolute inset-0 text-sm whitespace-pre-wrap text-transparent"
              aria-hidden
            >
              {"\ud83d\udea8 Hacker alert! Did you really think this would work?"}
            </p>
          )}
          {/* The picture carries the point as much as the words, so it hides with them. */}
          {ticket.gif && <GifAttachment gif={ticket.gif} size="card" blurred={isBlurred} />}
        </div>
      )}

      {/* Where the rock stands. A card you cannot read yet carries no mark you could read. */}
      {isRock && !isBlurred && (isAuthor || isPrivileged || ticket.rock_status) && (
        <div className="flex mt-2">
          <RockStatusControl
            ticketId={ticket.id}
            status={ticket.rock_status}
            canSet={isAuthor || isPrivileged}
            send={send}
          />
        </div>
      )}

      {/* Footer: author, votes, actions */}
      <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-border/40">
        {!board?.is_anonymous && (
          <span className="relative">
            <span
              className="text-xs text-muted truncate max-w-[120px] transition-[filter] duration-500 ease-out"
              style={{
                filter: isBlurred ? "blur(8px)" : "blur(0)",
                ...(isBlurred ? { userSelect: "none", pointerEvents: "none" } as React.CSSProperties : {}),
              }}
            >
              {ticket.author_name}
            </span>
            {isBlurred && (
              <span
                className="absolute inset-0 text-xs text-transparent truncate max-w-[120px]"
                aria-hidden
              >
                nice try
              </span>
            )}
          </span>
        )}
        <div className="flex items-center gap-2">
          {/* A card you cannot read yet takes no discussion either. */}
          {!isBlurred && (
            <CommentToggle
              count={comments.length}
              open={commentsOpen}
              threadId={threadId}
              onToggle={() => setCommentsOpen((v) => !v)}
            />
          )}
          {!isCarried && (
            <VoteButton
              ticketId={ticket.id}
              voteCount={ticket.votes.length}
              hasVoted={hasVoted}
              voteLimitReached={voteLimitReached}
              hideVotes={board?.hide_votes}
              send={send}
            />
          )}
          {/* Edit/Delete/Split shown on hover for author, facilitator, or editor */}
          {(isAuthor || isPrivileged) && !editing && (
            <div className="hidden group-hover:flex items-center gap-1">
              {canKeep && (
                <button
                  onClick={handleKeep}
                  className="text-xs text-muted hover:text-accent"
                  title="The action is not done. Move it to Actions, and the next retro gets it again."
                >
                  Move to Actions
                </button>
              )}
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
                    setEditGif(ticket.gif);
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

      {commentsOpen && !isBlurred && (
        <CommentThread
          threadId={threadId}
          ticketId={ticket.id}
          comments={comments}
          color={color}
          isAnonymous={!!board?.is_anonymous}
          participantId={participantId}
          isPrivileged={isPrivileged}
          send={send}
        />
      )}
    </div>
  );
}
