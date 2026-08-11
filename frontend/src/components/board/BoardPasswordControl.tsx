import { useState } from "react";
import { useBoardStore } from "../../store/boardStore";
import { setBoardPassword } from "../../lib/api";
import { MIN_BOARD_PASSWORD_LENGTH } from "../../lib/types";

interface BoardPasswordControlProps {
  boardId: string;
}

/**
 * The lock on the board, in the hands of the facilitator.
 *
 * A password shuts the board to everyone who has not typed it, the facilitator apart. Every write
 * makes a new key, so a change asks the room again the next time each person opens the board.
 */
export function BoardPasswordControl({ boardId }: BoardPasswordControlProps) {
  const hasPassword = useBoardStore((s) => s.board?.has_password ?? false);
  const [editing, setEditing] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  function reset() {
    setEditing(false);
    setPassword("");
    setError("");
  }

  async function save() {
    const next = password.trim();
    if (next.length < MIN_BOARD_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_BOARD_PASSWORD_LENGTH} characters.`);
      return;
    }

    setBusy(true);
    setError("");
    try {
      await setBoardPassword(boardId, next);
      reset();
      setDone("Password set.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The password did not save.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    try {
      await setBoardPassword(boardId, null);
      reset();
      setDone("Password removed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The password did not come off.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Password</span>
        {!editing && (
          <div className="flex gap-1.5 shrink-0">
            <button
              onClick={() => {
                setEditing(true);
                setDone("");
              }}
              className="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-canvas transition-colors"
            >
              {hasPassword ? "Change" : "Set a password"}
            </button>
            {hasPassword && (
              <button
                onClick={remove}
                disabled={busy}
                className="px-3 py-1.5 text-sm rounded-lg border border-transparent text-muted hover:text-red-600 hover:bg-red-500/10 hover:border-red-500/30 transition-colors disabled:opacity-50"
              >
                Remove
              </button>
            )}
          </div>
        )}
      </div>

      <p className="text-xs text-muted mt-1">
        {hasPassword
          ? "Everyone has to type the password to open this board."
          : "Anyone with the link can open this board."}
      </p>

      {editing && (
        <div className="mt-2.5 animate-card-enter">
          <input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") reset();
            }}
            placeholder="New password"
            autoComplete="new-password"
            className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 bg-canvas"
            autoFocus
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={save}
              disabled={busy || !password.trim()}
              className="flex-1 bg-accent text-white text-sm font-medium py-2 rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save password"}
            </button>
            <button
              onClick={reset}
              className="px-3 py-2 text-sm rounded-lg border border-border hover:bg-canvas transition-colors"
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-muted mt-2">
            Everyone else types it again the next time they open the board.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-red-600 mt-2">
          {error}
        </p>
      )}
      {done && !error && <p className="text-xs text-muted mt-2">{done}</p>}
    </div>
  );
}
