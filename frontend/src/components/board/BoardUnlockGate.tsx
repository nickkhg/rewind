import { useState } from "react";
import { COLUMN_COLORS } from "../../lib/types";

interface BoardUnlockGateProps {
  /** The name of the board, so that the reader knows which meeting they are at. */
  title: string;
  /** Trades the password for the key. Throws with what the server said when the word is wrong. */
  onUnlock: (password: string) => Promise<void>;
}

/** The three cards a reader cannot read yet. Blur is how the whole board says "not yours yet". */
const LOCKED_CARDS = [
  { color: COLUMN_COLORS[0], rotate: -4 },
  { color: COLUMN_COLORS[1], rotate: 2 },
  { color: COLUMN_COLORS[2], rotate: -1 },
];

/**
 * The gate of a locked board: everything the reader may see until they give the password.
 *
 * It stands in the place of the board and of the name prompt, so a person who cannot open the
 * board is never asked for their name first.
 */
export function BoardUnlockGate({ title, onUnlock }: BoardUnlockGateProps) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || submitting) return;

    setSubmitting(true);
    setError("");
    try {
      await onUnlock(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The password is wrong.");
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm animate-card-enter">
        <div className="flex justify-center gap-2 mb-7" aria-hidden="true">
          {LOCKED_CARDS.map(({ color, rotate }) => (
            <div
              key={color}
              className="w-16 h-[72px] rounded-md shadow-sm p-2.5 space-y-1.5"
              style={{
                backgroundColor: color,
                transform: `rotate(${rotate}deg)`,
                filter: "blur(3px) saturate(0.9)",
              }}
            >
              <span className="block h-1.5 rounded-full bg-black/20" />
              <span className="block h-1.5 w-4/5 rounded-full bg-black/20" />
              <span className="block h-1.5 w-1/2 rounded-full bg-black/20" />
            </div>
          ))}
        </div>

        <div className="bg-surface rounded-2xl shadow-sm border border-border p-8">
          <p className="text-[11px] font-medium uppercase tracking-widest text-muted truncate">
            {title}
          </p>
          <h1 className="font-display text-xl font-semibold mt-1.5">
            This board asks for a password
          </h1>

          <form onSubmit={handleSubmit} className="mt-5">
            <label htmlFor="board-password" className="block text-sm font-medium mb-1.5">
              Board password
            </label>
            <input
              id="board-password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError("");
              }}
              autoComplete="off"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 bg-canvas"
              autoFocus
            />
            <button
              type="submit"
              disabled={submitting || !password}
              className="mt-4 w-full bg-accent text-white font-medium py-2.5 rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              {submitting ? "Unlocking…" : "Unlock board"}
            </button>
          </form>

          {error ? (
            <p role="alert" className="text-sm text-red-600 mt-3">
              {error}
            </p>
          ) : (
            <p className="text-xs text-muted mt-3">The facilitator of the retro has it.</p>
          )}
        </div>
      </div>
    </div>
  );
}
