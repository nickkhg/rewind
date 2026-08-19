import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBoardStore } from "../../store/boardStore";
import { useTicketPermissions } from "../../hooks/useTicketPermissions";
import { formatRelativeDate } from "../../utils/date";
import { CommentThread } from "./CommentThread";
import { DoneToggle } from "./DoneToggle";
import { GifAttachment } from "./GifAttachment";
import { RockStatusControl } from "./RockStatusControl";
import { TicketEditor } from "./TicketEditor";
import { VoteButton } from "./VoteButton";
import { DONE_EDGE_COLOR } from "../../lib/types";
import type { Ticket as TicketType, ClientMessage, ColumnRole } from "../../lib/types";

/** What can hold the caret inside the panel, for the ring of focus that Tab runs around. */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

interface TicketModalProps {
  ticket: TicketType;
  color: string;
  columnName: string;
  columnRole?: ColumnRole | null;
  voteLimitReached?: boolean;
  /** True when the reader opened the card from the comment mark, meaning to write. */
  focusComposer?: boolean;
  send: (msg: ClientMessage) => void;
  onClose: () => void;
}

/**
 * One card, lifted off the board and laid on the desk.
 *
 * A column is narrow, so a card on the board says as little as it can: the words, the count of
 * the discussion, and the marks. This is where the rest of it lives — the whole of a long card,
 * the parts of a merged one set apart, and the conversation at the size of a conversation.
 */
