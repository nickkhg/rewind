import { useEffect, useRef, useState } from "react";
import { formatRelativeDate } from "../../utils/date";
import { useGifComposer } from "../../hooks/useGifComposer";
import { GifAttachment } from "./GifAttachment";
import { MAX_COMMENT_LENGTH } from "../../lib/types";
import type { ClientMessage, Gif, TicketComment } from "../../lib/types";

/** Below this many characters left, the composer starts to count down. */
const COUNTDOWN_FROM = 80;

interface CommentButtonProps {
  count: number;
  onOpen: () => void;
}

/**
 * The mark in the footer of a card. It carries the count, so a card says how much discussion
 * sits under it without holding any of it, and it opens the card where the discussion lives.
 */
export function CommentButton({ count, onOpen }: CommentButtonProps) {
  const label =
    count === 0 ? "Open the card and comment" : `Open the card · ${count} ${count === 1 ? "comment" : "comments"}`;

  return (
    <button
      onClick={onOpen}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={label}
      title={label}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-canvas text-muted hover:text-ink transition-colors"
    >
      <svg
        viewBox="0 0 14 14"
        className="w-3 h-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M12 8.5a1.5 1.5 0 0 1-1.5 1.5H5l-3 2.5V3.5A1.5 1.5 0 0 1 3.5 2h7A1.5 1.5 0 0 1 12 3.5Z" />
      </svg>
      {count > 0 && <span>{count}</span>}
    </button>
  );
}

interface CommentThreadProps {
  threadId: string;
  ticketId: string;
  comments: TicketComment[];
  color: string;
  isAnonymous: boolean;
  participantId: string | null;
  isPrivileged: boolean;
  /** True when the reader opened the card to write, so the caret starts in the composer. */
  autoFocus?: boolean;
  send: (msg: ClientMessage) => void;
}

/**
 * The comments of one card, set as notes in the margin: a pen mark in the color of the column,
 * the remark, and the writer signed under it.
 */
