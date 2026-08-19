import { useRef, useState } from "react";
import { updateBoardTitle } from "../../lib/api";

interface BoardTitleProps {
  boardId: string;
  title: string;
  /** The facilitator and the editors rename; everyone else reads a plain title. */
  canRename: boolean;
}

/**
 * The name of the board in the header. A privileged reader clicks the name, or the pencil that
 * appears beside it, and the name becomes a field: Enter saves, Escape cancels, and leaving the
 * field saves. The saved name arrives back on the socket, so this component never writes the
 * store — it only leaves edit mode when the PUT succeeds.
 */
export function BoardTitle({ boardId, title, canRename }: BoardTitleProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Escape unmounts the input, and the blur that follows must not save what was cancelled.
  const cancelled = useRef(false);
  // The name the field opened with. A rename by someone else can land while the field sits
  // untouched, and a blur then must not write the old name back over the new one.
  const openedWith = useRef(title);

  if (!canRename) {
    return <h1 className="font-display text-lg font-semibold truncate">{title}</h1>;
  }

  function startEditing() {
    setDraft(title);
    setError(null);
    cancelled.current = false;
    openedWith.current = title;
    setIsEditing(true);
  }

  async function save() {
    const next = draft.trim();
    // An empty draft, or a draft the reader never changed, asks the server for nothing.
    if (!next || next === title || next === openedWith.current) {
      setIsEditing(false);
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await updateBoardTitle(boardId, next);
      setIsEditing(false);
    } catch {
      setError("The rename did not save");
    } finally {
      setIsSaving(false);
    }
  }

  if (isEditing) {
    return (
      <div className="flex items-center gap-2 min-w-0">
        <input
          autoFocus
          value={draft}
          disabled={isSaving}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              cancelled.current = true;
              setIsEditing(false);
            }
          }}
          onBlur={() => {
            if (!cancelled.current) void save();
          }}
          aria-label="Board name"
          className="font-display text-lg font-semibold bg-surface rounded-lg border border-border px-2 py-0.5 min-w-0 w-56 md:w-72 focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-40"
        />
        {error && <span className="text-xs text-red-500 shrink-0">{error}</span>}
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-1 min-w-0">
      <h1
        className="font-display text-lg font-semibold truncate cursor-text"
        onClick={startEditing}
        title="Click to rename this board"
      >
        {title}
      </h1>
      <button
        type="button"
        onClick={startEditing}
        aria-label="Rename board"
        className="shrink-0 p-1 rounded-md text-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-canvas hover:text-ink transition-opacity"
      >
        <svg
          className="w-3.5 h-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
        </svg>
      </button>
    </div>
  );
}
