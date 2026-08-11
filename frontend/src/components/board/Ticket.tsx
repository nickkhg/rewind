import { useState, useRef, useEffect } from "react";
import { useBoardStore } from "../../store/boardStore";
import { useTicketPermissions } from "../../hooks/useTicketPermissions";
import { VoteButton } from "./VoteButton";
import { CommentButton } from "./CommentThread";
import { DoneToggle } from "./DoneToggle";
import { GifAttachment } from "./GifAttachment";
import { RockStatusControl } from "./RockStatusControl";
import { TicketEditor } from "./TicketEditor";
import { TicketModal } from "./TicketModal";
import { DONE_EDGE_COLOR } from "../../lib/types";
import type { Ticket as TicketType, ClientMessage, ColumnRole } from "../../lib/types";

/** What a click has to miss for it to count as a click on the card itself. */
const INTERACTIVE = "button, a, input, textarea, select, figure";

interface TicketProps {
  ticket: TicketType;
  color: string;
  columnName?: string;
  columnRole?: ColumnRole | null;
  voteLimitReached?: boolean;
  send: (msg: ClientMessage) => void;
}

export function TicketCard({
  ticket,
  color,
  columnName,
  columnRole,
  voteLimitReached,
  send,
}: TicketProps) {
  const board = useBoardStore((s) => s.board);
  const {
    isAuthor,
    isPrivileged,
    isCarried,
    isRock,
    isAction,
    isBlurred,
    canSetDone,
    hasVoted,
    actionsColumn,
  } = useTicketPermissions(ticket, columnRole);

  const canKeep = isCarried && isPrivileged && !!actionsColumn;
  // A finished action stays on the board. It goes quiet instead of going away.
  const isDone = ticket.done_at !== null;
  const showDoneMark = isAction && (canSetDone || isDone);

  const [editing, setEditing] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [openCard, setOpenCard] = useState<null | { focusComposer: boolean }>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const comments = ticket.comments ?? [];

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

  function handleSaveEdit(content: string, gif: TicketType["gif"]) {
    if (content !== ticket.content || gif?.id !== ticket.gif?.id) {
      send({ type: "EditTicket", payload: { ticket_id: ticket.id, content, gif } });
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

  // A card you cannot read yet does not open, and neither does one you are already editing.
  const canOpen = !isBlurred && !editing;

  function handleCardClick(e: React.MouseEvent) {
    if (!canOpen) return;
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
    // Somebody who has just selected words on the card meant to copy them, not to open it.
    if (window.getSelection()?.toString()) return;
    setOpenCard({ focusComposer: false });
  }

  return (
    <div
      onClick={handleCardClick}
      className={`animate-card-enter rounded-lg border p-3 relative group transition-opacity ${
        isCarried ? "bg-canvas border-border" : "bg-surface shadow-sm border-border/60"
      } ${canOpen ? "cursor-pointer" : ""} ${
        isDone ? "opacity-[0.62] hover:opacity-100 focus-within:opacity-100" : ""
      }`}
      style={{
        borderLeftWidth: "4px",
        borderLeftColor: isDone ? DONE_EDGE_COLOR : color,
        // The wash of a closed action. It is mixed into whichever paper the card sits on, so it
        // reads the same on a light board and on a dark one.
        ...(isDone
          ? {
              backgroundColor: `color-mix(in oklab, var(--color-${
                isCarried ? "canvas" : "surface"
              }) 92%, ${DONE_EDGE_COLOR})`,
            }
          : {}),
        ...(isCarried ? { borderLeftStyle: "dashed" as const } : {}),
      }}
    >
      {/* The tick that closes an action, in the corner where nothing else sits. */}
      {showDoneMark && !isBlurred && (
        <div className="absolute top-2.5 right-2.5 z-10">
          <DoneToggle
            ticketId={ticket.id}
            doneAt={ticket.done_at}
            canSet={canSetDone}
            quiet
            send={send}
          />
        </div>
      )}

      {/* Where the carried action came from. It stays with the card after a move to Actions. */}
      {ticket.carried_from_board_title && (
        <p
          className={`text-[10px] uppercase tracking-wider text-muted mb-1.5 truncate ${
            showDoneMark ? "pr-7" : ""
          }`}
        >
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
        <TicketEditor
          initialContent={ticket.content}
          initialGif={ticket.gif}
          onSave={handleSaveEdit}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="relative">
          <p
            className={`text-sm whitespace-pre-wrap transition-[filter] duration-500 ease-out ${
              showDoneMark ? "pr-7" : ""
            }`}
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
              {"🚨 Hacker alert! Did you really think this would work?"}
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
            <CommentButton
              count={comments.length}
              onOpen={() => setOpenCard({ focusComposer: true })}
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
                <button onClick={() => setEditing(true)} className="text-xs text-muted hover:text-ink">
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

      {openCard && (
        <TicketModal
          ticket={ticket}
          color={color}
          columnName={columnName ?? ""}
          columnRole={columnRole}
          voteLimitReached={voteLimitReached}
          focusComposer={openCard.focusComposer}
          send={send}
          onClose={() => setOpenCard(null)}
        />
      )}
    </div>
  );
}