export function TicketModal({
  ticket,
  color,
  columnName,
  columnRole,
  voteLimitReached,
  focusComposer,
  send,
  onClose,
}: TicketModalProps) {
  const board = useBoardStore((s) => s.board);
  const participantId = useBoardStore((s) => s.participantId);
  const { isAuthor, isPrivileged, isCarried, isRock, isAction, canEdit, canSetDone, hasVoted, actionsColumn } =
    useTicketPermissions(ticket, columnRole);

  const panelRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);

  // `onClose` is made anew on every render of the card under this panel, so the focus trap must
  // not depend on it: an effect keyed on it would re-run on every rebroadcast of the board and
  // pull the caret out of whatever field the reader was writing in. The trap reads it through a
  // ref instead, and runs once, at mount, which is the one moment focus should move.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const isDone = ticket.done_at !== null;
  const segments = ticket.content.split("\n---\n");
  const isMerged = segments.length > 1;
  const comments = ticket.comments ?? [];
  const canKeep = isCarried && isPrivileged && !!actionsColumn;
  const showDone = isAction && (canSetDone || isDone);
  const titleId = `ticket-modal-${ticket.id}`;

  // The panel takes the keyboard while it is open, gives it back on the way out, and holds the
  // page still behind it.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // A reader who opened the card from the comment mark came to write: the composer takes the
    // caret (its own effect runs first, being deeper in the tree), and the panel must not take
    // it back.
    if (!focusComposer) panelRef.current?.focus();

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const node = panelRef.current;
      if (!node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = bodyOverflow;
      previous?.focus?.();
    };
  }, []);

  function handleSaveEdit(content: string, gif: TicketType["gif"]) {
    if (content !== ticket.content || gif?.id !== ticket.gif?.id) {
      send({ type: "EditTicket", payload: { ticket_id: ticket.id, content, gif } });
    }
    setEditing(false);
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      // The board behind is a drag surface. Nothing that happens in here belongs to it.
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className="absolute inset-0 bg-scrim/40 backdrop-blur-[2px] animate-fade-in"
        onClick={onClose}
        aria-hidden
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="animate-card-lift relative w-full max-w-xl max-h-[86vh] flex flex-col rounded-xl bg-surface ring-1 ring-border/70 shadow-[0_28px_70px_-18px_rgba(45,42,38,0.45)] focus:outline-none"
        // The card keeps the edge it had on the board, run the whole height of the panel.
        style={{ borderLeft: `6px solid ${isDone ? DONE_EDGE_COLOR : color}` }}
      >
        <header className="flex items-center gap-3 px-6 pt-5 pb-3 shrink-0">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: color }}
            aria-hidden
          />
          <span className="text-[11px] uppercase tracking-[0.14em] font-medium text-muted truncate">
            {columnName}
          </span>
          <button
            onClick={onClose}
            aria-label="Close the card"
            title="Close the card"
            className="ml-auto shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-muted hover:text-ink hover:bg-canvas transition-colors"
          >
            <svg
              viewBox="0 0 14 14"
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M3.5 3.5 10.5 10.5M10.5 3.5 3.5 10.5" />
            </svg>
          </button>
        </header>

        <div className="px-6 pb-5 overflow-y-auto flex-1 min-h-0">
          {/* Where the carried action came from, above the words as it is on the card itself. */}
          {ticket.carried_from_board_title && (
            <p className="text-[10px] uppercase tracking-wider text-muted mb-2 truncate">
              {ticket.carried_from_board_id ? (
                <a
                  href={`/board/${ticket.carried_from_board_id}`}
                  className="hover:text-accent transition-colors"
                >
                  from {ticket.carried_from_board_title}
                </a>
              ) : (
                <>from {ticket.carried_from_board_title}</>
              )}
            </p>
          )}

          {editing ? (
            <TicketEditor
              initialContent={ticket.content}
              initialGif={ticket.gif}
              rows={5}
              textClassName="text-base"
              gifSize="modal"
              onSave={handleSaveEdit}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <>
              {/*
                A merged card is more than one voice held together by a rule of dashes. The
                column has no room to say so; here each one gets its own block, and its own way
                back out of the merge.
              */}
              <div id={titleId} className={isDone ? "opacity-70" : undefined}>
                {segments.map((segment, i) => (
                  <div
                    key={i}
                    className={`group/segment relative ${
                      i > 0 ? "mt-3 pt-3 border-t border-border/60" : ""
                    }`}
                  >
                    <p className="text-[17px] leading-[1.55] whitespace-pre-wrap break-words pr-16">
                      {segment.trim()}
                    </p>
                    {isMerged && (isAuthor || isPrivileged) && (
                      <button
                        onClick={() =>
                          send({
                            type: "SplitTicket",
                            payload: { ticket_id: ticket.id, segment_index: i },
                          })
                        }
                        title="Take this part back onto a card of its own"
                        className="absolute top-0 right-0 opacity-0 group-hover/segment:opacity-100 focus-visible:opacity-100 text-[11px] text-muted hover:text-accent transition-opacity"
                      >
                        Split out
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {ticket.gif && <GifAttachment gif={ticket.gif} size="modal" />}
            </>
          )}

          <div className="flex items-center gap-3 flex-wrap mt-4 text-xs text-muted">
            {!board?.is_anonymous && ticket.author_name && (
              <span className="truncate max-w-[160px]">{ticket.author_name}</span>
            )}
            <time dateTime={ticket.created_at}>{formatRelativeDate(ticket.created_at)}</time>
            {isRock && (
              <RockStatusControl
                ticketId={ticket.id}
                status={ticket.rock_status}
                canSet={isAuthor || isPrivileged}
                send={send}
              />
            )}
            {!isCarried && (
              <span className="ml-auto">
                <VoteButton
                  ticketId={ticket.id}
                  voteCount={ticket.votes.length}
                  hasVoted={hasVoted}
                  voteLimitReached={voteLimitReached}
                  hideVotes={board?.hide_votes}
                  send={send}
                />
              </span>
            )}
          </div>

          <div className="mt-5 pt-4 border-t border-border/60">
            <h3 className="font-display text-sm font-semibold mb-3">
              Conversation
              {comments.length > 0 && (
                <span className="ml-1.5 font-body font-normal text-muted">{comments.length}</span>
              )}
            </h3>
            <CommentThread
              threadId={`comments-${ticket.id}`}
              ticketId={ticket.id}
              comments={comments}
              color={color}
              isAnonymous={!!board?.is_anonymous}
              participantId={participantId}
              isPrivileged={isPrivileged}
              autoFocus={focusComposer}
              send={send}
            />
          </div>
        </div>

        {/* A reader who can do nothing to this card gets no bar of controls to read. */}
        {(showDone || canKeep || isAuthor || isPrivileged) && (
        <footer className="flex items-center gap-2 flex-wrap px-6 py-3 shrink-0 border-t border-border/60 bg-canvas/60 rounded-br-xl">
          {showDone && (
            <DoneToggle
              ticketId={ticket.id}
              doneAt={ticket.done_at}
              canSet={canSetDone}
              variant="labelled"
              send={send}
            />
          )}
          <div className="ml-auto flex items-center gap-3 text-xs">
            {canKeep && (
              <button
                onClick={() => {
                  if (!actionsColumn) return;
                  send({
                    type: "MoveTicket",
                    payload: { ticket_id: ticket.id, column_id: actionsColumn.id },
                  });
                  onClose();
                }}
                className="text-muted hover:text-accent transition-colors"
                title="The action is not done. Move it to Actions, and the next retro gets it again."
              >
                Move to Actions
              </button>
            )}
            {canEdit && !editing && (
              <button
                onClick={() => setEditing(true)}
                className="text-muted hover:text-ink transition-colors"
              >
                Edit
              </button>
            )}
            {(isAuthor || isPrivileged) && (
              <button
                onClick={() => {
                  send({ type: "RemoveTicket", payload: { ticket_id: ticket.id } });
                  onClose();
                }}
                className="text-muted hover:text-red-500 transition-colors"
              >
                Delete
              </button>
            )}
          </div>
        </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
