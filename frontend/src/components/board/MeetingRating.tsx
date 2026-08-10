import { useEffect, useRef, useState } from "react";
import { useBoardStore } from "../../store/boardStore";
import type { ClientMessage } from "../../lib/types";

/** A Level 10 meeting closes on a mark out of ten. */
const SCALE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

interface MeetingRatingProps {
  send: (msg: ClientMessage) => void;
}

/**
 * The mark the room gives the meeting. The header carries the average, and the strip of ten
 * below it is the ruler everyone marks: your own mark is filled, and a second mark replaces it.
 */
export function MeetingRating({ send }: MeetingRatingProps) {
  const ratings = useBoardStore((s) => s.board?.meeting_ratings ?? []);
  const participantId = useBoardStore((s) => s.participantId);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const mine = participantId
    ? ratings.find((r) => r.participant_id === participantId)?.rating ?? null
    : null;
  const average =
    ratings.length > 0
      ? ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length
      : null;

  function handleRate(rating: number) {
    send({ type: "RateMeeting", payload: { rating } });
    setOpen(false);
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex items-center gap-1.5 px-3 py-1 rounded-lg border transition-colors ${
          open ? "border-accent/40 bg-accent/10" : "border-border bg-canvas hover:border-accent/40"
        }`}
      >
        {average === null ? (
          <span className="text-sm font-medium">Rate 1&ndash;10</span>
        ) : (
          <>
            <span className="text-xs text-muted">Rating</span>
            <span className="text-sm font-semibold tabular-nums">{average.toFixed(1)}</span>
            <span className="text-xs text-muted tabular-nums">
              {"·"} {ratings.length}
            </span>
          </>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-[320px] max-w-[calc(100vw-1.5rem)] bg-surface border border-border rounded-xl shadow-xl p-3.5">
          <h3 className="font-display font-semibold text-sm">How was this meeting?</h3>

          <div className="grid grid-cols-10 gap-1 mt-3">
            {SCALE.map((n) => (
              <button
                key={n}
                onClick={() => handleRate(n)}
                aria-pressed={mine === n}
                className={`h-9 rounded-md border text-[11px] font-medium tabular-nums transition-colors ${
                  mine === n
                    ? "border-accent bg-accent text-white"
                    : "border-border hover:border-accent/40 hover:bg-accent/10"
                }`}
              >
                {n}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between mt-1.5 text-[10px] text-muted">
            <span>1 {"·"} poor</span>
            <span>10 {"·"} great</span>
          </div>

          <p className="text-xs text-muted mt-3 pt-2.5 border-t border-border">
            {average === null
              ? "Nobody has rated it yet."
              : `Average ${average.toFixed(1)} from ${ratings.length} ${
                  ratings.length === 1 ? "person" : "people"
                }.`}
          </p>
        </div>
      )}
    </div>
  );
}