export function CommentThread({
  threadId,
  ticketId,
  comments,
  color,
  isAnonymous,
  participantId,
  isPrivileged,
  autoFocus,
  send,
}: CommentThreadProps) {
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editGif, setEditGif] = useState<Gif | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);

  // Someone who opened the card from the comment mark came here to write.
  useEffect(() => {
    if (autoFocus) composerRef.current?.focus();
  }, [autoFocus]);

  // A GIF on its own is a whole remark, which is most of what a reaction is.
  const [draftGif, setDraftGif] = useState<Gif | null>(null);

  // `text` is each draft without its `/gif` command, which is what the comment should say.
  const {
    picker: draftPicker,
    hint: draftHint,
    text: draftText,
  } = useGifComposer({
    value: draft,
    onChange: setDraft,
    gif: draftGif,
    onGifChange: setDraftGif,
    anchor: composerRef.current,
    focus: () => composerRef.current?.focus(),
  });

  const {
    picker: editPicker,
    hint: editHint,
    text: editText,
  } = useGifComposer({
    value: editDraft,
    onChange: setEditDraft,
    gif: editGif,
    onGifChange: setEditGif,
    anchor: editRef.current,
    focus: () => editRef.current?.focus(),
  });

  const remaining = MAX_COMMENT_LENGTH - draftText.length;
  const canSend = (draftText.length > 0 || draftGif !== null) && remaining >= 0;

  function handleSend() {
    if (!canSend) return;
    send({
      type: "AddComment",
      payload: { ticket_id: ticketId, content: draftText, gif: draftGif },
    });
    setDraft("");
    setDraftGif(null);
  }

  function handleSaveEdit(comment: TicketComment) {
    if (!editText && !editGif) {
      setEditingId(null);
      return;
    }
    const changed = editText !== comment.content || editGif?.id !== comment.gif?.id;
    if (changed && editText.length <= MAX_COMMENT_LENGTH) {
      send({
        type: "EditComment",
        payload: { comment_id: comment.id, content: editText, gif: editGif },
      });
    }
    setEditingId(null);
  }

  return (
    <div id={threadId}>
      {/* An empty thread says nothing: the composer under it is the invitation. */}
      {comments.length > 0 && (
        <ul className="space-y-3.5 mb-3">
          {comments.map((comment) => {
            const isCommentAuthor = comment.author_id === participantId;
            const editing = editingId === comment.id;

            return (
              <li key={comment.id} className="group/comment relative pl-4">
                {/* The pen mark in the margin that every note hangs from. */}
                <span
                  className="absolute left-0 top-[0.62rem] w-2.5 h-[2px] rounded-full"
                  style={{ backgroundColor: color }}
                  aria-hidden
                />

                {editing ? (
                  <div>
                    <textarea
                      ref={editRef}
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSaveEdit(comment);
                        }
                        // Escape leaves the edit. The card that holds the thread stays open.
                        if (e.key === "Escape") {
                          e.stopPropagation();
                          setEditingId(null);
                        }
                      }}
                      rows={2}
                      maxLength={MAX_COMMENT_LENGTH}
                      className="w-full rounded border border-border px-2 py-1 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent/40 bg-surface"
                      autoFocus
                    />
                    {editGif && (
                      <div className="flex">
                        <GifAttachment
                          gif={editGif}
                          size="comment"
                          onRemove={() => setEditGif(null)}
                        />
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-1 text-xs">
                      <button onClick={() => handleSaveEdit(comment)} className="text-accent hover:underline">
                        Save
                      </button>
                      <button onClick={() => setEditingId(null)} className="text-muted hover:underline">
                        Cancel
                      </button>
                      {editHint && <span className="ml-auto">{editHint}</span>}
                    </div>
                    {editPicker}
                  </div>
                ) : (
                  <>
                    {comment.content && (
                      <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                        {comment.content}
                      </p>
                    )}
                    {comment.gif && <GifAttachment gif={comment.gif} size="comment" />}
                    {/* The note is signed under it, the way a margin note is. */}
                    <div className="flex items-baseline gap-1.5 mt-1 text-[10px] text-muted">
                      {!isAnonymous && comment.author_name && (
                        <span className="uppercase tracking-wider truncate max-w-[110px]">
                          {comment.author_name}
                        </span>
                      )}
                      <time dateTime={comment.created_at} className="shrink-0 opacity-70">
                        {formatRelativeDate(comment.created_at)}
                      </time>
                      {(isCommentAuthor || isPrivileged) && (
                        <span className="ml-auto hidden group-hover/comment:flex items-center gap-2">
                          {isCommentAuthor && (
                            <button
                              onClick={() => {
                                setEditDraft(comment.content);
                                setEditGif(comment.gif);
                                setEditingId(comment.id);
                              }}
                              className="hover:text-ink"
                            >
                              Edit
                            </button>
                          )}
                          <button
                            onClick={() =>
                              send({ type: "RemoveComment", payload: { comment_id: comment.id } })
                            }
                            className="hover:text-red-500"
                          >
                            Delete
                          </button>
                        </span>
                      )}
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <textarea
        ref={composerRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
        placeholder="Write a comment"
        rows={draft ? 3 : 2}
        maxLength={MAX_COMMENT_LENGTH}
        className="w-full rounded-md border border-border bg-canvas px-2.5 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent/40 placeholder:text-muted"
      />

      {draftGif && (
        <div className="flex">
          <GifAttachment gif={draftGif} size="comment" onRemove={() => setDraftGif(null)} />
        </div>
      )}

      {(canSend || draftHint) && (
        <div className="flex items-center gap-2 mt-1">
          {draftHint}
          {remaining <= COUNTDOWN_FROM && (
            <span
              className={`ml-auto text-[10px] ${remaining < 0 ? "text-red-500" : "text-muted"}`}
            >
              {remaining} left
            </span>
          )}
          {canSend && (
            <button
              onClick={handleSend}
              className="ml-auto text-xs px-2.5 py-1 rounded-md bg-accent text-white hover:bg-accent-hover transition-colors"
            >
              Add comment
            </button>
          )}
        </div>
      )}

      {draftPicker}
    </div>
  );
}
